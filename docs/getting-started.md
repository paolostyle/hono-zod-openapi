# Getting Started

## Installation

::: code-group

```sh [npm]
npm install hono-zod-openapi
```

```sh [pnpm]
pnpm add hono-zod-openapi
```

```sh [yarn]
yarn add hono-zod-openapi
```

```sh [bun]
bun add hono-zod-openapi
```

```sh [deno]
deno add jsr:@paolostyle/hono-zod-openapi
```

:::

## Quick Example

```ts{7-17}
import { Hono } from 'hono';
import * as z from 'zod';
import { createOpenApiDocument, openApi } from 'hono-zod-openapi';

const app = new Hono().get(
  '/user',
  openApi({
    tags: ['User'],
    responses: {
      200: z
        .object({ hi: z.string() })
        .meta({ examples: [{ hi: 'user' }] }),
    },
    request: {
      query: z.object({ id: z.string() }),
    },
  }),
  (c) => {
    // validates query params against schema in runtime
    const { id } = c.req.valid('query');
    // payload is validated on type level against responses
    return c.var.res(200, { hi: id });
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
                  "examples": [
                    {
                      "hi": "user"
                    }
                  ],
                  "properties": {
                    "hi": {
                      "type": "string"
                    }
                  },
                  "required": ["hi"],
                  "type": "object",
                  "additionalProperties": false
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

## Why This Library?

Hono provides a 3rd-party middleware in their [middleware monorepo](https://github.com/honojs/middleware/tree/main/packages/zod-openapi), which probably works alright, however the issue with that package is that it forces you to write your code in a different manner than you normally would in Hono. Refactoring the app becomes a significant hassle.

This library provides an `openApi` middleware instead, which you can easily add to your existing codebase, and a `createOpenApiDocument` function, which will generate an OpenAPI-compliant JSON document and serve it under `/doc` route of your app (it's configurable, don't worry).

Under the hood, this library is powered by [`zod-openapi`](https://github.com/samchungy/zod-openapi). For advanced features like schema references,discriminated unions, or extending Zod schemas with OpenAPI metadata, refer to the [zod-openapi documentation](https://github.com/samchungy/zod-openapi).

## Features

- **Simple usage** - just add a middleware and that's it!
- **Flexible notation** - generate OpenAPI docs using simple Zod schema-based notation, or with regular OpenAPI spec
- **Request validation** - same functionality as `@hono/zod-validator` (used as a dependency)
- **Typed responses** - type-safe `c.var.res` helper that ensures your responses match your OpenAPI schema
- **Zod v4 compatible** - if you're still on Zod v3, please use v0.5.0
