import * as z from 'zod';
import { RequestValidationSchemaSymbol } from './symbols.ts';
import type {
  HonoOpenApiOperation,
  HonoOpenApiRequestSchemas,
  HonoOpenApiResponses,
} from './types.ts';

const ARRAY_KEYS = [
  'tags',
  'security',
  'parameters',
  'servers',
  'callbacks',
] as const;

type ArrayKey = (typeof ARRAY_KEYS)[number];
type RequestSchema = NonNullable<
  HonoOpenApiRequestSchemas[keyof HonoOpenApiRequestSchemas]
>;

const dedupe = <T>(values: T[]): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
};

const mergeArrays = (a: unknown, b: unknown): unknown => {
  if (!Array.isArray(a)) return b;
  if (!Array.isArray(b)) return a;
  return dedupe([...a, ...b]);
};

const mergeObjects = (a: unknown, b: unknown): Record<string, unknown> => {
  const result: Record<string, unknown> = {
    ...((a && typeof a === 'object' ? a : {}) as Record<string, unknown>),
  };
  for (const [key, value] of Object.entries(
    (b && typeof b === 'object' ? b : {}) as Record<string, unknown>,
  )) {
    // keep the later value unless it is undefined (does not clear the earlier one)
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
};

const mergeResponses = (
  a: HonoOpenApiResponses | undefined,
  b: HonoOpenApiResponses | undefined,
): HonoOpenApiResponses => ({
  ...a,
  ...b,
});

const requestSchema = (request: RequestSchema): z.ZodType =>
  request instanceof z.ZodType ? request : request.schema;

const validationSchemaOf = (request: RequestSchema): z.ZodType | undefined => {
  if (request instanceof z.ZodType) return request;
  if (request.validate === false) return undefined;
  return request[RequestValidationSchemaSymbol] ?? request.schema;
};

const mergeSchemas = (first: z.ZodType, second: z.ZodType): z.ZodType =>
  first instanceof z.ZodObject && second instanceof z.ZodObject
    ? first.extend(second.shape)
    : second;

const mergeOptionalSchemas = (
  first: z.ZodType | undefined,
  second: z.ZodType | undefined,
): z.ZodType | undefined =>
  first && second ? mergeSchemas(first, second) : (first ?? second);

const mergeRequests = (
  a: HonoOpenApiRequestSchemas | undefined,
  b: HonoOpenApiRequestSchemas | undefined,
): HonoOpenApiRequestSchemas => {
  const merged = { ...a, ...b };
  for (const target of Object.keys(a ?? {}) as Array<
    keyof HonoOpenApiRequestSchemas
  >) {
    if (!(target in (b ?? {}))) continue;

    const first = a?.[target];
    const second = b?.[target];
    if (!first || !second) continue;

    const schema = mergeSchemas(requestSchema(first), requestSchema(second));
    const validationSchema = mergeOptionalSchemas(
      validationSchemaOf(first),
      validationSchemaOf(second),
    );

    merged[target] = {
      schema,
      validate: validationSchema !== undefined,
      ...(validationSchema && {
        [RequestValidationSchemaSymbol]: validationSchema,
      }),
    };
  }
  return merged;
};

/**
 * Merges two OpenAPI operation fragments into one.
 *
 * - `responses` merge per status code; conflict checks reject different schemas.
 * - Request object schemas merge per property within each target.
 * - Array keys (`tags`, `security`, `parameters`, `servers`, `callbacks`)
 *   concatenate and dedupe.
 * - Remaining scalar document keys: the second fragment wins.
 */
export function mergeOperations(
  first: HonoOpenApiOperation,
  second: HonoOpenApiOperation,
): HonoOpenApiOperation {
  const merged = mergeObjects(first, second) as unknown as HonoOpenApiOperation;
  merged.responses = mergeResponses(first.responses, second.responses);

  if (first.request || second.request) {
    merged.request =
      first.request && second.request
        ? mergeRequests(first.request, second.request)
        : (first.request ?? second.request);
  }

  for (const key of ARRAY_KEYS) {
    const firstValue = (first as unknown as Record<ArrayKey, unknown>)[key];
    const secondValue = (second as unknown as Record<ArrayKey, unknown>)[key];
    if (!Array.isArray(firstValue) && !Array.isArray(secondValue)) continue;
    (merged as unknown as Record<ArrayKey, unknown>)[key] = mergeArrays(
      firstValue,
      secondValue,
    );
  }

  return merged;
}
