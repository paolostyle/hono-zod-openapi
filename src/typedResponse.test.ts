import { Hono } from 'hono';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as z from 'zod';
import {
  determineContentType,
  parseResArgs,
  type ParsedResArgs,
  resolveResponseContentType,
  typedResponseMiddleware,
} from './typedResponse.ts';
import type { HeaderRecord } from './types.ts';

describe('parseResArgs', () => {
  describe('single argument (payload only)', () => {
    it('returns status 200 with payload', () => {
      const result = parseResArgs([{ name: 'John' }]);

      expect(result).toEqual({
        status: 200,
        payload: { name: 'John' },
      });
    });

    it('works with string payload', () => {
      const result = parseResArgs(['Hello']);

      expect(result).toEqual({
        status: 200,
        payload: 'Hello',
      });
    });

    it('works with null payload', () => {
      const result = parseResArgs([null]);

      expect(result).toEqual({
        status: 200,
        payload: null,
      });
    });
  });

  describe('two arguments', () => {
    it('interprets (number, payload) as status and payload', () => {
      const result = parseResArgs([201, { created: true }]);

      expect(result).toEqual({
        status: 201,
        payload: { created: true },
      });
    });

    it('interprets (object, object) as payload and headers', () => {
      const headers = { 'x-custom': 'value' };
      const result = parseResArgs([{ name: 'John' }, headers]);

      expect(result).toEqual({
        status: 200,
        payload: { name: 'John' },
        headers,
      });
    });

    it('interprets (string, object) as payload and headers', () => {
      const headers = { 'Content-Type': 'text/plain' as const };
      const result = parseResArgs(['Hello', headers]);

      expect(result).toEqual({
        status: 200,
        payload: 'Hello',
        headers,
      });
    });
  });

  describe('three arguments', () => {
    it('parses (status, payload, headers)', () => {
      const headers = { 'x-request-id': '123' };
      const result = parseResArgs([201, { id: 1 }, headers]);

      expect(result).toEqual({
        status: 201,
        payload: { id: 1 },
        headers,
      });
    });

    it('works with null payload for no-content responses', () => {
      const headers = { 'x-custom': 'value' };
      const result = parseResArgs([204, null, headers]);

      expect(result).toEqual({
        status: 204,
        payload: null,
        headers,
      });
    });
  });

  it('returns correct ParsedResArgs type', () => {
    const result = parseResArgs([200, { data: 'test' }]);

    expectTypeOf(result).toEqualTypeOf<ParsedResArgs>();
    expectTypeOf(result.status).toEqualTypeOf<number>();
    expectTypeOf(result.payload).toEqualTypeOf<unknown>();
    expectTypeOf(result.headers).toEqualTypeOf<HeaderRecord | undefined>();
  });
});

describe('determineContentType', () => {
  it('returns text/plain for z.string()', () => {
    expect(determineContentType(z.string())).toBe('text/plain');
  });

  it('returns text/plain for z.email() (ZodStringFormat)', () => {
    expect(determineContentType(z.email())).toBe('text/plain');
  });

  it('returns null for z.void()', () => {
    expect(determineContentType(z.void())).toBeNull();
  });

  it('returns null for z.undefined()', () => {
    expect(determineContentType(z.undefined())).toBeNull();
  });

  it('returns null for z.null()', () => {
    expect(determineContentType(z.null())).toBeNull();
  });

  it('returns null for z.never()', () => {
    expect(determineContentType(z.never())).toBeNull();
  });

  it('returns application/json for z.object()', () => {
    expect(determineContentType(z.object({ name: z.string() }))).toBe(
      'application/json',
    );
  });

  it('returns application/json for z.array()', () => {
    expect(determineContentType(z.array(z.string()))).toBe('application/json');
  });

  it('returns application/json for z.number()', () => {
    expect(determineContentType(z.number())).toBe('application/json');
  });

  it('returns application/json for z.boolean()', () => {
    expect(determineContentType(z.boolean())).toBe('application/json');
  });
});

describe('resolveResponseContentType', () => {
  describe('with raw Zod schema', () => {
    it('delegates to determineContentType for z.string()', () => {
      expect(resolveResponseContentType(z.string())).toBe('text/plain');
    });

    it('delegates to determineContentType for z.object()', () => {
      expect(resolveResponseContentType(z.object({}))).toBe('application/json');
    });
  });

  describe('with SimpleResponseObject (schema property)', () => {
    it('uses mediaType if provided', () => {
      const res = {
        schema: z.string(),
        mediaType: 'text/html',
      };

      expect(resolveResponseContentType(res)).toBe('text/html');
    });

    it('infers from schema if mediaType not provided', () => {
      const res = {
        schema: z.object({ name: z.string() }),
      };

      expect(resolveResponseContentType(res)).toBe('application/json');
    });

    it('infers text/plain for string schema without mediaType', () => {
      const res = {
        schema: z.string(),
      };

      expect(resolveResponseContentType(res)).toBe('text/plain');
    });
  });

  describe('with ZodOpenApiResponseObject (content property)', () => {
    it('extracts content types from content object', () => {
      const res = {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({ name: z.string() }),
          },
        },
      };

      expect(resolveResponseContentType(res)).toEqual(['application/json']);
    });

    it('returns multiple content types when defined', () => {
      const res = {
        description: 'Success',
        content: {
          'application/json': {
            schema: z.object({ name: z.string() }),
          },
          'text/plain': {
            schema: z.string(),
          },
        },
      };

      const result = resolveResponseContentType(res);
      expect(result).toContain('application/json');
      expect(result).toContain('text/plain');
    });

    it('filters out content types without Zod schemas', () => {
      expect(
        resolveResponseContentType({
          description: 'Success',
          content: {
            'application/json': {
              schema: z.object({ name: z.string() }),
            },
            'text/plain': {
              // OpenAPI schema object, not Zod
              schema: { type: 'string' as const },
            },
          },
        }),
      ).toEqual(['application/json']);
    });

    it('returns null when no valid Zod schemas in content', () => {
      expect(
        resolveResponseContentType({
          description: 'Success',
          content: {
            'application/json': {
              schema: { type: 'object' as const }, // Not a Zod schema
            },
          },
        }),
      ).toBeNull();
    });
  });

  describe('with reference object', () => {
    it('returns null for $ref objects', () => {
      const res = {
        $ref: '#/components/responses/Error',
      };

      expect(resolveResponseContentType(res)).toBeNull();
    });
  });

  describe('with description-only response (no content)', () => {
    it('returns null for responses without schema or content', () => {
      const res = {
        description: 'No content',
      };

      expect(resolveResponseContentType(res)).toBeNull();
    });
  });
});

describe('typedResponseMiddleware', () => {
  describe('c.var.res types', () => {
    it('provides correctly typed res helper with status', async () => {
      const app = new Hono().get(
        '/test',
        typedResponseMiddleware({
          responses: {
            200: z.object({ name: z.string() }),
            201: z.object({ created: z.boolean() }),
          },
        }),
        (c) => {
          const _201res = c.var.res(201, { created: true });
          // @ts-expect-error - wrong payload for 200
          const _200resWrong = c.var.res(200, { created: true });

          return c.var.res(200, { name: 'John' });
        },
      );

      const response = await app.request('/test');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ name: 'John' });
    });

    it('provides shorthand res(payload) when 200 is defined', async () => {
      const app = new Hono().get(
        '/test',
        typedResponseMiddleware({
          responses: {
            200: z.object({ ok: z.boolean() }),
          },
        }),
        (c) => {
          // Should be able to call res with just payload, defaulting to 200
          return c.var.res({ ok: true });
        },
      );

      const response = await app.request('/test');
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    });

    it('enforces correct payload types', async () => {
      const app = new Hono().get(
        '/test',
        typedResponseMiddleware({
          responses: {
            200: z.object({ name: z.string() }),
            400: z.object({ error: z.string() }),
          },
        }),
        (c) => {
          const { res } = c.var;

          // @ts-expect-error - wrong payload type for 200
          const _wrong200 = () => res(200, { error: 'wrong' });

          // @ts-expect-error - wrong payload type for 400
          const _wrong400 = () => res(400, { name: 'wrong' });

          return res(200, { name: 'correct' });
        },
      );

      const response = await app.request('/test');
      expect(response.status).toBe(200);
    });

    it('enforces valid status codes only', async () => {
      const app = new Hono().get(
        '/test',
        typedResponseMiddleware({
          responses: {
            200: z.object({ ok: z.boolean() }),
          },
        }),
        (c) => {
          const { res } = c.var;

          // @ts-expect-error - 404 is not defined in responses
          const _wrong = () => res(404, { error: 'not found' });

          return res(200, { ok: true });
        },
      );

      const response = await app.request('/test');
      expect(response.status).toBe(200);
    });
  });

  describe('error handling', () => {
    it('throws for invalid status codes at runtime', async () => {
      const app = new Hono()
        .get(
          '/test',
          typedResponseMiddleware({
            responses: {
              200: z.object({}),
            },
          }),
          (c) => {
            // @ts-expect-error - 999 is not a valid HTTP status code
            return c.var.res(999, {});
          },
        )
        .onError((err, c) => {
          return c.text(err.message, 500);
        });

      const response = await app.request('/test');
      expect(response.status).toBe(500);
      expect(await response.text()).toContain('Invalid status code: 999');
    });

    it('throws for undefined response schema at runtime', async () => {
      const app = new Hono()
        .get(
          '/test',
          typedResponseMiddleware({
            responses: {
              200: z.object({}),
            },
          }),
          (c) => {
            // @ts-expect-error - 400 is not defined in responses
            return c.var.res(404, { error: 'not found' });
          },
        )
        .onError((err, c) => {
          return c.text(err.message, 500);
        });

      const response = await app.request('/test');
      expect(response.status).toBe(500);
      expect(await response.text()).toContain(
        'Response schema for status 404 not defined',
      );
    });
  });

  describe('content-type handling', () => {
    it('returns JSON for object schemas', async () => {
      const app = new Hono().get(
        '/test',
        typedResponseMiddleware({
          responses: {
            200: z.object({ data: z.string() }),
          },
        }),
        (c) => c.var.res(200, { data: 'test' }),
      );

      const response = await app.request('/test');
      expect(response.headers.get('content-type')).toContain(
        'application/json',
      );
      expect(await response.json()).toEqual({ data: 'test' });
    });

    it('returns text/plain for string schemas', async () => {
      const app = new Hono().get(
        '/test',
        typedResponseMiddleware({
          responses: {
            200: z.string(),
          },
        }),
        (c) => c.var.res(200, 'Hello World'),
      );

      const response = await app.request('/test');
      expect(response.headers.get('content-type')).toContain('text/plain');
      expect(await response.text()).toBe('Hello World');
    });

    it('returns defined mediaType if specified', async () => {
      const app = new Hono().get(
        '/test',
        typedResponseMiddleware({
          responses: {
            200: { schema: z.string(), mediaType: 'text/html' },
          },
        }),
        (c) => c.var.res(200, '<h1>Hello</h1>'),
      );

      const response = await app.request('/test');
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toBe('<h1>Hello</h1>');
    });

    it('returns empty body for 204 No Content', async () => {
      const app = new Hono().get(
        '/test',
        typedResponseMiddleware({
          responses: {
            204: { description: 'No content' },
          },
        }),
        (c) => c.var.res(204, null),
      );

      const response = await app.request('/test');
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
    });
  });

  describe('multiple content types', () => {
    const responses = {
      200: {
        description: 'Success',
        content: {
          'application/json': { schema: z.object({ data: z.string() }) },
          'text/plain': { schema: z.string() },
        },
      },
    } as const;

    it('returns JSON for object payload', async () => {
      const app = new Hono().get(
        '/test',
        typedResponseMiddleware({ responses }),
        (c) => c.var.res(200, { data: 'test' }),
      );

      const response = await app.request('/test');
      expect(response.headers.get('content-type')).toContain(
        'application/json',
      );
    });

    it('returns text for string payload', async () => {
      const app = new Hono().get(
        '/test',
        typedResponseMiddleware({ responses }),
        (c) => c.var.res(200, 'plain text'),
      );

      const response = await app.request('/test');
      expect(response.headers.get('content-type')).toContain('text/plain');
    });
  });

  describe('headers passthrough', () => {
    it('includes custom headers in response', async () => {
      const app = new Hono().get(
        '/test',
        typedResponseMiddleware({
          responses: {
            201: z.object({ id: z.number() }),
          },
        }),
        (c) => c.var.res(201, { id: 1 }, { 'x-request-id': 'abc123' }),
      );

      const response = await app.request('/test');
      expect(response.status).toBe(201);
      expect(response.headers.get('x-request-id')).toBe('abc123');
    });

    it('supports headers with shorthand syntax', async () => {
      const app = new Hono().get(
        '/test',
        typedResponseMiddleware({
          responses: {
            200: z.object({ ok: z.boolean() }),
          },
        }),
        (c) => c.var.res({ ok: true }, { 'x-custom': 'value' }),
      );

      const response = await app.request('/test');
      expect(response.status).toBe(200);
      expect(response.headers.get('x-custom')).toBe('value');
    });
  });
});
