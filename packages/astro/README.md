# @drystack/astro

**Astro plugin/integration for drystack** - a git-backed CMS for Astro, inspired by [Keystatic](https://keystatic.com). Adds an admin UI route, content API, and live in-page editing toolbar to an Astro site backed by `@drystack/core`.

## Install

```sh
npm install @drystack/astro @drystack/core
```

## Usage

```ts
// astro.config.ts
import { defineConfig } from "astro/config";
import drystack from "@drystack/astro";

export default defineConfig({
  integrations: [drystack()],
});
```

See the [drystack repository](https://github.com/drystackdev/drystackdev) for full configuration (`drystack.config.ts`), storage modes (r2/demo), and deployment notes (Cloudflare Workers).

## Credits

drystack is an independent project inspired by and forked from [Keystatic](https://github.com/Thinkmill/keystatic) (Thinkmill). It is not affiliated with or endorsed by the Keystatic project.

## License

MIT
