import * as z from 'zod';
import type { ZodOpenApiResponseObject } from 'zod-openapi';
import { statusCodes } from './statusCodes.ts';
import type {
  HonoOpenApiResponseObject,
  ReferenceObject,
  StatusCodeWithWildcards,
} from './types.ts';

const inferredMediaType = (schema: z.ZodType): string =>
  schema instanceof z.ZodString ? 'text/plain' : 'application/json';

const warnIfMediaTypeIsAmbiguous = (schema: z.ZodType, path: string): void => {
  if (schema instanceof z.ZodObject || schema instanceof z.ZodArray) return;

  console.warn(
    `Your schema for ${path} is not an object or array, it's recommended to provide an explicit mediaType.`,
  );
};

export const normalizeResponse = (
  res: HonoOpenApiResponseObject,
  status: StatusCodeWithWildcards,
  path: string,
): ZodOpenApiResponseObject | ReferenceObject => {
  if (res instanceof z.ZodType) {
    const contentType = inferredMediaType(res);
    warnIfMediaTypeIsAmbiguous(res, path);

    return {
      description: statusCodes[status],
      content: {
        [contentType]: {
          schema: res,
        },
      },
    };
  }

  if ('schema' in res) {
    const { schema, description, mediaType, ...rest } = res;
    const contentType = mediaType ?? inferredMediaType(schema);
    if (!mediaType) warnIfMediaTypeIsAmbiguous(schema, path);

    return {
      description: description ?? statusCodes[status],
      content: {
        [contentType]: { schema },
      },
      ...rest,
    };
  }

  return res;
};
