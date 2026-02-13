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

      return c.var.res(200, { name: 'John' });
    });
  });

  it('works on type-level with all possible response variants', async () => {
    const app = new Hono().post(
      '/user',
      openApi({
        request: {
          query: z.object({
            status: z.string(),
          }),
        },
        responses: {
          // 1. minimal version: just zod schema, media type is inferred to be application/json
          default: z.object({ message: z.string() }),
          // 2. library's own object notation
          // 2a. just schema, media type is inferred to be text/plain for z.strings()
          200: {
            schema: z.object({
              name: z.string(),
            }),
          },
          // 2b. schema + headers, media type is inferred to be application/json
          201: {
            schema: z.object({ created: z.boolean() }),
            headers: z.object({ 'x-custom-header': z.string() }),
          },
          // 2c. custom description (description is required in OpenAPI but we're providing defaults)
          202: {
            description: 'Result is accepted',
            schema: z.string(),
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
          // 3. zod-openapi notation - description required, content type explicit, schema is a zod schema
          400: {
            description: 'Some custom description',
            content: {
              'application/json': {
                schema: z
                  .object({ err: z.string() })
                  .meta({ examples: [{ err: 'John' }] }),
              },
            },
          },
          // 4. regular OpenAPI notation - description required, content type explicit, schema is an OpenAPI object
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
          // 5. reference object
          402: {
            $ref: '#/components/responses/ServerError',
          },
        },
      }),
      async (c) => {
        const { status } = c.req.valid('query');
        const { res } = c.var;

        // invalid responses:
        // @ts-expect-error 'default' is not a valid status code
        const _resDefault = res('default', { message: 'John' });
        // @ts-expect-error wrong type
        const _res200Error = res(200, 123);
        // @ts-expect-error defined but without zod schema
        const _res401 = res(401, { name: 'error' });
        // @ts-expect-error defined but without zod schema
        const _res402 = res(402, { name: 'error' });

        // shortened signature for 200, just for type testing
        const _resSimple = res({ name: 'John' });

        const validStrictlyTypedResponses = {
          '200': res(200, { name: 'John' }),
          // todo: consider some support for headers
          '201': res(201, { created: true }, { 'x-custom-header': 'value' }),
          '202': res(202, 'Accepted'),
          '203': res(203, '<h1>HTML Content</h1>'),
          '204': res(204, null),
          '205': res(205, null, { 'x-custom-header': 'value' }),
          '400': res(400, { err: 'John' }),
        };

        return validStrictlyTypedResponses[
          status as keyof typeof validStrictlyTypedResponses
        ];
      },
    );

    const client = testClient(app);
    const testResponse = await client.user.$post({ query: { status: '200' } });
    const responseCopy = testResponse.clone();
    expect(await responseCopy.json()).toEqual({ name: 'John' });

    if (testResponse.status === 200) {
      expectTypeOf(testResponse.json()).resolves.toEqualTypeOf<{
        name: string;
      }>();
    } else if (testResponse.status === 201) {
      expectTypeOf(testResponse.json()).resolves.toEqualTypeOf<{
        created: boolean;
      }>();
    } else if (testResponse.status === 202) {
      expectTypeOf(testResponse.text()).resolves.toEqualTypeOf<string>();
    } else if (testResponse.status === 203) {
      expectTypeOf(testResponse.text()).resolves.toEqualTypeOf<string>();
    } else if (testResponse.status === 204) {
      expectTypeOf(testResponse.json()).resolves.toEqualTypeOf<null>();
    } else if (testResponse.status === 205) {
      expectTypeOf(testResponse.json()).resolves.toEqualTypeOf<null>();
    } else if (testResponse.status === 400) {
      expectTypeOf(testResponse.json()).resolves.toEqualTypeOf<{
        err: string;
      }>();
    }
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

  it('res middleware works without request validators', async () => {
    const app = new Hono().get(
      '/status',
      openApi({
        responses: {
          200: z.object({ status: z.string() }),
        },
      }),
      async (c) => {
        return c.var.res({ status: 'ok' });
      },
    );
    const client = testClient(app);
    const res = await client.status.$get();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
