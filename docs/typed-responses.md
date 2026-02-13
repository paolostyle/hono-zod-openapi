# Typed Responses

`hono-zod-openapi` provides a type-safe response helper via `c.var.res` that ensures your handler responses match the schemas defined in your OpenAPI operation. It provides compile-time type checking and runtime validation.

## Basic Usage

When you define `responses` in your `openApi` middleware, a `res` function becomes available on `c.var`. It validates that the status code you use is defined in your operation and infers the correct payload type.

```ts
import { Hono } from 'hono';
import * as z from 'zod';
import { openApi } from 'hono-zod-openapi';

const app = new Hono().get(
  '/user',
  openApi({
    responses: {
      200: z.object({ name: z.string() }),
      201: z.object({ created: z.boolean() }),
    },
  }),
  (c) => {
    return c.var.res(200, { name: 'John' });
  },
);
```

## Call Signatures

The `res` helper supports multiple call signatures:

### With Explicit Status

```ts
c.var.res(200, { name: 'John' });
c.var.res(201, { created: true });
```

### Shorthand (Defaults to 200)

If you have a `200` response defined, you can omit the status code:

```ts
c.var.res({ name: 'John' });
```

### With Response Headers

You can pass headers as the last argument:

```ts
// with explicit status
c.var.res(201, { id: 1 }, { 'x-request-id': 'abc123' });

// shorthand with headers
c.var.res({ name: 'John' }, { 'x-custom': 'value' });
```

## Content-Type Inference

When no explicit `mediaType` is provided in the response definition, the content type is automatically inferred from your Zod schema:

| Schema Type                                   | Content-Type       |
| --------------------------------------------- | ------------------ |
| `z.object()`, `z.array()`, `z.number()`, etc. | `application/json` |
| `z.string()`                                  | `text/plain`       |
| `z.void()`, `z.null()`, `z.undefined()`       | No content         |

### JSON Response

```ts
(openApi({
  responses: {
    200: z.object({ name: z.string() }),
  },
}),
  (c) => c.var.res(200, { name: 'John' }));
```

### Text Response

```ts
(openApi({
  responses: {
    200: z.string(),
  },
}),
  (c) => c.var.res(200, 'Hello World'));
```

### HTML Response

Use the library notation with a custom `mediaType`:

```ts
(openApi({
  responses: {
    200: { schema: z.string(), mediaType: 'text/html' },
  },
}),
  (c) => c.var.res(200, '<h1>Hello</h1>'));
```

### No Content (204)

```ts
(openApi({
  responses: {
    204: { description: 'No content' },
  },
}),
  (c) => c.var.res(204, null));
```

## Type Safety

The `res` helper catches errors at compile time:

### Wrong Payload Type

```ts
(openApi({
  responses: {
    200: z.object({ name: z.string() }),
  },
}),
  (c) => {
    // @ts-expect-error - payload doesn't match the 200 schema
    return c.var.res(200, { wrong: 'field' });
  });
```

### Undefined Status Code

```ts
(openApi({
  responses: {
    200: z.object({ name: z.string() }),
  },
}),
  (c) => {
    // @ts-expect-error - 404 is not defined in responses
    return c.var.res(404, { error: 'not found' });
  });
```

## Runtime Validation

We do not currently support runtime validation. However, there are some
sanity checks in place that _will_ affect runtime:

- **Invalid status code** (e.g. `999`) - throws `"Invalid status code: 999. Must be a valid HTTP status code."`
- **Undefined response schema** (e.g. using `404` when only `200` is defined) - throws `"Response schema for status 404 not defined in OpenAPI operation."`. If, for some reason, you need to handle this scenario, fall back to using `c.json()`.
