import type {
  MiddlewareHandler,
  TypedResponse,
  ValidationTargets as ValidationTargetsWithForm,
} from 'hono';
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
  responses: Res;
}

/**
 * zod-openapi document without `openapi` property (set to 3.1.0, we do not support lower versions).
 * @see https://swagger.io/specification/
 */
export type HonoOpenApiDocument = Omit<ZodOpenApiObject, 'openapi'>;

export type HonoOpenApiMiddleware = <
  Req extends HonoOpenApiRequestSchemas,
  P extends string,
  Res extends HonoOpenApiResponses,
>(
  operation: HonoOpenApiOperation<Req, Res>,
) => MiddlewareHandler<HonoOpenApiMiddlewareEnv<Res>, P, Values<Req>>;

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

export type HeaderRecord =
  | Record<'Content-Type', BaseMime>
  | Record<ResponseHeader, string | string[]>
  | Record<string, string | string[]>;

type InferPayload<T> = T extends null ? null : z.infer<T>;

type ResWithStatus<
  Schemas extends Partial<Record<StatusCodeWithoutMinus1, unknown>>,
> = <S extends keyof Schemas & StatusCodeWithoutMinus1>(
  status: S,
  payload: InferPayload<Schemas[S]>,
  headers?: HeaderRecord,
) => Response & TypedResponse<InferPayload<Schemas[S]>, S>;

type ResWithoutStatus<
  Schemas extends Partial<Record<StatusCodeWithoutMinus1, unknown>>,
> = Schemas extends { 200: infer T }
  ? (
      payload: z.infer<T>,
      headers?: HeaderRecord,
    ) => Response & TypedResponse<z.infer<T>, 200, 'json'>
  : // oxlint-disable-next-line typescript/no-empty-object-type
    {};

export type HonoOpenApiMiddlewareEnv<
  Res extends HonoOpenApiResponses,
  Schemas extends Partial<Record<StatusCodeWithoutMinus1, unknown>> =
    ResponseSchemas<Res>,
> = {
  Variables: {
    res: ResWithStatus<Schemas> & ResWithoutStatus<Schemas>;
  };
};

export type ResponseSchema = {
  status: string;
  schema: z.ZodType | null;
  contentType: string | null;
};
