import { expectTypeOf, it } from 'vitest';
import type {
  HonoOpenApiResponses,
  OperationInputResponsesInternal,
  ResponseSchemas,
} from './types.ts';
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

it('keeps status keys in the contextual responses type when responses is omitted', () => {
  type EmptyResponses = OperationInputResponsesInternal<
    Record<never, never>,
    Record<never, never>
  >;

  // `openApi()` and `createOpenApiFragment()` default `Res` to
  // `Record<never, never>` when `responses` is omitted. The operation input
  // must still expose the status-key set so IntelliSense can suggest `200`,
  // `2XX`, `default`, etc. instead of falling back to an empty object.
  expectTypeOf<
    200 extends keyof EmptyResponses ? true : false
  >().toEqualTypeOf<true>();
  expectTypeOf<
    '2XX' extends keyof EmptyResponses ? true : false
  >().toEqualTypeOf<true>();
  expectTypeOf<
    'default' extends keyof EmptyResponses ? true : false
  >().toEqualTypeOf<true>();
});
