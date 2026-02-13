# hono-zod-openapi

[![NPM Version](https://img.shields.io/npm/v/hono-zod-openapi)](https://npmjs.com/package/hono-zod-openapi)
[![JSR Version](https://img.shields.io/jsr/v/%40paolostyle/hono-zod-openapi)](https://jsr.io/@paolostyle/hono-zod-openapi)

Type-safe OpenAPI middleware for Hono. Just add a middleware - no refactoring needed.

**[See full documentation here](https://hono-zod-openapi.pages.dev)**

## Installation

```
npm install hono-zod-openapi
```

Or, if you prefer JSR:

```
jsr add @paolostyle/hono-zod-openapi
```

## Quick Example

```ts
import { Hono } from 'hono';
import * as z from 'zod';
import { createOpenApiDocument, openApi } from 'hono-zod-openapi';

const app = new Hono().get(
  '/user',
  openApi({
    tags: ['User'],
    responses: {
      200: z.object({ hi: z.string() }),
    },
    request: {
      query: z.object({ id: z.string() }),
    },
  }),
  (c) => {
    const { id } = c.req.valid('query');
    return c.var.res(200, { hi: id });
  },
);

createOpenApiDocument(app, {
  info: {
    title: 'Example API',
    version: '1.0.0',
  },
});
```

## Why This Library?

Hono provides a 3rd-party middleware in their
[middleware monorepo](https://github.com/honojs/middleware/tree/main/packages/zod-openapi),
which probably works alright, however the issue with that package is that it
forces you to write your code in a different manner than you normally would in
Hono. Refactoring the app becomes a significant hassle.

This library provides an `openApi` middleware instead, which you can easily add
to your existing codebase, and a `createOpenApiDocument` function, which will
generate an OpenAPI-compliant JSON document and serve it under `/doc` route of
your app (it's configurable, don't worry).

For detailed usage, recipes, API reference, and more, see the
**[full documentation](https://hono-zod-openapi.pages.dev)**.

## License

MIT
