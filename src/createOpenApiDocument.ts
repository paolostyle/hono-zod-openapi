import type { Hono } from 'hono';
import { z } from 'zod';
import {
  createDocument,
  type ZodOpenApiObject,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
  type ZodOpenApiResponsesObject,
} from 'zod-openapi';
import { normalizeResponse } from './normalizeResponse';
import { OpenApiSymbol } from './openApi';
import type {
  HonoOpenApiResponses,
  Method,
  NormalizedRequestSchemas,
  Operation,
  RequestSchemas,
  StatusCodeWithWildcards,
} from './types';

type Settings = {
  routeName?: string;
  addRoute?: boolean;
};

export function createOpenApiDocument(
  router: Hono,
  document: Omit<ZodOpenApiObject, 'openapi'>,
  { addRoute = true, routeName = '/doc' }: Settings = {},
): ReturnType<typeof createDocument> {
  const paths: ZodOpenApiPathsObject = {};

  router.routes
    .filter((route) => OpenApiSymbol in route.handler)
    .forEach((route) => {
      const { request, responses, ...rest } = (route.handler as any)[
        OpenApiSymbol
      ] as Operation;
      const path = `${route.method} ${route.path}`;

      const operation: ZodOpenApiOperationObject = {
        responses: processResponses(responses, path),
        ...(request ? processRequest(request) : {}),
        ...rest,
      };

      if (!(route.path in paths)) {
        paths[route.path] = {};
      }

      paths[route.path][route.method.toLowerCase() as Method] = operation;
    });

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
  req: RequestSchemas,
): Pick<ZodOpenApiOperationObject, 'requestBody' | 'requestParams'> => {
  const normalizedReq: NormalizedRequestSchemas = Object.fromEntries(
    Object.entries(req).map(
      ([key, value]) =>
        [key, value instanceof z.Schema ? value : value.schema] as const,
    ),
  );

  return {
    requestParams: {
      cookie: normalizedReq.cookie,
      header: normalizedReq.header,
      query: normalizedReq.query,
      path: normalizedReq.param,
    },
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
