import { Hono } from 'hono';
import { expectTypeOf, describe, expect, it } from 'vitest';
import * as z from 'zod';
import {
  createOpenApiDocument,
  hasWildcardSegment,
  normalizePathParams,
} from './createOpenApiDocument.ts';
import { defineOpenApiOperation, openApi } from './openApi.ts';
import type {
  HonoOpenApiOperation,
  HonoOpenApiRequestSchemas,
} from './types.ts';

const documentData = {
  info: {
    title: 'Some API',
    version: '0.0.1',
  },
};

describe('createOpenApiDocument', () => {
  it('throws when sibling chain middleware and the route declare the same request target differently', () => {
    const authFragment = openApi({
      request: {
        header: z.object({
          authorization: z.string().startsWith('Bearer ').optional(),
        }),
      },
      responses: {
        401: z.object({ code: z.string(), message: z.string() }),
      },
    });

    const app = new Hono().get(
      '/me',
      authFragment,
      openApi({
        request: {
          header: z.object({ authorization: z.number() }),
        },
        responses: {
          200: z.object({ ok: z.string() }),
        },
      }),
      (c) => c.var.res(200, { ok: 'never reached' }),
    );

    expect(() => createOpenApiDocument(app, documentData)).toThrowError(
      /GET \/me.*header\.authorization.*conflict/,
    );
  });

  it('throws when a sibling middleware declares a response status differently', () => {
    const fragment = openApi({
      responses: {
        401: z.object({ code: z.string() }),
      },
    });

    const app = new Hono().get(
      '/me',
      fragment,
      openApi({
        responses: {
          200: z.object({ ok: z.string() }),
          401: z.object({ message: z.string() }),
        },
      }),
      (c) => c.var.res(200, { ok: 'never reached' }),
    );

    expect(() => createOpenApiDocument(app, documentData)).toThrowError(
      /GET \/me.*'401'.*different schema/,
    );
  });

  it('allows sibling declarations that are output-compatible', () => {
    const fragment = openApi({
      request: {
        header: z.object({
          authorization: z.string().optional(),
        }),
      },
      responses: {
        401: z.object({ code: z.string(), message: z.string() }),
      },
    });

    const app = new Hono().get(
      '/me',
      fragment,
      openApi({
        request: {
          header: z.object({
            // meta/documentation differences do not change the contract
            authorization: z
              .string()
              .meta({ description: 'Bearer token' })
              .optional(),
          }),
        },
        responses: {
          200: z.object({ ok: z.string() }),
        },
      }),
      (c) => c.var.res(200, { ok: 'reached' }),
    );

    expect(() => createOpenApiDocument(app, documentData)).not.toThrow();
  });

  it('merges different request targets declared by sibling chain entries', () => {
    const app = new Hono().post(
      '/me',
      openApi({
        request: {
          header: z.object({ authorization: z.string() }),
        },
      }),
      openApi({
        request: {
          json: z.object({ name: z.string() }),
        },
      }),
      (c) => c.json({ name: c.req.valid('json').name }, 200),
    );

    const operation = createOpenApiDocument(app, documentData, {
      addRoute: false,
    }).paths?.['/me']?.post;

    expect(
      (operation?.parameters ?? []).map((parameter) =>
        'name' in parameter ? parameter.name : undefined,
      ),
    ).toEqual(['authorization']);

    const requestBody = operation?.requestBody as
      | {
          content?: Record<
            string,
            {
              schema?: {
                type?: string;
                properties?: Record<string, unknown>;
              };
            }
          >;
        }
      | undefined;
    expect(requestBody?.content?.['application/json']?.schema?.type).toBe(
      'object',
    );
    expect(
      Object.keys(
        requestBody?.content?.['application/json']?.schema?.properties ?? {},
      ),
    ).toEqual(['name']);
  });

  it('merges disjoint properties of the same request target declared by sibling chain entries', () => {
    const app = new Hono().post(
      '/me',
      openApi({
        request: {
          header: z.object({ authorization: z.string() }),
        },
      }),
      openApi({
        request: {
          header: z.object({ 'x-request-id': z.string() }),
        },
      }),
      (c) => c.json({ ok: true }, 200),
    );

    const operation = createOpenApiDocument(app, documentData, {
      addRoute: false,
    }).paths?.['/me']?.post;

    expect(
      (operation?.parameters ?? []).map((parameter) =>
        'name' in parameter ? parameter.name : undefined,
      ),
    ).toEqual(['authorization', 'x-request-id']);
  });

  it('throws a clear error when a documented route is a wildcard', () => {
    const app = new Hono().get(
      '/api/*',
      openApi({
        responses: { 200: z.object({ ok: z.boolean() }) },
      }),
      (c) => c.json({ ok: true }, 200),
    );

    expect(() => createOpenApiDocument(app, documentData)).toThrowError(
      /Cannot document wildcard route "GET \/api\/\*"/,
    );
  });

  it('does not treat a star inside a path matcher as a wildcard', () => {
    const app = new Hono().get(
      '/post/:date{[0-9]*}',
      openApi({
        request: { param: z.object({ date: z.string() }) },
        responses: { 200: z.object({ date: z.string() }) },
      }),
      (c) => c.json({ date: c.req.valid('param').date }, 200),
    );

    const document = createOpenApiDocument(app, documentData, {
      addRoute: false,
    });

    expect(document.paths?.['/post/{date}']?.get).toBeDefined();
  });

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
          200: z.object({ hi: z.string() }).meta({
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
            additionalProperties: false,
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
            schema: z.object({ hi: z.string() }).meta({
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
            additionalProperties: false,
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
            additionalProperties: false,
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
            additionalProperties: false,
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
        in: 'cookie',
        name: 'token',
        required: true,
        schema: {
          type: 'string',
        },
      },
      {
        in: 'query',
        name: 'name',
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
    const taggedAuthRoute = <T extends HonoOpenApiRequestSchemas>(
      tag: string,
      doc: HonoOpenApiOperation<T>,
    ) => {
      return defineOpenApiOperation({
        ...doc,
        tags: [tag],
        security: [{ apiKey: [] }],
      });
    };

    const app = new Hono<{ Bindings: { env: 'test' } }>().basePath('/api').get(
      '/example',
      openApi(
        taggedAuthRoute('auth', {
          responses: {
            200: z.object({ hi: z.string() }),
          },
          request: {
            query: z.object({ name: z.string() }),
          },
        }),
      ),
      async (c) => {
        const { name } = c.req.valid('query');
        expectTypeOf(name).toBeString();
      },
    );

    createOpenApiDocument(app, documentData);
  });

  it('works with onError hook defined before the handler', async () => {
    const app = new Hono()
      .onError((err, c) => {
        return c.json({ error: err.message }, 500);
      })
      .get(
        '/example',
        openApi({
          responses: {
            200: z.object({ hi: z.string() }),
          },
        }),
        (c) => c.json({ hi: ':)' }),
      );

    createOpenApiDocument(app, documentData);

    const response = await app.request('/doc');
    const openApiSpec = await response.json();

    expect(openApiSpec.paths['/example'].get.responses[200]).toEqual({
      content: {
        'application/json': {
          schema: {
            additionalProperties: false,
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

  it('normalizes path parameters correctly', async () => {
    const app = new Hono().get(
      '/user/:id',
      openApi({
        request: {
          param: z.object({ id: z.string() }),
        },
        responses: {
          200: z.object({ id: z.string() }),
        },
      }),
      async (c) => {
        const { id } = c.req.valid('param');
        return c.json({ id }, 200);
      },
    );

    createOpenApiDocument(app, documentData);

    const response = await app.request('/doc');
    const openApiSpec = await response.json();

    expect(openApiSpec.paths['/user/{id}'].get.parameters).toEqual([
      {
        in: 'path',
        name: 'id',
        required: true,
        schema: {
          type: 'string',
        },
      },
    ]);

    expect(openApiSpec.paths['/user/{id}']).toBeDefined();
  });
});

describe('normalizePathParams', () => {
  it.each`
    honoPath                                | openApiPath
    ${':date{[0-9]+}'}                      | ${'{date}'}
    ${'/post/:date{[0-9]+}/:title{[a-z]+}'} | ${'/post/{date}/{title}'}
    ${'/posts/:filename{.+\\.png$}'}        | ${'/posts/{filename}'}
    ${'/api/animal/:type?'}                 | ${'/api/animal/{type}'}
    ${'/:kek-1'}                            | ${'/{kek-1}'}
    ${'/:kek_id'}                           | ${'/{kek_id}'}
    ${'/posts/:id/comment/:comment_id'}     | ${'/posts/{id}/comment/{comment_id}'}
  `('normalizes $honoPath to $openApiPath', ({ honoPath, openApiPath }) => {
    expect(normalizePathParams(honoPath)).toBe(openApiPath);
  });
});

describe('hasWildcardSegment', () => {
  it.each`
    honoPath                        | isWildcard
    ${'/*'}                         | ${true}
    ${'/api/*'}                     | ${true}
    ${'/api/v1/*'}                  | ${true}
    ${'/api/*/thing'}               | ${true}
    ${'/api/:id'}                   | ${false}
    ${'/post/:date{[0-9]*}'}        | ${false}
    ${'/post/:filename{.*\\.png$}'} | ${false}
    ${'/literal-star-in-name'}      | ${false}
  `('reports $honoPath as $isWildcard', ({ honoPath, isWildcard }) => {
    expect(hasWildcardSegment(honoPath)).toBe(isWildcard);
  });
});
