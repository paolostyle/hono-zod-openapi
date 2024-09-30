import { zValidator } from '@hono/zod-validator';
import type { Env, Hono, MiddlewareHandler } from 'hono';
import { every } from 'hono/combine';
import { createMiddleware } from 'hono/factory';
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
  AnyZ,
  EndpointDetails,
  Method,
  NormalizedRequestSchemas,
  PathsSchemas,
  RequestSchemas,
  ResponseParams,
  ResponseSchemas,
  StatusCodePrefix,
  StatusCodeWithWildcards,
  ValidationTarget,
  Values,
  ZodValidatorFn,
} from './types';

const OpenApiSymbol = Symbol();

function normalizeResponseSchemas<T extends AnyZ>(
  responseSchemas: T | ResponseParams<T> | Array<ResponseParams<T>>,
): Array<ResponseParams<T>> {
  if (Array.isArray(responseSchemas)) {
    return responseSchemas;
  }

  if ('schema' in responseSchemas) {
    return [responseSchemas];
  }

  return [
    {
      status: 200,
      schema: responseSchemas,
      description: '200 OK',
    },
  ];
}

export function createOpenApiMiddleware(
  zodValidator: ZodValidatorFn = zValidator,
  { validateResponse = false } = {},
) {
  return function openApi<
    ResS extends ResponseSchemas,
    ReqS extends RequestSchemas,
    E extends Env,
    P extends string,
  >(
    responseSchemas: ResS,
    requestSchemas: ReqS = {} as ReqS,
    endpointDetails: EndpointDetails = {},
  ): MiddlewareHandler<E, P, Values<ReqS>> {
    const normalizedResponseSchemas = normalizeResponseSchemas(responseSchemas);

    const validateResponseMiddleware = createMiddleware(async (c, next) => {
      await next();

      const response = c.res as Response;
      const responseParams = normalizedResponseSchemas.find((i) => {
        if (i.status === response.status) return true;
        const statusPrefix = `${response.status}`[0] as StatusCodePrefix;
        return i.status === statusPrefix + 'XX';
      });

      if (!responseParams) return;

      const { schema, validate, mediaType } = responseParams;
      const shouldValidate =
        validate || (validateResponse && validate !== false);
      const contentType = response.headers.get('content-type');

      if (!shouldValidate) return;

      if (mediaType && contentType !== mediaType) {
        throw new Error(
          'Content type does not match the response schema definition',
        );
      } else {
        responseParams.mediaType ??= contentType ?? 'application/json';
      }

      const copy = response.clone();
      const body = await response.json();

      schema.parse(body);

      c.res = copy;
    });

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

    if (validateResponse) {
      validators.push(validateResponseMiddleware);
    }

    const middleware = every(...validators);

    return Object.assign(middleware, {
      [OpenApiSymbol]: {
        request: requestSchemas,
        response: normalizedResponseSchemas,
        endpointDetails,
      },
    });
  };
}

export const openApi = createOpenApiMiddleware();

type Settings = {
  routeName?: string;
  addRoute?: boolean;
  overrides?: (
    paths: NonNullable<ZodOpenApiObject['paths']>,
  ) => Partial<ZodOpenApiObject>;
};

export function createOpenApiDocs(
  router: Hono,
  info: ZodOpenApiObject['info'],
  { addRoute = true, routeName = '/doc', overrides }: Settings = {},
  // fixme: return type
): Record<string, any> {
  const paths: ZodOpenApiPathsObject = {};

  router.routes
    .filter((route) => OpenApiSymbol in route.handler)
    .forEach((route) => {
      const { request, response, endpointDetails } = (route.handler as any)[
        OpenApiSymbol
      ] as PathsSchemas;

      const requestSchemas: NormalizedRequestSchemas = Object.fromEntries(
        Object.entries(request).map(
          ([key, value]) =>
            [key, value instanceof z.Schema ? value : value.schema] as const,
        ),
      );

      const responses = response.reduce<ZodOpenApiResponsesObject>(
        (
          acc,
          { description, schema, mediaType = 'application/json', status },
        ) => {
          acc[status as `${StatusCodeWithWildcards}`] = {
            description,
            content: {
              [mediaType]: {
                schema,
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
        ...endpointDetails,
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
    router.get(routeName, (c) => c.json(openApiDoc, 200));
  }

  return openApiDoc;
}
