import * as z from 'zod';
import { createSchema } from 'zod-openapi';
import type {
  HonoOpenApiOperation,
  HonoOpenApiRequestSchemas,
  HonoOpenApiResponses,
} from './types.ts';

/**
 * Runtime counterpart of the static `OpenApiShapeConflicts` check.
 *
 * The static check can only compare declarations that pass through a single
 * `openApi()` call. Middleware composed as separate chain entries are accepted
 * by Hono's variadic registration independently, so a conflicting schema pair
 * can only be detected when the document is built. This module performs the
 * same comparison on the collected shapes of a route chain and reports the
 * conflicting keys so `createOpenApiDocument` can fail fast instead of
 * letting the last declaration silently win.
 */

export interface OpenApiRuntimeConflict {
  kind: 'request' | 'responses';
  key: string;
}

/** Metadata does not affect validation; validation constraints do. */
const REFERENCE_ONLY_KEYS = new Set([
  'description',
  'example',
  'examples',
  'title',
]);

/**
 * Schemas whose validated output is not a concrete shape (e.g. `z.any()`) are
 * not comparable — same as the static check, they never conflict.
 */
const isConcreteSchema = (schema: z.ZodType): boolean =>
  !(
    schema instanceof z.ZodAny ||
    schema instanceof z.ZodNever ||
    schema instanceof z.ZodUnknown
  );

const schemaOfRequestTarget = (value: unknown): z.ZodType | null => {
  if (value instanceof z.ZodType) {
    return value;
  }

  if (
    value &&
    typeof value === 'object' &&
    'schema' in value &&
    value.schema instanceof z.ZodType
  ) {
    // doc-only targets (`validate: false`) are skipped, like the static check
    if ('validate' in value && value.validate === false) {
      return null;
    }

    return value.schema;
  }

  return null;
};

/**
 * Canonicalizes a generated JSON schema so equal validated outputs produce
 * equal results. Property and member order, metadata-only keys and validation
 * refinements are normalized away.
 */
const canonicalize = (node: unknown, key?: string): unknown => {
  if (Array.isArray(node)) {
    const items = node.map((item) => canonicalize(item));
    // member order doesn't change the validated output for these keys
    if (key === 'enum') {
      return (
        items
          .map((item) => JSON.stringify(item))
          // oxlint-disable-next-line unicorn/no-array-sort -- freshly-created array, safe to sort in place
          .sort()
          .map((serialized) => JSON.parse(serialized) as unknown)
      );
    }

    if (key === 'required') {
      // oxlint-disable-next-line unicorn/no-array-sort -- freshly-created array, safe to sort in place
      return (items as string[]).sort();
    }

    return items;
  }

  if (!node || typeof node !== 'object') {
    return node;
  }

  const record = node as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  // oxlint-disable-next-line unicorn/no-array-sort -- freshly-created array, safe to sort in place
  for (const memberKey of Object.keys(record).sort()) {
    if (memberKey.startsWith('x-')) continue;
    if (REFERENCE_ONLY_KEYS.has(memberKey)) continue;
    if (memberKey === '$ref' || memberKey === '$schema' || memberKey === 'id') {
      // generated schemas are inlined (no registry), so $ref reuse of a
      // different registry would be a false conflict; the shared `$ref`s
      // cannot be resolved here — unresolvable, therefore non-conflicting
      return {};
    }

    const value = canonicalize(record[memberKey], memberKey);
    if (value !== undefined) {
      result[memberKey] = value;
    }
  }

  return result;
};

const schemaSignature = (schema: z.ZodType): string =>
  JSON.stringify(canonicalize(createSchema(schema, { io: 'output' }).schema));

const outputsEqual = (first: z.ZodType, second: z.ZodType): boolean =>
  schemaSignature(first) === schemaSignature(second);

const schemasOfResponse = (response: unknown): z.ZodType[] | null => {
  if (response instanceof z.ZodType) return [response];
  if (!response || typeof response !== 'object') return null;

  if ('schema' in response && response.schema instanceof z.ZodType) {
    return [response.schema];
  }

  if (
    'content' in response &&
    response.content &&
    typeof response.content === 'object'
  ) {
    const schemas: z.ZodType[] = [];
    for (const content of Object.values(response.content)) {
      if (
        !content ||
        typeof content !== 'object' ||
        !('schema' in content) ||
        !(content.schema instanceof z.ZodType)
      ) {
        return null;
      }
      schemas.push(content.schema);
    }
    return schemas.length > 0 ? schemas : null;
  }

  return null;
};

const sameResponseSchema = (first: unknown, second: unknown): boolean => {
  const firstSchemas = schemasOfResponse(first);
  const secondSchemas = schemasOfResponse(second);
  if (!firstSchemas || !secondSchemas) {
    const firstRef =
      first && typeof first === 'object' && '$ref' in first
        ? first.$ref
        : undefined;
    const secondRef =
      second && typeof second === 'object' && '$ref' in second
        ? second.$ref
        : undefined;
    return typeof firstRef === 'string' && firstRef === secondRef;
  }
  if (firstSchemas.length !== secondSchemas.length) {
    return false;
  }

  const firstShapes = firstSchemas.map(schemaSignature);
  const secondShapes = secondSchemas.map(schemaSignature);
  // Content member order does not change the response's schema set.
  firstShapes.sort();
  secondShapes.sort();
  return firstShapes.every((shape, index) => shape === secondShapes[index]);
};

const conflictingRequestTargets = (
  first: HonoOpenApiRequestSchemas,
  second: HonoOpenApiRequestSchemas,
): string[] => {
  const conflicts: string[] = [];
  for (const target of Object.keys(first) as Array<
    keyof HonoOpenApiRequestSchemas & string
  >) {
    if (!(target in second)) continue;

    const firstSchema = schemaOfRequestTarget(first[target]);
    const secondSchema = schemaOfRequestTarget(second[target]);

    if (!firstSchema || !secondSchema) continue;
    if (!isConcreteSchema(firstSchema) || !isConcreteSchema(secondSchema)) {
      continue;
    }

    if (
      firstSchema instanceof z.ZodObject &&
      secondSchema instanceof z.ZodObject
    ) {
      for (const property of Object.keys(firstSchema.shape)) {
        if (!(property in secondSchema.shape)) continue;
        const firstProperty = firstSchema.shape[property];
        const secondProperty = secondSchema.shape[property];
        if (
          firstProperty.isOptional() !== secondProperty.isOptional() ||
          !outputsEqual(firstProperty, secondProperty)
        ) {
          conflicts.push(`${target}.${property}`);
        }
      }
      continue;
    }

    if (!outputsEqual(firstSchema, secondSchema)) {
      conflicts.push(target);
    }
  }

  return conflicts;
};

const conflictingResponseKeys = (
  first: HonoOpenApiResponses,
  second: HonoOpenApiResponses,
): string[] => {
  const conflicts: string[] = [];
  for (const status of Object.keys(first) as Array<
    keyof HonoOpenApiResponses & string
  >) {
    if (!(status in second)) continue;
    if (!sameResponseSchema(first[status], second[status])) {
      conflicts.push(status);
    }
  }

  return conflicts;
};

/**
 * Compares the declarations of two `openApi` shapes attached to the same
 * route chain. Returns every target/status key that both declare with
 * schemas that cannot be redeclared (an empty array means compatible).
 */
export const detectOpenApiRuntimeConflicts = (
  first: HonoOpenApiOperation,
  second: HonoOpenApiOperation,
): OpenApiRuntimeConflict[] => {
  const conflicts: OpenApiRuntimeConflict[] = [];

  if (first.request && second.request) {
    for (const target of conflictingRequestTargets(
      first.request,
      second.request,
    )) {
      conflicts.push({ kind: 'request', key: target });
    }
  }

  if (first.responses && second.responses) {
    for (const status of conflictingResponseKeys(
      first.responses,
      second.responses,
    )) {
      conflicts.push({ kind: 'responses', key: status });
    }
  }

  return conflicts;
};

export const describeRuntimeConflict = (
  conflict: OpenApiRuntimeConflict,
): string =>
  conflict.kind === 'request'
    ? `request property '${conflict.key}' has a different schema`
    : `response status '${conflict.key}' has a different schema`;
