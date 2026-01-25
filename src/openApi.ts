import { zValidator } from '@hono/zod-validator';
import { every } from 'hono/combine';
import { createMiddleware } from 'hono/factory';
import * as z from 'zod';
import type {
  HonoOpenApiMiddleware,
  HonoOpenApiMiddlewareEnv,
  HonoOpenApiOperation,
  HonoOpenApiRequestSchemas,
  HonoOpenApiResponses,
  ResponseSchema,
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

    const middleware = createMiddleware<
      HonoOpenApiMiddlewareEnv<Res>,
      P,
      Values<Req>
    >(async (c, next) => {
      c.set('res', (status, payload, headers) => {
        const match = Object.entries(responses)
          .flatMap<ResponseSchema>(([status, res]) => {
            // direct zod schema
            if (res instanceof z.ZodType) {
              const contentType = determineContentType(res);
              return [{ status, schema: res, contentType }];
              // library notation
            } else if ('schema' in res) {
              const schema = res.schema;
              const contentType = res.mediaType ?? determineContentType(schema);
              return [{ status, schema, contentType }];
              // openapi notation
            } else if ('content' in res && typeof res.content === 'object') {
              return Object.entries(res.content).map(
                ([contentType, definition]) => {
                  if (!definition) {
                    return { status, schema: null, contentType };
                  }

                  if (definition.schema instanceof z.ZodType) {
                    return { status, schema: definition.schema, contentType };
                  }

                  return { status, schema: null, contentType };
                },
              );
            }

            return [{ status, schema: null, contentType: null }];
          })
          .find((r) => r.status.toString() === status.toString());

        if (!match) {
          throw new Error(
            `Response schema for status ${status as string} not defined in OpenAPI operation.`,
          );
        }

        // if (match.contentType === 'text/plain') {
        //   return c.text(payload as string, match.status, headers);
        // }
      });
      every(...validators)(c, next);
      await next();
    });

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
