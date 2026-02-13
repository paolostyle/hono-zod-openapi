# Recipes

## Authentication

Generally you just need to follow one of the Authentication guides [here](https://swagger.io/docs/specification/v3_0/authentication/), depending on the type of authentication you're using.

### Bearer Auth Example

```ts
const app = new Hono().get(
  '/example',
  openApi({
    responses: {
      200: z.object({}),
    },
    security: [{ bearerAuth: [] }],
  }),
  async (c) => {
    return c.json({}, 200);
  },
);

createOpenApiDocument(app, {
  info: {
    title: 'Some API',
    version: '0.0.1',
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
      },
    },
  },
  // if you use bearer auth in every endpoint, you can add
  // this here instead of adding `security` to every route:
  // security: [{ bearerAuth: [] }],
});
```

## Reusing Common Fields

Adding the same fields to various routes over and over can be a bit tedious. You can create your own typesafe wrapper, which will provide the fields shared by multiple endpoints. For example, if a lot of your endpoints require a `security` field and a `tag`, you can create a function like this:

```ts
import { defineOpenApiOperation } from 'hono-zod-openapi';
import type {
  HonoOpenApiOperation,
  HonoOpenApiRequestSchemas,
  HonoOpenApiResponses,
} from 'hono-zod-openapi';

const taggedAuthRoute = <
  Req extends HonoOpenApiRequestSchemas,
  Res extends HonoOpenApiResponses,
>(
  doc: HonoOpenApiOperation<Req, Res>,
) => {
  return defineOpenApiOperation({
    ...doc,
    tags: ['MyTag'],
    security: [{ apiKey: [] }],
  });
};
```

And use it with the `openApi` middleware:

```ts
openApi(
  taggedAuthRoute({
    request: {
      json: z.object({ field: z.number() }),
    },
  }),
);
```

## Custom Error Handling

In general, `hono-zod-openapi` stays away from error handling and delegates it fully to `zod-validator`. `zod-validator`, however, accepts a third argument `hook`, using which you can intercept the validation result for every usage of the middleware. There is no direct equivalent for that in `hono-zod-openapi`, as in my experience it made more sense to create a custom middleware that wraps `zod-validator` and handles the errors in a unified way.

That approach **is** supported. You can create your own `openApi` middleware using `createOpenApiMiddleware` - it's used internally to create the `openApi` exported by the library.

### Example with `zod-validation-error`

Using the excellent [`zod-validation-error`](https://github.com/causaly/zod-validation-error) library that translates `ZodError`s into user-friendly strings:

```ts
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { createOpenApiMiddleware } from 'hono-zod-openapi';
import { fromZodError } from 'zod-validation-error';
import * as z from 'zod';

// works exactly the same way as `openApi` exported by `hono-zod-openapi`
export const openApi = createOpenApiMiddleware((target, schema) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const validationError = fromZodError(result.error, {
        includePath: false,
      });
      // you can handle that in `new Hono().onError()` or just use e.g. `c.json()` directly instead
      throw new HTTPException(400, {
        message: validationError.message,
        cause: validationError,
      });
    }
  }),
);
```

If there is a need for handling errors on a case-by-case basis - create an issue and let's try to find a sensible solution for that!
