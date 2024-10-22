import { zValidator } from '@hono/zod-validator';
import { every } from 'hono/combine';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import type {
  HonoOpenApiMiddleware,
  HonoOpenApiOperation,
  HonoOpenApiRequestSchemas,
  ValidationTarget,
  ZodValidatorFn,
} from './types';

export const OpenApiSymbol = Symbol();

export function createOpenApiMiddleware(
  zodValidator: ZodValidatorFn = zValidator,
): HonoOpenApiMiddleware {
  return function openApi(operation) {
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

export const openApi: HonoOpenApiMiddleware = createOpenApiMiddleware();

export const defineOpenApiOperation = <Req extends HonoOpenApiRequestSchemas>(
  operation: HonoOpenApiOperation<Req>,
) => operation;
