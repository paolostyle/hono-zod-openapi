import { createMiddleware } from 'hono/factory';
import * as z from 'zod';
import {
  isContentfulStatusCode,
  isValidResponseStatusCode,
} from './statusCodes.ts';
import type {
  HeaderRecord,
  HonoOpenApiMiddlewareEnv,
  HonoOpenApiOperation,
  HonoOpenApiRequestSchemas,
  HonoOpenApiResponseObject,
  HonoOpenApiResponses,
  Values,
} from './types.ts';

export type ParsedResArgs = {
  status: number;
  payload: unknown;
  headers?: HeaderRecord;
};

/**
 * Parses the arguments passed to the `res` helper function.
 * Supports multiple call signatures:
 * - `res(payload)` - defaults to status 200
 * - `res(status, payload)`
 * - `res(payload, headers)` - defaults to status 200
 * - `res(status, payload, headers)`
 */
export const parseResArgs = (args: unknown[]): ParsedResArgs => {
  const [first, second, third] = args;

  // res(payload)
  if (args.length === 1) {
    return { status: 200, payload: first };
  }

  // res(status, payload) or res(payload, headers)
  if (args.length === 2) {
    const isStatusFirst = typeof first === 'number';
    return isStatusFirst
      ? { status: first, payload: second }
      : { status: 200, payload: first, headers: second as HeaderRecord };
  }

  // res(status, payload, headers)
  return {
    status: first as number,
    payload: second,
    headers: third as HeaderRecord,
  };
};

export const determineContentType = (schema: z.ZodType): string | null => {
  if (schema instanceof z.ZodString || schema instanceof z.ZodStringFormat) {
    return 'text/plain';
  } else if (
    schema instanceof z.ZodVoid ||
    schema instanceof z.ZodUndefined ||
    schema instanceof z.ZodNull ||
    schema instanceof z.ZodNever
  ) {
    return null;
  } else {
    return 'application/json';
  }
};

/**
 * Resolves the content type for a response based on the response schema definition.
 */
export const resolveResponseContentType = (
  res: HonoOpenApiResponseObject,
): string | string[] | null => {
  if (res instanceof z.ZodType) {
    return determineContentType(res);
  } else if ('schema' in res) {
    return res.mediaType ?? determineContentType(res.schema);
  } else if ('content' in res && typeof res.content === 'object') {
    const validContentTypes = Object.entries(res.content)
      .map(([contentType, definition]) =>
        definition?.schema instanceof z.ZodType ? contentType : null,
      )
      .filter((ct): ct is string => !!ct);

    return validContentTypes.length > 0 ? validContentTypes : null;
  }

  return null;
};

export const typedResponseMiddleware = <
  Req extends HonoOpenApiRequestSchemas,
  P extends string,
  Res extends HonoOpenApiResponses,
>({
  responses,
}: HonoOpenApiOperation<Req, Res>) =>
  createMiddleware<HonoOpenApiMiddlewareEnv<Res>, P, Values<Req>>(
    async (c, next) => {
      c.set('res', ((...args: unknown[]) => {
        const { status, payload, headers } = parseResArgs(args);

        if (!isValidResponseStatusCode(status)) {
          throw new Error(
            `Invalid status code: ${status}. Must be a valid HTTP status code.`,
          );
        }

        const match = Object.entries(responses).find(
          ([responseStatus]) => responseStatus === status.toString(),
        );

        if (!match) {
          throw new Error(
            `Response schema for status ${status} not defined in OpenAPI operation.`,
          );
        }

        const [, res] = match;
        const contentType = resolveResponseContentType(res);

        if (!isContentfulStatusCode(status)) {
          return c.body(null, status, headers);
        }

        if (contentType === 'text/plain') {
          return c.text(payload as string, status, headers);
        }

        if (contentType === 'text/html') {
          return c.html(payload as string, status, headers);
        }

        if (contentType === 'application/json') {
          return c.json(payload, status, headers);
        }

        // we avoid validating content in this scenario to not cause runtime errors
        if (Array.isArray(contentType)) {
          if (
            typeof payload === 'object' &&
            contentType.includes('application/json')
          ) {
            return c.json(payload, status, headers);
          }

          if (
            typeof payload === 'string' &&
            contentType.find((ct) => ct.startsWith('text/'))
          ) {
            return c.text(payload, status, headers);
          }
        }

        // oxlint-disable-next-line typescript/no-explicit-any
        return c.body(payload as any, status, headers);
      }) as HonoOpenApiMiddlewareEnv<Res>['Variables']['res']);

      await next();
    },
  );
