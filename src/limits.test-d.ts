import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type { ExtractSchema } from 'hono/types';
import { hc } from 'hono/client';
import { expectTypeOf, it } from 'vitest';
import * as z from 'zod';
import { createOpenApiFragment, openApi } from './openApi.ts';

const auth: MiddlewareHandler = async (_c, next) => {
  await next();
};

const okSchema = z.object({ ok: z.boolean() });

it('rejects more than three plain middleware arguments', () => {
  const tooMany = () =>
    // @ts-expect-error at most three plain middleware arguments are supported
    openApi({ responses: { 200: okSchema } }, auth, auth, auth, auth);
  expectTypeOf(tooMany).not.toBeUndefined();
});

it('rejects more than three composed fragments', () => {
  const fragment = openApi({ responses: {} });
  const tooMany = () =>
    openApi(
      { responses: { 200: okSchema } },
      fragment,
      fragment,
      fragment,
      // @ts-expect-error at most three fragments can be composed in one call
      fragment,
    );
  expectTypeOf(tooMany).not.toBeUndefined();
});

it('rejects more than three inline middleware in a fragment creator', () => {
  const fragmentCreator = createOpenApiFragment();
  const tooMany = () =>
    // @ts-expect-error at most three inline middleware arguments are supported
    fragmentCreator({ responses: { 200: okSchema } }, auth, auth, auth, auth);
  expectTypeOf(tooMany).not.toBeUndefined();
});

it('does not widen the client statuses for a plain Response from middleware', async () => {
  const app = new Hono().get(
    '/user',
    openApi(
      { responses: { 200: okSchema } },
      async () => new Response('blocked', { status: 418 }),
    ),
    (c) => c.json({ ok: true }, 200),
  );

  type RouteSchema = ExtractSchema<typeof app>['/user']['$get'];
  expectTypeOf<RouteSchema['status']>().toEqualTypeOf<200>();

  const client = hc<typeof app>('/');
  const response = await client.user.$get();
  if (response.status === 200) {
    expectTypeOf(await response.json()).toEqualTypeOf<{ ok: boolean }>();
  }
});
