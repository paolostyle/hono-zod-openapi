import { Hono } from 'hono';
import type { MiddlewareHandler, TypedResponse } from 'hono';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as z from 'zod';
import { createOpenApiDocument } from './createOpenApiDocument.ts';
import { createOpenApiFragment, openApi } from './openApi.ts';

interface AppBindings {
  SESSIONS: Map<string, string>;
}
type AppEnv = {
  Bindings: AppBindings;
  Variables: { userId: string };
};

type UnauthorizedResponse = Response &
  TypedResponse<{ message: string }, 401, 'json'>;

const sessions = new Map([['valid-token', 'user-1']]);

// Reusable middleware, annotated once with its environment and response types.
const auth: MiddlewareHandler<
  AppEnv,
  string,
  Record<never, never>,
  UnauthorizedResponse
> = createTypedAuth();

function createTypedAuth(): MiddlewareHandler<
  AppEnv,
  string,
  Record<never, never>,
  UnauthorizedResponse
> {
  return async (c, next) => {
    const token = c.req.header('Authorization');
    const userId = await c.env.SESSIONS.get(token ?? '');

    if (!userId) {
      return c.json({ message: 'Unauthorized' }, 401);
    }

    c.set('userId', userId);
    await next();
  };
}

const buildApp = () =>
  new Hono<AppEnv>().post(
    '/user',
    openApi(
      {
        responses: {
          200: z.object({ name: z.string() }),
          401: z.object({ message: z.string() }),
        },
        request: {
          json: z.object({ name: z.string() }),
        },
      },
      auth,
    ),
    async (c) => {
      const { name } = c.req.valid('json');
      return c.json({ name }, 200);
    },
  );

describe('openApi with reusable middleware', () => {
  it('runs middleware in order: validators, openApi, user middleware, handler', async () => {
    const order: string[] = [];
    const tracer: MiddlewareHandler = async (_c, next) => {
      order.push('mw');
      await next();
    };

    const app = new Hono<AppEnv>().post(
      '/user',
      openApi(
        {
          responses: {
            200: z.object({ name: z.string() }),
            401: z.object({ message: z.string() }),
          },
          request: {
            json: z.object({ name: z.string() }),
          },
        },
        auth,
        tracer,
      ),
      async (c) => {
        expect(order).toEqual(['mw']);
        const { name } = c.req.valid('json');
        return c.json({ name }, 200);
      },
    );

    const response = await app.request(
      '/user',
      {
        method: 'POST',
        headers: {
          Authorization: 'valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'John' }),
      },
      { SESSIONS: sessions } satisfies AppBindings,
    );

    expect(response.status).toBe(200);
    expect(order).toEqual(['mw']);
  });

  it('middleware early response stops the handler and is surfaced to the client', async () => {
    const app = buildApp();

    const response = await app.request(
      '/user',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John' }),
      },
      { SESSIONS: sessions } satisfies AppBindings,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: 'Unauthorized' });
  });

  it('middleware with next() continues to the handler with the request still validated', async () => {
    const app = buildApp();

    const response = await app.request(
      '/user',
      {
        method: 'POST',
        headers: {
          Authorization: 'valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'John' }),
      },
      { SESSIONS: sessions } satisfies AppBindings,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'John' });
  });

  it('request validation remains active on routes using the helper', async () => {
    const app = buildApp();

    const response = await app.request(
      '/user',
      {
        method: 'POST',
        headers: {
          Authorization: 'valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 123 }),
      },
      { SESSIONS: sessions } satisfies AppBindings,
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { message: string };
      success: boolean;
    };
    expect(body.success).toBe(false);
    expect(body.error.message).toContain('expected string, received number');
  });

  it('middleware reads typed bindings passed via request env', async () => {
    const app = buildApp();
    const runtimeSessions = new Map([['env-token', 'user-1']]);

    const ok = await app.request(
      '/user',
      {
        method: 'POST',
        headers: {
          Authorization: 'env-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'John' }),
      },
      { SESSIONS: runtimeSessions } satisfies AppBindings,
    );
    expect(ok.status).toBe(200);

    const failed = await app.request(
      '/user',
      {
        method: 'POST',
        headers: {
          Authorization: 'env-token-missing',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'John' }),
      },
      { SESSIONS: runtimeSessions } satisfies AppBindings,
    );
    expect(failed.status).toBe(401);
  });

  it('middleware set variables are available in the handler', async () => {
    const app = new Hono<AppEnv>().post(
      '/user',
      openApi(
        {
          responses: {
            200: z.object({ userId: z.string() }),
            401: z.object({ message: z.string() }),
          },
        },
        auth,
      ),
      async (c) => {
        return c.json({ userId: c.var.userId }, 200);
      },
    );

    const response = await app.request(
      '/user',
      {
        method: 'POST',
        headers: { Authorization: 'valid-token' },
      },
      { SESSIONS: sessions } satisfies AppBindings,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: 'user-1' });
  });

  it('middleware is reusable across routes', async () => {
    const app = new Hono<AppEnv>()
      .post(
        '/user',
        openApi(
          {
            responses: {
              200: z.object({ name: z.string() }),
              401: z.object({ message: z.string() }),
            },
            request: {
              json: z.object({ name: z.string() }),
            },
          },
          auth,
        ),
        async (c) => c.json({ name: c.var.userId }, 200),
      )
      .get(
        '/secret',
        openApi(
          {
            responses: {
              200: z.object({ secret: z.string() }),
              401: z.object({ message: z.string() }),
            },
          },
          auth,
        ),
        async (c) => c.json({ secret: c.var.userId }, 200),
      );

    const unauthorized = await app.request(
      '/user',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John' }),
      },
      { SESSIONS: sessions } satisfies AppBindings,
    );
    expect(unauthorized.status).toBe(401);

    const secret = await app.request(
      '/secret',
      { headers: { Authorization: 'valid-token' } },
      { SESSIONS: sessions } satisfies AppBindings,
    );
    expect(secret.status).toBe(200);
    expect(await secret.json()).toEqual({ secret: 'user-1' });
  });

  it('res helper is still available to the handler', async () => {
    const app = new Hono<AppEnv>().get(
      '/user',
      openApi(
        {
          responses: {
            200: z.object({ name: z.string() }),
            401: z.object({ message: z.string() }),
          },
        },
        auth,
      ),
      async (c) => c.var.res({ name: 'John' }),
    );

    const response = await app.request(
      '/user',
      { headers: { Authorization: 'valid-token' } },
      { SESSIONS: sessions } satisfies AppBindings,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'John' });
  });

  it('openApi document reflects the schema of helper routes', () => {
    const app = buildApp();

    const document = createOpenApiDocument(app, {
      info: { title: 'Test', version: '1.0.0' },
    });

    const post = document.paths?.['/user']?.post;
    expect(post).toBeDefined();

    const responses = post?.responses;
    expect(Object.keys(responses ?? {})).toEqual(
      expect.arrayContaining(['200', '401']),
    );

    expect(
      (responses as Record<string, { content?: Record<string, unknown> }>)?.[
        '200'
      ]?.content?.['application/json'],
    ).toBeDefined();

    expect(post?.requestBody && 'content' in post.requestBody).toBe(true);
  });
});

describe('createOpenApiFragment', () => {
  type FragmentEnv = {
    Bindings: { SESSIONS: Map<string, string> };
    Variables: { userId: string };
  };

  const openApiFragment = createOpenApiFragment<FragmentEnv>();
  const fragmentSessions = new Map([['valid-token', 'user-1']]);

  const fragmentAuth = openApiFragment(
    {
      responses: {
        401: { schema: z.object({ message: z.string() }) },
      },
      request: {
        header: z.object({ Authorization: z.string() }),
      },
    },
    async (c, next) => {
      const userId = await c.env.SESSIONS.get(
        c.req.valid('header').Authorization,
      );
      if (!userId) {
        return c.var.res(401, { message: 'Unauthorized' });
      }
      c.set('userId', userId);
      await next();
    },
  );

  it('inline middleware reads validated input, bindings and returns schema-checked responses', async () => {
    const app = new Hono<FragmentEnv>().post(
      '/user',
      fragmentAuth,
      openApiFragment({
        responses: {
          200: z.object({ userId: z.string() }),
        },
        request: {
          json: z.object({ name: z.string() }),
        },
      }),
      async (c) => c.var.res(200, { userId: c.var.userId }),
    );

    const ok = await app.request(
      '/user',
      {
        method: 'POST',
        headers: {
          Authorization: 'valid-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'John' }),
      },
      { SESSIONS: fragmentSessions } satisfies FragmentEnv['Bindings'],
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ userId: 'user-1' });

    const denied = await app.request(
      '/user',
      {
        method: 'POST',
        headers: {
          Authorization: 'missing-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'John' }),
      },
      { SESSIONS: fragmentSessions } satisfies FragmentEnv['Bindings'],
    );
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ message: 'Unauthorized' });
  });

  it('fragment middleware still validates its own request part', async () => {
    const app = new Hono<FragmentEnv>().post(
      '/user',
      fragmentAuth,
      openApiFragment({
        responses: {
          200: z.object({ userId: z.string() }),
        },
        request: {
          json: z.object({ name: z.string() }),
        },
      }),
      async (c) => c.var.res(200, { userId: c.var.userId }),
    );

    const response = await app.request(
      '/user',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'John' }),
      },
      { SESSIONS: fragmentSessions } satisfies FragmentEnv['Bindings'],
    );

    expect(response.status).toBe(400);
  });

  it('openApi document is generated for fragment routes', () => {
    const app = new Hono<FragmentEnv>().post(
      '/user',
      openApiFragment(
        {
          responses: {
            200: z.object({ userId: z.string() }),
            401: {
              schema: z.object({ code: z.string(), message: z.string() }),
            },
          },
          request: {
            json: z.object({ name: z.string() }),
          },
        },
        async (c, next) => {
          if (
            !(await c.env.SESSIONS.get(c.req.header('Authorization') ?? ''))
          ) {
            return c.var.res(401, { code: 'UNAUTHORIZED', message: 'nope' });
          }
          await next();
        },
      ),
      async (c) => c.var.res(200, { userId: c.var.userId }),
    );

    const document = createOpenApiDocument(app, {
      info: { title: 'Test', version: '1.0.0' },
    });

    const post = document.paths?.['/user']?.post;
    expect(Object.keys(post?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '401']),
    );
    expect(post?.requestBody && 'content' in post.requestBody).toBe(true);
  });

  it('runs the maximum inline middleware overloads in order and stops on an early response', async () => {
    const order: string[] = [];
    const app = new Hono<FragmentEnv>().post(
      '/max-inline',
      openApiFragment(
        {
          request: { json: z.object({ name: z.string() }) },
          responses: { 200: z.object({ name: z.string() }) },
        },
        async (_c, next) => {
          order.push('one-before');
          await next();
          order.push('one-after');
        },
        async (_c, next) => {
          order.push('two-before');
          await next();
          order.push('two-after');
        },
        async (c, next) => {
          order.push('three-before');
          if (c.req.valid('json').name === 'blocked') {
            return c.json({ blocked: true }, 403);
          }
          expect(c.req.valid('json').name).toBe('allowed');
          await next();
          order.push('three-after');
        },
      ),
      (c) => {
        order.push('handler');
        return c.var.res(200, { name: c.req.valid('json').name });
      },
    );

    const ok = await app.request('/max-inline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'allowed' }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ name: 'allowed' });
    expect(order).toEqual([
      'one-before',
      'two-before',
      'three-before',
      'handler',
      'three-after',
      'two-after',
      'one-after',
    ]);

    order.length = 0;
    const blocked = await app.request('/max-inline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'blocked' }),
    });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ blocked: true });
    expect(order).toEqual([
      'one-before',
      'two-before',
      'three-before',
      'two-after',
      'one-after',
    ]);

    order.length = 0;
    const invalid = await app.request('/max-inline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 123 }),
    });
    expect(invalid.status).toBe(400);
    expect(order).toEqual([]);
  });
});

describe('openApi fragment merging', () => {
  it('rejects nested request property and response schema conflicts at runtime', () => {
    const fragment = openApi({
      request: { header: z.object({ authorization: z.string() }) },
      responses: { 401: z.object({ message: z.string() }) },
    });

    expect(() =>
      openApi(
        {
          request: { header: z.object({ authorization: z.number() }) },
          responses: { 200: z.object({ ok: z.boolean() }) },
        },
        // @ts-expect-error the same header property has a different schema
        fragment,
      ),
    ).toThrow(/header\.authorization/);

    expect(() =>
      openApi(
        { responses: { 401: z.object({ message: z.number() }) } },
        // @ts-expect-error response status has a different schema
        fragment,
      ),
    ).toThrow(/response status '401'/);

    expect(() =>
      openApi(
        { responses: { 401: z.object({ message: z.string() }) } },
        fragment,
      ),
    ).not.toThrow();
  });

  it('merges disjoint properties within request targets for validation and docs', async () => {
    let authRuns = 0;
    const authFragment = openApi(
      {
        request: {
          header: z.object({ authorization: z.string().startsWith('Bearer ') }),
        },
        responses: { 401: z.object({ message: z.string() }) },
      },
      async (_c, next) => {
        authRuns += 1;
        await next();
      },
    );

    const app = new Hono().post(
      '/tasks',
      openApi(
        {
          request: {
            header: z.object({ 'x-request-id': z.string().min(1) }),
            json: z.object({ title: z.string() }),
          },
          responses: { 201: z.object({ title: z.string() }) },
        },
        authFragment,
      ),
      (c) => {
        const headers = c.req.valid('header');
        return c.var.res(201, {
          title: `${headers['x-request-id']}:${headers.authorization}`,
        });
      },
    );

    const response = await app.request('/tasks', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'x-request-id': 'req-1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'task' }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ title: 'req-1:Bearer token' });
    expect(authRuns).toBe(1);

    const document = createOpenApiDocument(
      app,
      { info: { title: 'Test', version: '1.0.0' } },
      { addRoute: false },
    );
    const headers = document.paths?.['/tasks']?.post?.parameters;
    expect(
      headers?.map((parameter) =>
        'name' in parameter ? parameter.name : undefined,
      ),
    ).toEqual(expect.arrayContaining(['authorization', 'x-request-id']));
  });

  it('merges multiple fragments once and preserves middleware order', async () => {
    const order: string[] = [];
    const authFragment = openApi(
      {
        request: {
          header: z.object({ authorization: z.string() }),
        },
        responses: {
          400: z.object({ message: z.string() }),
          401: z.object({ message: z.string() }),
        },
      },
      async (_c, next) => {
        order.push('auth-before');
        await next();
        order.push('auth-after');
      },
    );
    const requestIdFragment = openApi(
      {
        request: {
          header: z.object({ 'x-request-id': z.string().min(1) }),
        },
        responses: { 400: z.object({ message: z.string() }) },
      },
      async (_c, next) => {
        order.push('request-id-before');
        await next();
        order.push('request-id-after');
      },
    );
    const app = new Hono().post(
      '/tasks',
      openApi(
        {
          request: {
            json: z.object({ title: z.string() }),
          },
          responses: { 201: z.object({ title: z.string() }) },
        },
        authFragment,
        requestIdFragment,
      ),
      (c) => {
        order.push('handler');
        return c.var.res(201, { title: c.req.valid('json').title });
      },
    );

    const response = await app.request('/tasks', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'x-request-id': 'req-1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'task' }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ title: 'task' });
    expect(order).toEqual([
      'auth-before',
      'request-id-before',
      'handler',
      'request-id-after',
      'auth-after',
    ]);

    order.length = 0;
    const invalidResponse = await app.request('/tasks', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'task' }),
    });
    expect(invalidResponse.status).toBe(400);
    expect(order).toEqual([]);

    const document = createOpenApiDocument(
      app,
      { info: { title: 'Test', version: '1.0.0' } },
      { addRoute: false },
    );
    const operation = document.paths?.['/tasks']?.post;
    expect(
      operation?.parameters?.map((parameter) =>
        'name' in parameter ? parameter.name : undefined,
      ),
    ).toEqual(expect.arrayContaining(['authorization', 'x-request-id']));
    expect(Object.keys(operation?.responses ?? {})).toEqual(
      expect.arrayContaining(['201', '401', '400']),
    );
  });

  it('runs two composed fragments and an inline middleware with merged request targets', async () => {
    const order: string[] = [];
    const headerFragment = openApi(
      {
        request: {
          header: z.object({ 'x-request-id': z.string().min(1) }),
        },
        responses: { 400: z.object({ message: z.string() }) },
      },
      async (_c, next) => {
        order.push('header-before');
        await next();
        order.push('header-after');
      },
    );
    const bodyFragment = openApi(
      {
        request: {
          json: z.object({ title: z.string() }),
        },
        responses: {},
      },
      async (_c, next) => {
        order.push('body-before');
        await next();
        order.push('body-after');
      },
    );
    const app = new Hono().post(
      '/tasks',
      openApi(
        {
          responses: {
            201: z.object({ title: z.string(), requestId: z.string() }),
          },
        },
        headerFragment,
        bodyFragment,
        async (c, next) => {
          order.push('inline-before');
          // both fragments' targets are validated before the inline middleware
          expect(c.req.valid('header')['x-request-id']).toBe('req-1');
          expect(c.req.valid('json').title).toBe('task');
          await next();
          order.push('inline-after');
        },
      ),
      (c) => {
        order.push('handler');
        return c.var.res(201, {
          title: c.req.valid('json').title,
          requestId: c.req.valid('header')['x-request-id'],
        });
      },
    );

    const response = await app.request('/tasks', {
      method: 'POST',
      headers: {
        'x-request-id': 'req-1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'task' }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      title: 'task',
      requestId: 'req-1',
    });
    expect(order).toEqual([
      'header-before',
      'body-before',
      'inline-before',
      'handler',
      'inline-after',
      'body-after',
      'header-after',
    ]);

    order.length = 0;
    const invalidResponse = await app.request('/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'task' }),
    });
    expect(invalidResponse.status).toBe(400);
    expect(order).toEqual([]);

    const document = createOpenApiDocument(
      app,
      { info: { title: 'Test', version: '1.0.0' } },
      { addRoute: false },
    );
    const operation = document.paths?.['/tasks']?.post;
    expect(
      operation?.parameters?.map((parameter) =>
        'name' in parameter ? parameter.name : undefined,
      ),
    ).toEqual(expect.arrayContaining(['x-request-id']));
    expect(operation?.requestBody).toBeDefined();
    expect(Object.keys(operation?.responses ?? {})).toEqual(
      expect.arrayContaining(['201', '400']),
    );
  });

  it('executes nested fragments once at maximum composition arity', async () => {
    const order: string[] = [];
    const openApiFragment = createOpenApiFragment<AppEnv>();
    const requestIdFragment = openApiFragment(
      {
        request: {
          header: z.object({ 'x-request-id': z.string() }),
        },
        responses: { 400: z.object({ message: z.string() }) },
      },
      async (_c, next) => {
        order.push('request-id-before');
        await next();
        order.push('request-id-after');
      },
    );
    const bodyFragment = openApiFragment(
      {
        request: { json: z.object({ title: z.string() }) },
        responses: {},
      },
      async (_c, next) => {
        order.push('body-before');
        await next();
        order.push('body-after');
      },
    );
    const inner = openApiFragment(
      {
        request: {
          header: z.object({ authorization: z.string() }),
        },
        responses: { 401: z.object({ message: z.string() }) },
      },
      requestIdFragment,
      bodyFragment,
      async (c, next) => {
        order.push('inner-before');
        expect(c.req.valid('header')['x-request-id']).toBe('req-1');
        expect(c.req.valid('json').title).toBe('task');
        await next();
        order.push('inner-after');
      },
    );
    const traceFragment = openApiFragment(
      {
        request: {
          header: z.object({ 'x-trace-id': z.string() }),
        },
        responses: { 403: z.object({ message: z.string() }) },
      },
      async (_c, next) => {
        order.push('trace-before');
        await next();
        order.push('trace-after');
      },
    );
    const clientIdFragment = openApiFragment(
      {
        request: {
          header: z.object({ 'x-client-id': z.string() }),
        },
        responses: { 429: z.object({ message: z.string() }) },
      },
      async (_c, next) => {
        order.push('client-id-before');
        await next();
        order.push('client-id-after');
      },
    );

    const app = new Hono<AppEnv>().post(
      '/deep',
      openApi(
        {
          request: { json: z.object({ extra: z.boolean() }) },
          responses: {
            201: z.object({
              title: z.string(),
              requestId: z.string(),
              traceId: z.string(),
              clientId: z.string(),
            }),
          },
        },
        inner,
        traceFragment,
        clientIdFragment,
      ),
      (c) => {
        order.push('handler');
        return c.var.res(201, {
          title: c.req.valid('json').title,
          requestId: c.req.valid('header')['x-request-id'],
          traceId: c.req.valid('header')['x-trace-id'],
          clientId: c.req.valid('header')['x-client-id'],
        });
      },
    );

    const response = await app.request('/deep', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'x-request-id': 'req-1',
        'x-trace-id': 'trace-1',
        'x-client-id': 'client-1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'task', extra: true }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      title: 'task',
      requestId: 'req-1',
      traceId: 'trace-1',
      clientId: 'client-1',
    });
    expect(order).toEqual([
      'request-id-before',
      'body-before',
      'inner-before',
      'trace-before',
      'client-id-before',
      'handler',
      'client-id-after',
      'trace-after',
      'inner-after',
      'body-after',
      'request-id-after',
    ]);

    order.length = 0;
    const invalidResponse = await app.request('/deep', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'x-request-id': 'req-1',
        'x-trace-id': 'trace-1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'task', extra: true }),
    });
    expect(invalidResponse.status).toBe(400);
    expect(order).toEqual([]);

    const document = createOpenApiDocument(
      app,
      { info: { title: 'Test', version: '1.0.0' } },
      { addRoute: false },
    );
    const operation = document.paths?.['/deep']?.post;
    expect(
      operation?.parameters?.map((parameter) =>
        'name' in parameter ? parameter.name : undefined,
      ),
    ).toEqual(
      expect.arrayContaining([
        'authorization',
        'x-request-id',
        'x-trace-id',
        'x-client-id',
      ]),
    );
    expect(operation?.requestBody).toBeDefined();
    expect(Object.keys(operation?.responses ?? {})).toEqual(
      expect.arrayContaining(['201', '400', '401', '403', '429']),
    );
  });

  it('keeps validate:false request properties documented but out of runtime validation', async () => {
    const authFragment = openApi({
      request: {
        header: z.object({ authorization: z.string() }),
      },
      responses: { 401: z.object({ message: z.string() }) },
    });
    const app = new Hono().get(
      '/me',
      openApi(
        {
          request: {
            header: {
              schema: z.object({ 'x-document-only': z.string() }),
              validate: false,
            },
          },
          responses: { 200: z.object({ ok: z.boolean() }) },
        },
        authFragment,
      ),
      (c) => c.var.res(200, { ok: true }),
    );

    const response = await app.request('/me', {
      headers: { authorization: 'Bearer token' },
    });
    expect(response.status).toBe(200);

    const missingAuth = await app.request('/me');
    expect(missingAuth.status).toBe(400);

    const operation = createOpenApiDocument(
      app,
      { info: { title: 'Test', version: '1.0.0' } },
      { addRoute: false },
    ).paths?.['/me']?.get;

    expect(
      (operation?.parameters ?? []).map((parameter) =>
        'name' in parameter ? parameter.name : undefined,
      ),
    ).toEqual(expect.arrayContaining(['authorization', 'x-document-only']));
  });

  it('composed fragment: the route\u0027s op status stays callable from the handler (c.var.res is not overwritten by the fragment\u0027s inner res)', async () => {
    const authFragment = openApi({
      responses: {
        401: z.object({ code: z.string(), message: z.string() }),
      },
    });

    const app = new Hono().get(
      '/user',
      openApi(
        {
          responses: {
            200: z.object({ userId: z.string() }),
          },
        },
        authFragment,
      ),
      (c) => c.var.res(200, { userId: 'u1' }),
    );

    const response = await app.request('/user');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId: 'u1' });
  });

  it('nested fragment: operations merge into a single metadata (doc) payload', () => {
    const jwtOpenApi = openApi({
      security: [{ bearerAuth: [] }],
      tags: ['Auth'],
      request: {
        header: z.object({ authorization: z.string() }),
      },
      responses: {
        401: { schema: z.object({ message: z.string() }) },
      },
    });

    const app = new Hono().get(
      '/user',
      openApi(
        {
          tags: ['User'],
          responses: {
            200: z.object({ name: z.string() }),
          },
        },
        jwtOpenApi,
      ),
      (c) => {
        // nested fragment header validation is active at type level
        expectTypeOf(c.req.valid('header')).toEqualTypeOf<{
          authorization: string;
        }>();
        return c.json({ name: 'John' }, 200);
      },
    );

    const document = createOpenApiDocument(app, {
      info: { title: 'Test', version: '1.0.0' },
    });

    const post = document.paths?.['/user']?.get;
    expect(post?.security).toEqual([{ bearerAuth: [] }]);
    // nested fragments append their tags after the outer fragment's
    expect(post?.tags).toEqual(['User', 'Auth']);
    expect(Object.keys(post?.responses ?? {})).toEqual(['200', '401']);
  });

  it('stacked fragments: the doc merges the same way (later wins conflicts)', () => {
    const first = openApi({
      tags: ['Auth'],
      responses: {
        401: { schema: z.object({ message: z.string() }) },
      },
    });

    const second = openApi({
      tags: ['User'],
      responses: {
        200: z.object({ name: z.string() }),
      },
    });

    const app = new Hono().get('/user', first, second, (c) =>
      c.json({ name: 'John' }, 200),
    );

    const document = createOpenApiDocument(app, {
      info: { title: 'Test', version: '1.0.0' },
    });

    const post = document.paths?.['/user']?.get;
    expect(post?.tags).toEqual(['Auth', 'User']);
    expect(Object.keys(post?.responses ?? {})).toEqual(['200', '401']);
  });

  it('stacked fragments: matching response schemas can be redeclared', () => {
    const sameSchema = z.object({ name: z.string() });

    const first = openApi({
      responses: { 200: sameSchema },
      request: { json: sameSchema },
    });

    const second = openApi({
      responses: { 200: sameSchema },
      request: { json: sameSchema },
    });

    const app = new Hono().get('/user', first, second, (c) =>
      c.json(c.req.valid('json'), 200),
    );

    const document = createOpenApiDocument(app, {
      info: { title: 'Test', version: '1.0.0' },
    });
    expect(document.paths?.['/user']?.get?.responses?.['200']).toBeDefined();
  });

  it('stacked fragments: different response schemas conflict', () => {
    const first = openApi({
      responses: { 200: z.object({ name: z.string() }) },
    });
    const second = openApi({
      responses: { 200: z.object({ id: z.number() }) },
    });
    const app = new Hono().get('/user', first, second, (c) =>
      c.json({ name: 'John' }, 200),
    );

    expect(() =>
      createOpenApiDocument(app, {
        info: { title: 'Test', version: '1.0.0' },
      }),
    ).toThrow(/response status '200'/);
  });
});

describe('separate openApi chain slots', () => {
  it('validates and runs each slot once, and exposes cross-slot input to the handler', async () => {
    const order: string[] = [];
    const headerSlot = openApi(
      {
        request: {
          header: z.object({ authorization: z.string().optional() }),
        },
        responses: {
          200: z.object({ name: z.string() }),
          401: z.object({ message: z.string() }),
        },
      },
      async (c, next) => {
        order.push('header-before');
        if (c.req.header('authorization') !== 'Bearer token') {
          return c.json({ message: 'Unauthorized' }, 401);
        }
        await next();
        order.push('header-after');
      },
    );
    const bodySlot = openApi(
      {
        request: { json: z.object({ name: z.string() }) },
      },
      async (_c, next) => {
        order.push('body-before');
        await next();
        order.push('body-after');
      },
    );

    const app = new Hono().post('/tasks', headerSlot, bodySlot, (c) => {
      order.push('handler');
      return c.var.res(200, { name: c.req.valid('json').name });
    });

    const ok = await app.request('/tasks', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'John' }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ name: 'John' });
    expect(order).toEqual([
      'header-before',
      'body-before',
      'handler',
      'body-after',
      'header-after',
    ]);

    order.length = 0;
    const unauthorized = await app.request('/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 123 }),
    });
    // The earlier slot returns before the later slot's validator runs.
    expect(unauthorized.status).toBe(401);
    expect(order).toEqual(['header-before']);

    order.length = 0;
    const invalidBody = await app.request('/tasks', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 123 }),
    });
    expect(invalidBody.status).toBe(400);
    // The later slot's validation happens after the earlier slot's
    // pre-next middleware, but before its own middleware and the handler.
    expect(order).toEqual(['header-before', 'header-after']);
  });

  it('can use a status declared by another slot through c.var.res', async () => {
    const okSlot = openApi({
      responses: { 200: z.object({ ok: z.boolean() }) },
    });
    const errorSlot = openApi({
      responses: { 401: z.object({ message: z.string() }) },
    });

    const app = new Hono().get('/user', okSlot, errorSlot, (c) =>
      c.var.res(401, { message: 'Unauthorized' }),
    );

    const response = await app.request('/user');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: 'Unauthorized' });
  });

  it('runs the same fragment once per chain slot when passed twice', async () => {
    let runs = 0;
    const fragment = openApi(
      {
        request: { header: z.object({}) },
      },
      async (_c, next) => {
        runs += 1;
        await next();
      },
    );

    const app = new Hono().get('/user', fragment, fragment, (c) =>
      c.json({ ok: true }, 200),
    );

    const response = await app.request('/user');
    expect(response.status).toBe(200);
    expect(runs).toBe(2);
  });

  it('rejects a nested conflict that only exists at runtime', () => {
    const fragment = openApi({
      request: { header: z.object({ id: z.string().min(1) }) },
    });

    expect(() =>
      openApi(
        {
          request: { header: z.object({ id: z.string().max(10) }) },
        },
        fragment,
      ),
    ).toThrow(/header\.id/);
  });
});

describe('middleware return handling', () => {
  it('stops on an early plain Response from an async middleware', async () => {
    let handlerRuns = 0;
    const app = new Hono().get(
      '/user',
      openApi(
        { responses: { 200: z.object({ ok: z.boolean() }) } },
        async () => new Response('blocked', { status: 418 }),
      ),
      (c) => {
        handlerRuns += 1;
        return c.json({ ok: true }, 200);
      },
    );

    const response = await app.request('/user');
    expect(response.status).toBe(418);
    expect(await response.text()).toBe('blocked');
    expect(handlerRuns).toBe(0);
  });

  it('lets Hono onError handle a middleware exception', async () => {
    const app = new Hono()
      .onError((error, c) => c.json({ handled: error.message }, 500))
      .get(
        '/user',
        openApi({ responses: {} }, async () => {
          throw new Error('boom');
        }),
        (c) => c.json({ ok: true }, 200),
      );

    const response = await app.request('/user');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ handled: 'boom' });
  });

  it('can set a response header after next()', async () => {
    const app = new Hono().get(
      '/user',
      openApi({ responses: {} }, async (c, next) => {
        await next();
        c.header('x-after-next', 'yes');
      }),
      (c) => c.json({ ok: true }, 200),
    );

    const response = await app.request('/user');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-after-next')).toBe('yes');
  });
});

describe('openApi without responses', () => {
  it('validates input and runs reusable middleware when responses are omitted', async () => {
    let middlewareRuns = 0;
    const app = new Hono<AppEnv>().post(
      '/user',
      openApi(
        {
          request: {
            json: z.object({ name: z.string() }),
            header: z.object({ 'x-request-id': z.string().min(1) }),
          },
        },
        auth,
        async (_c, next) => {
          middlewareRuns += 1;
          await next();
        },
      ),
      (c) => {
        expectTypeOf(c.req.valid('json')).toEqualTypeOf<{ name: string }>();
        return c.json(
          {
            name: c.req.valid('json').name,
            userId: c.var.userId,
            requestId: c.req.valid('header')['x-request-id'],
          },
          200,
        );
      },
    );
    const env = { SESSIONS: sessions } satisfies AppBindings;

    const ok = await app.request(
      '/user',
      {
        method: 'POST',
        headers: {
          Authorization: 'valid-token',
          'x-request-id': 'req-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'John' }),
      },
      env,
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      name: 'John',
      userId: 'user-1',
      requestId: 'req-1',
    });
    expect(middlewareRuns).toBe(1);

    middlewareRuns = 0;
    const invalid = await app.request(
      '/user',
      {
        method: 'POST',
        headers: {
          Authorization: 'valid-token',
          'x-request-id': 'req-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 123 }),
      },
      env,
    );
    expect(invalid.status).toBe(400);
    expect(middlewareRuns).toBe(0);

    const unauthorized = await app.request(
      '/user',
      {
        method: 'POST',
        headers: {
          'x-request-id': 'req-1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: 'John' }),
      },
      env,
    );
    expect(unauthorized.status).toBe(401);
    expect(middlewareRuns).toBe(0);

    // Middleware TypedResponse schemas reach the RPC client, but the document
    // only contains responses explicitly declared by the operation.
    const document = createOpenApiDocument(
      app,
      { info: { title: 'Test', version: '1.0.0' } },
      { addRoute: false },
    );
    expect(document.paths?.['/user']?.post?.responses).toEqual({});
  });

  it('generates the same document as an explicit empty response map', () => {
    const query = z.object({ id: z.string() });

    const omitted = new Hono().get(
      '/user',
      openApi({ request: { query } }),
      (c) => c.json({ id: c.req.valid('query').id }),
    );
    const explicit = new Hono().get(
      '/user',
      openApi({ request: { query }, responses: {} }),
      (c) => c.json({ id: c.req.valid('query').id }),
    );

    const omittedDocument = createOpenApiDocument(omitted, {
      info: { title: 'Test', version: '1.0.0' },
    });
    const explicitDocument = createOpenApiDocument(explicit, {
      info: { title: 'Test', version: '1.0.0' },
    });

    expect(omittedDocument.paths?.['/user']?.get?.responses).toEqual({});
    expect(omittedDocument.paths?.['/user']?.get?.responses).toEqual(
      explicitDocument.paths?.['/user']?.get?.responses,
    );
  });

  it('composes fragments that omit responses and merges later declarations', async () => {
    const requestId = openApi(
      {
        request: {
          header: z.object({ 'x-request-id': z.string().min(1) }),
        },
      },
      async (_c, next) => {
        await next();
      },
    );

    const app = new Hono<AppEnv>().get(
      '/user',
      openApi(
        {
          request: { query: z.object({ id: z.string() }) },
        },
        auth,
      ),
      openApi({ responses: { 200: z.object({ id: z.string() }) } }, requestId),
      (c) => {
        const query = c.req.valid('query');
        const header = c.req.valid('header');
        return c.var.res(200, {
          id: `${query.id}:${header['x-request-id']}`,
        });
      },
    );
    const env = { SESSIONS: sessions } satisfies AppBindings;

    const ok = await app.request(
      '/user?id=42',
      {
        headers: {
          Authorization: 'valid-token',
          'x-request-id': 'req-1',
        },
      },
      env,
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ id: '42:req-1' });

    const missingAuth = await app.request(
      '/user?id=42',
      { headers: { 'x-request-id': 'req-1' } },
      env,
    );
    expect(missingAuth.status).toBe(401);

    const missingHeader = await app.request(
      '/user?id=42',
      { headers: { Authorization: 'valid-token' } },
      env,
    );
    expect(missingHeader.status).toBe(400);

    const document = createOpenApiDocument(
      app,
      {
        info: { title: 'Test', version: '1.0.0' },
      },
      { addRoute: false },
    );
    expect(
      Object.keys(document.paths?.['/user']?.get?.responses ?? {}),
    ).toEqual(['200']);
  });
});
