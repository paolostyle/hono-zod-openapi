import * as z from 'zod';
import type { ZodOpenApiResponseObject } from 'zod-openapi';
import { statusCodes } from './statusCodes.ts';
import type {
  HonoOpenApiResponseObject,
  ReferenceObject,
  StatusCodeWithWildcards,
} from './types.ts';

export const normalizeResponse = (
  res: HonoOpenApiResponseObject,
  status: StatusCodeWithWildcards,
  path: string,
): ZodOpenApiResponseObject | ReferenceObject => {
  if (res instanceof z.ZodType) {
    const contentType =
      res instanceof z.ZodString ? 'text/plain' : 'application/json';

    if (!(res instanceof z.ZodObject) && !(res instanceof z.ZodArray)) {
      console.warn(
        `Your schema for ${path} is not an object or array, it's recommended to provide an explicit mediaType.`,
      );
    }

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
    const contentType =
      mediaType ??
      (schema instanceof z.ZodString ? 'text/plain' : 'application/json');

    if (
      !mediaType &&
      !(schema instanceof z.ZodObject) &&
      !(schema instanceof z.ZodArray)
    ) {
      console.warn(
        `Your schema for ${path} is not an object or array, it's recommended to provide an explicit mediaType.`,
      );
    }

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
