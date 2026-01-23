# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [1.0.1](https://github.com/paolostyle/hono-zod-openapi/compare/v1.0.0...v1.0.1) (2025-10-05)

### Bug Fixes

- missing deno importmap version updates ([d0a2366](https://github.com/paolostyle/hono-zod-openapi/commit/d0a23668efabdad793709c873e4e03a5829ec590))

## [1.0.0](https://github.com/paolostyle/hono-zod-openapi/compare/v0.5.0...v1.0.0) (2025-10-05)

### ⚠ BREAKING CHANGES

- require node v20 as v18 is deprecated already
- **deps:** enforce zod v4 usage

### Miscellaneous Chores

- **deps:** enforce zod v4 usage ([1d5fa2d](https://github.com/paolostyle/hono-zod-openapi/commit/1d5fa2d0c1c81ac436562ab237e0da3b33d93fae))
- require node v20 as v18 is deprecated already ([f32b6d3](https://github.com/paolostyle/hono-zod-openapi/commit/f32b6d3b258f8ae3b4cbdd3189261ca7ef9f19ff))

## [0.5.0](https://github.com/paolostyle/hono-zod-openapi/compare/v0.4.2...v0.5.0) (2024-11-13)

### Features

- **deps:** upgrade zod-openapi to 4.0.0 ([5f93eed](https://github.com/paolostyle/hono-zod-openapi/commit/5f93eedcf3fa9b2fb957ed9c40e789f3b66ebd88))

### Bug Fixes

- adjust paths with params to the OpenAPI format ([0f52006](https://github.com/paolostyle/hono-zod-openapi/commit/0f520066f30f1e0a73ae9fc5f19c7a27a44da471))
- require hono ^4.6.10 as it includes fix that closes [#15](https://github.com/paolostyle/hono-zod-openapi/issues/15) ([1617c09](https://github.com/paolostyle/hono-zod-openapi/commit/1617c097167680f6c8d4d4c6482c22f836116caf))

## [0.4.2](https://github.com/paolostyle/hono-zod-openapi/compare/v0.4.1...v0.4.2) (2024-11-02)

### Miscellaneous Chores

- fix JSR publishing through CI ([667f13b](https://github.com/paolostyle/hono-zod-openapi/commit/667f13b6cea0f29b6171f9c252b0d4767a01e23e))
- include missing JSDocs to exported types ([5a50697](https://github.com/paolostyle/hono-zod-openapi/commit/5a506970fcb559c7a3b260dfa3e85c85bb890aa8))

## [0.4.1](https://github.com/paolostyle/hono-zod-openapi/compare/v0.4.0...v0.4.1) (2024-10-31)

### Bug Fixes

- use NPM version of Hono to unblock JSR release ([e9b13a5](https://github.com/paolostyle/hono-zod-openapi/commit/e9b13a53078104b61564a4a6b8899919830e9364))

## [0.4.0](https://github.com/paolostyle/hono-zod-openapi/compare/hono-zod-openapi-v0.3.1...hono-zod-openapi-v0.4.0) (2024-10-31)

### Features

- add basic JSDocs ([fd8bb84](https://github.com/paolostyle/hono-zod-openapi/commit/fd8bb8443344273d063c0b3ad87d95f61b66b244))

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
