import { zValidator } from '@hono/zod-validator';
import type { Env, MiddlewareHandler } from 'hono';
import { every } from 'hono/combine';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import type {
  Operation,
  RequestSchemas,
  ValidationTarget,
  Values,
  ZodValidatorFn,
} from './types';

export const OpenApiSymbol = Symbol();

export function createOpenApiMiddleware(
  zodValidator: ZodValidatorFn = zValidator,
) {
  return function openApi<
    Req extends RequestSchemas,
    E extends Env,
    P extends string,
  >(operation: Operation<Req>): MiddlewareHandler<E, P, Values<Req>> {
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
          schemaOrParams instanceof z.Schema
            ? schemaOrParams
            : schemaOrParams.validate !== false
              ? schemaOrParams.schema
              : null;

        if (!schema) return;

        return zodValidator(target as ValidationTarget, schema);
      })
      .filter((v) => !!v);

    const middleware = every(...validators);

    return Object.assign(middleware, metadata);
  };
}

export const openApi = createOpenApiMiddleware();

export const defineOpenApiOperation = <Req extends RequestSchemas>(
  operation: Operation<Req>,
) => operation;
