import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { mergeOperations } from './mergeOperation.ts';
import { RequestValidationSchemaSymbol } from './symbols.ts';
import type {
  HonoOpenApiOperation,
  HonoOpenApiRequestSchemas,
} from './types.ts';

const operation = (
  value: Partial<HonoOpenApiOperation> & {
    request?: HonoOpenApiRequestSchemas;
  } = {},
): HonoOpenApiOperation => ({
  responses: {},
  ...value,
});

const objectRequestSchema = (
  request: HonoOpenApiRequestSchemas | undefined,
  target: keyof HonoOpenApiRequestSchemas,
): z.ZodType => {
  const value = request?.[target];
  if (!value) throw new Error(`missing request target ${target}`);
  return value instanceof z.ZodType ? value : value.schema;
};

const validationSchema = (
  request: HonoOpenApiRequestSchemas | undefined,
  target: keyof HonoOpenApiRequestSchemas,
): z.ZodType | undefined => {
  const value = request?.[target];
  if (!value || value instanceof z.ZodType) return undefined;
  return value[RequestValidationSchemaSymbol];
};

describe('mergeOperations', () => {
  it('lets the later scalar document keys win but does not let undefined erase earlier values', () => {
    const merged = mergeOperations(
      operation({
        summary: 'first',
        description: 'kept',
        operationId: 'first-id',
      }),
      operation({
        summary: 'second',
        description: undefined,
        operationId: 'second-id',
      }),
    );

    expect(merged.summary).toBe('second');
    expect(merged.description).toBe('kept');
    expect(merged.operationId).toBe('second-id');
  });

  it('concatenates array document keys and removes duplicates', () => {
    const merged = mergeOperations(
      operation({
        tags: ['Auth', 'User'],
        security: [{ bearerAuth: [] }, { apiKey: [] }],
        parameters: [{ in: 'header', name: 'authorization', required: true }],
        servers: [{ url: 'https://a.example.com' }],
      }),
      operation({
        tags: ['User', 'Tasks'],
        security: [{ apiKey: [] }, { bearerAuth: ['read'] }],
        parameters: [
          { in: 'header', name: 'authorization', required: true },
          { in: 'header', name: 'x-request-id', required: false },
        ],
        servers: [
          { url: 'https://a.example.com' },
          { url: 'https://b.example.com' },
        ],
      }),
    );

    expect(merged.tags).toEqual(['Auth', 'User', 'Tasks']);
    expect(merged.security).toEqual([
      { bearerAuth: [] },
      { apiKey: [] },
      { bearerAuth: ['read'] },
    ]);
    expect(
      merged.parameters?.map((parameter) =>
        'name' in parameter ? parameter.name : undefined,
      ),
    ).toEqual(['authorization', 'x-request-id']);
    expect(merged.servers).toEqual([
      { url: 'https://a.example.com' },
      { url: 'https://b.example.com' },
    ]);
  });

  it('merges responses per status code with the later declaration winning', () => {
    const firstSchema = z.object({ first: z.string() });
    const secondSchema = z.object({ second: z.string() });
    const merged = mergeOperations(
      operation({ responses: { 200: firstSchema, 401: firstSchema } }),
      operation({ responses: { 200: secondSchema, 404: secondSchema } }),
    );

    expect(merged.responses[200]).toBe(secondSchema);
    expect(merged.responses[401]).toBe(firstSchema);
    expect(merged.responses[404]).toBe(secondSchema);
  });

  it('merges different request targets from both operations', () => {
    const header = z.object({ authorization: z.string() });
    const json = z.object({ name: z.string() });
    const query = z.object({ id: z.string() });
    const merged = mergeOperations(
      operation({ request: { header, json } }),
      operation({ request: { query } }),
    );

    expect(objectRequestSchema(merged.request, 'header')).toBe(header);
    expect(objectRequestSchema(merged.request, 'json')).toBe(json);
    expect(objectRequestSchema(merged.request, 'query')).toBe(query);
  });

  it('extends object schemas that share a request target', () => {
    const merged = mergeOperations(
      operation({
        request: {
          header: z.object({ authorization: z.string() }),
        },
      }),
      operation({
        request: {
          header: z.object({ 'x-request-id': z.string() }),
        },
      }),
    );

    const schema = objectRequestSchema(merged.request, 'header');
    expect(
      schema.parse({ authorization: 'token', 'x-request-id': 'req-1' }),
    ).toEqual({
      authorization: 'token',
      'x-request-id': 'req-1',
    });
  });

  it('lets the later schema win when a request target is not an object', () => {
    const merged = mergeOperations(
      operation({
        request: {
          header: z.string().min(1),
        },
      }),
      operation({
        request: {
          header: z.string().max(2),
        },
      }),
    );

    const schema = objectRequestSchema(merged.request, 'header');
    expect(schema.safeParse('abc').success).toBe(false);
    expect(schema.parse('ab')).toBe('ab');
  });

  it('keeps documentation-only properties while validating only the included schemas', () => {
    const merged = mergeOperations(
      operation({
        request: {
          header: {
            schema: z.object({ 'x-doc-only': z.string() }),
            validate: false,
          },
        },
      }),
      operation({
        request: {
          header: {
            schema: z.object({ authorization: z.string() }),
            validate: true,
          },
        },
      }),
    );

    const documented = objectRequestSchema(merged.request, 'header');
    expect(
      documented.parse({ 'x-doc-only': 'doc', authorization: 'token' }),
    ).toEqual({ 'x-doc-only': 'doc', authorization: 'token' });

    const validated = validationSchema(merged.request, 'header');
    expect(validated).toBeDefined();
    expect(
      validated?.parse({ authorization: 'token', 'x-doc-only': 'doc' }),
    ).toEqual({
      authorization: 'token',
    });
  });

  it('keeps validation from the first operation when the later one is documentation-only', () => {
    const merged = mergeOperations(
      operation({
        request: {
          header: {
            schema: z.object({ authorization: z.string() }),
            validate: true,
          },
        },
      }),
      operation({
        request: {
          header: {
            schema: z.object({ 'x-doc-only': z.string() }),
            validate: false,
          },
        },
      }),
    );

    expect(
      objectRequestSchema(merged.request, 'header').parse({
        authorization: 'token',
        'x-doc-only': 'doc',
      }),
    ).toEqual({ authorization: 'token', 'x-doc-only': 'doc' });

    const validated = validationSchema(merged.request, 'header');
    expect(validated?.parse({ authorization: 'token' })).toEqual({
      authorization: 'token',
    });
  });

  it('does not validate a target that is documentation-only in both operations', () => {
    const merged = mergeOperations(
      operation({
        request: {
          header: {
            schema: z.object({ first: z.string() }),
            validate: false,
          },
        },
      }),
      operation({
        request: {
          header: {
            schema: z.object({ second: z.string() }),
            validate: false,
          },
        },
      }),
    );

    const target = merged.request?.header;
    expect(target).toMatchObject({ validate: false });
    expect(validationSchema(merged.request, 'header')).toBeUndefined();
  });

  it('keeps a request target declared by only one operation', () => {
    const header = z.object({ authorization: z.string() });
    const merged = mergeOperations(
      operation({ request: { header } }),
      operation(),
    );

    expect(objectRequestSchema(merged.request, 'header')).toBe(header);
    expect(merged.request?.json).toBeUndefined();
  });

  it('keeps the later request when the earlier operation has none', () => {
    const json = z.object({ name: z.string() });
    const merged = mergeOperations(
      operation(),
      operation({ request: { json } }),
    );

    expect(objectRequestSchema(merged.request, 'json')).toBe(json);
  });
});
