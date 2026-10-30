/**
 * Symbol attached to `openApi()`-created middleware holding the operation it
 * was created with (runtime metadata for `createOpenApiDocument`).
 */
export const OpenApiSymbol = Symbol();

/**
 * Type-level and runtime marker for fragment-shaped middleware: middleware
 * created by `openApi()`/`createOpenApiFragment()` carry their operation
 * (request and response shapes) so fragments can be composed/nested, merged in
 * the generated document, and statically checked for schema conflicts.
 */
export const FragmentShapeSymbol: unique symbol = Symbol();

/** Runtime middleware inside a fragment, without its already-merged validators. */
export const FragmentMiddlewareSymbol: unique symbol = Symbol();

/** Runtime-only schema when docs merge also includes validate:false fields. */
export const RequestValidationSchemaSymbol: unique symbol = Symbol();

/**
 * Type-level contract of the `c.var.res` helper: the response schemas declared
 * by a fragment. It is carried on the environment's variables so that Hono's
 * `Variables` intersection combines the schemas of every middleware on the
 * route, which the polymorphic `this` of `res` then reads.
 */
export const ResponseSchemasSymbol: unique symbol = Symbol();
