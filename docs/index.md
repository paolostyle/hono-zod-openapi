---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: hono-zod-openapi
  tagline: OpenAPI in Hono made easy
  actions:
    - theme: brand
      text: Getting Started
      link: /getting-started
    - theme: alt
      text: API Reference
      link: /api-reference

features:
  - title: Simple Middleware
    details: Just add the openApi middleware to your routes — no need to restructure your Hono app
  - title: Typed Responses
    details: Type-safe c.var.res helper ensures your responses match your OpenAPI schema at compile time
  - title: Request Validation
    details: Built-in request validation powered by @hono/zod-validator with automatic OpenAPI translation
  - title: Flexible Notation
    details: Describe responses with raw Zod schemas, library notation, zod-openapi notation, or classic OpenAPI spec
---
