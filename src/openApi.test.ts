import { zValidator } from '@hono/zod-validator';
import { Hono, type MiddlewareHandler, type ValidationTargets } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { testClient } from 'hono/testing';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import * as z from 'zod';
import {
  createOpenApiMiddleware,
  defineOpenApiOperation,
  openApi,
} from './openApi.ts';

describe('object-based openApi middleware', () => {
  it('works fine with request: undefined', async () => {
    const app = new Hono().post(
      '/user',
      openApi({
        responses: {
          200: z.object({ name: z.string() }),
        },
      }),
      async (c) => {
        return c.json({ name: 'John' }, 200);
      },
    );

    const client = testClient(app);
    const response = await client.user.$post({});

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'John' });
  });

  it('integrates with zodValidator and validates request body', async () => {
    const app = new Hono().post(
      '/user',
      openApi({
        responses: {
          default: z.object({ name: z.string() }),
        },
        request: {
          json: z.object({ name: z.string() }),
        },
      }),
      async (c) => {
        const body = c.req.valid('json');

        expectTypeOf(body).toEqualTypeOf<{ name: string }>();

        // @ts-expect-error c.req.valid() should only accept json
        const _nonExistent = c.req.valid('cookie');
        // @ts-expect-error c.req.valid() should only accept json
        const _nonExistent2 = c.req.valid('header');
        // @ts-expect-error c.req.valid() should only accept json
        const _nonExistent3 = c.req.valid('query');
        // @ts-expect-error c.req.valid() should only accept json
        const _nonExistent4 = c.req.valid('param');

        return c.json(body, 200);
      },
    );

    const client = testClient(app);
    const response = await client.user.$post({ json: { name: 'John' } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'John' });

    // @ts-expect-error name should be a string
    const response2 = await client.user.$post({ json: { name: 123 } });
    expect(response2.status).toBe(400);
    const errorResponse = (await response2.json()) as any;
    expect(errorResponse).toEqual({
      error: {
        message: expect.stringContaining('expected string, received number'),
        name: 'ZodError',
      },
      success: false,
    });
  });

  it.each(['cookie', 'header', 'query', 'param', 'json'] as const)(
    'passes target %s and schema to validator',
    async (type) => {
      const validatorMock = vi.fn();
      const someSchema = z.object({ name: z.string() }).optional();
      const middleware = createOpenApiMiddleware(validatorMock);

      const app = new Hono().post(
        '/user',
        middleware({
          request: {
            [type]: someSchema,
          },
          responses: {
            default: someSchema,
          },
        }),
        async (c) => {
          return c.json({ name: 'John' }, 200);
        },
      );

      const client = testClient(app);
      await client.user.$post({} as any);

      expect(validatorMock).toHaveBeenCalledWith(type, someSchema);
    },
  );

  it('passes multiple targets and schemas to validator', async () => {
    const validatorMock = vi.fn();
    const someSchema = z.object({ name: z.string() });
    const middleware = createOpenApiMiddleware(validatorMock);

    const app = new Hono().post(
      '/user',
      middleware({
        responses: {
          200: someSchema,
        },
        request: {
          cookie: someSchema,
          header: someSchema,
          query: someSchema,
          json: someSchema,
          // alternative version though a bit redundant
          param: { schema: someSchema, validate: true },
        },
      }),
      async (c) => {
        return c.json({ name: 'John' }, 200);
      },
    );

    const client = testClient(app);
    await client.user.$post({} as any);

    expect(validatorMock).toHaveBeenCalledWith('cookie', someSchema);
    expect(validatorMock).toHaveBeenCalledWith('header', someSchema);
    expect(validatorMock).toHaveBeenCalledWith('query', someSchema);
    expect(validatorMock).toHaveBeenCalledWith('json', someSchema);
    expect(validatorMock).toHaveBeenCalledWith('param', someSchema);
  });

  it('does not validate when validate is false', async () => {
    const validatorMock = vi.fn();
    const someSchema = z.object({ name: z.string() });
    const middleware = createOpenApiMiddleware(validatorMock);

    const app = new Hono().post(
      '/user',
      middleware({
        responses: {
          200: someSchema,
        },
        request: {
          cookie: { schema: someSchema, validate: false },
          header: { schema: someSchema, validate: false },
          query: { schema: someSchema, validate: false },
          json: { schema: someSchema, validate: false },
          param: { schema: someSchema, validate: false },
        },
      }),
      async (c) => {
        // @ts-expect-error c.req.valid() should not accept any target
        const _body = c.req.valid('json');
        // @ts-expect-error c.req.valid() should not accept any target
        const _nonExistent = c.req.valid('cookie');
        // @ts-expect-error c.req.valid() should not accept any target
        const _nonExistent2 = c.req.valid('header');
        // @ts-expect-error c.req.valid() should not accept any target
        const _nonExistent3 = c.req.valid('query');
        // @ts-expect-error c.req.valid() should not accept any target
        const _nonExistent4 = c.req.valid('param');

        return c.json({ name: 'John' }, 200);
      },
    );

    const client = testClient(app);
    await client.user.$post({});

    expect(validatorMock).not.toHaveBeenCalled();
  });

  it('types are working correctly when passed defined openAPI operation', async () => {
    const operation = defineOpenApiOperation({
      responses: {
        200: z.object({ name: z.string() }),
      },
      request: {
        header: z.object({ 'api-key': z.string() }),
        json: z.object({ email: z.string() }),
      },
    });

    new Hono().post('/user', openApi(operation), async (c) => {
      const body = c.req.valid('json');
      expectTypeOf(body).toEqualTypeOf<{ email: string }>();

      const header = c.req.valid('header');
      expectTypeOf(header).toEqualTypeOf<{ 'api-key': string }>();

      return c.json({ name: 'John' }, 200);
    });
  });

  it('works on type-level with all possible response variants', () => {
    new Hono().post(
      '/user',
      openApi({
        responses: {
          // 1. minimal version: just zod schema, media type is inferred to be application/json
          default: z.object({ name: z.string() }),
          // 2. library's own object notation
          // 2a. just schema, media type is inferred to be text/plain for z.strings()
          200: {
            schema: z.string(),
          },
          // 2b. schema + headers, media type is inferred to be application/json
          201: {
            schema: z.object({ name: z.string() }),
            headers: z.object({ 'x-custom-header': z.string() }),
          },
          // 2c. custom description (description is required in OpenAPI but we're providing defaults)
          202: {
            description: 'Result is accepted',
            schema: z
              .object({ name: z.string() })
              .meta({ example: { name: 'John' } }),
          },
          // 2d. custom description, schema, explicit media type
          203: {
            description: 'Some custom description',
            schema: z.string(),
            mediaType: 'text/html',
          },
          // 2e. no response body: you need to provide at least a description
          204: {
            description: 'No content',
          },
          // 2f. no response body, but returns headers - still need to provide at least a description
          205: {
            description: 'Just headers',
            headers: z.object({ 'x-custom-header': z.string() }),
          },
          // 3. _invalid_ library's own object notations, some should be perhaps allowed
          // @ts-expect-error 3a. empty object - just add a description
          300: {},
          // @ts-expect-error 3b. just headers without description - just add a description
          301: {
            headers: z.object({ 'x-custom-header': z.string() }),
          },
          // @ts-expect-error 3c. just mediaType, adding description fixes the TypeScript error but it won't result in anything sensible
          302: {
            mediaType: 'text/html',
          },
          // 4. zod-openapi notation - description required, content type explicit, schema is a zod schema
          400: {
            description: 'Some custom description',
            content: {
              'application/json': {
                schema: z
                  .object({ name: z.string() })
                  .meta({ example: { name: 'John' } }),
              },
            },
          },
          // 5. regular OpenAPI notation - description required, content type explicit, schema is an OpenAPI object
          401: {
            description: 'My error endpoint',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                    },
                  },
                  example: {
                    name: 'John',
                  },
                },
              },
            },
          },
          // 6. reference object
          402: {
            $ref: '#/components/responses/ServerError',
          },
        },
      }),
      async (c) => {
        return c.json({ name: 'John' }, 200);
      },
    );
  });

  it('works properly with global middlewares', async () => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const nextMiddleware: MiddlewareHandler = async (c, next) => {
      await next();
    };

    const app = new Hono();
    app.use('*', nextMiddleware);

    app.get(
      '/:id',
      openApi({
        request: {
          param: z.object({
            id: z.string(),
          }),
        },
        responses: {
          200: z.object({ id: z.string() }),
        },
      }),
      (c) => {
        const { id } = c.req.valid('param');
        return c.json({ id }, 200);
      },
    );

    const res = await app.request('/123');
    const data = await res.json();

    expect(data).toEqual({ id: '123' });
  });

  it('createOpenApiMiddleware can accept zodValidator with hook', async () => {
    createOpenApiMiddleware((target, schema) =>
      zValidator(target, schema, (result, c) => {
        if (!result.success) {
          const validationError = z.prettifyError(result.error);
          return c.json({ error: validationError });
        }
      }),
    );

    const zodValidator = <
      S extends z.ZodType,
      T extends keyof ValidationTargets,
    >(
      target: T,
      schema: S,
    ) =>
      zValidator(target, schema, (result) => {
        if (!result.success) {
          const validationError = z.prettifyError(result.error);
          throw new HTTPException(400, {
            message: validationError,
            cause: result.error,
          });
        }
      });

    createOpenApiMiddleware(zodValidator);
  });
});
