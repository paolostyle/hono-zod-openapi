import type {
  MiddlewareHandler,
  ValidationTargets as ValidationTargetsWithForm,
} from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { ZodOpenApiOperationObject } from 'zod-openapi';

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

export type StatusCodePrefix = '1' | '2' | '3' | '4' | '5';
export type StatusCodeWildcards = `${StatusCodePrefix}XX`;
export type StatusCodeWithoutMinus1 = Exclude<StatusCode, -1>;
export type StatusCodeWithWildcards =
  | StatusCodeWithoutMinus1
  | StatusCodeWildcards;

export type ResponseParams<T extends AnyZ> = {
  status: StatusCodeWithWildcards;
  /**
   * Zod schema for the response body. By default, it will only be used for documentation purposes.
   * If you want to validate the response body, set the `validate` option to `true`, or create a middleware
   * with the `createOpenApiMiddleware` function
   */
  schema: T;
  /**
   * Description of the response. When using the object, it must be manually provided.
   */
  description: string;
  /**
   * Response media type, usually determined by a method on Hono's context object, e.g. c.json(),
   * or explicitly set with `Content-Type` header. If `validate` is `true`, the `Content-Type`
   * response header will be validated against this value.
   * @default `application/json`
   */
  mediaType?: string;
  /**
   * Determines whether the response body and media type should be validated.
   * @default false
   */
  validate?: boolean;
};

export type ResponseSchemas =
  | Array<ResponseParams<AnyZ>>
  | ResponseParams<AnyZ>
  | AnyZ;
export type RequestSchemas = Partial<
  Record<RequestParam, ValidationTargetParams<AnyZ> | AnyZ>
>;

export type Method = 'get' | 'put' | 'post' | 'delete' | 'options' | 'patch';

export type PathsSchemas = {
  request: RequestSchemas;
  response: NormalizedResponseSchemas;
  endpointDetails: EndpointDetails;
};

export type NormalizedRequestSchemas = Partial<Record<RequestParam, AnyZ>>;
export type NormalizedResponseSchemas = Array<ResponseParams<AnyZ>>;

type HasUndefined<T> = undefined extends T ? true : false;
type IsUnknown<T> = unknown extends T
  ? [T] extends [null]
    ? false
    : true
  : false;
type Clean<T> = {
  [K in keyof T as T[K] extends never ? never : K]: T[K];
} & {};

type TransformInput<
  In,
  Target extends keyof Omit<ValidationTargets, 'form'>,
> = Target extends 'json'
  ? In
  : HasUndefined<keyof ValidationTargets[Target]> extends true
    ? { [K in keyof In]?: ValidationTargets[Target][K] | undefined }
    : { [K in keyof In]: ValidationTargets[Target][K] };

type ExtractInValues<
  Schema extends AnyZ,
  Target extends keyof Omit<ValidationTargets, 'form'>,
  In = z.input<Schema>,
> =
  HasUndefined<In> extends true
    ? TransformInput<In, Target> | undefined
    : TransformInput<In, Target>;

type GetValidationSchemas<T extends RequestSchemas> = Clean<{
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

export type Values<T extends RequestSchemas> = ToValidatorValues<
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
