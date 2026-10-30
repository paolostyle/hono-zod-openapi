import { zValidator } from '@hono/zod-validator';
import { every } from 'hono/combine';
import type { MiddlewareHandler } from 'hono';
import * as z from 'zod';
import { mergeOperations } from './mergeOperation.ts';
import {
  describeRuntimeConflict,
  detectOpenApiRuntimeConflicts,
} from './conflicts.ts';
import {
  FragmentMiddlewareSymbol,
  FragmentShapeSymbol,
  OpenApiSymbol,
  RequestValidationSchemaSymbol,
} from './symbols.ts';
import { typedResponseMiddleware } from './typedResponse.ts';
import type {
  HonoOpenApiFragmentMiddleware,
  HonoOpenApiMiddleware,
  HonoOpenApiMiddlewareEnv,
  HonoOpenApiOperation,
  HonoOpenApiOperationWithoutResponses,
  HonoOpenApiRequestSchemas,
  HonoOpenApiResponses,
  ValidationTarget,
  Values,
  ZodValidatorFn,
} from './types.ts';
import type { Env } from 'hono';

export { OpenApiSymbol } from './symbols.ts';

/**
 * Used internally to create the `openApi` middleware. You can use it if you have a custom `zod-validator` middleware,
 * e.g. one that has a custom error handler. Otherwise, you probably don't need it and you should just use `openApi` instead.
 * @param [zodValidator] `@hono/zod-validator`-compatible middleware
 * @returns `openApi` middleware
 */
export function createOpenApiMiddleware(
  zodValidator: ZodValidatorFn = zValidator,
): HonoOpenApiMiddleware {
  const openApi = <
    Req extends HonoOpenApiRequestSchemas,
    P extends string,
    Res extends HonoOpenApiResponses,
  >(
    operation: HonoOpenApiOperation<Req, Res>,
    // oxlint-disable-next-line typescript/no-explicit-any
    ...middleware: Array<MiddlewareHandler<any, any, any, any>>
  ): MiddlewareHandler<HonoOpenApiMiddlewareEnv<Res>, P, Values<Req>> => {
    // absorb nested fragments into a single, merge-aware metadata payload
    // `responses` is optional at the call site; normalize it once so the
    // metadata, merged operation, response helper and document generation all
    // observe an empty map instead of `undefined`.
    let mergedOperation: HonoOpenApiOperation<
      HonoOpenApiRequestSchemas,
      HonoOpenApiResponses
    > =
      operation.responses === undefined
        ? { ...operation, responses: {} }
        : (operation as HonoOpenApiOperation<
            HonoOpenApiRequestSchemas,
            HonoOpenApiResponses
          >);
    const composedMiddleware: MiddlewareHandler[] = [];
    for (const mw of middleware) {
      // oxlint-disable-next-line typescript/no-explicit-any -- fragment detection on untyped middleware
      const fragmentShape = (mw as any)[FragmentShapeSymbol] as unknown;
      if (fragmentShape) {
        const conflicts = detectOpenApiRuntimeConflicts(
          mergedOperation,
          fragmentShape as HonoOpenApiOperation,
        );
        if (conflicts.length > 0) {
          throw new Error(
            `openApi(): ${conflicts.map(describeRuntimeConflict).join(', ')} conflict. ` +
              'Request targets may add distinct properties; overlapping request properties and response statuses require matching schemas.',
          );
        }
        mergedOperation = mergeOperations(
          mergedOperation,
          fragmentShape as HonoOpenApiOperation,
        );
        // Reuse the fragment's author middleware, but don't rerun its
        // validators; the merged operation validates each target once.
        const fragmentMiddleware = (
          mw as unknown as Record<PropertyKey, unknown>
        )[FragmentMiddlewareSymbol];
        const nestedMiddleware = Array.isArray(fragmentMiddleware)
          ? (fragmentMiddleware as MiddlewareHandler[])
          : [mw];
        composedMiddleware.push(...nestedMiddleware);
      } else {
        composedMiddleware.push(mw);
      }
    }

    const { request } = mergedOperation;
    const metadata = {
      [OpenApiSymbol]: mergedOperation,
      [FragmentShapeSymbol]: mergedOperation,
    };

    // the merged operation covers responses declared by nested fragments too
    const resMiddleware = typedResponseMiddleware(mergedOperation);

    const validators = Object.entries(request ?? {})
      .map(([target, schemaOrParams]) => {
        const schema =
          schemaOrParams instanceof z.ZodType
            ? schemaOrParams
            : schemaOrParams.validate !== false
              ? (schemaOrParams[RequestValidationSchemaSymbol] ??
                schemaOrParams.schema)
              : null;

        if (!schema) return null;

        return zodValidator(target as ValidationTarget, schema);
      })
      .filter((v) => !!v);

    return Object.assign(
      every(...validators, resMiddleware, ...composedMiddleware),
      metadata,
      { [FragmentMiddlewareSymbol]: composedMiddleware },
    );
  };

  // The implementation returns the shared runtime shape for every overload of
  // `HonoOpenApiMiddleware` and of the fragment creator (per-middleware
  // environment intersections and conflict checks cannot be expressed by the
  // implementation's single signature). The declared interfaces are the
  // contract; their type behavior is covered by type tests.
  return openApi as unknown as HonoOpenApiMiddleware;
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
export function defineOpenApiOperation<
  Req extends HonoOpenApiRequestSchemas,
  Res extends HonoOpenApiResponses,
>(operation: HonoOpenApiOperation<Req, Res>): HonoOpenApiOperation<Req, Res>;
export function defineOpenApiOperation<Req extends HonoOpenApiRequestSchemas>(
  operation: HonoOpenApiOperationWithoutResponses<Req>,
): HonoOpenApiOperationWithoutResponses<Req>;
export function defineOpenApiOperation(
  operation: HonoOpenApiOperation | HonoOpenApiOperationWithoutResponses,
) {
  return operation;
}

/**
 * Creates a route-environment-aware variant of the `openApi` middleware.
 *
 * Middleware passed to the returned creator is typed with the route environment
 * (`RouteEnv`), so middleware written inline get `c.env` (bindings), validated
 * request data (`c.req.valid()`) and the typed-response helper (`c.var.res`)
 * without extra annotations. Middleware annotated with their own environment
 * (the reusable style) are accepted as well and their environment is
 * intersected with the route environment, as with plain Hono middleware
 * chaining.
 *
 * @example
 * ```ts
 * const openApi = createOpenApiFragment<AppEnv>();
 *
 * app.post(
 *   '/user',
 *   openApi(
 *     {
 *       responses: { 401: z.object({ message: z.string() }) },
 *     },
 *     async (c, next) => {
 *       // `c.env`, `c.req.valid('json')` etc. are fully typed
 *       await next();
 *     },
 *   ),
 * );
 * ```
 */
export function createOpenApiFragment<
  RouteEnv extends Env = Env,
>(): HonoOpenApiFragmentMiddleware<RouteEnv> {
  return createOpenApiMiddleware() as unknown as HonoOpenApiFragmentMiddleware<RouteEnv>;
}
