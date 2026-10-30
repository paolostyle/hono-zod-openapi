import { Hono } from 'hono';
import type { TypedResponse } from 'hono';
import type { ExtractSchema } from 'hono/types';
import { hc } from 'hono/client';
import { expectTypeOf, it } from 'vitest';
import * as z from 'zod';
import { createOpenApiFragment, openApi } from './openApi.ts';

/**
 * Regression: `openApi(schema)` and a reusable fragment middleware in separate
 * chain slots must give the handler the same `c.var.res` status/payload types
 * as composing them through `openApi(schema, middleware)`, and the merged
 * responses must still reach the Hono RPC client.
 */

interface AppBindings {
  JWT_SECRET: string;
}

type AppEnv = {
  Bindings: AppBindings;
  Variables: { jwtPayload: unknown };
};

const okSchema = z.object({ id: z.string() });
const errorSchema = z.object({ code: z.string(), message: z.string() });
const badRequestSchema = z.object({
  errors: z.object({ code: z.string() }),
});

const openApiFragment = createOpenApiFragment<AppEnv>();

const jwtMiddleware = openApiFragment(
  {
    request: {
      header: z.object({ authorization: z.string().optional() }),
    },
    responses: { 401: errorSchema, 400: badRequestSchema },
  },
  async (c, next) => {
    expectTypeOf(c.env.JWT_SECRET).toEqualTypeOf<AppBindings['JWT_SECRET']>();
    expectTypeOf(c.var.jwtPayload).toEqualTypeOf<unknown>();

    if (c.req.valid('header').authorization !== 'Bearer token') {
      return c.var.res(401, { code: 'UNAUTHORIZED', message: 'missing' });
    }

    await next();
  },
);

const app = new Hono<AppEnv>()
  .get(
    '/me',
    openApi({
      request: {
        header: z.object({ authorization: z.string().optional() }),
      },
      responses: { 200: okSchema },
    }),
    jwtMiddleware,
    (c) => {
      expectTypeOf(c.env.JWT_SECRET).toEqualTypeOf<AppBindings['JWT_SECRET']>();
      expectTypeOf(c.var.jwtPayload).toEqualTypeOf<unknown>();
      expectTypeOf(c.req.valid('header')).toEqualTypeOf<{
        authorization?: string | undefined;
      }>();

      expectTypeOf(c.var.res(200, { id: 'x' })).toEqualTypeOf<
        Response & TypedResponse<{ id: string }, 200, 'json'>
      >();
      expectTypeOf(
        c.var.res(401, { code: 'UNAUTHORIZED', message: 'missing' }),
      ).toEqualTypeOf<
        Response & TypedResponse<{ code: string; message: string }, 401>
      >();
      expectTypeOf(c.var.res(400, { errors: { code: 'bad' } })).toEqualTypeOf<
        Response & TypedResponse<{ errors: { code: string } }, 400>
      >();

      // @ts-expect-error the 401 payload comes from the middleware fragment
      c.var.res(401, { code: 'UNAUTHORIZED' });
      // @ts-expect-error 500 is not declared by any fragment
      c.var.res(500, {});

      return c.var.res(200, { id: 'x' });
    },
  )
  // The same reusable middleware is used by more than one route.
  .get(
    '/profile',
    openApi({ responses: { 200: z.object({ name: z.string() }) } }),
    jwtMiddleware,
    (c) => {
      expectTypeOf(c.var.res(401, { code: 'x', message: 'y' })).toEqualTypeOf<
        Response & TypedResponse<{ code: string; message: string }, 401>
      >();
      return c.var.res(200, { name: 'John' });
    },
  )
  // A route without the helper keeps its own client inference.
  .get('/open', (c) => c.json({ hi: 'you' }, 200));

type AppType = typeof app;
type MeSchema = ExtractSchema<AppType>['/me']['$get'];

it('route schema merges responses from separate chain slots', () => {
  expectTypeOf<MeSchema['status']>().toEqualTypeOf<200 | 401 | 400>();
  expectTypeOf<MeSchema['output']>().toEqualTypeOf<
    | { id: string }
    | { code: string; message: string }
    | { errors: { code: string } }
  >();
});

const client = hc<AppType>('/');

it('client infers success and middleware responses for the decoupled route', async () => {
  const res = await client.me.$get({
    header: { authorization: 'Bearer token' },
  });

  if (res.status === 200) {
    expectTypeOf(await res.json()).toEqualTypeOf<{ id: string }>();
  }
  if (res.status === 401) {
    expectTypeOf(await res.json()).toEqualTypeOf<{
      code: string;
      message: string;
    }>();
  }
  if (res.status === 400) {
    expectTypeOf(await res.json()).toEqualTypeOf<{
      errors: { code: string };
    }>();
  }
});

it('client keeps inference on other routes', async () => {
  const profile = await client.profile.$get({
    header: { authorization: 'Bearer token' },
  });
  if (profile.status === 200) {
    expectTypeOf(await profile.json()).toEqualTypeOf<{ name: string }>();
  }

  const publicRoute = await client.open.$get();
  if (publicRoute.status === 200) {
    expectTypeOf(await publicRoute.json()).toEqualTypeOf<{
      hi: string;
    }>();
  }
});
