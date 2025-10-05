# hono-zod-openapi

[![NPM Version](https://img.shields.io/npm/v/hono-zod-openapi)](https://npmjs.com/package/hono-zod-openapi)
[![JSR Version](https://img.shields.io/jsr/v/%40paolostyle/hono-zod-openapi)](https://jsr.io/@paolostyle/hono-zod-openapi)

Alternative Hono middleware for creating OpenAPI documentation from Zod schemas

## Installation

```
npm install hono-zod-openapi hono zod
```

Or, if you prefer JSR:

```
jsr add @paolostyle/hono-zod-openapi
```

## Why?

Hono provides a 3rd-party middleware in their
[middleware](https://github.com/honojs/middleware/tree/main/packages/zod-openapi)
monorepo, which probably works alright, however my issue with this package is
that it forces you to write your code in a different manner than you normally
would in Hono. Refactoring the app becomes a significant hassle.

This library provides an `openApi` middleware instead, which you can easily add
to your existing codebase, and a `createOpenApiDocument` function, which will
generate an OpenAPI-compliant JSON document and serve it under `/doc` route of
your app (it's configurable, don't worry).

## Features

- Super simple usage - just add a middleware and that's it!
- Ability to generate OpenAPI docs both using simple, almost exclusively Zod
  schema-based notation, or with regular OpenAPI spec
- Request validation - same functionality as `@hono/zod-validator` (we're using
  it as a dependency)
- Fully compatible with Zod v4 (if you're still on Zod v3, please use v0.5.0)

## Usage

This library is based on
[`zod-openapi`](https://github.com/samchungy/zod-openapi) library (not the same
one as the official package).

### Middleware

`hono-zod-openapi` provides a middleware which you can attach to any endpoint.
It accepts a single argument, an object that is mostly the same as the
[OpenAPI Operation Object](https://swagger.io/specification/#operation-object).
There are 2 main differences:

- a `request` field, which functions essentially like a condensed version of
  `@hono/zod-validator`. For example, `{ json: z.object() }` is equivalent to
  `zValidator('json', z.object())`. Passing multiple attributes to the object is
  equivalent to calling multiple `zValidator`s. At the same time, **it will
  translate the validation schemas to OpenAPI notation**. There is no need to
  use `parameters` and `requestBody` fields at all (but it is still possible).

- enhanced `responses` field which has essentially 4 variants:

  - Passing a Zod schema directly. For simple APIs this is more than enough.
    `description` field will be equal to the full HTTP status code (e.g.
    `200 OK` or `500 Internal Server Error`) and media type will be inferred
    based on the passed schema, though it is pretty simple now - for
    `z.string()` it will be `text/plain`, otherwise it's `application/json`.

    Example:

    ```ts
    openApi({
      responses: {
        200: z
          .object({ wow: z.string() })
          .meta({ example: { wow: 'this is cool!' } }),
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

  - "Library notation" - a simplified, flattened format, similar to the official
    OpenAPI spec, but reduces annoying nesting. Convenient form if you want a
    custom description or need to pass extra data.

    Example:

    ```ts
    openApi({
      responses: {
        200: {
          // the only required field! Use .meta() method on the schema to add metadata
          schema: z.string().meta({
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

  - `zod-openapi` notation. Mostly useful when you need to have `content` in
    multiple formats, or you just want to be as close as possible to the
    official spec.

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

  - Classic OpenAPI spec notation: just
    [refer to the official spec](https://swagger.io/specification/#responses-object).
    Not recommended but it also just works.

Since the object can get pretty large, you can use `defineOpenApiOperation`
function to get the autocomplete in the IDE.

Simple example:

```ts
import { Hono } from 'hono';
import * as z from 'zod';
import { createOpenApiDocument, openApi } from 'hono-zod-openapi';

export const app = new Hono().get(
  '/user',
  openApi({
    tags: ['User'],
    responses: {
      200: z.object({ hi: z.string() }).meta({ example: { hi: 'user' } }),
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

## Recipes

### Authentication

Generally you just need to follow one of the Authentication guides
[here](https://swagger.io/docs/specification/v3_0/authentication/), depending on
the type of authentication you're using.

Bearer Auth example:

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

### Reusing common fields

Adding the same fields to various routes over an over can be a bit tedious. You
can create your own typesafe wrapper, which will provide the fields shared by
multiple endpoints. For example, if a lot of your endpoints require a `security`
field and a `tag`, you can create a function like this:

```ts
const taggedAuthRoute = <T extends HonoOpenApiRequestSchemas>(
  doc: HonoOpenApiOperation<T>,
) => {
  return defineOpenApiOperation({
    ...doc,
    tags: ['MyTag'],
    security: [{ apiKey: [] }],
  });
};
```

and use it with `openApi` middleware:

```ts
openApi(
  taggedAuthRoute({
    request: {
      json: z.object({ field: z.number() }),
    },
  }),
);
```

### Custom error handling

In general, `hono-zod-openapi` stays away from error handling and delegates it
fully to `zod-validator`. `zod-validator`, however, accepts a third argument
`hook`, using which you can intercept the validation result for every usage of
the middleware. There is no direct equivalent for that in `hono-zod-openapi`, as
in my experience it made more sense to create a custom middleware that wraps
`zod-validator` and handles the errors in a unified way. That approach **is**
supported. You can create your own `openApi` middleware using
`createOpenApiMiddleware` - it's used internally to create `openApi` exported by
the library.

Example using an excellent `zod-validation-error` library that translates
`ZodError`s into user friendly strings:

```ts
import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createOpenApiMiddleware } from 'hono-zod-openapi';
import { fromZodError } from 'zod-validation-error';
import * as z from 'zod';

const zodValidator = <S extends z.ZodType, T extends keyof ValidationTargets>(
  target: T,
  schema: S,
) =>
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
  });

// works exactly the same way as `openApi` exported by `hono-zod-openapi`
export const openApi = createOpenApiMiddleware(zodValidator);
```

If there is a need for handling errors on a case-by-case basis - create an issue
and let's try to find a sensible solution for that!

## API

### `createOpenApiDocument`

```ts
function createOpenApiDocument(
  router: Hono,
  document: Omit<ZodOpenApiObject, 'openapi'>,
  { addRoute = true, routeName = '/doc' }: Settings = {},
): ReturnType<typeof createDocument>;
```

Call this function after you defined your Hono app to generate the OpenAPI
document and host it under `/doc` route by default. `info` field in the second
argument is required by the OpenAPI specification. You can pass there also any
other fields available in the OpenAPI specification, e.g. `servers`, `security`
or `components`.

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

A Hono middleware used to document a given endpoint. Refer to the
[Middleware](#middleware) section above to see the usage examples.

### `defineOpenApiOperation`

A no-op function, used to ensure proper validator's type inference and provide
autocomplete in cases where you don't want to define the spec inline.

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

<details>
<summary>This will result in this JSON document:</summary>

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
        "parameters": [
          {
            "in": "cookie",
            "name": "session",
            "required": true,
            "schema": {
              "type": "string"
            }
          }
        ],
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "properties": {
                  "email": {
                    "type": "string"
                  }
                },
                "required": ["email"],
                "type": "object"
              }
            }
          }
        },
        "responses": {
          "200": {
            "content": {
              "application/json": {
                "schema": {
                  "properties": {
                    "name": {
                      "type": "string"
                    }
                  },
                  "required": ["name"],
                  "type": "object"
                }
              }
            },
            "description": "200 OK"
          },
          "400": {
            "content": {
              "application/xml": {
                "schema": {
                  "properties": {
                    "message": {
                      "type": "string"
                    }
                  },
                  "required": ["message"],
                  "type": "object"
                }
              }
            },
            "description": "Custom description"
          },
          "401": {
            "content": {
              "application/json": {
                "schema": {
                  "properties": {
                    "message": {
                      "type": "string"
                    }
                  },
                  "required": ["message"],
                  "type": "object"
                }
              }
            },
            "description": "Required description"
          },
          "404": {
            "content": {
              "application/json": {
                "schema": {
                  "properties": {
                    "message": {
                      "type": "string"
                    }
                  },
                  "required": ["message"],
                  "type": "object"
                }
              }
            },
            "description": "Not found"
          }
        },
        "tags": ["User"]
      }
    }
  }
}
```

</details>

### `createOpenApiMiddleware`

```ts
export function createOpenApiMiddleware(
  zodValidator: ZodValidatorFn = zValidator,
): HonoOpenApiMiddleware;
```

Used internally to create `openApi` instance. You can use it if you need custom
error handling on the middleware level.

## Runtime compatibility

While this package _should_ work in Bun, Deno, Cloudflare Workers and browsers
(as I'm not using any platform specific APIs and I do not plan to), the codebase
is currently tested against Node.js 20.x, 22.x and 24.x. I haven't found any
tools that would help with cross-platform testing that wouldn't incur
significant maintenance burden.

For now I managed to successfully run the tests with Bun test runner with some
grepping and used the lib in Cloudflare Workers and everything seemed to work
fine. If you are using the library in non-Node runtime and encountered some
bugs, please consider creating an issue.

## Contributing

### Local setup

Run the following set of commands to set up the project. Corepack is required to
install the correct version of PNPM.

```sh
corepack enable
corepack install
pnpm i
```

Now you can run `pnpm test` to continuously run tests while developing.

### Commit naming conventions

At the moment of writing this, we don't have an automated setup for
[conventional commits](https://www.conventionalcommits.org/en/v1.0.0/) as none
of the tooling I tried was really meeting my expectations, but Release Please,
which takes care of the automated release process is using them to identify the
need for releasing a new version. For now please try to do this manually
(including in PR names), but automating this process would be great.
