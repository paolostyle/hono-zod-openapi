# Contributing

## Runtime Compatibility

While this package _should_ work in Bun, Deno, Cloudflare Workers and browsers (as we're not using any platform-specific APIs), the codebase is currently tested against Node.js 20.x, 22.x and 24.x.

For now we've managed to successfully run the tests with the Bun test runner (with some grepping) and used the library in Cloudflare Workers without issues. If you are using the library in a non-Node runtime and encounter bugs, please consider [creating an issue](https://github.com/paolostyle/hono-zod-openapi/issues).

## Local Setup

Run the following set of commands to set up the project. Corepack is required to install the correct version of PNPM.

```sh
corepack enable
corepack install
pnpm i
```

Now you can run `pnpm test` to continuously run tests while developing.

## Commit Naming Conventions

At the moment of writing this, we don't have an automated setup for [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/) as none of the tooling tried was really meeting expectations, but Release Please, which takes care of the automated release process, is using them to identify the need for releasing a new version. For now please try to do this manually (including in PR names), but automating this process would be great.
