import { Hono } from 'hono';
import type { TypedResponse } from 'hono';
import { expectTypeOf, it } from 'vitest';
import * as z from 'zod';
import { createOpenApiFragment, openApi } from './openApi.ts';

interface AppBindings {
  KV: { get(key: string): Promise<string | null> };
}
type AppEnv = {
  Bindings: AppBindings;
  Variables: { userId: string };
};

const openApiFragment = createOpenApiFragment<AppEnv>();

const fragment = openApiFragment(
  {
    request: {
      header: z.object({
        additionalHeaderField: z.string().optional(),
      }),
    },
    responses: { 401: z.object({ message: z.string() }) },
  },
  async (c, next) => {
    // The fragment itself is fully typed.
    expectTypeOf(c.req.valid('header')).toEqualTypeOf<{
      additionalHeaderField?: string | undefined;
    }>();
    await next();
  },
);

const chained = new Hono<AppEnv>().use('/foo', fragment).get('/foo', (c) => {
  // `use` carries the middleware environment, including `res`.
  expectTypeOf(c.var.res(401, { message: 'no' })).toEqualTypeOf<
    Response & TypedResponse<{ message: string }, 401>
  >();

  // @ts-expect-error app.use does not carry the fragment's validated input
  c.req.valid('header');

  return c.json({ ok: true }, 200);
});

const separate = new Hono<AppEnv>();
separate.use('/foo', fragment);
separate.get('/foo', (c) => {
  // @ts-expect-error a standalone app.use statement does not add `res`
  c.var.res(401, { message: 'no' });
  // @ts-expect-error a standalone app.use statement adds no validated input
  c.req.valid('header');
  return c.json({ ok: true }, 200);
});

const allRoute = new Hono<AppEnv>().all(
  '/foo',
  openApi({ responses: { 200: z.object({ ok: z.boolean() }) } }),
  (c) => c.var.res(200, { ok: true }),
);

it('app.use with a fragment keeps the fragment typed but drops route input inference', () => {
  expectTypeOf(chained).not.toBeUndefined();
  expectTypeOf(separate).not.toBeUndefined();
  expectTypeOf(allRoute).not.toBeUndefined();
});
