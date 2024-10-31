# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [1.0.0](https://github.com/paolostyle/hono-zod-openapi/compare/hono-zod-openapi-v0.3.1...hono-zod-openapi-v1.0.0) (2024-10-31)


### ⚠ BREAKING CHANGES

* rename `Operation` type to `HonoOpenApiOperation`, export `HonoOpenApiRequestSchemas`
* major rewrite, stabilized public API, decent test coverage

### Features

* configurable routeName, third argument endpointDetails ([0e7d290](https://github.com/paolostyle/hono-zod-openapi/commit/0e7d2905992ed0df2e5ed39e6b231750b9f46c0d))
* export some types that might be useful for users ([5ecd9f8](https://github.com/paolostyle/hono-zod-openapi/commit/5ecd9f81293d99199c39afcc830740ba905a6e45))
* JSR/Deno support ([#5](https://github.com/paolostyle/hono-zod-openapi/issues/5)) ([93316f3](https://github.com/paolostyle/hono-zod-openapi/commit/93316f38e7b23b74e3386227f65cbb682babd220))
* major rewrite, stabilized public API, decent test coverage ([0f19085](https://github.com/paolostyle/hono-zod-openapi/commit/0f190855e2ca46777939b94681fdf91c4f7ff477))
* rename `Operation` type to `HonoOpenApiOperation`, export `HonoOpenApiRequestSchemas` ([e2bdda1](https://github.com/paolostyle/hono-zod-openapi/commit/e2bdda1439c61d106acf2d42a691024f17f3a3ef))
* response validator ([#1](https://github.com/paolostyle/hono-zod-openapi/issues/1)) ([12ed885](https://github.com/paolostyle/hono-zod-openapi/commit/12ed8854f7b351434dc7412e967f6f0632d9fbe1))


### Bug Fixes

* allow Hono instances with different Env type parameter than default ([f77869c](https://github.com/paolostyle/hono-zod-openapi/commit/f77869c4553c8cf64ec81cbea9744d924cd7d435)), closes [#2](https://github.com/paolostyle/hono-zod-openapi/issues/2)

## [0.3.1](https://github.com/paolostyle/hono-zod-openapi/compare/v0.3.0...v0.3.1) (2024-10-22)

### Features

- JSR/Deno support ([#5](https://github.com/paolostyle/hono-zod-openapi/issues/5)) ([93316f3](https://github.com/paolostyle/hono-zod-openapi/commit/93316f38e7b23b74e3386227f65cbb682babd220))

## [0.3.0](https://github.com/paolostyle/hono-zod-openapi/compare/v0.2.1...v0.3.0) (2024-10-11)

### ⚠ BREAKING CHANGES

- rename `Operation` type to `HonoOpenApiOperation` - technically breaking as it was exported, but realistically you wouldn't use it without a good reason.

### Features

- rename `Operation` type to `HonoOpenApiOperation`, export `HonoOpenApiRequestSchemas` ([e2bdda1](https://github.com/paolostyle/hono-zod-openapi/commit/e2bdda1439c61d106acf2d42a691024f17f3a3ef))

## [0.2.1](https://github.com/paolostyle/hono-zod-openapi/compare/v0.2.0...v0.2.1) (2024-10-11)

### Features

- export some types that might be useful for users ([5ecd9f8](https://github.com/paolostyle/hono-zod-openapi/commit/5ecd9f81293d99199c39afcc830740ba905a6e45))

### Bug Fixes

- allow Hono instances with different Env type parameter than default ([f77869c](https://github.com/paolostyle/hono-zod-openapi/commit/f77869c4553c8cf64ec81cbea9744d924cd7d435)), closes [#2](https://github.com/paolostyle/hono-zod-openapi/issues/2)

## [0.2.0](https://github.com/paolostyle/hono-zod-openapi/compare/v0.1.1...v0.2.0) (2024-10-06)

### ⚠ BREAKING CHANGES

- Major rewrite: please adjust your code to the latest version

### Features

- major rewrite, stabilized public API, decent test coverage ([0f19085](https://github.com/paolostyle/hono-zod-openapi/commit/0f190855e2ca46777939b94681fdf91c4f7ff477))
- ~~response validator ([#1](https://github.com/paolostyle/hono-zod-openapi/issues/1)) ([12ed885](https://github.com/paolostyle/hono-zod-openapi/commit/12ed8854f7b351434dc7412e967f6f0632d9fbe1))~~

## [0.1.1](https://github.com/paolostyle/hono-zod-openapi/compare/0e7d2905992ed0df2e5ed39e6b231750b9f46c0d...v0.1.1) (2024-09-19)

### Features

- configurable routeName, third argument endpointDetails ([0e7d290](https://github.com/paolostyle/hono-zod-openapi/commit/0e7d2905992ed0df2e5ed39e6b231750b9f46c0d))
