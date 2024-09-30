import { Hono } from 'hono';
import { testClient } from 'hono/testing';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import { extendZodWithOpenApi } from 'zod-openapi';
import { createOpenApiDocs, createOpenApiMiddleware, openApi } from './openapi';

extendZodWithOpenApi(z);

const apiInfo = {
  title: 'Some API',
  version: '0.0.1',
};

describe('config: createOpenApiDocs', () => {
  it('correctly passes metadata to the document and creates the document under /doc route', async () => {
    const app = new Hono();

    createOpenApiDocs(app, apiInfo);

    const response = await app.request('/doc');
    const openApiSpec = await response.json();

    expect(response.status).toBe(200);
    expect(openApiSpec.openapi).toEqual('3.1.0');
    expect(openApiSpec.info).toEqual(apiInfo);
  });

  it('does not create route when addRoute = false', () => {
    const app = new Hono();

    createOpenApiDocs(app, apiInfo, { addRoute: false });

    expect(app.routes).toEqual([]);
  });

  it('creates a route under different name when routeName is provided', () => {
    const app = new Hono();

    createOpenApiDocs(app, apiInfo, { routeName: '/api-docs' });

    expect(app.routes[0].path).toEqual('/api-docs');
  });

  it('correctly adds additional attributes to the document through overrides', async () => {
    const app = new Hono();

    createOpenApiDocs(app, apiInfo, {
      overrides: () => ({
        servers: [{ url: 'https://api.example.com' }],
      }),
    });

    const response = await app.request('/doc');
    const openApiSpec = await response.json();

    expect(openApiSpec.servers).toEqual([{ url: 'https://api.example.com' }]);
  });
});

describe('paths: createOpenApiDocs', () => {
  it('simple', async () => {
    const app = new Hono().get(
      '/user',
      openApi(z.object({ hi: z.string() })),
      async (c) => {
        return c.json({ hi: 'string' }, 200);
      },
    );

    createOpenApiDocs(app, apiInfo);

    const response = await app.request('/doc');
    const openApiSpec = await response.json();

    expect(openApiSpec.paths).toMatchSnapshot();
  });

  it('object', async () => {
    const app = new Hono().get(
      '/user',
      openApi({
        schema: z.object({ hi: z.string() }).openapi({
          example: { hi: 'hello' },
        }),
        description: 'Great success',
        status: 200,
      }),
      async (c) => {
        return c.json({ hi: 'string' }, 200);
      },
    );

    createOpenApiDocs(app, apiInfo);

    const response = await app.request('/doc');
    const openApiSpec = await response.json();

    expect(openApiSpec.paths).toMatchSnapshot();
  });

  it('handles custom media type', async () => {
    const app = new Hono().get(
      '/user',
      openApi({
        schema: z.string(),
        description: 'Great success',
        mediaType: 'text/plain',
        status: 200,
      }),
      async (c) => {
        return c.text('yoooooooo', 200);
      },
    );

    createOpenApiDocs(app, apiInfo);

    const response = await app.request('/doc');
    const openApiSpec = await response.json();

    expect(
      openApiSpec.paths['/user'].get.responses['200'].content,
    ).toHaveProperty('text/plain');
  });

  it('properly normalizes response schema', async () => {
    const app1 = new Hono().get(
      '/example',
      openApi(z.object({ wow: z.string() })),
      async (c) => {
        return c.json({ wow: 'cool' }, 200);
      },
    );

    const doc1 = createOpenApiDocs(app1, apiInfo);

    const app2 = new Hono().get(
      '/example',
      openApi({
        status: 200,
        schema: z.object({ wow: z.string() }),
        description: '200 OK',
      }),
      async (c) => {
        return c.json({ wow: 'cool' }, 200);
      },
    );

    const doc2 = createOpenApiDocs(app2, apiInfo);

    const app3 = new Hono().get(
      '/example',
      openApi([
        {
          status: 200,
          schema: z.object({ wow: z.string() }),
          description: '200 OK',
        },
      ]),
      async (c) => {
        return c.json({ wow: 'cool' }, 200);
      },
    );

    const doc3 = createOpenApiDocs(app3, apiInfo);

    expect(doc1).toEqual(doc2);
    expect(doc2).toEqual(doc3);
  });

  it('properly handles multiple responses', async () => {
    const app = new Hono().get(
      '/example',
      openApi([
        {
          status: 200,
          schema: z.object({ wow: z.string() }),
          description: '200 OK',
        },
        {
          status: 400,
          schema: z.object({ error: z.string() }),
          description: '400 Bad Request',
        },
      ]),
      async (c) => {
        if (Math.random() > 0.5) {
          return c.json({ error: 'sike, wrong number' }, 200);
        }

        return c.json({ wow: 'cool' }, 200);
      },
    );

    createOpenApiDocs(app, apiInfo);

    const response = await app.request('/doc');
    const openApiSpec = await response.json();

    expect(openApiSpec.paths['/example'].get.responses).toMatchSnapshot();
  });
});

describe('default openApi middleware', () => {
  it('validates request body', async () => {
    const app = new Hono().post(
      '/user',
      openApi(z.object({ name: z.string() }), {
        json: z.object({ name: z.string() }),
      }),
      async (c) => {
        const body = c.req.valid('json');

        expectTypeOf(body).toEqualTypeOf<{ name: string }>();

        // @ts-expect-error c.req.valid() should only accept json
        const nonExistent = c.req.valid('cookie');
        // @ts-expect-error c.req.valid() should only accept json
        const nonExistent2 = c.req.valid('header');
        // @ts-expect-error c.req.valid() should only accept json
        const nonExistent3 = c.req.valid('query');
        // @ts-expect-error c.req.valid() should only accept json
        const nonExistent4 = c.req.valid('param');

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
    expect(await response2.json()).toEqual({
      error: {
        issues: [
          {
            code: 'invalid_type',
            expected: 'string',
            message: 'Expected string, received number',
            path: ['name'],
            received: 'number',
          },
        ],
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
        middleware(someSchema, {
          [type]: someSchema,
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
      middleware(z.object({ name: z.string() }), {
        cookie: someSchema,
        header: someSchema,
        query: someSchema,
        json: someSchema,
        param: someSchema,
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
});
