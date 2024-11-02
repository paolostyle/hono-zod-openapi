import type {
  Env,
  MiddlewareHandler,
  ValidationTargets as ValidationTargetsWithForm,
} from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import type {
  ZodOpenApiObject,
  ZodOpenApiOperationObject,
  ZodOpenApiResponseObject,
} from 'zod-openapi';

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export type AnyZ = z.ZodType<any, z.ZodTypeDef, any>;

export type ValidationTarget = 'json' | 'query' | 'param' | 'cookie' | 'header';
type RequestParam = ValidationTarget;
type ValidationSchemas = Partial<Record<ValidationTarget, AnyZ>>;
type ValidationTargets = Omit<ValidationTargetsWithForm, 'form'>;

export type ValidationTargetParams<T extends AnyZ> = {
  /**
   * Zod schema for the target.
   */
  schema: T;
  /**
   * Determines whether the target should be validated or if the schema should only be used for documentation.
   * @default true
   */
  validate?: boolean;
};

type StatusCodePrefix = '1' | '2' | '3' | '4' | '5';
type StatusCodeWithoutMinus1 = Exclude<StatusCode, -1>;
export type StatusCodeWithWildcards =
  | StatusCodeWithoutMinus1
  | `${StatusCodePrefix}XX`
  | 'default';

/**
 * Mapping of zod-validator targets to their respective schemas, used both as a source of truth
 * for validation and for OpenAPI documentation.
 */
export type HonoOpenApiRequestSchemas = Partial<
  Record<RequestParam, ValidationTargetParams<AnyZ> | AnyZ>
>;

export type Method = 'get' | 'put' | 'post' | 'delete' | 'options' | 'patch';
export type NormalizedRequestSchemas = Partial<Record<RequestParam, AnyZ>>;

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
  Schema extends AnyZ,
  Target extends keyof Omit<ValidationTargets, 'form'>,
  In = z.input<Schema>,
> = HasUndefined<In> extends true
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
    : T[K] extends AnyZ
      ? T[K]
      : never;
}>;

type ToValidatorValues<T extends ValidationSchemas> = {
  in: Clean<{
    [K in keyof ValidationTargets]: IsUnknown<T[K]> extends true
      ? never
      : ExtractInValues<Exclude<T[K], undefined>, K>;
  }>;
  out: Clean<{
    [K in keyof ValidationTargets]: IsUnknown<T[K]> extends true
      ? never
      : z.output<Exclude<T[K], undefined>>;
  }>;
};

export type Values<T extends HonoOpenApiRequestSchemas> = ToValidatorValues<
  GetValidationSchemas<T>
>;

export type ZodValidatorFn = <
  S extends AnyZ,
  T extends keyof ValidationTargets,
>(
  target: T,
  schema: S,
) => MiddlewareHandler;

export type EndpointDetails = Omit<
  ZodOpenApiOperationObject,
  'responses' | 'requestBody' | 'requestParams'
>;

export interface ReferenceObject {
  $ref: string;
  summary?: string;
  description?: string;
}

interface SimpleResponseObject
  extends Pick<ZodOpenApiResponseObject, 'links' | 'headers' | 'ref'> {
  description?: string;
  schema: AnyZ;
  mediaType?: string;
}

/**
 * OpenAPI response object, augmented with Zod-based schema.
 */
export type HonoOpenApiResponseObject =
  | ZodOpenApiResponseObject
  | SimpleResponseObject
  | AnyZ
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
> extends Omit<ZodOpenApiOperationObject, 'requestParams' | 'responses'> {
  request?: Req;
  responses: HonoOpenApiResponses;
}

/**
 * zod-openapi document without `openapi` property (set to 3.1.0, we do not support lower versions).
 * @see https://swagger.io/specification/
 */
export type HonoOpenApiDocument = Omit<ZodOpenApiObject, 'openapi'>;

export type HonoOpenApiMiddleware = <
  Req extends HonoOpenApiRequestSchemas,
  E extends Env,
  P extends string,
>(
  operation: HonoOpenApiOperation<Req>,
) => MiddlewareHandler<E, P, Values<Req>>;
