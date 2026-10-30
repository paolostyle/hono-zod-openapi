import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { MiddlewareHandler, TypedResponse } from 'hono';
import { hc } from 'hono/client';
import type { InferRequestType } from 'hono/client';
import { describe, expectTypeOf, it } from 'vitest';
import * as z from 'zod';
import {
  createOpenApiFragment,
  defineOpenApiOperation,
  openApi,
} from './openApi.ts';
import type {
  HonoOpenApiOperation,
  HonoOpenApiRequestSchemas,
  HonoOpenApiResponses,
  OpenApiFragmentValue,
  OpenApiShapeConflictDetails,
} from './types.ts';

interface AppBindings {
  SESSIONS: Map<string, string>;
  KV: { get(key: string): Promise<string | null> };
}
type AppEnv = {
  Bindings: AppBindings;
  Variables: { userId: string };
};

type UnauthorizedResponse = Response &
  TypedResponse<{ message: string }, 401, 'json'>;

/**
 * Reusable middleware, annotated exactly once. Bindings, variables and
 * early-response types must flow through `openApi()` without any cast at the
 * call site.
 */
const auth: MiddlewareHandler<
  AppEnv,
  string,
  Record<never, never>,
  UnauthorizedResponse
> = async (c, next) => {
  expectTypeOf(c.env.SESSIONS).toEqualTypeOf<AppBindings['SESSIONS']>();
  expectTypeOf(c.env.KV).toEqualTypeOf<AppBindings['KV']>();

  // @ts-expect-error the middleware env is precise, not `any`: unknown bindings are rejected
  const _unknownBinding = c.env.NOT_A_REAL_BINDING;

  const session = await c.env.SESSIONS.get(c.req.header('Authorization') ?? '');
  if (!session) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  c.set('userId', session);
  await next();
};

type ForbiddenResponse = Response &
  TypedResponse<{ reason: string }, 403, 'json'>;

const forbidden: MiddlewareHandler<
  AppEnv,
  string,
  Record<never, never>,
  ForbiddenResponse
> = async (c, next) => {
  if (c.req.header('x-forbidden') === '1') {
    return c.json({ reason: 'forbidden' }, 403);
  }
  await next();
};

type RateLimitedResponse = Response &
  TypedResponse<{ retryAfter: number }, 429, 'json'>;

const rateLimited: MiddlewareHandler<
  AppEnv,
  string,
  Record<never, never>,
  RateLimitedResponse
> = async (c, next) => {
  if (c.req.header('x-rate-limited') === '1') {
    return c.json({ retryAfter: 60 }, 429);
  }
  await next();
};

const routes = new Hono<AppEnv>()
  .post(
    '/user',
    // accepted without any caller-side cast; env and response types are inferred
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
      // app bindings, middleware variables and the res helper survive into the handler
      expectTypeOf(c.env.KV).toEqualTypeOf<AppBindings['KV']>();
      expectTypeOf(c.env.SESSIONS).toEqualTypeOf<AppBindings['SESSIONS']>();
      expectTypeOf(c.var.userId).toEqualTypeOf<string>();
      expectTypeOf(c.var.res(200, { name: 'John' })).toEqualTypeOf<
        Response & TypedResponse<{ name: string }, 200, 'json'>
      >();

      const { name } = c.req.valid('json');
      expectTypeOf(name).toEqualTypeOf<string>();

      // @ts-expect-error only declared request targets are accepted
      const _invalid = c.req.valid('query');

      return c.json({ name }, 200);
    },
  )
  /**
   * A middleware without declared response types is accepted (env is still
   * inferred); it just does not contribute middleware responses to the client
   * schema, matching Hono's own response-merge rule (only `TypedResponse`
   * members are merged).
   */
  .get(
    '/logger',
    openApi(
      {
        responses: {
          200: z.object({ hi: z.string() }),
        },
      },
      (async (_c, next) => {
        await next();
      }) satisfies MiddlewareHandler<AppEnv, string, Record<never, never>>,
    ),
    async (c) => {
      expectTypeOf(c.env.SESSIONS).toEqualTypeOf<AppBindings['SESSIONS']>();
      return c.json({ hi: 'you' }, 200);
    },
  );

export type AppType = typeof routes;

const client = hc<AppType>('http://localhost/');

it('client infers request types derived from validation', () => {
  expectTypeOf<InferRequestType<typeof client.user.$post>>().not.toBeNever();
  expectTypeOf<
    InferRequestType<typeof client.user.$post>['json']
  >().toEqualTypeOf<{
    name: string;
  }>();
});

it('client infers success and middleware-provided 401 responses', async () => {
  const res = await client.user.$post({ json: { name: 'John' } });

  if (res.status === 200) {
    expectTypeOf(await res.json()).toEqualTypeOf<{ name: string }>();
  }
  if (res.status === 401) {
    expectTypeOf(await res.json()).toEqualTypeOf<{ message: string }>();
  }

  // @ts-expect-error request shape is derived from validation
  await client.user.$post({ json: { name: 123 } });
});

it('routes without the helper keep their client inference', async () => {
  const res = await client.logger.$get();
  if (res.status === 200) {
    expectTypeOf(await res.json()).toEqualTypeOf<{ hi: string }>();
  }
});

it('stacked openApi calls: inputs intersect and res payloads stay schema-checked', async () => {
  await new Hono<AppEnv>().post(
    '/stack',
    openApi(
      {
        responses: {
          200: z.object({ first: z.string() }),
          401: z.object({ message: z.string() }),
        },
        request: {
          json: z.object({ name: z.string() }),
        },
      },
      auth,
    ),
    openApi({
      responses: {
        400: z.object({ second: z.string() }),
      },
      request: {
        json: z.object({ email: z.string() }),
      },
    }),
    async (c) => {
      // both validators must pass, so the validated input is the intersection
      const body = c.req.valid('json');
      expectTypeOf(body.name).toEqualTypeOf<string>();
      expectTypeOf(body.email).toEqualTypeOf<string>();

      // declared payloads of both operations stay typed
      c.var.res(400, { second: 'x' });
      // @ts-expect-error 200 is not declared in the second operation's own schema
      c.var.res(200, { second: 'x' });
      // @ts-expect-error wrong payload type for the 400 response
      c.var.res(400, { second: 123 });

      return c.var.res(200, { first: 'ok' });
    },
  );
});

/**
 * Incompatible middleware environments: Hoon merges middleware environments
 * structurally (this is Hono's own behavior for plain chaining, verified
 * separately), so an env that is structurally incompatible with the app does
 * not produce an error at the `openApi()` call site. What IS enforced is that a
 * middleware's declared env is trustworthy inside the middleware itself (see
 * the `@ts-expect-error` above) and that app bindings survive in the handler.
 */
it('handler env stays precise even with an env-mismatched middleware', () => {
  const mismatched = createMiddleware<{ Bindings: { WRONG: boolean } }>(
    async (c, next) => {
      expectTypeOf(c.env.WRONG).toEqualTypeOf<boolean>();
      await next();
    },
  );

  const app = new Hono<AppEnv>().post(
    '/whatever',
    openApi(
      {
        responses: {
          200: z.object({ ok: z.boolean() }),
        },
      },
      mismatched,
    ),
    async (c) => {
      expectTypeOf(c.env.KV).toEqualTypeOf<AppBindings['KV']>();
      return c.json({ ok: true }, 200);
    },
  );
  expectTypeOf(app).not.toBeUndefined();
});

it('accepts the maximum plain middleware overloads and merges their responses', () => {
  const app = new Hono<AppEnv>().post(
    '/triple',
    openApi(
      {
        request: { json: z.object({ name: z.string() }) },
        responses: { 200: z.object({ name: z.string() }) },
      },
      auth,
      forbidden,
      rateLimited,
    ),
    (c) => {
      expectTypeOf(c.env.KV).toEqualTypeOf<AppBindings['KV']>();
      expectTypeOf(c.var.userId).toEqualTypeOf<string>();
      return c.var.res(200, { name: c.req.valid('json').name });
    },
  );

  const client = hc<typeof app>('/');
  const run = async () => {
    const res = await client.triple.$post({ json: { name: 'x' } });
    if (res.status === 200) {
      expectTypeOf(await res.json()).toEqualTypeOf<{ name: string }>();
    }
    if (res.status === 401) {
      expectTypeOf(await res.json()).toEqualTypeOf<{ message: string }>();
    }
    if (res.status === 403) {
      expectTypeOf(await res.json()).toEqualTypeOf<{ reason: string }>();
    }
    if (res.status === 429) {
      expectTypeOf(await res.json()).toEqualTypeOf<{ retryAfter: number }>();
    }
  };
  expectTypeOf(run).not.toBeUndefined();
});

describe('createOpenApiFragment', () => {
  type FragmentEnv = {
    Bindings: { SESSIONS: Map<string, string> };
    Variables: { userId: string };
  };
  const openApiFragment = createOpenApiFragment<FragmentEnv>();

  const fragmentRoutes = new Hono<FragmentEnv>()
    .post(
      '/user',
      openApiFragment(
        {
          responses: {
            200: z.object({ name: z.string() }),
            401: { schema: z.object({ message: z.string() }) },
          },
          request: {
            header: z.object({ Authorization: z.string() }),
            json: z.object({ name: z.string() }),
          },
        },
        // inline middleware — everything contextually typed, zero annotations
        async (c, next) => {
          expectTypeOf(c.env.SESSIONS).toEqualTypeOf<
            FragmentEnv['Bindings']['SESSIONS']
          >();
          expectTypeOf(c.req.valid('header')).toEqualTypeOf<{
            Authorization: string;
          }>();
          expectTypeOf(c.var.res(401, { message: 'no' })).toEqualTypeOf<
            Response & TypedResponse<{ message: string }, 401, 'json'>
          >();

          // @ts-expect-error the middleware env is precise: unknown bindings are rejected
          const _unknownBinding = c.env.NOT_A_REAL_BINDING;
          // @ts-expect-error only declared request targets are accepted
          const _invalidTarget = c.req.valid('query');
          // @ts-expect-error wrong payload shape for the 401 response
          c.var.res(401, { message: 123 });

          if (
            !(await c.env.SESSIONS.get(c.req.valid('header').Authorization))
          ) {
            return c.var.res(401, { message: 'Unauthorized' });
          }
          await next();
        },
      ),
      async (c) => {
        expectTypeOf(c.var.userId).toEqualTypeOf<string>();
        return c.var.res(200, { name: 'John' });
      },
    )
    .get(
      '/plain',
      openApiFragment({ responses: { 200: z.object({ a: z.string() }) } }),
      (c) => c.var.res(200, { a: 'x' }),
    );

  it('incompatible environments are rejected at the fragment slot', () => {
    const wrongEnv = createMiddleware<{ Bindings: { WRONG: true } }>(
      async (c, next) => {
        expectTypeOf(c.env.WRONG).toEqualTypeOf<true>();
        await next();
      },
    );

    const composed = openApiFragment(
      { responses: { 200: z.object({}) } },
      // @ts-expect-error incompatible middleware environments must be rejected
      wrongEnv,
    );
    expectTypeOf(composed).not.toBeUndefined();
  });

  it('fragment routes keep hc<AppType> inference (200 + middleware 401 + plain routes)', () => {
    const client = hc<typeof fragmentRoutes>('/');
    expectTypeOf<
      InferRequestType<typeof client.user.$post>['json']
    >().toEqualTypeOf<{
      name: string;
    }>();
    const run = async () => {
      const res = await client.user.$post({
        json: { name: 'x' },
        header: { Authorization: 't' },
      });
      if (res.status === 200) {
        expectTypeOf(await res.json()).toEqualTypeOf<{ name: string }>();
      }
      if (res.status === 401) {
        expectTypeOf(await res.json()).toEqualTypeOf<{ message: string }>();
      }
      const plain = await client.plain.$get();
      if (plain.status === 200) {
        expectTypeOf(await plain.json()).toEqualTypeOf<{ a: string }>();
      }
    };
    expectTypeOf(run).not.toBeUndefined();
  });

  it('fragment arity-0 route keeps the seeded app env in the handler', () => {
    const app = new Hono<FragmentEnv>().post(
      '/zero',
      openApiFragment({
        responses: {
          200: z.object({ ok: z.boolean() }),
        },
      }),
      async (c) => {
        expectTypeOf(c.env.SESSIONS).toEqualTypeOf<
          FragmentEnv['Bindings']['SESSIONS']
        >();
        return c.json({ ok: true }, 200);
      },
    );
    expectTypeOf(app).not.toBeUndefined();
  });
});

describe('fragment conflict checking', () => {
  it('includes the conflicting property or status in the diagnostic type', () => {
    const firstHeader = z.object({ authorization: z.string() });
    const secondHeader = z.object({ authorization: z.number() });
    expectTypeOf<
      OpenApiShapeConflictDetails<
        { header: typeof firstHeader },
        { header: typeof secondHeader },
        Record<never, never>,
        Record<never, never>
      >
    >().toEqualTypeOf<'request property "header.authorization" has an incompatible schema'>();

    expectTypeOf<
      OpenApiShapeConflictDetails<
        Record<never, never>,
        Record<never, never>,
        { 401: typeof firstHeader },
        { 401: z.ZodNumber }
      >
    >().toEqualTypeOf<'response status "401" has a different schema'>();

    expectTypeOf<
      OpenApiShapeConflictDetails<
        Record<never, never>,
        Record<never, never>,
        { 401: typeof firstHeader },
        { 401: typeof firstHeader }
      >
    >().toEqualTypeOf<never>();
  });

  it('different properties on the same request target merge', () => {
    const fragment = openApi({
      request: { json: z.object({ name: z.string() }) },
      responses: {},
    });

    const composed = openApi(
      {
        request: { json: z.object({ age: z.number() }) },
        responses: {},
      },
      fragment,
    );
    expectTypeOf(composed).not.toBeUndefined();
  });

  it('same request property with a different schema is rejected statically', () => {
    const fragment = openApi({
      request: { json: z.object({ name: z.string() }) },
      responses: {},
    });
    const invalid = () =>
      openApi(
        { request: { json: z.object({ name: z.number() }) }, responses: {} },
        // @ts-expect-error the overlapping json.name property has a different schema
        fragment,
      );
    expectTypeOf(invalid).not.toBeUndefined();
  });

  it('allows a response status to be redeclared with the same schema', () => {
    const fragment = openApi({
      responses: { 200: z.object({ name: z.string() }) },
    });

    const composed = openApi(
      { responses: { 200: z.object({ name: z.string() }) } },
      fragment,
    );
    expectTypeOf(composed).not.toBeUndefined();
  });

  it('rejects a response status redeclared with a different schema', () => {
    const fragment = openApi({
      responses: { 200: z.object({ name: z.string() }) },
    });

    const invalid = () =>
      // @ts-expect-error response status 200 has a different schema
      openApi({ responses: { 200: z.object({ id: z.number() }) } }, fragment);
    expectTypeOf(invalid).not.toBeUndefined();
  });

  it('identical request properties are allowed when request schemas merge', () => {
    const schema = z.object({ name: z.string() });
    const fragment = openApi({
      request: { json: schema },
      responses: {},
    });

    const composed = openApi(
      {
        request: { json: z.object({ name: z.string() }) },
        responses: {},
      },
      fragment,
    );
    expectTypeOf(composed).not.toBeUndefined();
  });

  it('disjoint fragments compose without errors', () => {
    const authFragment = openApi({
      request: { header: z.object({ authorization: z.string() }) },
      responses: { 401: z.object({ message: z.string() }) },
    });

    const composed = openApi(
      {
        request: { json: z.object({ name: z.string() }) },
        responses: { 200: z.object({ name: z.string() }) },
      },
      authFragment,
    );
    expectTypeOf(composed).not.toBeUndefined();
  });

  it('nested fragments keep merged client inference', () => {
    const authFragment = openApi({
      responses: { 401: z.object({ message: z.string() }) },
    });

    const routes = new Hono().post(
      '/user',
      openApi(
        {
          request: { json: z.object({ name: z.string() }) },
          responses: { 200: z.object({ name: z.string() }) },
        },
        authFragment,
      ),
      (c) => c.json(c.req.valid('json'), 200),
    );

    const client = hc<typeof routes>('/');
    const run = async () => {
      const res = await client.user.$post({ json: { name: 'x' } });
      if (res.status === 200) {
        expectTypeOf(await res.json()).toEqualTypeOf<{ name: string }>();
      }
      if (res.status === 401) {
        expectTypeOf(await res.json()).toEqualTypeOf<{ message: string }>();
      }
    };
    expectTypeOf(run).not.toBeUndefined();
  });
});

describe('creator-fragment conflict checking (createOpenApiFragment)', () => {
  type AppEnv = {
    Bindings: { JWT_SECRET: string };
    Variables: { jwtPayload: unknown };
  };

  const openApiFragment = createOpenApiFragment<AppEnv>();

  const jwtMiddleware = openApiFragment(
    {
      security: [{ bearerAuth: [] }],
      tags: ['Auth'],
      request: {
        header: z.object({
          authorization: z
            .string()
            .startsWith('Bearer ')
            .meta({ description: 'Bearer token' })
            .optional(),
        }),
      },
      responses: {
        401: {
          description: 'Missing, malformed or expired bearer token',
          schema: z.object({ code: z.string(), message: z.string() }),
        },
        400: z.object({ errors: z.object({ code: z.string() }) }),
        '4XX': z.any(),
        default: {
          description:
            'Any other failure, normalized by the global error handler',
          schema: z.object({ code: z.string(), message: z.string() }),
        },
      },
    },
    async (c, next) => {
      try {
        const authorization = c.req.header('authorization');
        if (!authorization?.startsWith('Bearer ')) {
          throw new Error('Missing or malformed bearer token');
        }
        const secret = c.env.JWT_SECRET;
        expectTypeOf(secret).toEqualTypeOf<string>();
        c.set('jwtPayload', { id: 1, username: 'u', iat: 0 });
        await next();
        return undefined;
      } catch (error) {
        return c.var.res(401, {
          code: 'UNAUTHORIZED',
          message:
            error instanceof Error
              ? error.message
              : 'Invalid or expired bearer token',
        });
      }
    },
  );

  const requestIdMiddleware = openApiFragment(
    {
      request: {
        header: z.object({
          'x-request-id': z.string(),
        }),
      },
      responses: {
        400: z.object({ errors: z.object({ code: z.string() }) }),
        403: z.object({ code: z.string() }),
      },
    },
    async (_c, next) => {
      await next();
    },
  );
  const traceMiddleware = openApiFragment(
    {
      request: {
        header: z.object({
          'x-trace-id': z.string(),
        }),
      },
      responses: {
        422: z.object({ error: z.string() }),
      },
    },
    async (_c, next) => {
      await next();
    },
  );

  it('composes multiple creator fragments with merged request and response inference', () => {
    const threeFragments = openApiFragment(
      {
        request: { header: z.object({}) },
        responses: { 200: z.object({ ok: z.boolean() }) },
      },
      jwtMiddleware,
      requestIdMiddleware,
      traceMiddleware,
    );
    expectTypeOf(threeFragments).not.toBeUndefined();

    const errorEnvelope = z.object({
      code: z.string(),
      message: z.string(),
    });
    const badRequestEnvelope = z.object({
      status: z.boolean(),
      errors: errorEnvelope,
    });
    const combinedJwtMiddleware = openApiFragment(
      {
        request: {
          header: z.object({
            authorization: z
              .string()
              .startsWith('Bearer ')
              .meta({ description: 'Bearer token' })
              .optional(),
          }),
        },
        responses: {
          401: errorEnvelope,
          400: badRequestEnvelope,
        },
      },
      async (c, next) => {
        expectTypeOf(c.env.JWT_SECRET).toEqualTypeOf<string>();
        await next();
      },
    );
    const someOtherMiddleware = openApiFragment(
      {
        request: {
          header: z.object({
            additionalHeaderField: z.string().optional(),
          }),
        },
        responses: { 400: badRequestEnvelope },
      },
      async (_c, next) => {
        await next();
      },
    );

    const routes = new Hono<AppEnv>().get(
      '/me',
      openApiFragment(
        {
          request: {
            header: z.object({
              additionalHeaderField: z.string().optional(),
              authorization: z
                .string()
                .startsWith('Bearer ')
                .meta({ description: 'Bearer token' })
                .optional(),
            }),
          },
          responses: {
            200: z.object({ ok: z.boolean() }),
            400: badRequestEnvelope,
            401: errorEnvelope,
          },
        },
        combinedJwtMiddleware,
        someOtherMiddleware,
      ),
      (c) => {
        expectTypeOf(c.req.valid('header')).toMatchTypeOf<{
          authorization?: string | undefined;
          additionalHeaderField?: string | undefined;
        }>();
        expectTypeOf(c.get('jwtPayload')).toEqualTypeOf<unknown>();
        return c.var.res(200, { ok: true });
      },
    );

    const client = hc<typeof routes>('/');
    const run = async () => {
      const res = await client.me.$get({
        header: {
          authorization: 'Bearer token',
          additionalHeaderField: 'extra',
        },
      });
      if (res.status === 200) {
        expectTypeOf(await res.json()).toEqualTypeOf<{ ok: boolean }>();
      }
      if (res.status === 401) {
        expectTypeOf(await res.json()).toEqualTypeOf<{
          code: string;
          message: string;
        }>();
      }
      if (res.status === 400) {
        expectTypeOf(await res.json()).toEqualTypeOf<{
          status: boolean;
          errors: { code: string; message: string };
        }>();
      }
    };
    expectTypeOf(run).not.toBeUndefined();
  });

  it('composes fragments followed by an inline middleware', () => {
    const errorEnvelope = z.object({ code: z.string(), message: z.string() });
    const headerFragment = openApiFragment(
      {
        request: {
          header: z.object({ additionalHeaderField: z.string().optional() }),
        },
        responses: { 400: errorEnvelope },
      },
      async (c, next) => {
        expectTypeOf(c.req.valid('header').additionalHeaderField).toEqualTypeOf<
          string | undefined
        >();
        await next();
      },
    );
    const bodyFragment = openApiFragment(
      {
        request: { json: z.object({ name: z.string().optional() }) },
        responses: {},
      },
      async (c, next) => {
        expectTypeOf(c.req.valid('json').name).toEqualTypeOf<
          string | undefined
        >();
        await next();
      },
    );

    // Two reusable fragments followed by inline middleware: the inline
    // middleware sees every fragment's request target, not only the
    // operation's own declaration.
    const composed = openApiFragment(
      {
        request: {
          header: z.object({
            authorization: z.string().startsWith('Bearer ').optional(),
          }),
        },
        responses: { 401: errorEnvelope },
      },
      headerFragment,
      bodyFragment,
      async (c, next) => {
        const { authorization, additionalHeaderField } = c.req.valid('header');
        expectTypeOf(authorization).toEqualTypeOf<string | undefined>();
        expectTypeOf(additionalHeaderField).toEqualTypeOf<string | undefined>();
        expectTypeOf(c.req.valid('json').name).toEqualTypeOf<
          string | undefined
        >();
        expectTypeOf(c.env.JWT_SECRET).toEqualTypeOf<string>();
        expectTypeOf(c.var.res(401, { code: 'x', message: 'y' })).toEqualTypeOf<
          Response & TypedResponse<{ code: string; message: string }, 401>
        >();
        // @ts-expect-error unknown header fields are rejected
        const _unknownHeader = c.req.valid('header').unknownHeader;
        await next();
      },
    );

    const routes = new Hono<AppEnv>().post(
      '/me',
      openApi(
        {
          // the route redeclares none of the fragments' request targets
          responses: { 200: z.object({ ok: z.boolean() }) },
        },
        composed,
      ),
      (c) => {
        expectTypeOf(c.req.valid('header')).toMatchTypeOf<{
          authorization?: string | undefined;
          additionalHeaderField?: string | undefined;
        }>();
        expectTypeOf(c.req.valid('json').name).toEqualTypeOf<
          string | undefined
        >();
        return c.var.res(200, { ok: true });
      },
    );

    const client = hc<typeof routes>('/');
    const run = async () => {
      const res = await client.me.$post({
        header: {
          authorization: 'Bearer token',
          additionalHeaderField: 'extra',
        },
        json: { name: 'name' },
      });
      if (res.status === 200) {
        expectTypeOf(await res.json()).toEqualTypeOf<{ ok: boolean }>();
      }
      if (res.status === 400) {
        expectTypeOf(await res.json()).toEqualTypeOf<{
          code: string;
          message: string;
        }>();
      }
      if (res.status === 401) {
        expectTypeOf(await res.json()).toEqualTypeOf<{
          code: string;
          message: string;
        }>();
      }
    };
    expectTypeOf(run).not.toBeUndefined();

    const invalid = () =>
      openApiFragment(
        {
          request: { header: z.object({ additionalHeaderField: z.number() }) },
          responses: { 200: z.object({ ok: z.boolean() }) },
        },
        // @ts-expect-error header.additionalHeaderField conflicts with the first fragment
        headerFragment,
        bodyFragment,
        async (_c, next) => {
          await next();
        },
      );
    expectTypeOf(invalid).not.toBeUndefined();
  });

  it('accepts structurally identical response schemas declared separately', () => {
    // Separate `z.object` declarations have distinct type identities after
    // response maps are intersected during composition. Compatibility is based
    // on their validated shapes, not that identity.
    const badRequest = () =>
      z.object({
        status: z.boolean(),
        errors: z.object({ code: z.string() }),
      });
    const requestId = openApiFragment(
      {
        request: { header: z.object({ 'x-request-id': z.string() }) },
        responses: { 400: badRequest() },
      },
      async (_c, next) => {
        await next();
      },
    );
    const traceId = openApiFragment(
      {
        request: { header: z.object({ 'x-trace-id': z.string() }) },
        responses: { 400: badRequest() },
      },
      async (_c, next) => {
        await next();
      },
    );
    const composed = openApiFragment(
      {
        request: { header: z.object({ authorization: z.string().optional() }) },
        responses: {
          200: z.object({ ok: z.boolean() }),
          400: badRequest(),
        },
      },
      requestId,
      traceId,
      async (_c, next) => {
        await next();
      },
    );
    expectTypeOf(composed).not.toBeUndefined();

    // Composing the accumulated response map into another fragment stays clean.
    const route = openApi(
      {
        request: { header: z.object({}) },
        responses: { 200: z.object({ ok: z.boolean() }) },
      },
      composed,
    );
    expectTypeOf(route).not.toBeUndefined();
  });

  it('merges request targets of a fragment that already merged fragments', () => {
    const errorEnvelope = z.object({ code: z.string(), message: z.string() });
    const additionalHeader = openApiFragment(
      {
        request: {
          header: z.object({ additionalHeaderField: z.string().optional() }),
        },
        responses: {
          400: z.object({ status: z.boolean(), errors: errorEnvelope }),
        },
      },
      async (_c, next) => {
        await next();
      },
    );
    // Each declaration lives on a different fragment, so the composed
    // middleware exposes a union of request schemas until the validated value
    // is computed.
    const nestedJwtMiddleware = openApiFragment(
      {
        request: {
          header: z.object({
            authorization: z.string().startsWith('Bearer ').optional(),
          }),
        },
        responses: { 401: errorEnvelope },
      },
      additionalHeader,
      async (c, next) => {
        expectTypeOf(c.req.valid('header')).toMatchTypeOf<{
          authorization?: string | undefined;
          additionalHeaderField?: string | undefined;
        }>();
        await next();
      },
    );

    const routes = new Hono<AppEnv>().get(
      '/me',
      openApi(
        {
          // the route redeclares neither header field
          request: { header: z.object({}) },
          responses: { 200: z.object({ ok: z.boolean() }) },
        },
        nestedJwtMiddleware,
      ),
      (c) => {
        const { authorization, additionalHeaderField } = c.req.valid('header');
        expectTypeOf(authorization).toEqualTypeOf<string | undefined>();
        expectTypeOf(additionalHeaderField).toEqualTypeOf<string | undefined>();
        return c.var.res(200, { ok: true });
      },
    );

    const client = hc<typeof routes>('/');
    const run = async () => {
      const res = await client.me.$get({
        header: {
          authorization: 'Bearer token',
          additionalHeaderField: 'extra',
        },
      });
      if (res.status === 200) {
        expectTypeOf(await res.json()).toEqualTypeOf<{ ok: boolean }>();
      }
      if (res.status === 401) {
        expectTypeOf(await res.json()).toEqualTypeOf<{
          code: string;
          message: string;
        }>();
      }
    };
    expectTypeOf(run).not.toBeUndefined();
  });

  it('composes multiple fragments with merged request and response inference', () => {
    const routes = new Hono<AppEnv>().get(
      '/me',
      openApi(
        {
          request: {
            header: z.object({}),
          },
          responses: {
            200: z.object({ ok: z.boolean() }),
          },
        },
        jwtMiddleware,
        requestIdMiddleware,
        traceMiddleware,
      ),
      (c) => {
        expectTypeOf(c.req.valid('header')).toMatchTypeOf<{
          authorization?: string | undefined;
          'x-request-id': string;
          'x-trace-id': string;
        }>();
        expectTypeOf(c.get('jwtPayload')).toEqualTypeOf<unknown>();
        return c.var.res(200, { ok: true });
      },
    );

    const client = hc<typeof routes>('/');
    const run = async () => {
      const res = await client.me.$get({
        header: {
          authorization: 'Bearer token',
          'x-request-id': 'request-id',
          'x-trace-id': 'trace-id',
        },
      });
      if (res.status === 200) {
        expectTypeOf(await res.json()).toEqualTypeOf<{ ok: boolean }>();
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
      if (res.status === 403) {
        expectTypeOf(await res.json()).toEqualTypeOf<{ code: string }>();
      }
      if (res.status === 422) {
        expectTypeOf(await res.json()).toEqualTypeOf<{ error: string }>();
      }
    };
    expectTypeOf(run).not.toBeUndefined();
  });

  it('checks conflicts when composing multiple creator fragments', () => {
    const duplicateRequest = openApiFragment({
      request: {
        header: z.object({ authorization: z.number() }),
      },
      responses: {},
    });
    const invalidRequest = () =>
      // @ts-expect-error header.authorization conflicts with the JWT fragment
      openApiFragment(
        { responses: { 200: z.object({ ok: z.boolean() }) } },
        jwtMiddleware,
        duplicateRequest,
      );

    const duplicateResponse = openApiFragment({
      responses: { 400: z.object({ code: z.string() }) },
    });
    const invalidResponse = () =>
      // @ts-expect-error response status 400 conflicts with both fragments
      openApiFragment(
        { responses: { 200: z.object({ ok: z.boolean() }) } },
        jwtMiddleware,
        duplicateResponse,
      );

    expectTypeOf(invalidRequest).not.toBeUndefined();
    expectTypeOf(invalidResponse).not.toBeUndefined();
  });

  it('reports response conflicts between fragments', () => {
    const duplicate400 = openApiFragment({
      responses: { 400: z.object({ code: z.string() }) },
    });
    const invalid = () =>
      // @ts-expect-error response status 400 has a different schema
      openApi(
        { responses: { 200: z.object({ ok: z.boolean() }) } },
        jwtMiddleware,
        duplicate400,
      );
    expectTypeOf(invalid).not.toBeUndefined();
  });

  it('reports request property conflicts between fragments', () => {
    const duplicateAuthorization = openApiFragment({
      request: { header: z.object({ authorization: z.number() }) },
      responses: {},
    });
    const invalid = () =>
      // @ts-expect-error header.authorization has incompatible schemas
      openApi(
        { responses: { 200: z.object({ ok: z.boolean() }) } },
        jwtMiddleware,
        duplicateAuthorization,
      );
    expectTypeOf(invalid).not.toBeUndefined();
  });

  it('reports request conflicts against a fragment whose request schemas were merged', () => {
    const errorEnvelope = z.object({
      code: z.string(),
      message: z.string(),
    });
    const additionalHeader = openApiFragment({
      request: {
        header: z.object({ additionalHeaderField: z.string().optional() }),
      },
      responses: {},
    });
    const combinedJwtMiddleware = openApiFragment(
      {
        request: {
          header: z.object({
            authorization: z.string().startsWith('Bearer ').optional(),
          }),
        },
        responses: { 401: errorEnvelope },
      },
      additionalHeader,
    );

    const invalid = () =>
      openApi(
        {
          request: { header: z.object({ authorization: z.number() }) },
          responses: { 200: z.object({ ok: z.boolean() }) },
        },
        // @ts-expect-error header.authorization conflicts with the combined fragment
        combinedJwtMiddleware,
      );
    expectTypeOf(invalid).not.toBeUndefined();
  });

  it('checks property conflicts when composed metadata is an intersection', () => {
    type AuthorizationRequest = {
      header: z.ZodObject<{
        authorization: z.ZodOptional<z.ZodString>;
      }>;
    };
    type AdditionalHeaderRequest = {
      header: z.ZodObject<{
        additionalHeaderField: z.ZodOptional<z.ZodString>;
      }>;
    };
    type MiddlewareResponses = {
      401: z.ZodObject<{ message: z.ZodString }>;
    };
    type ConflictDetails = OpenApiShapeConflictDetails<
      { header: z.ZodObject<{ authorization: z.ZodNumber }> },
      AuthorizationRequest & AdditionalHeaderRequest,
      { 200: z.ZodObject<{ ok: z.ZodBoolean }> },
      MiddlewareResponses
    >;
    expectTypeOf<ConflictDetails>().toEqualTypeOf<'request property "header.authorization" has an incompatible schema'>();

    const assertConflict = (
      middleware: OpenApiFragmentValue<
        AuthorizationRequest & AdditionalHeaderRequest,
        MiddlewareResponses
      >,
    ) => {
      const invalid = () =>
        openApiFragment(
          {
            request: {
              header: z.object({ authorization: z.number() }),
            },
            responses: { 200: z.object({ ok: z.boolean() }) },
          },
          // @ts-expect-error authorization conflicts with the intersected metadata
          middleware,
        );
      expectTypeOf(invalid).not.toBeUndefined();

      // Distinct properties from both declarations still merge successfully.
      openApiFragment(
        {
          request: {
            header: z.object({
              authorization: z.string().optional(),
              additionalHeaderField: z.string().optional(),
            }),
          },
          responses: { 200: z.object({ ok: z.boolean() }) },
        },
        middleware,
      );
    };
    expectTypeOf(assertConflict).not.toBeUndefined();
  });

  it('checks request conflicts when fragment and inline middleware are composed together', () => {
    const errorEnvelope = z.object({
      code: z.string(),
      message: z.string(),
    });
    const badRequestEnvelope = z.object({
      status: z.boolean(),
      errors: errorEnvelope,
    });
    const additionalHeader = openApiFragment({
      request: {
        header: z.object({ additionalHeaderField: z.string().optional() }),
      },
      responses: { 400: badRequestEnvelope },
    });
    const composedJwtMiddleware = openApiFragment(
      {
        request: {
          header: z.object({
            authorization: z.string().startsWith('Bearer ').optional(),
          }),
        },
        responses: {
          401: errorEnvelope,
          400: badRequestEnvelope,
          default: errorEnvelope,
        },
      },
      additionalHeader,
      async (c, next) => {
        expectTypeOf(c.req.valid('header').authorization).toEqualTypeOf<
          string | undefined
        >();
        expectTypeOf(c.req.valid('header')).toMatchTypeOf<{
          authorization?: string | undefined;
          additionalHeaderField?: string | undefined;
        }>();
        expectTypeOf(c.env.JWT_SECRET).toEqualTypeOf<string>();
        await next();
      },
    );
    const route = new Hono<AppEnv>().get(
      '/me',
      openApiFragment(
        {
          request: {
            header: z.object({
              authorization: z.string().optional(),
              additionalHeaderField: z.string().optional(),
            }),
          },
          responses: {
            200: z.object({ ok: z.boolean() }),
            401: errorEnvelope,
          },
        },
        composedJwtMiddleware,
      ),
      (c) => {
        expectTypeOf(c.req.valid('header')).toMatchTypeOf<{
          authorization?: string | undefined;
          additionalHeaderField?: string | undefined;
        }>();
        return c.var.res(200, { ok: true });
      },
    );
    const client = hc<typeof route>('/');
    const run = async () => {
      const response = await client.me.$get({
        header: {
          authorization: 'Bearer token',
          additionalHeaderField: 'trace',
        },
      });
      if (response.status === 200) {
        expectTypeOf(await response.json()).toEqualTypeOf<{ ok: boolean }>();
      }
      if (response.status === 401) {
        expectTypeOf(await response.json()).toEqualTypeOf<{
          code: string;
          message: string;
        }>();
      }
    };
    expectTypeOf(run).not.toBeUndefined();

    const invalid = () =>
      openApiFragment(
        {
          request: { header: z.object({ authorization: z.number() }) },
          responses: { 200: z.object({ ok: z.boolean() }) },
        },
        // @ts-expect-error header.authorization conflicts with the nested fragment
        composedJwtMiddleware,
      );
    expectTypeOf(invalid).not.toBeUndefined();
  });

  it('mismatched 401 payload and required-vs-optional header are rejected', () => {
    const routeMw = () =>
      openApi(
        {
          request: {
            header: z.object({
              authorization: z.string(),
            }),
          },
          responses: {
            200: z.object({
              id: z.string(),
              username: z.string(),
              issuedAt: z.string(),
            }),
            401: {
              schema: z.object({ name: z.string() }),
            },
          },
        },
        // @ts-expect-error required header + different 401 payload both conflict with the fragment
        jwtMiddleware,
      );
    expectTypeOf(routeMw).not.toBeUndefined();
  });

  it('matching contracts compose: same 401 payload and same requiredness', () => {
    const composed = openApi(
      {
        tags: ['Auth'],
        request: {
          header: z.object({
            // .meta() is cosmetic; the validated contract matches the fragment
            authorization: z
              .string()
              .meta({ description: 'same contract' })
              .optional(),
          }),
        },
        responses: {
          200: {
            description: 'The payload of the presented bearer token',
            schema: z.object({
              id: z.string(),
              username: z.string(),
              issuedAt: z.string(),
            }),
          },
        },
      },
      jwtMiddleware,
    );
    expectTypeOf(composed).not.toBeUndefined();
  });

  it('creator fragments keep merged client inference after nesting', () => {
    const routes = new Hono<AppEnv>().post(
      '/me',
      openApi(
        {
          request: {
            header: z.object({
              'x-request-id': z.string(),
            }),
            json: z.object({ name: z.string() }),
          },
          responses: {
            200: {
              description: 'ok',
              schema: z.object({
                id: z.string(),
                username: z.string(),
                issuedAt: z.string(),
              }),
            },
          },
        },
        jwtMiddleware,
      ),
      async (c) => {
        expectTypeOf(c.get('jwtPayload')).toEqualTypeOf<unknown>();
        expectTypeOf(c.req.valid('header')).toMatchTypeOf<{
          authorization?: string | undefined;
          'x-request-id': string;
        }>();
        const { name } = c.req.valid('json');
        expectTypeOf(name).toEqualTypeOf<string>();
        return c.var.res(200, { id: '1', username: 'u', issuedAt: '' });
      },
    );

    const client = hc<typeof routes>('/');
    const run = async () => {
      const res = await client.me.$post({
        json: { name: 'x' },
        header: { authorization: 'Bearer t', 'x-request-id': 'req-1' },
      });
      if (res.status === 200) {
        expectTypeOf(await res.json()).toEqualTypeOf<{
          id: string;
          username: string;
          issuedAt: string;
        }>();
      }
      if (res.status === 401) {
        expectTypeOf(await res.json()).toEqualTypeOf<{
          code: string;
          message: string;
        }>();
      }
    };
    expectTypeOf(run).not.toBeUndefined();
  });

  it('accepts the maximum inline middleware overloads on the creator', () => {
    const app = new Hono<AppEnv>().post(
      '/max',
      openApiFragment(
        {
          request: { json: z.object({ name: z.string() }) },
          responses: {
            200: z.object({ name: z.string() }),
            400: z.object({ field: z.string() }),
            401: z.object({ message: z.string() }),
            403: z.object({ reason: z.string() }),
          },
        },
        async (c, next) => {
          expectTypeOf(c.env.JWT_SECRET).toEqualTypeOf<string>();
          expectTypeOf(c.req.valid('json').name).toEqualTypeOf<string>();
          // @ts-expect-error the seeded env stays precise
          const _unknownBinding = c.env.NOT_A_BINDING;
          if (c.req.valid('json').name === 'bad') {
            return c.var.res(400, { field: 'name' });
          }
          await next();
        },
        async (c, next) => {
          expectTypeOf(c.env.JWT_SECRET).toEqualTypeOf<string>();
          expectTypeOf(c.req.valid('json').name).toEqualTypeOf<string>();
          if (c.req.valid('json').name === 'unauthorized') {
            return c.var.res(401, { message: 'unauthorized' });
          }
          await next();
        },
        async (c, next) => {
          expectTypeOf(c.env.JWT_SECRET).toEqualTypeOf<string>();
          expectTypeOf(c.req.valid('json').name).toEqualTypeOf<string>();
          if (c.req.valid('json').name === 'forbidden') {
            return c.var.res(403, { reason: 'forbidden' });
          }
          await next();
        },
      ),
      (c) => c.var.res(200, { name: c.req.valid('json').name }),
    );

    const client = hc<typeof app>('/');
    const run = async () => {
      const res = await client.max.$post({ json: { name: 'x' } });
      if (res.status === 200) {
        expectTypeOf(await res.json()).toEqualTypeOf<{ name: string }>();
      }
      if (res.status === 400) {
        expectTypeOf(await res.json()).toEqualTypeOf<{ field: string }>();
      }
      if (res.status === 401) {
        expectTypeOf(await res.json()).toEqualTypeOf<{ message: string }>();
      }
      if (res.status === 403) {
        expectTypeOf(await res.json()).toEqualTypeOf<{ reason: string }>();
      }
    };
    expectTypeOf(run).not.toBeUndefined();
  });

  it('composes nested fragments through the maximum overloads', () => {
    const errorEnvelope = z.object({ code: z.string(), message: z.string() });
    const requestIdFragment = openApiFragment(
      {
        request: { header: z.object({ 'x-request-id': z.string() }) },
        responses: { 400: errorEnvelope },
      },
      async (_c, next) => {
        await next();
      },
    );
    const bodyFragment = openApiFragment(
      {
        request: { json: z.object({ name: z.string() }) },
        responses: {},
      },
      async (_c, next) => {
        await next();
      },
    );
    // Level 1: two fragments followed by inline middleware (mixed maximum).
    const inner = openApiFragment(
      {
        request: { header: z.object({ authorization: z.string().optional() }) },
        responses: { 401: errorEnvelope },
      },
      requestIdFragment,
      bodyFragment,
      async (c, next) => {
        expectTypeOf(c.env.JWT_SECRET).toEqualTypeOf<string>();
        expectTypeOf(c.req.valid('header')).toMatchTypeOf<{
          authorization?: string | undefined;
          'x-request-id': string;
        }>();
        expectTypeOf(c.req.valid('json').name).toEqualTypeOf<string>();
        await next();
      },
    );

    const traceFragment = openApiFragment(
      {
        request: { header: z.object({ 'x-trace-id': z.string() }) },
        responses: { 403: errorEnvelope },
      },
      async (_c, next) => {
        await next();
      },
    );
    // Level 2: the nested fragment plus another fragment and inline middleware.
    const outer = openApiFragment(
      {
        request: { header: z.object({ 'x-client-id': z.string() }) },
        responses: { 200: z.object({ ok: z.boolean() }) },
      },
      inner,
      traceFragment,
      async (c, next) => {
        const header = c.req.valid('header');
        expectTypeOf(header).toMatchTypeOf<{
          authorization?: string | undefined;
          'x-request-id': string;
          'x-trace-id': string;
          'x-client-id': string;
        }>();
        expectTypeOf(c.req.valid('json').name).toEqualTypeOf<string>();
        expectTypeOf(c.env.JWT_SECRET).toEqualTypeOf<string>();
        await next();
      },
    );

    // Level 3: compose the nested fragment into a route.
    const routes = new Hono<AppEnv>().post(
      '/deep',
      openApi(
        {
          request: { json: z.object({ extra: z.boolean() }) },
          responses: { 201: z.object({ created: z.boolean() }) },
        },
        outer,
      ),
      (c) => {
        const header = c.req.valid('header');
        expectTypeOf(header).toMatchTypeOf<{
          authorization?: string | undefined;
          'x-request-id': string;
          'x-trace-id': string;
          'x-client-id': string;
        }>();
        expectTypeOf(c.req.valid('json')).toMatchTypeOf<{
          name: string;
          extra: boolean;
        }>();
        return c.var.res(201, { created: true });
      },
    );

    const client = hc<typeof routes>('/');
    const run = async () => {
      const res = await client.deep.$post({
        header: {
          authorization: 'Bearer token',
          'x-request-id': 'req',
          'x-trace-id': 'trace',
          'x-client-id': 'client',
        },
        json: { name: 'name', extra: true },
      });
      if (res.status === 201) {
        expectTypeOf(await res.json()).toEqualTypeOf<{ created: boolean }>();
      }
      if (res.status === 200) {
        expectTypeOf(await res.json()).toEqualTypeOf<{ ok: boolean }>();
      }
      if (res.status === 400) {
        expectTypeOf(await res.json()).toEqualTypeOf<{
          code: string;
          message: string;
        }>();
      }
      if (res.status === 401) {
        expectTypeOf(await res.json()).toEqualTypeOf<{
          code: string;
          message: string;
        }>();
      }
      if (res.status === 403) {
        expectTypeOf(await res.json()).toEqualTypeOf<{
          code: string;
          message: string;
        }>();
      }
    };
    expectTypeOf(run).not.toBeUndefined();

    const invalid = () =>
      openApiFragment(
        {
          request: {
            header: z.object({ 'x-request-id': z.number() }),
          },
          responses: { 200: z.object({ ok: z.boolean() }) },
        },
        // @ts-expect-error x-request-id conflicts with the nested fragment
        outer,
      );
    expectTypeOf(invalid).not.toBeUndefined();
  });
});

/**
 * Regression: composing fragments used to intersect one `res` helper per
 * fragment/operation. Calls still type-checked, but TypeScript contextual
 * typing picked a single overload, so IntelliSense only completed payloads
 * declared by the last operation. The helper must instead be built from the
 * merged response map.
 */
describe('composed response helper', () => {
  type CompositionEnv = {
    Bindings: { JWT_SECRET: string };
    Variables: { jwtPayload: unknown };
  };

  const openApiFragment = createOpenApiFragment<CompositionEnv>();

  const okSchema = z.object({ ok: z.boolean() });
  const createdSchema = z.object({ created: z.boolean() });
  const errorSchema = z.object({ code: z.string(), message: z.string() });
  const traceSchema = z.object({ trace: z.string() });
  const detailSchema = z.object({ detail: z.string() });

  const auth = openApiFragment(
    { responses: { 401: errorSchema } },
    async (_c, next) => {
      await next();
    },
  );
  const trace = openApiFragment(
    { responses: { 403: traceSchema } },
    async (_c, next) => {
      await next();
    },
  );

  it('route handlers get one res helper covering every fragment response', () => {
    const middleware = openApi({ responses: { 200: okSchema } }, auth);

    new Hono<CompositionEnv>().get('/me', middleware, (c) => {
      expectTypeOf(c.var.res(200, { ok: true })).toEqualTypeOf<
        Response & TypedResponse<{ ok: boolean }, 200, 'json'>
      >();
      expectTypeOf(c.var.res(401, { code: 'x', message: 'y' })).toEqualTypeOf<
        Response & TypedResponse<{ code: string; message: string }, 401>
      >();

      // @ts-expect-error the 401 payload comes from the composed fragment
      c.var.res(401, { ok: true });
      // @ts-expect-error 500 is not declared by any fragment
      c.var.res(500, {});

      return c.var.res(200, { ok: true });
    });
  });

  it('compatible redeclared statuses keep the last schema usable', () => {
    const routeErrorSchema = z.object({
      code: z.string(),
      message: z.string(),
    });
    const middleware = openApi(
      { responses: { 200: okSchema, 401: routeErrorSchema } },
      auth,
    );

    new Hono<CompositionEnv>().get('/overlap', middleware, (c) => {
      // The fragment's 401 is the later declaration, matching runtime
      // `mergeOperations`, so the res helper must keep it (not an intersection
      // of both Zod schema types).
      expectTypeOf(c.var.res(401, { code: 'x', message: 'y' })).toEqualTypeOf<
        Response & TypedResponse<{ code: string; message: string }, 401>
      >();
      return c.var.res(200, { ok: true });
    });
  });

  it('three-fragment compositions merge every response map', () => {
    const detail = openApiFragment(
      { responses: { 400: detailSchema } },
      async (_c, next) => {
        await next();
      },
    );
    const middleware = openApiFragment(
      { responses: { 201: createdSchema } },
      auth,
      trace,
      detail,
    );

    new Hono<CompositionEnv>().get('/deep', middleware, (c) => {
      expectTypeOf(c.var.res(201, { created: true })).toEqualTypeOf<
        Response & TypedResponse<{ created: boolean }, 201>
      >();
      expectTypeOf(c.var.res(401, { code: 'x', message: 'y' })).toEqualTypeOf<
        Response & TypedResponse<{ code: string; message: string }, 401>
      >();
      expectTypeOf(c.var.res(403, { trace: 't' })).toEqualTypeOf<
        Response & TypedResponse<{ trace: string }, 403>
      >();
      expectTypeOf(c.var.res(400, { detail: 'd' })).toEqualTypeOf<
        Response & TypedResponse<{ detail: string }, 400>
      >();
      return c.var.res(201, { created: true });
    });
  });

  it('inline composition middleware return the merged res helper', () => {
    const creatorComposed = openApiFragment(
      { responses: { 201: createdSchema } },
      auth,
      trace,
      async (_c, next) => {
        await next();
      },
    );
    const plainComposed = openApi(
      { responses: { 201: createdSchema } },
      auth,
      trace,
      async (_c, next) => {
        await next();
      },
    );

    new Hono<CompositionEnv>().get('/creator', creatorComposed, (c) => {
      expectTypeOf(c.var.res(201, { created: true })).toEqualTypeOf<
        Response & TypedResponse<{ created: boolean }, 201>
      >();
      expectTypeOf(c.var.res(401, { code: 'x', message: 'y' })).toEqualTypeOf<
        Response & TypedResponse<{ code: string; message: string }, 401>
      >();
      expectTypeOf(c.var.res(403, { trace: 't' })).toEqualTypeOf<
        Response & TypedResponse<{ trace: string }, 403>
      >();
      return c.var.res(201, { created: true });
    });

    new Hono<CompositionEnv>().get('/plain', plainComposed, (c) => {
      expectTypeOf(c.var.res(201, { created: true })).toEqualTypeOf<
        Response & TypedResponse<{ created: boolean }, 201>
      >();
      expectTypeOf(c.var.res(401, { code: 'x', message: 'y' })).toEqualTypeOf<
        Response & TypedResponse<{ code: string; message: string }, 401>
      >();
      expectTypeOf(c.var.res(403, { trace: 't' })).toEqualTypeOf<
        Response & TypedResponse<{ trace: string }, 403>
      >();
      return c.var.res(201, { created: true });
    });
  });
});

describe('openApi without responses', () => {
  it('keeps environment, validation and client inference when responses are omitted', async () => {
    const app = new Hono<AppEnv>().post(
      '/without-responses',
      openApi(
        {
          request: {
            json: z.object({ name: z.string() }),
            header: z.object({ 'x-request-id': z.string() }),
          },
        },
        auth,
      ),
      (c) => {
        expectTypeOf(c.env.KV).toEqualTypeOf<AppBindings['KV']>();
        expectTypeOf(c.var.userId).toEqualTypeOf<string>();

        const { name } = c.req.valid('json');
        return c.json({ name }, 200);
      },
    );

    const client = hc<typeof app>('/');
    const res = await client['without-responses'].$post({
      json: { name: 'John' },
      header: { 'x-request-id': 'req-1' },
    });

    if (res.status === 200) {
      expectTypeOf(await res.json()).toEqualTypeOf<{ name: string }>();
    }
    if (res.status === 401) {
      expectTypeOf(await res.json()).toEqualTypeOf<{ message: string }>();
    }

    await client['without-responses'].$post({
      // @ts-expect-error json input is still derived from the request schema
      json: { name: 123 },
      header: { 'x-request-id': 'req-1' },
    });
  });

  it('creates a fragment without responses whose middleware sees the route environment', async () => {
    const fragment = createOpenApiFragment<AppEnv>()(
      { request: { json: z.object({ name: z.string() }) } },
      async (c, next) => {
        expectTypeOf(c.env.KV).toEqualTypeOf<AppBindings['KV']>();
        expectTypeOf(c.req.valid('json')).toEqualTypeOf<{ name: string }>();
        await next();
      },
    );

    const app = new Hono<AppEnv>().post(
      '/fragment-without-responses',
      openApi(
        { responses: { 201: z.object({ created: z.boolean() }) } },
        fragment,
      ),
      (c) => {
        expectTypeOf(c.req.valid('json')).toEqualTypeOf<{ name: string }>();
        return c.var.res(201, { created: true });
      },
    );

    const client = hc<typeof app>('/');
    const res = await client['fragment-without-responses'].$post({
      json: { name: 'John' },
    });
    if (res.status === 201) {
      expectTypeOf(await res.json()).toEqualTypeOf<{ created: boolean }>();
    }
  });

  it('keeps later response declarations when an earlier openApi omits responses', async () => {
    const app = new Hono<AppEnv>().post(
      '/stacked-without-responses',
      openApi({ request: { json: z.object({ name: z.string() }) } }, auth),
      openApi({ responses: { 200: z.object({ name: z.string() }) } }),
      (c) => c.var.res(200, { name: c.req.valid('json').name }),
    );

    const client = hc<typeof app>('/');
    const res = await client['stacked-without-responses'].$post({
      json: { name: 'John' },
    });
    if (res.status === 200) {
      expectTypeOf(await res.json()).toEqualTypeOf<{ name: string }>();
    }
    if (res.status === 401) {
      expectTypeOf(await res.json()).toEqualTypeOf<{ message: string }>();
    }
  });

  it('supports omitted responses across the multi-middleware overloads', async () => {
    const app = new Hono<AppEnv>().post(
      '/multi-without-responses',
      openApi(
        { request: { json: z.object({ name: z.string() }) } },
        auth,
        forbidden,
        rateLimited,
      ),
      (c) => {
        expectTypeOf(c.var.userId).toEqualTypeOf<string>();
        expectTypeOf(c.req.valid('json')).toEqualTypeOf<{ name: string }>();
        return c.json({ name: c.req.valid('json').name }, 200);
      },
    );

    const client = hc<typeof app>('/');
    const res = await client['multi-without-responses'].$post({
      json: { name: 'John' },
    });
    if (res.status === 200) {
      expectTypeOf(await res.json()).toEqualTypeOf<{ name: string }>();
    }
    if (res.status === 401) {
      expectTypeOf(await res.json()).toEqualTypeOf<{ message: string }>();
    }
    if (res.status === 403) {
      expectTypeOf(await res.json()).toEqualTypeOf<{ reason: string }>();
    }
    if (res.status === 429) {
      expectTypeOf(await res.json()).toEqualTypeOf<{ retryAfter: number }>();
    }
  });

  it('creates a fragment without responses with multiple middleware', async () => {
    const fragment = createOpenApiFragment<AppEnv>()(
      { request: { json: z.object({ name: z.string() }) } },
      async (c, next) => {
        expectTypeOf(c.env.KV).toEqualTypeOf<AppBindings['KV']>();
        expectTypeOf(c.req.valid('json')).toEqualTypeOf<{ name: string }>();
        await next();
      },
      async (c, next) => {
        expectTypeOf(c.var.userId).toEqualTypeOf<string>();
        await next();
      },
    );

    const app = new Hono<AppEnv>().post(
      '/multi-fragment-without-responses',
      openApi(
        { responses: { 201: z.object({ created: z.boolean() }) } },
        fragment,
      ),
      (c) => {
        expectTypeOf(c.req.valid('json')).toEqualTypeOf<{ name: string }>();
        return c.var.res(201, { created: true });
      },
    );

    const client = hc<typeof app>('/');
    const res = await client['multi-fragment-without-responses'].$post({
      json: { name: 'John' },
    });
    if (res.status === 201) {
      expectTypeOf(await res.json()).toEqualTypeOf<{ created: boolean }>();
    }
  });

  it('preserves explicit generic arguments and required operation responses', async () => {
    type JsonBody = {
      json: z.ZodObject<{ name: z.ZodString }>;
    };
    type Created = {
      200: z.ZodObject<{ name: z.ZodString }>;
    };
    type LegacyDefineOpenApiOperation = <
      Req extends HonoOpenApiRequestSchemas,
      Res extends HonoOpenApiResponses,
    >(
      operation: HonoOpenApiOperation<Req, Res>,
    ) => HonoOpenApiOperation<Req, Res>;

    // The pre-existing signature remains assignable after adding the
    // no-responses overload.
    const legacyDefine: LegacyDefineOpenApiOperation = defineOpenApiOperation;
    expectTypeOf(legacyDefine).toBeFunction();

    const operation: HonoOpenApiOperation<JsonBody, Created> = {
      request: { json: z.object({ name: z.string() }) },
      responses: { 200: z.object({ name: z.string() }) },
    };
    // `HonoOpenApiOperation` still requires responses; only the call sites
    // accept the no-responses variant.
    expectTypeOf(operation.responses).not.toBeUndefined();
    // @ts-expect-error responses remain required on HonoOpenApiOperation
    const missingResponses: HonoOpenApiOperation<JsonBody> = {
      request: { json: z.object({ name: z.string() }) },
    };
    expectTypeOf(missingResponses).toEqualTypeOf<
      HonoOpenApiOperation<JsonBody>
    >();

    const app = new Hono().post(
      '/explicit-generics',
      openApi<JsonBody, '/explicit-generics', Created>(operation),
      (c) => c.json(c.req.valid('json'), 200),
    );

    const defined = defineOpenApiOperation<JsonBody, Created>(operation);
    expectTypeOf(defined.responses).not.toBeUndefined();

    const definedWithoutResponses = defineOpenApiOperation({
      request: { json: z.object({ name: z.string() }) },
    });
    new Hono().post(
      '/defined-without-responses',
      openApi(definedWithoutResponses),
      (c) => {
        expectTypeOf(c.req.valid('json')).toEqualTypeOf<{ name: string }>();
        return c.json(c.req.valid('json'), 200);
      },
    );

    const client = hc<typeof app>('/');
    const res = await client['explicit-generics'].$post({
      json: { name: 'John' },
    });
    if (res.status === 200) {
      expectTypeOf(await res.json()).toEqualTypeOf<{ name: string }>();
    }
  });
});
