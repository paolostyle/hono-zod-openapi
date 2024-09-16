import type {
  MiddlewareHandler,
  ValidationTargets as ValidationTargetsWithForm,
} from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import { z } from 'zod';

type AnyZ = z.ZodType<any, z.ZodTypeDef, any>;

export type ValidationTarget = 'json' | 'query' | 'param' | 'cookie' | 'header';
type RequestParam = ValidationTarget;
type ValidationSchemas = Partial<Record<ValidationTarget, AnyZ>>;
type ValidationTargets = Omit<ValidationTargetsWithForm, 'form'>;

export type ValidationTargetParams<T extends AnyZ> = {
  schema: T;
  validate?: boolean;
};

export type ResponseParams<T extends AnyZ> = {
  schema: T;
  status: StatusCode;
  description: string;
  mediaType?: string;
  example?: z.input<T>;
};

export type ResponseSchemas =
  | Array<ResponseParams<AnyZ>>
  | ResponseParams<AnyZ>
  | AnyZ;
export type RequestSchemas = Partial<
  Record<RequestParam, ValidationTargetParams<AnyZ> | AnyZ>
>;

export type Method = 'get' | 'put' | 'post' | 'delete' | 'options' | 'patch';

export type PathSchemas = {
  request: RequestSchemas;
  response: ResponseSchemas;
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
