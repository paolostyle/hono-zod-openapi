import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { testClient } from 'hono/testing';
import { expect, test } from 'vitest';
import { z } from 'zod';

test('check the behavior of response', async () => {
  const mwr = createMiddleware(async (c, next) => {
    const schema = z.object({ message: z.string() });

    await next();

    const response = c.res as Response;

    const body = await response.clone().json();
    const result = schema.safeParse(body);

    if (!result.success) {
      throw new Error('Invalid response');
    }
  });

  const api = new Hono().get('/hello', mwr, (c) => {
    return c.json({ message6: 'hi' }, 200);
  });

  const response = await testClient(api).hello.$get();

  // expect(response.status).toBe(200);
  expect(response.json()).resolves.toEqual({ message: 'hi' });
});
