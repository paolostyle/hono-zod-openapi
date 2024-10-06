# hono-zod-openapi

Alternative Hono middleware for creating OpenAPI documentation from Zod schemas

## Installation

```
npm install hono-zod-openapi hono zod
```

## Why?

Hono provides a 3rd-party middleware in their [middleware](https://github.com/honojs/middleware/tree/main/packages/zod-openapi) monorepo,
which probably works alright, however my issue with this package is that it forces you to write your code
in a different manner than you normally would in Hono. Refactoring the app becomes a significant hassle.

This library provides an `openApi` middleware instead, which you can easily add to your existing codebase, and a `createOpenApiDocument` function,
which will generate an OpenAPI-compliant JSON document and serve it under `/doc` route of your app (it's configurable, don't worry).

## Features

- Super simple usage - just add a middleware and that's it!
- Ability to generate OpenAPI docs both using simple, almost exclusively Zod schema-based notation, or with regular OpenAPI spec
- Request validation - same functionality as `@hono/zod-validator` (we're using it as a dependency)

## Stability

⚠ Warning: This library is still at the early stages although I would consider the documented API rather stable since version 0.2.0.
In any case, please be aware that until I release v1.0.0 there might still be some breaking changes between minor versions.

## Usage

This library is based on [`zod-openapi`](https://github.com/samchungy/zod-openapi) library (not the same one as the official package).

### Extending Zod

`zod-openapi` provides an extension to Zod, which adds [a new `.openapi()` method](https://github.com/samchungy/zod-openapi/tree/master?tab=readme-ov-file#openapi).
`hono-zod-openapi` reexports the `extendZodWithOpenApi` method. Call it ideally somewhere in your entry point (e.g. in a file with your main Hono router).

```ts
import { z } from 'zod';
import { extendZodWithOpenApi } from 'hono-zod-openapi';

extendZodWithOpenApi(z);

z.string().openapi({ description: 'hello world!', example: 'hello world' });
```

This is not strictly necessary, but it allows you to add additional information that cannot be represented by just using Zod,
or [registering OpenAPI components](https://github.com/samchungy/zod-openapi/tree/master?tab=readme-ov-file#auto-registering-schema).

### Middleware

`hono-zod-openapi` provides a middleware which you can attach to any endpoint.
It accepts a single argument, an object that is mostly the same as the [OpenAPI Operation Object](https://swagger.io/specification/#operation-object).
There are 2 main differences:

- a `request` field, which functions essentially like a condensed version of `@hono/zod-validator`.
  For example, `{ json: z.object() }` is equivalent to `zValidator('json', z.object())`. Passing multiple attributes to the object is equivalent to
  calling multiple `zValidator`s.
  At the same time, **it will translate the validation schemas to OpenAPI notation**.
  There is no need to use `parameters` and `requestBody` fields at all (but it is still possible).

- enhanced `responses` field which has essentially 4 variants:

  - Passing a Zod schema directly. For simple APIs this is more than enough. `description` field
    will be equal to the full HTTP status code (e.g. `200 OK` or `500 Internal Server Error`) and
    media type will be inferred based on the passed schema, though it is pretty simple now - for
    `z.string()` it will be `text/plain`, otherwise it's `application/json`.

    Example:

    ```ts
    openApi({
      responses: {
        200: z
          .object({ wow: z.string() })
          .openapi({ example: { wow: 'this is cool!' } }),
      },
    });
    ```

    <details>
    <summary>This will be equivalent to this OpenAPI spec:</summary>

    ```json
    {
      "responses": {
        "200": {
          "description": "200 OK",
          "content": {
            "application/json": {
              "schema": {
                "example": {
                  "wow": "this is cool!"
                },
                "properties": {
                  "wow": {
                    "type": "string"
                  }
                },
                "required": ["wow"],
                "type": "object"
              }
            }
          }
        }
      }
    }
    ```

    </details>

  - "Library notation" - a simplified, flattened format, similar to the official OpenAPI spec,
    but reduces annoying nesting. Convenient form if you want a custom description or need to pass
    extra data.

    Example:

    ```ts
    openApi({
      responses: {
        200: {
          // the only required field! Use .openapi() method on the schema to add metadata
          schema: z.string().openapi({
            description: 'HTML code',
            example: '<html><body>hi!</body></html>',
          }),
          // description is optional, as opposed to OpenAPI spec
          description: 'My description',
          // mediaType is optional, it's `text/plain` if schema is z.string()
          // otherwise it's `application/json`, in other scenarios it should be specified
          mediaType: 'text/html',
          // headers field is also optional, but you can also use Zod schema here
          headers: z.object({ 'x-custom': z.string() }),
          // ...you can also pass all the other fields you normally would here in OpenAPI spec
        },
      },
    });
    ```

    <details>
    <summary>This will be equivalent to this OpenAPI spec:</summary>

    ```json
    {
      "responses": {
        "200": {
          "content": {
            "text/html": {
              "schema": {
                "description": "HTML code",
                "example": "<html><body>hi!</body></html>",
                "type": "string"
              }
            }
          },
          "description": "My description",
          "headers": {
            "x-custom": {
              "required": true,
              "schema": {
                "type": "string"
              }
            }
          }
        }
      }
    }
    ```

    </details>

  - `zod-openapi` notation. Mostly useful when you need to have `content` in multiple formats,
    or you just want to be as close as possible to the official spec.

    Example:

    ```ts
    openApi({
      responses: {
        200: {
          // required
          description: 'Success response',
          content: {
            'application/json': {
              schema: z.object({ welcome: z.string() }),
            },
          },
          // ...you can also pass all the other fields you normally would here in OpenAPI spec
        },
      },
    });
    ```

    <details>
    <summary>This will be equivalent to this OpenAPI spec:</summary>

    ```json
    {
      "responses": {
        "200": {
          "content": {
            "application/json": {
              "schema": {
                "properties": {
                  "welcome": {
                    "type": "string"
                  }
                },
                "required": ["welcome"],
                "type": "object"
              }
            }
          },
          "description": "Success response"
        }
      }
    }
    ```

    </details>

  - Classic OpenAPI spec notation: just [refer to the official spec](https://swagger.io/specification/#responses-object). Not recommended but it also just works.

Since the object can get pretty large, you can use `defineOpenApiOperation` function to get
the autocomplete in the IDE.

Simple example:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { createOpenApi, openApi } from 'hono-zod-openapi';

export const app = new Hono().get(
  '/user',
  openApi({
    tags: ['User'],
    responses: {
      200: z.object({ hi: z.string() }).openapi({ example: { hi: 'user' } }),
    },
    request: {
      query: z.object({ id: z.string() }),
    },
  }),
  (c) => {
    // works identically to @hono/zod-validator
    const { id } = c.req.valid('query');
    return c.json({ hi: id }, 200);
  },
);

// this will add a `GET /doc` route to the `app` router
createOpenApiDocument(app, {
  info: {
    title: 'Example API',
    version: '1.0.0',
  },
});
```

<details>
<summary>Calling GET /doc will result in this response:</summary>

```json
{
  "info": {
    "title": "Example API",
    "version": "1.0.0"
  },
  "openapi": "3.1.0",
  "paths": {
    "/user": {
      "get": {
        "tags": ["User"],
        "parameters": [
          {
            "in": "query",
            "name": "id",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "responses": {
          "200": {
            "content": {
              "application/json": {
                "schema": {
                  "example": {
                    "hi": "user"
                  },
                  "properties": {
                    "hi": {
                      "type": "string"
                    }
                  },
                  "required": ["hi"],
                  "type": "object"
                }
              }
            },
            "description": "200 OK"
          }
        }
      }
    }
  }
}
```

</details>

## API

### `createOpenApiDocument`

```ts
function createOpenApiDocument(
  router: Hono,
  document: Omit<ZodOpenApiObject, 'openapi'>,
  { addRoute = true, routeName = '/doc' }: Settings = {},
): ReturnType<typeof createDocument>;
```

Call this function after you defined your Hono app to generate the OpenAPI document and host it under `/doc` route by default. `info` field in the second argument is required by the OpenAPI specification. You can pass there also any other fields available in the OpenAPI specification, e.g. `servers`, `security` or `components`.

Examples:

- typical usage:

  ```ts
  createOpenApiDocument(app, {
    info: {
      title: 'Example API',
      version: '1.0.0',
    },
  });
  ```

- add the route under /openApi route:

  ```ts
  createOpenApiDocument(
    app,
    {
      info: {
        title: 'Example API',
        version: '1.0.0',
      },
    },
    { routeName: '/openApi' },
  );
  ```

- don't add the route, just get the OpenAPI document as an object
  ```ts
  const openApiDoc = createOpenApiDocument(
    app,
    {
      info: {
        title: 'Example API',
        version: '1.0.0',
      },
    },
    { addRoute: false },
  );
  ```

### `openApi`

```ts
function openApi<Req extends RequestSchemas, E extends Env, P extends string>(
  operation: Operation<Req>,
): MiddlewareHandler<E, P, Values<Req>>;
```

A Hono middleware used to document a given endpoint. Refer to the [Middleware](#middleware) section above to see the usage examples.

### `defineOpenApiOperation`

A no-op function, used to ensure proper validator's type inference and provide autocomplete in cases where you don't want to define the spec inline.

Example:

```ts
const operation = defineOpenApiOperation({
  responses: {
    200: z.object({ name: z.string() }),
  },
  request: {
    json: z.object({ email: z.string() }),
  },
});

const app = new Hono().post('/user', openApi(operation), async (c) => {
  const { name } = c.req.valid('json');

  return c.json({ name }, 200);
});
```
