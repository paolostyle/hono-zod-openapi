import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { normalizeResponse } from './normalizeResponse';
import type { HonoOpenApiResponseObject } from './types';

describe('normalize response', () => {
  beforeEach(() => {
    const warnCopy = console.warn;
    console.warn = vi.fn();

    return () => {
      console.warn = warnCopy;
    };
  });

  it('returns self when passed reference object', () => {
    const refObject = { $ref: '#/components/schemas/SomeSchema' };

    expect(normalizeResponse(refObject, 200, 'GET /somePath')).toEqual(
      refObject,
    );
  });

  it('returns self when passed zod-openapi response object', () => {
    const zodOpenApiResponseObject = {
      description: '200 OK',
      content: {
        'application/json': {
          schema: z.object({
            id: z.number(),
            name: z.string(),
          }),
        },
      },
    };

    expect(
      normalizeResponse(zodOpenApiResponseObject, 200, 'GET /somePath'),
    ).toEqual(zodOpenApiResponseObject);
  });

  it('returns self when passed plain OpenAPI response object', () => {
    const openApiResponseObject = {
      description: '200 OK',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
            },
          },
        },
      },
    } as const;

    expect(
      normalizeResponse(openApiResponseObject, 200, 'GET /somePath'),
    ).toEqual(openApiResponseObject);
  });

  describe('for zod schema', () => {
    it('normalizes object schema to application/json', () => {
      const objectSchema = z.object({
        id: z.number(),
        name: z.string(),
      });

      expect(normalizeResponse(objectSchema, 200, 'GET /somePath')).toEqual({
        description: '200 OK',
        content: {
          'application/json': {
            schema: objectSchema,
          },
        },
      });
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('normalizes array schema to application/json', () => {
      const arraySchema = z.array(z.string());

      expect(normalizeResponse(arraySchema, 200, 'GET /somePath')).toEqual({
        description: '200 OK',
        content: {
          'application/json': {
            schema: arraySchema,
          },
        },
      });
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('normalizes string schema to text/plain and warns about no explicit mediaType', () => {
      const stringSchema = z.string();

      expect(normalizeResponse(stringSchema, 200, 'GET /somePath')).toEqual({
        description: '200 OK',
        content: {
          'text/plain': {
            schema: stringSchema,
          },
        },
      });
      expect(console.warn).toHaveBeenCalledWith(
        `Your schema for GET /somePath is not an object or array, it's recommended to provide an explicit mediaType.`,
      );
    });

    it('warns about no explicit mediaType for non-object and non-array schema but still defaults to application/json', () => {
      const numberSchema = z.number();

      expect(normalizeResponse(numberSchema, 200, 'GET /somePath')).toEqual({
        description: '200 OK',
        content: {
          'application/json': {
            schema: numberSchema,
          },
        },
      });
      expect(console.warn).toHaveBeenCalledWith(
        `Your schema for GET /somePath is not an object or array, it's recommended to provide an explicit mediaType.`,
      );
    });
  });

  describe('for custom notation', () => {
    it('normalizes zod object schema to application/json', () => {
      const objectSchema: HonoOpenApiResponseObject = {
        schema: z.object({
          id: z.number(),
          name: z.string(),
        }),
      };

      expect(normalizeResponse(objectSchema, 200, 'GET /somePath')).toEqual({
        description: '200 OK',
        content: {
          'application/json': {
            schema: objectSchema.schema,
          },
        },
      });
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('normalizes zod array schema to application/json', () => {
      const arraySchema: HonoOpenApiResponseObject = {
        schema: z.array(z.string()),
      };

      expect(normalizeResponse(arraySchema, 200, 'GET /somePath')).toEqual({
        description: '200 OK',
        content: {
          'application/json': {
            schema: arraySchema.schema,
          },
        },
      });
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('normalizes zod string schema to text/plain and warns about no explicit mediaType', () => {
      const stringSchema: HonoOpenApiResponseObject = {
        schema: z.string(),
      };

      expect(normalizeResponse(stringSchema, 200, 'GET /somePath')).toEqual({
        description: '200 OK',
        content: {
          'text/plain': {
            schema: stringSchema.schema,
          },
        },
      });
      expect(console.warn).toHaveBeenCalledWith(
        `Your schema for GET /somePath is not an object or array, it's recommended to provide an explicit mediaType.`,
      );
    });

    it('normalizes zod string schema to text/html when mediaType is provided without warning', () => {
      const stringSchema: HonoOpenApiResponseObject = {
        schema: z.string(),
        mediaType: 'text/html',
      };

      expect(normalizeResponse(stringSchema, 200, 'GET /somePath')).toEqual({
        description: '200 OK',
        content: {
          'text/html': {
            schema: stringSchema.schema,
          },
        },
      });
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('allows empty schema when description provided', () => {
      const emptySchema: HonoOpenApiResponseObject = {
        description: 'Empty response',
      };

      expect(normalizeResponse(emptySchema, 204, 'GET /somePath')).toEqual(
        emptySchema,
      );
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('properly passes other attributes', () => {
      const responseObj: HonoOpenApiResponseObject = {
        schema: z.object({
          id: z.number(),
          name: z.string(),
        }),
        description: 'Custom description',
        mediaType: 'application/xml', // I don't think this makes sense but just for testing
        headers: z.object({
          'x-custom-header': z.string(),
        }),
        links: {
          'x-custom-link': {
            summary: 'Custom link',
          },
        },
      };

      expect(normalizeResponse(responseObj, 200, 'GET /somePath')).toEqual({
        description: 'Custom description',
        content: {
          'application/xml': {
            schema: responseObj.schema,
          },
        },
        headers: responseObj.headers,
        links: responseObj.links,
      });
    });
  });
});
