# API Reference

## `createOpenApiDocument`

```ts
function createOpenApiDocument<
  E extends Env,
  S extends Schema,
  P extends string,
>(
  router: Hono<E, S, P>,
  document: HonoOpenApiDocument,
  { addRoute = true, routeName = '/doc' }: DocumentRouteSettings = {},
): ReturnType<typeof createDocument>;
```

Call this function after you define your Hono app to generate the OpenAPI document and host it under `/doc` route by default. The `info` field in the second argument is required by the OpenAPI specification. You can pass any other fields available in the OpenAPI specification, e.g. `servers`, `security` or `components`.

### Examples

Typical usage:

```ts
createOpenApiDocument(app, {
  info: {
    title: 'Example API',
    version: '1.0.0',
  },
});
```

Custom route name:

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

Get the document as an object without adding a route:

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

## `openApi`

```ts
function openApi<
  Req extends HonoOpenApiRequestSchemas,
  P extends string,
  Res extends HonoOpenApiResponses,
>(
  operation: HonoOpenApiOperation<Req, Res>,
): MiddlewareHandler<HonoOpenApiMiddlewareEnv<Res>, P, Values<Req>>;
```

A Hono middleware used to document a given endpoint. See the [Usage](/usage) page for detailed examples of the `request` and `responses` fields.

## `defineOpenApiOperation`

```ts
function defineOpenApiOperation<
  Req extends HonoOpenApiRequestSchemas,
  Res extends HonoOpenApiResponses,
>(operation: HonoOpenApiOperation<Req, Res>): HonoOpenApiOperation<Req, Res>;
```

A no-op function, used to ensure proper validator's type inference and provide autocomplete in cases where you don't want to define the spec inline.

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
                "type": "object",
                "additionalProperties": false
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
                  "type": "object",
                  "additionalProperties": false
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
                  "type": "object",
                  "additionalProperties": false
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
                  "type": "object",
                  "additionalProperties": false
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
                  "type": "object",
                  "additionalProperties": false
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

## `createOpenApiMiddleware`

```ts
function createOpenApiMiddleware(
  zodValidator: ZodValidatorFn = zValidator,
): HonoOpenApiMiddleware;
```

Used internally to create the `openApi` instance. You can use it if you need custom error handling on the middleware level. See the [Custom Error Handling](/recipes#custom-error-handling) recipe for a full example.
