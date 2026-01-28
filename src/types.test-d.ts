import { expectTypeOf, it } from 'vitest';
import type { HonoOpenApiResponses, ResponseSchemas } from './types.ts';
import * as z from 'zod';

it('ResponseSchemas', () => {
  const responseSchemas = {
    200: z.object({ name: z.string() }),
    202: {
      description: 'Result is accepted',
      schema: z
        .object({ name: z.string() })
        .meta({ example: { name: 'John' } }),
    },
    400: {
      schema: z.object({ error: z.string() }),
    },
    401: {
      description: 'Unauthorized',
      content: {
        'application/json': {
          schema: z.object({ message: z.string() }),
        },
      },
    },
  } satisfies HonoOpenApiResponses;

  type Schemas = ResponseSchemas<typeof responseSchemas>;
  expectTypeOf<Schemas>().toEqualTypeOf<{
    200: (typeof responseSchemas)[200];
    202: (typeof responseSchemas)[202]['schema'];
    400: (typeof responseSchemas)[400]['schema'];
    401: (typeof responseSchemas)[401]['content']['application/json']['schema'];
  }>();
});
