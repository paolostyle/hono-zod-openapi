import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { createOpenApiDocument } from './createOpenApiDocument.ts';
import { createOpenApiFragment, openApi } from './openApi.ts';

const documentData = {
  info: { title: 'Test', version: '1.0.0' },
};

type AppEnv = {
  Bindings: { KV: { get(key: string): Promise<string | null> } };
  Variables: { userId: string };
};

describe('Hono registration integration', () => {
  it('documents routes registered for multiple methods with app.on', async () => {
    const app = new Hono().on(
      ['GET', 'POST'],
      '/thing',
      openApi({
        responses: { 200: z.object({ ok: z.boolean() }) },
      }),
      (c) => c.json({ ok: true }, 200),
    );

    const document = createOpenApiDocument(app, documentData, {
      addRoute: false,
    });
    expect(document.paths?.['/thing']?.get).toBeDefined();
    expect(document.paths?.['/thing']?.post).toBeDefined();

    expect((await app.request('/thing')).status).toBe(200);
    expect((await app.request('/thing', { method: 'POST' })).status).toBe(200);
  });

  it('documents a sub-app mounted with app.route under its prefix', async () => {
    const subApp = new Hono().get(
      '/user/:id',
      openApi({
        request: { param: z.object({ id: z.string() }) },
        responses: { 200: z.object({ id: z.string() }) },
      }),
      (c) => c.json({ id: c.req.valid('param').id }, 200),
    );
    const app = new Hono().route('/api', subApp);

    const document = createOpenApiDocument(app, documentData, {
      addRoute: false,
    });
    expect(document.paths?.['/api/user/{id}']?.get).toBeDefined();
    expect(Object.keys(document.paths ?? {})).toEqual(['/api/user/{id}']);

    const response = await app.request('/api/user/42');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: '42' });
  });

  it('includes basePath in documented paths', async () => {
    const app = new Hono().basePath('/api').get(
      '/user',
      openApi({
        responses: { 200: z.object({ ok: z.boolean() }) },
      }),
      (c) => c.json({ ok: true }, 200),
    );

    const document = createOpenApiDocument(app, documentData, {
      addRoute: false,
    });
    expect(document.paths?.['/api/user']?.get).toBeDefined();
    expect((await app.request('/api/user')).status).toBe(200);
  });

  it('runs a fragment attached with app.use on an exact path', async () => {
    const fragment = createOpenApiFragment<AppEnv>()(
      {
        request: {
          header: z.object({ authorization: z.string().min(1) }),
        },
      },
      async (c, next) => {
        expect(c.req.valid('header').authorization).toBe('Bearer token');
        await next();
      },
    );

    const app = new Hono<AppEnv>();
    app.use('/user', fragment);
    app.get('/user', (c) => c.json({ ok: true }, 200));

    const missing = await app.request('/user');
    expect(missing.status).toBe(400);

    const valid = await app.request('/user', {
      headers: { authorization: 'Bearer token' },
    });
    expect(valid.status).toBe(200);
  });

  it('accepts an omitted optional header in a fragment used with app.use', async () => {
    const observed: Array<string | undefined> = [];
    const fragment = createOpenApiFragment<AppEnv>()(
      {
        request: {
          header: z.object({
            additionalHeaderField: z.string().optional(),
          }),
        },
      },
      async (c, next) => {
        observed.push(c.req.valid('header').additionalHeaderField);
        await next();
      },
    );

    const app = new Hono<AppEnv>();
    app.use('/user', fragment);
    app.get('/user', (c) => c.json({ ok: true }, 200));

    expect((await app.request('/user')).status).toBe(200);
    expect(
      (
        await app.request('/user', {
          headers: { additionalHeaderField: 'extra' },
        })
      ).status,
    ).toBe(200);
    expect(observed).toEqual([undefined, 'extra']);
  });

  it('only runs app.use middleware when Hono path matching includes the route', async () => {
    const fragment = createOpenApiFragment<AppEnv>()(
      {
        request: {
          header: z.object({ authorization: z.string().min(1) }),
        },
      },
      async (_c, next) => {
        await next();
      },
    );

    const exactPrefix = new Hono<AppEnv>();
    exactPrefix.use('/user', fragment);
    exactPrefix.get('/user/profile', (c) => c.json({ ok: true }, 200));
    expect((await exactPrefix.request('/user/profile')).status).toBe(200);

    const wildcardPrefix = new Hono<AppEnv>();
    wildcardPrefix.use('/user/*', fragment);
    wildcardPrefix.get('/user/profile', (c) => c.json({ ok: true }, 200));
    expect((await wildcardPrefix.request('/user/profile')).status).toBe(400);
  });

  it('validates requests for app.all routes at runtime', async () => {
    const app = new Hono().all(
      '/thing',
      openApi({
        request: {
          header: z.object({ authorization: z.string().min(1) }),
        },
      }),
      (c) => c.json({ ok: true }, 200),
    );

    expect((await app.request('/thing')).status).toBe(400);
    expect(
      (
        await app.request('/thing', {
          method: 'PATCH',
          headers: { authorization: 'token' },
        })
      ).status,
    ).toBe(200);
  });
});
