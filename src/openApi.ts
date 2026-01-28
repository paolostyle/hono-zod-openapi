import { zValidator } from '@hono/zod-validator';
import { every } from 'hono/combine';
import { createMiddleware } from 'hono/factory';
import * as z from 'zod';
import {
  isContentfulStatusCode,
  isValidResponseStatusCode,
} from './statusCodes.ts';
import type {
  HeaderRecord,
  HonoOpenApiMiddleware,
  HonoOpenApiMiddlewareEnv,
  HonoOpenApiOperation,
  HonoOpenApiRequestSchemas,
  HonoOpenApiResponses,
  ValidationTarget,
  Values,
  ZodValidatorFn,
} from './types.ts';

export const OpenApiSymbol = Symbol();

const determineContentType = (schema: z.ZodType): string | null => {
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
 * Used internally to create the `openApi` middleware. You can use it if you have a custom `zod-validator` middleware,
 * e.g. one that has a custom error handler. Otherwise, you probably don't need it and you should just use `openApi` instead.
 * @param [zodValidator] `@hono/zod-validator`-compatible middleware
 * @returns `openApi` middleware
 */
export function createOpenApiMiddleware(
  zodValidator: ZodValidatorFn = zValidator,
): HonoOpenApiMiddleware {
  return function openApi<
    Req extends HonoOpenApiRequestSchemas,
    P extends string,
    Res extends HonoOpenApiResponses,
  >(operation: HonoOpenApiOperation<Req, Res>) {
    const { request, responses } = operation;
    const metadata = {
      [OpenApiSymbol]: operation,
    };

    if (!request) {
      const emptyMiddleware = createMiddleware(async (_, next) => {
        await next();
      });
      return Object.assign(emptyMiddleware, metadata);
    }

    const validators = Object.entries(request)
      .map(([target, schemaOrParams]) => {
        const schema =
          schemaOrParams instanceof z.ZodType
            ? schemaOrParams
            : schemaOrParams.validate !== false
              ? schemaOrParams.schema
              : null;

        if (!schema) return null;

        return zodValidator(target as ValidationTarget, schema);
      })
      .filter((v) => !!v);

    const resMiddleware = createMiddleware<
      HonoOpenApiMiddlewareEnv<Res>,
      P,
      Values<Req>
    >(async (c, next) => {
      // oxlint-disable-next-line typescript/no-explicit-any
      c.set('res', ((...args: any[]) => {
        let status: number;
        let payload: unknown;
        let headers: HeaderRecord | undefined;

        if (args.length === 1) {
          payload = args[0];
          status = 200;
        } else if (args.length === 2) {
          if (typeof args[0] === 'number') {
            status = args[0];
            payload = args[1];
          } else {
            payload = args[0];
            headers = args[1];
            status = 200;
          }
        } else {
          status = args[0];
          payload = args[1];
          headers = args[2];
        }

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
        const contentType = (() => {
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
        })();

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
    });

    const middleware = every(...validators, resMiddleware);

    return Object.assign(middleware, metadata);
  };
}

/**
 * Hono middleware that documents decorated route. Additionally validates request body/query params/path params etc.,
 * the same way `@hono/zod-validator` does.
 *
 * @see HonoOpenApiOperation for more information on how to use it.
 */
export const openApi: HonoOpenApiMiddleware = createOpenApiMiddleware();

/**
 * A no-op function, used to ensure proper validator's type inference and provide autocomplete in cases where you don't want to define the spec inline.
 * @example
 *
 * ```ts
 * const operation = defineOpenApiOperation({
 *   responses: {
 *     200: z.object({ name: z.string() }),
 *   },
 *   request: {
 *     json: z.object({ email: z.string() }),
 *   },
 * });
 *
 * const app = new Hono().post('/user', openApi(operation), async (c) => {
 *   const { name } = c.req.valid('json');
 *
 *   return c.json({ name }, 200);
 * });
 * ```
 */
export const defineOpenApiOperation = <Req extends HonoOpenApiRequestSchemas>(
  operation: HonoOpenApiOperation<Req>,
) => operation;
