import { zValidator } from '@hono/zod-validator';
import type { Env, Hono, MiddlewareHandler } from 'hono';
import { every } from 'hono/combine';
import { z } from 'zod';
import {
  createDocument,
  type ZodOpenApiObject,
  type ZodOpenApiOperationObject,
  type ZodOpenApiPathsObject,
  type ZodOpenApiRequestBodyObject,
  type ZodOpenApiResponseObject,
  type ZodOpenApiResponsesObject,
} from 'zod-openapi';
import type {
  Method,
  NormalizedRequestSchemas,
  NormalizedResponseSchemas,
  PathSchemas,
  RequestSchemas,
  ResponseSchemas,
  ValidationTarget,
  Values,
  ZodValidatorFn,
} from './types';

const OpenApiSymbol = Symbol();

export function createOpenApiMiddleware(
  zodValidator: ZodValidatorFn = zValidator,
) {
  return function openApi<
    ReqS extends RequestSchemas,
    ResS extends ResponseSchemas,
    E extends Env,
    P extends string,
  >(
    responseSchemas: ResS,
    requestSchemas: ReqS = {} as ReqS,
  ): MiddlewareHandler<E, P, Values<ReqS>> {
    const validators = Object.entries(requestSchemas)
      .map(([target, schemaOrParams]) => {
        const schema =
          schemaOrParams instanceof z.Schema
            ? schemaOrParams
            : schemaOrParams.validate !== false
              ? schemaOrParams.schema
              : null;

        if (!schema) return;

        return zodValidator(target as ValidationTarget, schema);
      })
      .filter((v) => !!v);

    const middleware = every(...validators);

    return Object.assign(middleware, {
      [OpenApiSymbol]: {
        request: requestSchemas,
        response: responseSchemas,
      },
    });
  };
}

export const openApi = createOpenApiMiddleware();

interface Settings {
  addRoute?: boolean;
  overrides?: (
    paths: NonNullable<ZodOpenApiObject['paths']>,
  ) => Partial<ZodOpenApiObject>;
}

export function createOpenApi(
  router: Hono,
  info: ZodOpenApiObject['info'],
  { addRoute = true, overrides }: Settings = {},
  // fixme: return type
): Record<string, any> {
  const paths: ZodOpenApiPathsObject = {};

  router.routes
    .filter((route) => OpenApiSymbol in route.handler)
    .forEach((route) => {
      const { request, response } = (route.handler as any)[
        OpenApiSymbol
      ] as PathSchemas;

      const requestSchemas: NormalizedRequestSchemas = Object.fromEntries(
        Object.entries(request).map(
          ([key, value]) =>
            [key, value instanceof z.Schema ? value : value.schema] as const,
        ),
      );

      const responseSchemas: NormalizedResponseSchemas = Array.isArray(response)
        ? response
        : response instanceof z.Schema
          ? [{ status: 200, description: 'Success', schema: response }]
          : [response];

      const responses = responseSchemas.reduce<ZodOpenApiResponsesObject>(
        (
          acc,
          {
            schema,
            status,
            mediaType = 'application/json',
            description,
            example,
          },
        ) => {
          acc[status as any] = {
            description,
            content: {
              [mediaType]: {
                schema,
                example,
              },
            },
          } satisfies ZodOpenApiResponseObject;

          return acc;
        },
        {},
      );

      const requestBody: ZodOpenApiRequestBodyObject = {
        content: {
          'application/json': {
            schema: requestSchemas.json,
          },
        },
      };

      const operation: ZodOpenApiOperationObject = {
        requestParams: {
          cookie: requestSchemas.cookie,
          header: requestSchemas.header,
          query: requestSchemas.query,
          path: requestSchemas.param,
        },
        requestBody: requestSchemas.json && requestBody,
        responses,
      };

      if (!(route.path in paths)) {
        paths[route.path] = {};
      }

      paths[route.path][route.method.toLowerCase() as Method] = operation;
    });

  const openApiDoc = createDocument({
    openapi: '3.1.0',
    info,
    paths,
    ...overrides?.(paths),
  });

  if (addRoute) {
    router.get('/doc', (c) => c.json(openApiDoc, 200));
  }

  return openApiDoc;
}
