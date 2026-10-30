import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { createOpenApiDocument } from './createOpenApiDocument.ts';
import { openApi } from './openApi.ts';

const validRequest = {
  method: 'POST' as const,
  headers: {
    'x-token': 'token',
    cookie: 'session=abc',
    'content-type': 'application/json',
  },
  body: JSON.stringify({ name: '  John  ', age: '42' }),
};

const buildApp = (runs: string[]) =>
  new Hono().post(
    '/user/:id',
    openApi(
      {
        request: {
          param: z.object({ id: z.string().min(3) }),
          query: z.object({ active: z.enum(['yes']) }),
          header: z.object({ 'x-token': z.string().min(1) }),
          cookie: z.object({ session: z.string().min(1) }),
          json: z.object({
            name: z.string().trim(),
            age: z.coerce.number().int().positive(),
          }),
        },
        responses: {
          200: z.object({ id: z.string(), name: z.string(), age: z.number() }),
        },
      },
      async (_c, next) => {
        runs.push('middleware');
        await next();
      },
    ),
    (c) => {
      runs.push('handler');
      return c.var.res(200, {
        id: c.req.valid('param').id,
        name: c.req.valid('json').name,
        age: c.req.valid('json').age,
      });
    },
  );

describe('request validation edges', () => {
  it('validates every target and gives the handler parsed values', async () => {
    const runs: string[] = [];
    const response = await buildApp(runs).request(
      '/user/abc?active=yes',
      validRequest,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: 'abc',
      name: 'John',
      age: 42,
    });
    expect(runs).toEqual(['middleware', 'handler']);
  });

  it.each([
    ['short path param', '/user/ab?active=yes', validRequest],
    ['missing query param', '/user/abc', validRequest],
    ['invalid query param', '/user/abc?active=no', validRequest],
    [
      'missing header',
      '/user/abc?active=yes',
      { ...validRequest, headers: { ...validRequest.headers, 'x-token': '' } },
    ],
    [
      'missing cookie',
      '/user/abc?active=yes',
      { ...validRequest, headers: { ...validRequest.headers, cookie: '' } },
    ],
    [
      'missing content type',
      '/user/abc?active=yes',
      {
        ...validRequest,
        headers: {
          'x-token': 'token',
          cookie: 'session=abc',
        },
      },
    ],
    [
      'wrong content type',
      '/user/abc?active=yes',
      {
        ...validRequest,
        headers: {
          ...validRequest.headers,
          'content-type': 'text/plain',
        },
      },
    ],
    [
      'invalid json body',
      '/user/abc?active=yes',
      { ...validRequest, body: JSON.stringify({ name: 'John', age: -1 }) },
    ],
  ])('rejects %s before middleware runs', async (_label, path, request) => {
    const runs: string[] = [];
    const response = await buildApp(runs).request(path, request);

    expect(response.status).toBe(400);
    expect(runs).toEqual([]);
  });

  it('documents a validate:false target without requiring it at runtime', async () => {
    const app = new Hono().get(
      '/me',
      openApi({
        request: {
          header: {
            schema: z.object({ 'x-document-only': z.string() }),
            validate: false,
          },
        },
        responses: { 200: z.object({ ok: z.boolean() }) },
      }),
      (c) => c.var.res(200, { ok: true }),
    );

    const response = await app.request('/me');
    expect(response.status).toBe(200);

    const operation = createOpenApiDocument(
      app,
      { info: { title: 'Test', version: '1.0.0' } },
      { addRoute: false },
    ).paths?.['/me']?.get;

    expect(
      (operation?.parameters ?? []).map((parameter) =>
        'name' in parameter ? parameter.name : undefined,
      ),
    ).toEqual(['x-document-only']);
  });
});
