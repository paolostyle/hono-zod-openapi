import type {
  Env,
  Input,
  MiddlewareHandler,
  TypedResponse,
  ValidationTargets as ValidationTargetsWithForm,
} from 'hono';
import type { HandlerResponse, IntersectNonAnyTypes } from 'hono/types';
import type {
  FragmentShapeSymbol,
  RequestValidationSchemaSymbol,
  ResponseSchemasSymbol,
} from './symbols.ts';
import type { ResponseHeader } from 'hono/utils/headers';
import type { ContentlessStatusCode, StatusCode } from 'hono/utils/http-status';
import type { BaseMime } from 'hono/utils/mime';
import type * as z from 'zod';
import type {
  ZodOpenApiObject,
  ZodOpenApiOperationObject,
  ZodOpenApiResponseObject,
} from 'zod-openapi';

export type ValidationTarget = 'json' | 'query' | 'param' | 'cookie' | 'header';
type RequestParam = ValidationTarget;
type ValidationSchemas = Partial<Record<ValidationTarget, z.ZodType>>;
type ValidationTargets = Omit<ValidationTargetsWithForm, 'form'>;

export type ValidationTargetParams<T extends z.ZodType> = {
  /**
   * Zod schema for the target.
   */
  schema: T;
  /**
   * Determines whether the target should be validated or if the schema should only be used for documentation.
   * @default true
   */
  validate?: boolean;
  /** @internal Runtime schema when the documented schema includes doc-only fields. */
  [RequestValidationSchemaSymbol]?: z.ZodType;
};

type StatusCodePrefix = '1' | '2' | '3' | '4' | '5';
export type StatusCodeWithoutMinus1 = Exclude<StatusCode, -1>;
export type StatusCodeWithWildcards =
  | StatusCodeWithoutMinus1
  | `${StatusCodePrefix}XX`
  | 'default';

// Check if a key is a wildcard or 'default'
type IsWildcardOrDefault<K> = K extends 'default'
  ? true
  : K extends `${StatusCodePrefix}XX`
    ? true
    : false;

// Contentless status codes (204, 205, 304) don't require a schema
type IsContentlessStatusCode<K> = K extends ContentlessStatusCode
  ? true
  : false;

/**
 * Mapping of zod-validator targets to their respective schemas, used both as a source of truth
 * for validation and for OpenAPI documentation.
 */
export type HonoOpenApiRequestSchemas = Partial<
  Record<RequestParam, ValidationTargetParams<z.ZodType> | z.ZodType>
>;

export type Method = 'get' | 'put' | 'post' | 'delete' | 'options' | 'patch';
export type NormalizedRequestSchemas = Partial<Record<RequestParam, z.ZodType>>;
type HasUndefined<T> = undefined extends T ? true : false;
type IsUnknown<T> = unknown extends T
  ? [T] extends [null]
    ? false
    : true
  : false;
type Clean<T> = {
  [K in keyof T as T[K] extends never ? never : K]: T[K];
} & {};

type ExtractInValues<
  Schema extends z.ZodType,
  Target extends keyof Omit<ValidationTargets, 'form'>,
  In = z.input<Schema>,
> =
  HasUndefined<In> extends true
    ? In extends ValidationTargets[Target]
      ? In
      : { [K2 in keyof In]?: ValidationTargets[Target][K2] }
    : In extends ValidationTargets[Target]
      ? In
      : { [K2 in keyof In]: ValidationTargets[Target][K2] };

type GetValidationSchemas<T extends HonoOpenApiRequestSchemas> = Clean<{
  [K in keyof T]: T[K] extends ValidationTargetParams<infer S>
    ? T[K]['validate'] extends false
      ? never
      : S
    : T[K] extends z.ZodType
      ? T[K]
      : never;
}>;

/**
 * Flattens the union of request-schema records produced by composed fragments
 * into one record whose targets are the union of every member's declaration.
 * Without this, targets declared by only some fragments would be dropped when
 * `Values` indexes the union, collapsing validated values to `unknown`.
 */
type RequestSchemaKeys<T> = T extends unknown ? keyof T : never;
type RequestSchemaAt<T, K> = T extends unknown
  ? K extends keyof T
    ? T[K]
    : never
  : never;
type MergeRequestSchemaMaps<T> = Clean<{
  [K in RequestSchemaKeys<T>]: RequestSchemaAt<T, K>;
}>;

// A target's schemas are a TypeScript union only after `openApi` fragments are
// composed (see the composition overloads). At runtime `mergeOperations` folds
// those schemas with `ZodObject.extend`, so the validated value is the merge of
// the members' object shapes, not a union of them.
type UnionToIntersection<T> = (
  T extends unknown ? (value: T) => void : never
) extends (value: infer Intersected) => void
  ? Intersected
  : never;

type IsUnion<T, Whole = T> = (
  T extends unknown ? ([Whole] extends [T] ? never : true) : never
) extends never
  ? false
  : true;

// Merges a union of schema-derived values into one object (and leaves single
// schemas untouched, so a `z.union` whose output is a union keeps its meaning).
type MergeSchemaUnion<Schema, Value> =
  IsUnion<Schema> extends true
    ? UnionToIntersection<Value> extends infer Merged
      ? [Merged] extends [never]
        ? Value
        : Merged
      : Value
    : Value;

type ToValidatorValues<T extends ValidationSchemas> = {
  in: Clean<{
    [K in keyof ValidationTargets]: IsUnknown<T[K]> extends true
      ? never
      : MergeSchemaUnion<
          Exclude<T[K], undefined>,
          ExtractInValues<Exclude<T[K], undefined>, K>
        >;
  }>;
  out: Clean<{
    [K in keyof ValidationTargets]: IsUnknown<T[K]> extends true
      ? never
      : MergeSchemaUnion<
          Exclude<T[K], undefined>,
          z.output<Exclude<T[K], undefined>>
        >;
  }>;
};

export type Values<T extends HonoOpenApiRequestSchemas> = ToValidatorValues<
  MergeRequestSchemaMaps<GetValidationSchemas<T>>
>;

type MergeValueTarget<A, B> =
  A extends Record<string, never>
    ? B
    : B extends Record<string, never>
      ? A
      : A & B;

type MergeValueMaps<A, B> = Clean<{
  [K in keyof A | keyof B]: K extends keyof A
    ? K extends keyof B
      ? MergeValueTarget<A[K], B[K]>
      : A[K]
    : K extends keyof B
      ? B[K]
      : never;
}>;

/** Merge validated inputs/outputs by target, ignoring empty object schemas. */
type MergeRequestValues<A, B> = A extends { in: infer AIn; out: infer AOut }
  ? B extends { in: infer BIn; out: infer BOut }
    ? {
        in: MergeValueMaps<AIn, BIn>;
        out: MergeValueMaps<AOut, BOut>;
      }
    : never
  : never;

export type ZodValidatorFn = <
  S extends z.ZodType,
  T extends keyof ValidationTargets,
>(
  target: T,
  schema: S,
  // oxlint-disable-next-line no-explicit-any, no-empty-object-type
) => MiddlewareHandler<any, string, {}, any>;

export type EndpointDetails = Omit<
  ZodOpenApiOperationObject,
  'responses' | 'requestBody' | 'requestParams'
>;

export interface ReferenceObject {
  $ref: string;
  summary?: string;
  description?: string;
}

interface SimpleResponseObject extends Pick<
  ZodOpenApiResponseObject,
  'links' | 'headers' | 'id'
> {
  description?: string;
  schema: z.ZodType;
  mediaType?: string;
}

/**
 * OpenAPI response object, augmented with Zod-based schema.
 */
export type HonoOpenApiResponseObject =
  | ZodOpenApiResponseObject
  | SimpleResponseObject
  | z.ZodType
  | ReferenceObject;

export type HonoOpenApiResponses = Partial<
  Record<StatusCodeWithWildcards, HonoOpenApiResponseObject>
>;

/**
 * OpenAPI operation object, augmented with Zod-based request and response schemas.
 * See README for exhaustive set of examples.
 */
export interface HonoOpenApiOperation<
  Req extends HonoOpenApiRequestSchemas = HonoOpenApiRequestSchemas,
  Res extends HonoOpenApiResponses = HonoOpenApiResponses,
> extends Omit<ZodOpenApiOperationObject, 'requestParams' | 'responses'> {
  request?: Req;
  /**
   * Response schemas, keyed by status code.
   *
   * `openApi()` and `defineOpenApiOperation()` accept operations without this
   * field and default it to `{}` at runtime.
   */
  responses: Res;
}

/**
 * Operation accepted by `openApi()` when no response schemas are declared.
 * `responses` is optional at the call site and normalized to `{}` at runtime.
 */
export type HonoOpenApiOperationWithoutResponses<
  Req extends HonoOpenApiRequestSchemas = HonoOpenApiRequestSchemas,
> = Omit<HonoOpenApiOperation<Req, Record<never, never>>, 'responses'> & {
  responses?: never;
};

type HonoOpenApiOperationInput<
  Req extends HonoOpenApiRequestSchemas,
  Res extends HonoOpenApiResponses,
> =
  | (Omit<HonoOpenApiOperation<Req, Res>, 'responses'> & {
      // Keep the contextual type broad enough for status-code completions.
      // `Res` can default to `Record<never, never>` when `responses` is
      // omitted; typing the property as bare `Res` would make that an empty
      // object and hide every status key from IntelliSense.
      responses: Res & HonoOpenApiResponses;
    })
  | HonoOpenApiOperationWithoutResponses<Req>;

/**
 * zod-openapi document without `openapi` property (set to 3.1.0, we do not support lower versions).
 * @see https://swagger.io/specification/
 */
export type HonoOpenApiDocument = Omit<ZodOpenApiObject, 'openapi'>;

type OperationMiddlewareEnv<
  RouteEnv extends Env | undefined,
  Res extends HonoOpenApiResponses,
> = RouteEnv extends Env
  ? FragmentEnv<RouteEnv, Res>
  : HonoOpenApiMiddlewareEnv<Res>;

/**
 * Merges accumulated response maps the same way `mergeOperations` does at
 * runtime: statuses from `B` (the later fragment) override `A`'s.
 * Intersecting the maps instead would turn a compatible redeclaration of a
 * status (allowed when the payload shapes match) into an intersection of Zod
 * schema types, which `ResponseSchemas` can no longer resolve.
 */
type MergeResponseMaps<
  A extends HonoOpenApiResponses,
  B extends HonoOpenApiResponses,
> = Clean<{
  [K in keyof A | keyof B]: K extends keyof B
    ? B[K]
    : K extends keyof A
      ? A[K]
      : never;
}>;

/**
 * Environment of a fragment composed from an operation and one or more other
 * fragments. Response maps are merged *before* building the `res` helper
 * environment: intersecting two separate `HonoOpenApiMiddlewareEnv`s produces
 * an intersection of `res` function types, which TypeScript accepts at call
 * sites but cannot use for contextual typing (IntelliSense falls back to the
 * first overload, so payload completions only show the operation's own
 * responses). A single environment over the merged response map keeps one `res`
 * signature covering every declared status.
 */
type ComposedFragmentEnv<
  RouteEnv extends Env | undefined,
  Res extends HonoOpenApiResponses,
  FRes extends HonoOpenApiResponses,
> = OperationMiddlewareEnv<RouteEnv, MergeResponseMaps<Res, FRes>>;

type InlineCompositionMiddleware<
  RouteEnv extends Env | undefined,
  Res extends HonoOpenApiResponses,
  P extends string,
  ReqValues extends Input,
  MiddlewareEnv extends Env,
  MiddlewareResponse extends HandlerResponse<unknown>,
> = MiddlewareHandler<
  RouteEnv extends Env ? FragmentEnv<RouteEnv, Res> : MiddlewareEnv,
  P,
  ReqValues,
  MiddlewareResponse
>;

/** Shared operation and fragment composition signatures for both helpers. */
interface HonoOpenApiCompositionMiddleware<RouteEnv extends Env | undefined> {
  <
    Req extends HonoOpenApiRequestSchemas,
    P extends string,
    Res extends HonoOpenApiResponses = Record<never, never>,
  >(
    operation: HonoOpenApiOperationInput<Req, Res>,
  ): OpenApiFragmentValue<
    Req,
    Res,
    MiddlewareHandler<
      OperationMiddlewareEnv<RouteEnv, Res>,
      P,
      Values<Req>,
      OperationResponseTypes<Res>
    >
  >;

  /** Compose a fragment followed by inline Hono middleware. */
  <
    Req extends HonoOpenApiRequestSchemas,
    P extends string,
    Res extends HonoOpenApiResponses = Record<never, never>,
    FReq extends HonoOpenApiRequestSchemas = HonoOpenApiRequestSchemas,
    FRes extends HonoOpenApiResponses = HonoOpenApiResponses,
    E1 extends Env = Env,
    X1 extends HandlerResponse<unknown> = HandlerResponse<unknown>,
    M1 extends InlineCompositionMiddleware<
      RouteEnv,
      MergeResponseMaps<Res, FRes>,
      P,
      MergeRequestValues<Values<Req>, Values<FReq>>,
      E1,
      X1
    > = InlineCompositionMiddleware<
      RouteEnv,
      MergeResponseMaps<Res, FRes>,
      P,
      MergeRequestValues<Values<Req>, Values<FReq>>,
      E1,
      X1
    >,
  >(
    operation: HonoOpenApiOperationInput<Req, Res>,
    fragmentMiddleware: OpenApiFragmentValue<FReq, FRes> &
      OpenApiShapeConflict<Req, FReq, Res, FRes>,
    middleware: M1 & { [FragmentShapeSymbol]?: never },
  ): OpenApiFragmentValue<
    Req | FReq,
    MergeResponseMaps<Res, FRes>,
    MiddlewareHandler<
      RouteEnv extends Env
        ? ComposedFragmentEnv<RouteEnv, Res, FRes>
        : IntersectNonAnyTypes<
            [E1, HonoOpenApiMiddlewareEnv<MergeResponseMaps<Res, FRes>>]
          >,
      P,
      MergeRequestValues<Values<Req>, Values<FReq>>,
      OperationResponseTypes<Res> | OperationResponseTypes<FRes> | X1
    >
  >;

  <
    Req extends HonoOpenApiRequestSchemas,
    P extends string,
    Res extends HonoOpenApiResponses = Record<never, never>,
    FReq extends HonoOpenApiRequestSchemas = HonoOpenApiRequestSchemas,
    FRes extends HonoOpenApiResponses = HonoOpenApiResponses,
  >(
    operation: HonoOpenApiOperationInput<Req, Res>,
    fragmentMiddleware: OpenApiFragmentValue<FReq, FRes> &
      OpenApiShapeConflict<Req, FReq, Res, FRes>,
  ): OpenApiFragmentValue<
    Req | FReq,
    MergeResponseMaps<Res, FRes>,
    MiddlewareHandler<
      ComposedFragmentEnv<RouteEnv, Res, FRes>,
      P,
      MergeRequestValues<Values<Req>, Values<FReq>>,
      OperationResponseTypes<Res> | OperationResponseTypes<FRes>
    >
  >;

  /** Compose two fragments followed by inline Hono middleware. */
  <
    Req extends HonoOpenApiRequestSchemas,
    P extends string,
    Res extends HonoOpenApiResponses = Record<never, never>,
    F1Req extends HonoOpenApiRequestSchemas = HonoOpenApiRequestSchemas,
    F1Res extends HonoOpenApiResponses = HonoOpenApiResponses,
    F2Req extends HonoOpenApiRequestSchemas = HonoOpenApiRequestSchemas,
    F2Res extends HonoOpenApiResponses = HonoOpenApiResponses,
    E1 extends Env = Env,
    X1 extends HandlerResponse<unknown> = HandlerResponse<unknown>,
    M1 extends InlineCompositionMiddleware<
      RouteEnv,
      MergeResponseMaps<MergeResponseMaps<Res, F1Res>, F2Res>,
      P,
      MergeRequestValues<
        MergeRequestValues<Values<Req>, Values<F1Req>>,
        Values<F2Req>
      >,
      E1,
      X1
    > = InlineCompositionMiddleware<
      RouteEnv,
      MergeResponseMaps<MergeResponseMaps<Res, F1Res>, F2Res>,
      P,
      MergeRequestValues<
        MergeRequestValues<Values<Req>, Values<F1Req>>,
        Values<F2Req>
      >,
      E1,
      X1
    >,
  >(
    operation: HonoOpenApiOperationInput<Req, Res>,
    fragment1: OpenApiFragmentValue<F1Req, F1Res> &
      OpenApiShapeConflict<Req, F1Req, Res, F1Res>,
    fragment2: OpenApiFragmentValue<F2Req, F2Res> &
      OpenApiShapeConflict<
        Req | F1Req,
        F2Req,
        MergeResponseMaps<Res, F1Res>,
        F2Res
      >,
    middleware: M1 & { [FragmentShapeSymbol]?: never },
  ): OpenApiFragmentValue<
    Req | F1Req | F2Req,
    MergeResponseMaps<MergeResponseMaps<Res, F1Res>, F2Res>,
    MiddlewareHandler<
      RouteEnv extends Env
        ? ComposedFragmentEnv<RouteEnv, MergeResponseMaps<Res, F1Res>, F2Res>
        : IntersectNonAnyTypes<
            [
              E1,
              HonoOpenApiMiddlewareEnv<
                MergeResponseMaps<MergeResponseMaps<Res, F1Res>, F2Res>
              >,
            ]
          >,
      P,
      MergeRequestValues<
        MergeRequestValues<Values<Req>, Values<F1Req>>,
        Values<F2Req>
      >,
      | OperationResponseTypes<Res>
      | OperationResponseTypes<F1Res>
      | OperationResponseTypes<F2Res>
      | X1
    >
  >;

  <
    Req extends HonoOpenApiRequestSchemas,
    P extends string,
    Res extends HonoOpenApiResponses = Record<never, never>,
    F1Req extends HonoOpenApiRequestSchemas = HonoOpenApiRequestSchemas,
    F1Res extends HonoOpenApiResponses = HonoOpenApiResponses,
    F2Req extends HonoOpenApiRequestSchemas = HonoOpenApiRequestSchemas,
    F2Res extends HonoOpenApiResponses = HonoOpenApiResponses,
  >(
    operation: HonoOpenApiOperationInput<Req, Res>,
    fragment1: OpenApiFragmentValue<F1Req, F1Res> &
      OpenApiShapeConflict<Req, F1Req, Res, F1Res>,
    fragment2: OpenApiFragmentValue<F2Req, F2Res> &
      OpenApiShapeConflict<
        Req | F1Req,
        F2Req,
        MergeResponseMaps<Res, F1Res>,
        F2Res
      >,
  ): OpenApiFragmentValue<
    Req | F1Req | F2Req,
    MergeResponseMaps<MergeResponseMaps<Res, F1Res>, F2Res>,
    MiddlewareHandler<
      OperationMiddlewareEnv<
        RouteEnv,
        MergeResponseMaps<MergeResponseMaps<Res, F1Res>, F2Res>
      >,
      P,
      MergeRequestValues<
        MergeRequestValues<Values<Req>, Values<F1Req>>,
        Values<F2Req>
      >,
      | OperationResponseTypes<Res>
      | OperationResponseTypes<F1Res>
      | OperationResponseTypes<F2Res>
    >
  >;

  <
    Req extends HonoOpenApiRequestSchemas,
    P extends string,
    Res extends HonoOpenApiResponses = Record<never, never>,
    F1Req extends HonoOpenApiRequestSchemas = HonoOpenApiRequestSchemas,
    F1Res extends HonoOpenApiResponses = HonoOpenApiResponses,
    F2Req extends HonoOpenApiRequestSchemas = HonoOpenApiRequestSchemas,
    F2Res extends HonoOpenApiResponses = HonoOpenApiResponses,
    F3Req extends HonoOpenApiRequestSchemas = HonoOpenApiRequestSchemas,
    F3Res extends HonoOpenApiResponses = HonoOpenApiResponses,
  >(
    operation: HonoOpenApiOperationInput<Req, Res>,
    fragment1: OpenApiFragmentValue<F1Req, F1Res> &
      OpenApiShapeConflict<Req, F1Req, Res, F1Res>,
    fragment2: OpenApiFragmentValue<F2Req, F2Res> &
      OpenApiShapeConflict<
        Req | F1Req,
        F2Req,
        MergeResponseMaps<Res, F1Res>,
        F2Res
      >,
    fragment3: OpenApiFragmentValue<F3Req, F3Res> &
      OpenApiShapeConflict<
        Req | F1Req | F2Req,
        F3Req,
        MergeResponseMaps<MergeResponseMaps<Res, F1Res>, F2Res>,
        F3Res
      >,
  ): OpenApiFragmentValue<
    Req | F1Req | F2Req | F3Req,
    MergeResponseMaps<
      MergeResponseMaps<MergeResponseMaps<Res, F1Res>, F2Res>,
      F3Res
    >,
    MiddlewareHandler<
      OperationMiddlewareEnv<
        RouteEnv,
        MergeResponseMaps<
          MergeResponseMaps<MergeResponseMaps<Res, F1Res>, F2Res>,
          F3Res
        >
      >,
      P,
      MergeRequestValues<
        MergeRequestValues<
          MergeRequestValues<Values<Req>, Values<F1Req>>,
          Values<F2Req>
        >,
        Values<F3Req>
      >,
      | OperationResponseTypes<Res>
      | OperationResponseTypes<F1Res>
      | OperationResponseTypes<F2Res>
      | OperationResponseTypes<F3Res>
    >
  >;
}

type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * Typed responses contributed by a plain middleware whose return type may also
 * include `void`/`undefined`/untyped `Response`. Hono's client response merge
 * requires every non-void member to be a `Response`/`TypedResponse`, so
 * forwarding the raw return type would discard the whole middleware's
 * responses when it also returns `undefined` (e.g. after `await next()`).
 *
 * The unparameterized `TypedResponse` carried by `HandlerResponse<any>` (the
 * inferred constraint of middleware returning `void`) has the full `StatusCode`
 * union. Passing it through would widen the route schema to every status, so
 * only responses with a concrete status are kept.
 */
type MiddlewareTypedResponses<X> = X extends unknown
  ? IsAny<X> extends true
    ? never
    : Exclude<X, void | undefined> extends infer T
      ? T extends AnyTypedResponse
        ? T extends TypedResponse<unknown, infer S, infer _F>
          ? IsAny<S> extends true
            ? never
            : [StatusCode] extends [S]
              ? never
              : T
          : never
        : never
      : never
  : never;

/**
 * The `openApi` middleware, optionally accepting reusable user middleware.
 *
 * When middleware is passed, the returned middleware composes them after the
 * request validators and the typed-response middleware, and its environment is
 * the intersection of the route environment (inferred from the passed
 * middleware) and this library's `res` helper environment. Responses declared
 * as `TypedResponse` by the passed middleware are merged into the route's
 * Hono RPC client schema.
 *
 * @example
 * ```ts
 * app.post('/user', openApi(operation), handler); // pre-existing usage
 * app.post(
 *   '/user',
 *   openApi(
 *     operation,
 *     auth, // MiddlewareHandler<AppEnv, string, {}, TypedResponse<...>>
 *   ),
 *   handler,
 * );
 * ```
 */
export interface HonoOpenApiMiddleware extends HonoOpenApiCompositionMiddleware<undefined> {
  <
    // oxlint-disable-next-line no-explicit-any
    X1 extends HandlerResponse<any>,
    E1 extends Env,
    Req extends HonoOpenApiRequestSchemas,
    P extends string,
    Res extends HonoOpenApiResponses = Record<never, never>,
  >(
    operation: HonoOpenApiOperationInput<Req, Res>,
    // oxlint-disable-next-line no-explicit-any
    middleware1: MiddlewareHandler<E1, P, any, X1> & {
      [FragmentShapeSymbol]?: never;
    },
  ): OpenApiFragmentValue<
    Req,
    Res,
    MiddlewareHandler<
      IntersectNonAnyTypes<[E1, HonoOpenApiMiddlewareEnv<Res>]>,
      P,
      Values<Req>,
      MiddlewareTypedResponses<X1> | OperationResponseTypes<Res>
    >
  >;

  <
    // oxlint-disable-next-line no-explicit-any
    X1 extends HandlerResponse<any>,
    // oxlint-disable-next-line no-explicit-any
    X2 extends HandlerResponse<any>,
    E1 extends Env,
    E2 extends Env,
    Req extends HonoOpenApiRequestSchemas,
    P extends string,
    Res extends HonoOpenApiResponses = Record<never, never>,
  >(
    operation: HonoOpenApiOperationInput<Req, Res>,
    // oxlint-disable-next-line no-explicit-any
    middleware1: MiddlewareHandler<E1, P, any, X1> & {
      [FragmentShapeSymbol]?: never;
    },
    // oxlint-disable-next-line no-explicit-any
    middleware2: MiddlewareHandler<E2, P, any, X2>,
  ): OpenApiFragmentValue<
    Req,
    Res,
    MiddlewareHandler<
      IntersectNonAnyTypes<[E1, E2, HonoOpenApiMiddlewareEnv<Res>]>,
      P,
      Values<Req>,
      | MiddlewareTypedResponses<X1>
      | MiddlewareTypedResponses<X2>
      | OperationResponseTypes<Res>
    >
  >;

  <
    // oxlint-disable-next-line no-explicit-any
    X1 extends HandlerResponse<any>,
    // oxlint-disable-next-line no-explicit-any
    X2 extends HandlerResponse<any>,
    // oxlint-disable-next-line no-explicit-any
    X3 extends HandlerResponse<any>,
    E1 extends Env,
    E2 extends Env,
    E3 extends Env,
    Req extends HonoOpenApiRequestSchemas,
    P extends string,
    Res extends HonoOpenApiResponses = Record<never, never>,
  >(
    operation: HonoOpenApiOperationInput<Req, Res>,
    // oxlint-disable-next-line no-explicit-any
    middleware1: MiddlewareHandler<E1, P, any, X1> & {
      [FragmentShapeSymbol]?: never;
    },
    // oxlint-disable-next-line no-explicit-any
    middleware2: MiddlewareHandler<E2, P, any, X2>,
    // oxlint-disable-next-line no-explicit-any
    middleware3: MiddlewareHandler<E3, P, any, X3>,
  ): OpenApiFragmentValue<
    Req,
    Res,
    MiddlewareHandler<
      IntersectNonAnyTypes<[E1, E2, E3, HonoOpenApiMiddlewareEnv<Res>]>,
      P,
      Values<Req>,
      | MiddlewareTypedResponses<X1>
      | MiddlewareTypedResponses<X2>
      | MiddlewareTypedResponses<X3>
      | OperationResponseTypes<Res>
    >
  >;
}

/**
 * `TypedResponse` union implied by an operation's declared responses.
 * Used as the default response type for middleware that do not declare their
 * own, so early responses typed with the operation's schema surface in the
 * Hono RPC client.
 */
type ExtractTypedMiddlewareResponseOnly<T> = T extends TypedResponse
  ? T
  : never;

/* AnyMiddleware mirrors Hono's own middleware generics (default is `any`). */
// oxlint-disable-next-line typescript/no-explicit-any
type AnyMiddleware = MiddlewareHandler<any, any, any, any>;
// oxlint-disable-next-line typescript/no-explicit-any
type AnyTypedResponse = TypedResponse<any, any, any>;
// the unparameterized z.ZodType base used by blank request records; not comparable
// oxlint-disable-next-line typescript/no-explicit-any
type AnyZodSchema = z.ZodType<any, any, any>;

/**
 * `TypedResponse` members a Hono middleware contributes to a route, mirroring
 * Hono's internal `MergeMiddlewareResponse`.
 */
export type HonoMiddlewareTypedResponses<M extends AnyMiddleware> = M extends (
  c: unknown,
  next: unknown,
) => Promise<infer R>
  ? Exclude<R, void> extends never
    ? never
    : Exclude<R, void> extends Response | AnyTypedResponse
      ? ExtractTypedMiddlewareResponseOnly<Exclude<R, void>>
      : never
  : M extends (c: unknown, next: unknown) => infer R
    ? R extends Response | AnyTypedResponse
      ? ExtractTypedMiddlewareResponseOnly<R>
      : never
    : never;

/**
 * Middleware value created by `openApi()` / `createOpenApiFragment()`.
 * Carries the operation's declared shapes so fragments can be composed and
 * statically checked for conflicting schemas.
 */
export type OpenApiFragmentValue<
  FReq extends HonoOpenApiRequestSchemas,
  FRes extends HonoOpenApiResponses,
  Mw extends AnyMiddleware = AnyMiddleware,
> = Mw & {
  readonly [FragmentShapeSymbol]: {
    readonly request?: FReq;
    readonly responses: FRes;
  };
};

/**
 * Type for a parameter that cannot be satisfied — used by fragment slots to
 * statically reject conflicting fragments.
 */
export type OpenApiFragmentConflictError<Details extends string = string> = {
  readonly 'openApi fragment conflict': Details;
};

type SchemaOfTarget<T> =
  T extends ValidationTargetParams<infer S>
    ? S
    : T extends AnyZodSchema
      ? T
      : never;

// internal aliases used by type tests to inspect intermediate steps
export type SchemaOfTargetInternal<T> = SchemaOfTarget<T>;
export type ConcreteSchemaOutInternal<T extends AnyZodSchema> =
  ConcreteSchemaOut<T>;
export type EqualInternal<A, B> = Equal<A, B>;
export type OperationInputResponsesInternal<
  Req extends HonoOpenApiRequestSchemas,
  Res extends HonoOpenApiResponses,
> = Extract<
  HonoOpenApiOperationInput<Req, Res>,
  { responses: unknown }
>['responses'];

// schemas whose validated output is not a concrete shape (e.g. the bare
// `z.ZodType` used by blank request records, `z.any()`) cannot be conflicting
type ConcreteSchemaOut<T extends AnyZodSchema> =
  z.output<T> extends never
    ? never
    : unknown extends z.output<T>
      ? never
      : z.output<T>;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type ConflictingKeys<Req, FReq> = {
  [K in keyof Req & keyof FReq]: ConcreteSchemaOut<
    Extract<SchemaOfTarget<Req[K]>, AnyZodSchema>
  > extends never
    ? never
    : ConcreteSchemaOut<
          Extract<SchemaOfTarget<FReq[K]>, AnyZodSchema>
        > extends never
      ? never
      : Equal<
            z.output<Extract<SchemaOfTarget<Req[K]>, AnyZodSchema>>,
            z.output<Extract<SchemaOfTarget<FReq[K]>, AnyZodSchema>>
          > extends true
        ? never
        : K;
}[keyof Req & keyof FReq];

// Index the shape instead of inferring it: for an intersection of ZodObjects,
// inference chooses one constituent and loses the other object's properties.
type ObjectShape<T> = T extends z.ZodObject ? T['shape'] : never;
type PropertyConflicts<A, B> = {
  [K in keyof A & keyof B]: Equal<z.output<A[K]>, z.output<B[K]>> extends true
    ? never
    : K;
}[keyof A & keyof B];
// Distribute over each schema declaration; intersections hide object properties from `keyof`.
type ConflictingRequestKeys<Req, FReq> = FReq extends unknown
  ? Req extends unknown
    ? {
        [K in keyof Req & keyof FReq]: ObjectShape<
          Extract<SchemaOfTarget<Req[K]>, AnyZodSchema>
        > extends infer A
          ? [A] extends [never]
            ? ConflictingKeys<Pick<Req, K>, Pick<FReq, K>> extends never
              ? never
              : K
            : ObjectShape<
                  Extract<SchemaOfTarget<FReq[K]>, AnyZodSchema>
                > extends infer B
              ? [B] extends [never]
                ? ConflictingKeys<Pick<Req, K>, Pick<FReq, K>> extends never
                  ? never
                  : K
                : PropertyConflicts<A, B> extends never
                  ? never
                  : `${K & string}.${PropertyConflicts<A, B> & string}`
              : never
          : never;
      }[keyof Req & keyof FReq]
    : never
  : never;

type DeclaredResponseSchema<T> = ExtractResponseSchema<T>;
// Compatible redeclarations of a response status can have distinct schema type
// identities (e.g. two separately declared `z.object` calls with the same
// shape). Compare structural assignability in both directions so a compatible
// redeclaration is not reported as a conflict.
type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
type SameResponseSchema<A, B> = [DeclaredResponseSchema<A>] extends [never]
  ? [DeclaredResponseSchema<B>] extends [never]
    ? A extends ReferenceObject
      ? B extends ReferenceObject
        ? Equal<A['$ref'], B['$ref']>
        : false
      : false
    : false
  : [DeclaredResponseSchema<B>] extends [never]
    ? false
    : MutuallyAssignable<
        z.output<Extract<DeclaredResponseSchema<A>, z.ZodType>>,
        z.output<Extract<DeclaredResponseSchema<B>, z.ZodType>>
      >;
type ConflictingResponseStatuses<Res, FRes> = {
  [Status in keyof Res & keyof FRes]: SameResponseSchema<
    Res[Status],
    FRes[Status]
  > extends true
    ? never
    : Status;
}[keyof Res & keyof FRes];

/**
 * Whether a fragment middleware may be composed into an operation without
 * conflicting request properties or a repeated response status with a
 * different schema. Request object schemas may declare disjoint properties on
 * the same target.
 */
export type OpenApiShapeConflicts<
  Req extends HonoOpenApiRequestSchemas,
  FReq extends HonoOpenApiRequestSchemas,
  Res extends HonoOpenApiResponses,
  FRes extends HonoOpenApiResponses,
> = [OpenApiShapeConflictDetails<Req, FReq, Res, FRes>] extends [never]
  ? true
  : false;

type RequestConflictMessage<Conflict> = Conflict extends string
  ? `request property "${Conflict}" has an incompatible schema`
  : never;
type ResponseConflictMessage<Status> = Status extends string | number
  ? `response status "${Status}" has a different schema`
  : never;

export type OpenApiShapeConflictDetails<
  Req extends HonoOpenApiRequestSchemas,
  FReq extends HonoOpenApiRequestSchemas,
  Res extends HonoOpenApiResponses,
  FRes extends HonoOpenApiResponses,
> =
  | RequestConflictMessage<ConflictingRequestKeys<Req, FReq>>
  | ResponseConflictMessage<ConflictingResponseStatuses<Res, FRes>>;

export type OpenApiShapeConflict<
  Req extends HonoOpenApiRequestSchemas,
  FReq extends HonoOpenApiRequestSchemas,
  Res extends HonoOpenApiResponses,
  FRes extends HonoOpenApiResponses,
> = [OpenApiShapeConflictDetails<Req, FReq, Res, FRes>] extends [never]
  ? unknown
  : OpenApiFragmentConflictError<
      OpenApiShapeConflictDetails<Req, FReq, Res, FRes>
    >;

export type OperationResponseTypes<Res extends HonoOpenApiResponses> =
  keyof ResponseSchemas<Res> extends never
    ? Response
    : {
        [S in keyof ResponseSchemas<Res>]: TypedResponse<
          InferPayload<ResponseSchemas<Res>[S]>,
          S & StatusCodeWithoutMinus1
        >;
      }[keyof ResponseSchemas<Res>];

/**
 * Middleware shape accepted by a fragment: the fragment's seeded environment
 * (route environment intersected with the `res` helper environment) and the
 * operation's validated-input types.
 */
export type FragmentMiddlewareBase<
  RouteEnv extends Env,
  Res extends HonoOpenApiResponses,
  P extends string,
  Req extends HonoOpenApiRequestSchemas,
> = MiddlewareHandler<
  IntersectNonAnyTypes<[RouteEnv, HonoOpenApiMiddlewareEnv<Res>]>,
  P,
  Values<Req>
>;

export type FragmentEnv<
  RouteEnv extends Env,
  Res extends HonoOpenApiResponses,
> = IntersectNonAnyTypes<[RouteEnv, HonoOpenApiMiddlewareEnv<Res>]>;

/**
 * Call signatures of the creator returned by {@link createOpenApiFragment}.
 *
 * Every middleware slot carries the fragment's seeded environment (app
 * bindings/variables intersected with the `res` helper environment) and the
 * validated-input types derived from the operation, so middleware written
 * inline get `c.env`, `c.req.valid()` and `c.var.res()` typed without extra
 * annotations. Middleware annotated with their own environment are accepted as
 * well when it is compatible with the seeded environment. Responses declared as
 * `TypedResponse` by the passed middleware are merged into the route's Hono RPC
 * client schema.
 */
export interface HonoOpenApiFragmentMiddleware<
  RouteEnv extends Env,
> extends HonoOpenApiCompositionMiddleware<RouteEnv> {
  <
    Req extends HonoOpenApiRequestSchemas,
    P extends string,
    Res extends HonoOpenApiResponses = Record<never, never>,
    M1 extends FragmentMiddlewareBase<RouteEnv, Res, P, Req> =
      FragmentMiddlewareBase<RouteEnv, Res, P, Req>,
  >(
    operation: HonoOpenApiOperationInput<Req, Res>,
    middleware1: M1 & { [FragmentShapeSymbol]?: never },
  ): OpenApiFragmentValue<
    Req,
    Res,
    MiddlewareHandler<
      FragmentEnv<RouteEnv, Res>,
      P,
      Values<Req>,
      HonoMiddlewareTypedResponses<M1> | OperationResponseTypes<Res>
    >
  >;

  <
    Req extends HonoOpenApiRequestSchemas,
    P extends string,
    Res extends HonoOpenApiResponses = Record<never, never>,
    M1 extends FragmentMiddlewareBase<RouteEnv, Res, P, Req> =
      FragmentMiddlewareBase<RouteEnv, Res, P, Req>,
    M2 extends FragmentMiddlewareBase<RouteEnv, Res, P, Req> =
      FragmentMiddlewareBase<RouteEnv, Res, P, Req>,
  >(
    operation: HonoOpenApiOperationInput<Req, Res>,
    middleware1: M1 & { [FragmentShapeSymbol]?: never },
    middleware2: M2 & { [FragmentShapeSymbol]?: never },
  ): OpenApiFragmentValue<
    Req,
    Res,
    MiddlewareHandler<
      FragmentEnv<RouteEnv, Res>,
      P,
      Values<Req>,
      | HonoMiddlewareTypedResponses<M1>
      | HonoMiddlewareTypedResponses<M2>
      | OperationResponseTypes<Res>
    >
  >;

  <
    Req extends HonoOpenApiRequestSchemas,
    P extends string,
    Res extends HonoOpenApiResponses = Record<never, never>,
    M1 extends FragmentMiddlewareBase<RouteEnv, Res, P, Req> =
      FragmentMiddlewareBase<RouteEnv, Res, P, Req>,
    M2 extends FragmentMiddlewareBase<RouteEnv, Res, P, Req> =
      FragmentMiddlewareBase<RouteEnv, Res, P, Req>,
    M3 extends FragmentMiddlewareBase<RouteEnv, Res, P, Req> =
      FragmentMiddlewareBase<RouteEnv, Res, P, Req>,
  >(
    operation: HonoOpenApiOperationInput<Req, Res>,
    middleware1: M1 & { [FragmentShapeSymbol]?: never },
    middleware2: M2 & { [FragmentShapeSymbol]?: never },
    middleware3: M3 & { [FragmentShapeSymbol]?: never },
  ): OpenApiFragmentValue<
    Req,
    Res,
    MiddlewareHandler<
      FragmentEnv<RouteEnv, Res>,
      P,
      Values<Req>,
      | HonoMiddlewareTypedResponses<M1>
      | HonoMiddlewareTypedResponses<M2>
      | HonoMiddlewareTypedResponses<M3>
      | OperationResponseTypes<Res>
    >
  >;
}

type ExtractResponseSchema<T> = T extends SimpleResponseObject
  ? T['schema']
  : T extends ZodOpenApiResponseObject
    ? T['content'] extends Record<string, { schema: z.ZodType }>
      ? T['content'][keyof T['content']]['schema']
      : never
    : T extends z.ZodType
      ? T
      : never;

export type ResponseSchemas<T extends HonoOpenApiResponses> = {
  [S in keyof T as IsWildcardOrDefault<S> extends true
    ? never
    : IsContentlessStatusCode<S> extends true
      ? S
      : ExtractResponseSchema<T[S]> extends never
        ? never
        : S]: IsContentlessStatusCode<S> extends true
    ? null
    : ExtractResponseSchema<T[S]>;
};

export type HeaderRecord = Record<string, string | string[]> & {
  'Content-Type'?: BaseMime;
} & Partial<Record<ResponseHeader, string | string[]>>;

type InferPayload<T> = T extends null ? null : z.infer<T>;

/**
 * Variables contributed by an `openApi()` fragment.
 *
 * `res` is declared as a method instead of a function-typed property so that
 * its `this` type is the *whole* variables object it is called on. Hono chains
 * middleware by intersecting their environments, so when `openApi(schema)` is
 * followed by other fragments in the same route (e.g.
 * `openApi(schema), jwtMiddleware, handler`) the intersected variables carry
 * every fragment's response schemas. Reading them through `this` inside `res`
 * yields one call signature covering all of them, which keeps status/payload
 * IntelliSense working. A plain function property would instead intersect two
 * independent `res` signatures, and contextual typing would only see the
 * first one.
 */
export interface HonoOpenApiVariables<
  Schemas extends Partial<Record<StatusCodeWithoutMinus1, unknown>>,
> {
  readonly [ResponseSchemasSymbol]: Schemas;

  res<
    S extends keyof this[typeof ResponseSchemasSymbol] &
      StatusCodeWithoutMinus1,
  >(
    status: S,
    payload: InferPayload<this[typeof ResponseSchemasSymbol][S]>,
    headers?: HeaderRecord,
  ): Response &
    TypedResponse<InferPayload<this[typeof ResponseSchemasSymbol][S]>, S>;

  res(
    payload: this[typeof ResponseSchemasSymbol] extends { 200: infer T }
      ? InferPayload<T>
      : never,
    headers?: HeaderRecord,
  ): this[typeof ResponseSchemasSymbol] extends { 200: infer T }
    ? Response & TypedResponse<InferPayload<T>, 200, 'json'>
    : never;

  // Per-fragment fallbacks. Sibling declarations of the same status have their
  // schemas intersected by the polymorphic signature above; when the two
  // declarations use distinct schema identities (e.g. two `z.literal` types)
  // that intersection has no payload. These signatures keep each fragment's
  // own declaration callable, matching the previous intersection behavior.
  res<S extends keyof Schemas & StatusCodeWithoutMinus1>(
    status: S,
    payload: InferPayload<Schemas[S]>,
    headers?: HeaderRecord,
  ): Response & TypedResponse<InferPayload<Schemas[S]>, S>;

  res(
    payload: Schemas extends { 200: infer T } ? InferPayload<T> : never,
    headers?: HeaderRecord,
  ): Schemas extends { 200: infer T }
    ? Response & TypedResponse<InferPayload<T>, 200, 'json'>
    : never;
}

export type HonoOpenApiMiddlewareEnv<
  Res extends HonoOpenApiResponses,
  Schemas extends Partial<Record<StatusCodeWithoutMinus1, unknown>> =
    ResponseSchemas<Res>,
> = {
  Variables: HonoOpenApiVariables<Schemas>;
};

export type ResponseSchema = {
  status: string;
  schema: z.ZodType | null;
  contentType: string | null;
};
