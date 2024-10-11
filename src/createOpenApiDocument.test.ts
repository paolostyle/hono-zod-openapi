import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extendZodWithOpenApi } from 'zod-openapi';
import { createOpenApiDocument } from './createOpenApiDocument';
import { openApi } from './openApi';

extendZodWithOpenApi(z);

const documentData = {
  info: {
    title: 'Some API',
    version: '0.0.1',
  },
};

describe('createOpenApiDocument', () => {
  it('correctly passes metadata to the document and creates the document under /doc route', async () => {
    const app = new Hono();

    createOpenApiDocument(app, documentData);

    const response = await app.request('/doc');
    const openApiSpec = await response.json();

    expect(response.status).toBe(200);
    expect(openApiSpec.openapi).toEqual('3.1.0');
    expect(openApiSpec.info).toEqual(documentData.info);
  });

  it('does not create route when addRoute = false', () => {
    const app = new Hono();

    createOpenApiDocument(app, documentData, { addRoute: false });

    expect(app.routes).toEqual([]);
  });

  it('creates a route under different name when routeName is provided', () => {
    const app = new Hono();

    createOpenApiDocument(app, documentData, { routeName: '/api-docs' });

    expect(app.routes[0].path).toEqual('/api-docs');
  });

  it('correctly adds additional attributes to the document', async () => {
    const app = new Hono();

    createOpenApiDocument(app, {
      ...documentData,
      servers: [{ url: 'https://api.example.com' }],
    });

    const response = await app.request('/doc');
    const openApiSpec = await response.json();

    expect(openApiSpec.servers).toEqual([{ url: 'https://api.example.com' }]);
  });

  it('returns correct openapi doc for simple response format', async () => {
    const app = new Hono().get(
      '/user',
      openApi({
        responses: {
          200: z.object({ hi: z.string() }).openapi({
            example: { hi: 'henlo' },
          }),
        },
      }),
      async (c) => {
        return c.json({ hi: 'string' }, 200);
      },
    );

    createOpenApiDocument(app, documentData);

    const response = await app.request('/doc');
    const openApiSpec = await response.json();

    expect(openApiSpec.paths['/user'].get.responses[200]).toEqual({
      content: {
        'application/json': {
          schema: {
            example: {
              hi: 'henlo',
            },
            properties: {
              hi: {
                type: 'string',
              },
            },
            required: ['hi'],
            type: 'object',
          },
        },
      },
      description: '200 OK',
    });
  });

  it('returns correct openapi doc for custom object response format', async () => {
    const app = new Hono().get(
      '/user',
      openApi({
        responses: {
          200: {
            schema: z.object({ hi: z.string() }).openapi({
              example: { hi: 'henlo' },
            }),
            description: 'Great success',
          },
        },
      }),
      async (c) => {
        return c.json({ hi: 'string' }, 200);
      },
    );

    createOpenApiDocument(app, documentData);

    const response = await app.request('/doc');
    const openApiSpec = await response.json();

    expect(openApiSpec.paths['/user'].get.responses[200]).toEqual({
      content: {
        'application/json': {
          schema: {
            example: {
              hi: 'henlo',
            },
            properties: {
              hi: {
                type: 'string',
              },
            },
            required: ['hi'],
            type: 'object',
          },
        },
      },
      description: 'Great success',
    });
  });

  it('properly handles multiple responses', async () => {
    const app = new Hono().get(
      '/example',
      openApi({
        responses: {
          200: z.object({ wow: z.string() }),
          400: z.object({ error: z.string() }),
        },
      }),
      async (c) => {
        if (Math.random() > 0.5) {
          return c.json({ error: 'sike, wrong number' }, 200);
        }

        return c.json({ wow: 'cool' }, 200);
      },
    );

    createOpenApiDocument(app, documentData);

    const response = await app.request('/doc');
    const openApiSpec = await response.json();

    expect(openApiSpec.paths['/example'].get.responses[200]).toEqual({
      content: {
        'application/json': {
          schema: {
            properties: {
              wow: {
                type: 'string',
              },
            },
            required: ['wow'],
            type: 'object',
          },
        },
      },
      description: '200 OK',
    });

    expect(openApiSpec.paths['/example'].get.responses[400]).toEqual({
      content: {
        'application/json': {
          schema: {
            properties: {
              error: {
                type: 'string',
              },
            },
            required: ['error'],
            type: 'object',
          },
        },
      },
      description: '400 Bad Request',
    });
  });

  it('properly passes request schema to the document', async () => {
    const app = new Hono().get(
      '/example',
      openApi({
        request: {
          query: z.object({ name: z.string() }),
          cookie: {
            schema: z.object({ token: z.string() }),
            validate: false,
          },
        },
        responses: {
          200: z.object({ hi: z.string() }),
        },
      }),
      async (c) => {
        return c.json({ wow: 'cool' }, 200);
      },
    );

    createOpenApiDocument(app, documentData);

    const response = await app.request('/doc');
    const openApiSpec = await response.json();

    expect(openApiSpec.paths['/example'].get.parameters).toEqual([
      {
        in: 'query',
        name: 'name',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        in: 'cookie',
        name: 'token',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ]);
  });

  it('properly passes request body to the document', async () => {
    const app = new Hono().post(
      '/example',
      openApi({
        request: {
          json: z.object({ name: z.string() }),
        },
        responses: {
          200: z.object({ hi: z.string() }),
        },
      }),
      async (c) => {
        return c.json({ wow: 'cool' }, 200);
      },
    );

    createOpenApiDocument(app, documentData);

    const response = await app.request('/doc');
    const openApiSpec = await response.json();

    expect(openApiSpec.paths['/example'].post.requestBody).toEqual({
      content: {
        'application/json': {
          schema: {
            properties: {
              name: {
                type: 'string',
              },
            },
            required: ['name'],
            type: 'object',
          },
        },
      },
    });
  });

  it('works with Hono instance with type parameters', () => {
    const app = new Hono<{ Bindings: { env: 'test' } }>().basePath('/api');

    createOpenApiDocument(app, documentData);
  });
});
