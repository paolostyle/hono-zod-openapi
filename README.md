# hono-zod-openapi

Alternative Hono middleware for creating OpenAPI documentation from Zod schemas

## Installation

```
# NPM
npm install hono-zod-openapi hono zod

# Yarn
yarn add hono-zod-openapi hono zod

# PNPM
pnpm add hono-zod-openapi hono zod

# Bun
bun add hono-zod-openapi hono zod
```

## Why?

Hono provides a 3rd-party middleware in their [middleware](https://github.com/honojs/middleware/tree/main/packages/zod-openapi) monorepo,
which probably works alright, however my issue with this package is that it forces you to write your code
in a different manner than you normally would in Hono. Refactoring the app becomes a significant hassle.

My library takes a different approach and effectively provides the same value as `@hono/zod-validator` with the bonus of generating the

Another issue is that as a developer I don't really want to deeply understand OpenAPI spec, which is IMHO quite verbose. The library
should do as much heavy lifting as possible, ideally with a less convenient fallback.

That's why I wrote this library, I will try to talk to Hono maintainers and see if they'd be interested in adopting this package into their
middleware, either as another option or perhaps as a new major version of the existing one.
At the moment it's pretty immature but we'll get there.

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

`hono-zod-openapi` provides a middleware which you can attach to any endpoint and it functions similarly to `zValidator`.
The main difference is that you need to also provide a Zod schema for the response type.
At the moment, the response value is **not** processed by Zod, it's only as a documentation.

Simple example:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { createOpenApi, openApi } from 'hono-zod-openapi';

export const app = new Hono().get(
  '/user',
  openApi(
    // response type
    z.object({ hi: z.string() }),
    {
      query: z.object({ id: z.string() }),
    },
  ),
  (c) => {
    const { id } = c.req.valid('query');
    return c.json({ hi: id }, 200);
  },
);

// this will add a `GET /doc` route to the `app` router
createOpenApi(app, {
  title: 'Example API',
  version: '1.0.0',
});
```

Extensive example:

```ts
import { swaggerUI } from '@hono/swagger-ui';
import { Hono } from 'hono';
import { createOpenApi, openApi } from 'hono-zod-openapi';
import { z } from 'zod';

export const subRouter = new Hono().post(
  '/example',
  openApi(
    // response schema, more verbose version
    {
      schema: z.object({ hi: z.string() }),
      description: 'Great Success!',
      status: 200,
    },
    // request validators
    {
      json: z.object({
        day: z.string(),
      }),
    },
  ),
  (c) => {
    // you can still use it the same way as with zValidator
    const { day } = c.req.valid('json');

    return c.json({ hi: `Hello on ${day}` }, 200);
  },
);

export const app = new Hono()
  // it also works with subrouters! don't wrap them in `createOpenApi`, though
  .route('/sub', subRouter)
  .get(
    '/hello',
    openApi(
      // shorthand version - will represent 200 status
      z.object({ hi: z.string() }),
      {
        query: z.object({ id: z.string() }),
        // object form - you can skip validation by passing `validate: false`
        // it will still appear in the OpenAPI document
        header: {
          schema: z.object({ Authorization: z.string() }),
          validate: false,
        },
      },
    ),
    (c) => {
      const { id } = c.req.valid('query');

      // TypeScript would throw errors here because we don't want to validate the headers
      // const { Authorization } = c.req.valid('header');

      return c.json({ hi: id }, 200);
    },
  )
  // you can use
  .get('/docs', swaggerUI({ url: '/doc' }));

const document = createOpenApi(
  app,
  {
    title: 'Example API',
    version: '1.0.0',
  },
  {
    addRoute: false, // pass false here to *not* create the /doc route
    overrides: (paths) => ({
      // add some additional things to the OpenAPI doc
      // you can modify the generated paths object
    }),
  },
);

// manually adding a route with the OpenAPI document
app.get('/doc', (c) => c.json(document, 200));
```
