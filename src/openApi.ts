import { zValidator } from '@hono/zod-validator';
import { every } from 'hono/combine';
import { createMiddleware } from 'hono/factory';
import * as z from 'zod';
import { typedResponseMiddleware } from './typedResponse.ts';
import type {
  HonoOpenApiMiddleware,
  HonoOpenApiOperation,
  HonoOpenApiRequestSchemas,
  HonoOpenApiResponses,
  ValidationTarget,
  ZodValidatorFn,
} from './types.ts';

export const OpenApiSymbol = Symbol();

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
    const { request } = operation;
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

    const resMiddleware = typedResponseMiddleware<Req, P, Res>(operation);

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
