import type { Env, Hono, Schema } from 'hono';
import * as z from 'zod';
import {
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
  type ZodOpenApiResponsesObject,
  createDocument,
} from 'zod-openapi';
import { normalizeResponse } from './normalizeResponse.ts';
import { mergeOperations } from './mergeOperation.ts';
import {
  describeRuntimeConflict,
  detectOpenApiRuntimeConflicts,
} from './conflicts.ts';
import { OpenApiSymbol } from './symbols.ts';
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

  // every chain entry of a route is registered as its own route in Hono, so
  // the shapes of sibling middlewares (e.g. a reusable auth fragment and the
  // route's own `openApi()`) collected here would otherwise merge silently
  // with the later declaration winning. Fail fast on conflicting schemas.
  const shapesByRoute = new Map<
    string,
    Array<{ path: string; operation: HonoOpenApiOperation }>
  >();

  // Keep unprocessed operations so sibling slots merge as `openApi` operations
  // (request schemas included) before document-specific normalization. Merging
  // already-processed operations would lose earlier request targets because
  // they only carry `requestParams`/`requestBody`, not `request`.
  const operationsByRoute = new Map<
    string,
    {
      method: Method;
      path: string;
      pathWithMethod: string;
      operation: HonoOpenApiOperation;
    }
  >();

  for (const route of router.routes) {
    const handler =
      COMPOSED_HANDLER in route.handler
        ? (route.handler.__COMPOSED_HANDLER as H)
        : route.handler;

    if (!(OpenApiSymbol in handler)) {
      continue;
    }

    const rawOperation = handler[OpenApiSymbol] as HonoOpenApiOperation;
    const { request, responses, ...rest } = rawOperation;

    if (hasWildcardSegment(route.path)) {
      throw new Error(
        `Cannot document wildcard route "${route.method} ${route.path}": ` +
          'OpenAPI paths do not support "*" segments. Use a concrete path or add the operation to the document manually.',
      );
    }

    const path = normalizePathParams(route.path);
    const pathWithMethod = `${route.method} ${path}`;
    const method = route.method.toLowerCase() as Method;
    const routeKey = `${route.method} ${path}`;

    const shapes = shapesByRoute.get(routeKey) ?? [];
    shapes.push({ path, operation: { request, responses, ...rest } });
    shapesByRoute.set(routeKey, shapes);

    const operationKey = `${method} ${path}`;
    const previous = operationsByRoute.get(operationKey);
    operationsByRoute.set(operationKey, {
      method,
      path,
      pathWithMethod,
      operation: previous
        ? mergeOperations(previous.operation, rawOperation)
        : rawOperation,
    });
  }

  for (const [routeKey, shapes] of shapesByRoute) {
    for (let i = 1; i < shapes.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const conflicts = detectOpenApiRuntimeConflicts(
          shapes[j].operation,
          shapes[i].operation,
        );

        if (conflicts.length > 0) {
          const details = conflicts.map(describeRuntimeConflict).join(', ');
          throw new Error(
            `${routeKey}: ${details} conflict along the same route chain. ` +
              'Request targets may add distinct properties; overlapping request properties and response statuses require matching schemas.',
          );
        }
      }
    }
  }

  for (const {
    method,
    path,
    pathWithMethod,
    operation,
  } of operationsByRoute.values()) {
    const { request, responses, ...rest } = operation;
    const openApiOperation: ZodOpenApiOperationObject = {
      responses: processResponses(responses, pathWithMethod),
      ...(request ? processRequest(request) : {}),
      ...rest,
    };

    if (!(path in paths)) {
      paths[path] = {};
    }

    // stacked `openApi()` fragments of the same route merge (the later
    // fragment wins on conflicting doc keys)
    paths[path][method] = openApiOperation;
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

/**
 * Hono uses a standalone `*` segment for catch-all routes. OpenAPI has no
 * equivalent path template, so such routes cannot be documented faithfully.
 * Stars inside a parameter matcher (e.g. `:id{[0-9]*}`) are not wildcards.
 */
export const hasWildcardSegment = (path: string): boolean =>
  /(^|\/)\*(?:\/|$)/.test(path);
