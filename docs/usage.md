# Usage

`hono-zod-openapi` provides an `openApi` middleware which you can attach to any endpoint. It accepts a single argument, an object that is mostly the same as the [OpenAPI Operation Object](https://swagger.io/specification/#operation-object). There are 2 main differences: the `request` field and the enhanced `responses` field.

## Request Validation

The `request` field functions essentially like a condensed version of `@hono/zod-validator`. For example, `{ json: z.object() }` is equivalent to `zValidator('json', z.object())`. Passing multiple attributes to the object is equivalent to calling multiple `zValidator`s. At the same time, **it will translate the validation schemas to OpenAPI notation**. There is no need to use `parameters` and `requestBody` fields at all (but it is still possible).

```ts
openApi({
  request: {
    query: z.object({ id: z.string() }),
    json: z.object({ name: z.string() }),
  },
  responses: {
    200: z.object({ ok: z.boolean() }),
  },
});
```

## Response Notation

The `responses` field has 4 supported variants. You can mix and match them across different status codes.

### Raw Zod Schema

For simple APIs this is more than enough. The `description` field will be equal to the full HTTP status code (e.g. `200 OK` or `500 Internal Server Error`) and media type will be inferred based on the passed schema - for `z.string()` it will be `text/plain`, otherwise it's `application/json`.

```ts
openApi({
  responses: {
    200: z
      .object({ wow: z.string() })
      .meta({ examples: [{ wow: 'this is cool!' }] }),
  },
});
```

<details>
<summary>Equivalent OpenAPI spec:</summary>

```json
{
  "responses": {
    "200": {
      "description": "200 OK",
      "content": {
        "application/json": {
          "schema": {
            "examples": [
              {
                "wow": "this is cool!"
              }
            ],
            "properties": {
              "wow": {
                "type": "string"
              }
            },
            "required": ["wow"],
            "type": "object",
            "additionalProperties": false
          }
        }
      }
    }
  }
}
```

</details>

### Library Notation

A simplified, flattened format, similar to the official OpenAPI spec, but reduces annoying nesting. Convenient form if you want a custom description or need to pass extra data.

```ts
openApi({
  responses: {
    200: {
      // the only required field! Use .meta() method on the schema to add metadata
      schema: z.string().meta({
        description: 'HTML code',
        examples: ['<html><body>hi!</body></html>'],
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
<summary>Equivalent OpenAPI spec:</summary>

```json
{
  "responses": {
    "200": {
      "content": {
        "text/html": {
          "schema": {
            "description": "HTML code",
            "examples": ["<html><body>hi!</body></html>"],
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

### `zod-openapi` Notation

Mostly useful when you need to have `content` in multiple formats, or you just want to be as close as possible to the official spec.

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
<summary>Equivalent OpenAPI spec:</summary>

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
            "type": "object",
            "additionalProperties": false
          }
        }
      },
      "description": "Success response"
    }
  }
}
```

</details>

### Classic OpenAPI Spec

You can also use the standard [OpenAPI Responses Object](https://swagger.io/specification/#responses-object) notation directly. Not recommended but it also just works.

## Using `defineOpenApiOperation`

Since the operation object can get pretty large, you can use the `defineOpenApiOperation` function to get autocomplete in the IDE:

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
