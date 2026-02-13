---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: hono-zod-openapi
  text: Type-safe OpenAPI middleware for Hono
  tagline: Just add a middleware - no refactoring needed
  image:
    light:
      src: /code-light.webp
      alt: hono-zod-openapi code example
    dark:
      src: /code-dark.webp
      alt: hono-zod-openapi code example
  actions:
    - theme: brand
      text: Getting Started
      link: /getting-started
    - theme: alt
      text: API Reference
      link: /api-reference

features:
  - title: Simple Middleware
    icon: 🔌
    details: Just add the middleware to your routes - no need to restructure your entire app
  - title: Typed Responses
    icon: 🛡️
    details: Type-safe response helper ensures your responses match your OpenAPI schema at compile time
  - title: Request Validation
    icon: ✅
    details: Built-in request validation powered by @hono/zod-validator with automatic OpenAPI translation
  - title: Less Boilerplate
    icon: ✨
    details: Start with just a Zod schema, use a simplified notation for more detail, or drop down to the full OpenAPI spec when needed
---
