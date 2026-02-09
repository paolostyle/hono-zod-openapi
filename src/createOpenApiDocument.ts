import type { Env, Hono, Schema } from 'hono';
import * as z from 'zod';
import {
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
  type ZodOpenApiResponsesObject,
  createDocument,
} from 'zod-openapi';
import { normalizeResponse } from './normalizeResponse.ts';
import { OpenApiSymbol } from './openApi.ts';
import type {
  HonoOpenApiDocument,
  HonoOpenApiOperation,
  HonoOpenApiRequestSchemas,
  HonoOpenApiResponses,
  Method,
  NormalizedRequestSchemas,
  StatusCodeWithWildcards,
} from './types.ts';
import type { H } from 'hono/types';

// when defining .onError on Hono instance, the framework internally wraps
// all handlers defined earlier with a composed handler that has the original handler
// under this property. The OpenApiSymbol is added to the original
// handler, so we need to check for both when looking for OpenAPI metadata
const COMPOSED_HANDLER = '__COMPOSED_HANDLER' as const;

interface DocumentRouteSettings {
  /**
   * Whether to add a new route with the OpenAPI document.
   * @default true
   */
  addRoute?: boolean;
  /**
   * Route name under which the OpenAPI document will be available, assuming `settings.addRoute` is `true`.
   * @default '/doc'
   */
  routeName?: string;
}

/**
 * Creates an OpenAPI document from a Hono router based on the routes decorated with `openApi` middleware.
 * By default it will create a new route at `/doc` that returns the OpenAPI document.
 * @param router Hono router containing routes decorated with `openApi` middleware
 * @param document OpenAPI document base. An object with at least `info` property is required
 * @param [routeSettings] Settings for the route that will serve the OpenAPI document
 * @returns object representing the OpenAPI document
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { z } from 'zod';
 * import { createOpenApiDocument, openApi } from 'hono-zod-openapi';
 *
 * export const app = new Hono().get(
 *   '/user',
 *   openApi({
 *     tags: ['User'],
 *     responses: {
 *       200: z.object({ hi: z.string() }).meta({ example: { hi: 'user' } }),
 *     },
 *     request: {
 *       query: z.object({ id: z.string() }),
 *     },
 *   }),
 *   (c) => {
 *     const { id } = c.req.valid('query');
 *     return c.json({ hi: id }, 200);
 *   },
 * );
 *
 * createOpenApiDocument(app, {
 *   info: {
 *     title: 'Example API',
 *     version: '1.0.0',
 *   },
 * });
 * ```
 */
export function createOpenApiDocument<
  E extends Env,
  S extends Schema,
  P extends string,
>(
  router: Hono<E, S, P>,
  document: HonoOpenApiDocument,
  { addRoute = true, routeName = '/doc' }: DocumentRouteSettings = {},
): ReturnType<typeof createDocument> {
  const paths: ZodOpenApiPathsObject = {};

  for (const route of router.routes) {
    const handler =
      COMPOSED_HANDLER in route.handler
        ? (route.handler.__COMPOSED_HANDLER as H)
        : route.handler;

    if (!(OpenApiSymbol in handler)) {
      continue;
    }

    const { request, responses, ...rest } = handler[
      OpenApiSymbol
    ] as HonoOpenApiOperation;

    const path = normalizePathParams(route.path);
    const pathWithMethod = `${route.method} ${path}`;

    const operation: ZodOpenApiOperationObject = {
      responses: processResponses(responses, pathWithMethod),
      ...(request ? processRequest(request) : {}),
      ...rest,
    };

    if (!(path in paths)) {
      paths[path] = {};
    }

    paths[path][route.method.toLowerCase() as Method] = operation;
  }

  const openApiDoc = createDocument({
    ...document,
    openapi: '3.1.0',
    paths: {
      ...document.paths,
      ...paths,
    },
  });

  if (addRoute) {
    router.get(routeName, (c) => c.json(openApiDoc, 200));
  }

  return openApiDoc;
}

export const processRequest = (
  req: HonoOpenApiRequestSchemas,
): Pick<ZodOpenApiOperationObject, 'requestBody' | 'requestParams'> => {
  const normalizedReq: NormalizedRequestSchemas = Object.fromEntries(
    Object.entries(req).map(
      ([key, value]) =>
        [key, value instanceof z.ZodType ? value : value.schema] as const,
    ),
  );

  const requestParams = Object.fromEntries(
    Object.entries({
      cookie: normalizedReq.cookie,
      header: normalizedReq.header,
      query: normalizedReq.query,
      path: normalizedReq.param,
    }).filter(([_, schema]) => schema !== undefined),
  );

  return {
    requestParams,
    requestBody: normalizedReq.json && {
      content: {
        'application/json': {
          schema: normalizedReq.json,
        },
      },
    },
  };
};

export const processResponses = (
  res: HonoOpenApiResponses,
  path: string,
): ZodOpenApiResponsesObject => {
  return Object.fromEntries(
    Object.entries(res).map(([status, schema]) => {
      const response = normalizeResponse(
        schema,
        status as StatusCodeWithWildcards,
        path,
      );
      return [status, response];
    }),
  );
};

export const normalizePathParams = (path: string): string => {
  return path.replace(/:([a-zA-Z0-9-_]+)\??(\{.*?\})?/g, '{$1}');
};
