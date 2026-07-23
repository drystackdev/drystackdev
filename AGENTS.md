## Project nature

drystack is a customized fork of Keystatic.

> **⚠️ Standing rule - no exceptions:** every feature (file manager, uploads, trash/delete, editing, media library, etc.) **must work in both `storage.kind === 'demo'` and `storage.kind === 'r2'`.** This applies to every change, not just new features - if you touch a write path, verify both modes before calling the work done. (`local` and `github` storage kinds were removed 2026-07-23 - r2 is now the only writable backend, demo is the read-only public showcase.)

Checklist for any change that reads or writes content:

1. Find the relevant `isDemoConfig`/`isR2Config` (or `config.storage.kind`) call sites in `packages/drystack/src/app/storage-mode.ts` and the feature's own files.
2. Both modes read/write through the same local-shaped REST routes (`/api/<base>/tree`, `/blob`, `/update` - see `packages/drystack/src/api/generic.ts` and `api-node.ts`/`api-r2.ts`); r2 just swaps the storage backend from disk to a Cloudflare R2 bucket server-side and sits behind native email/password login (`api/native-auth.ts`). There's no branch/commit model to wire up separately - a feature that works against the REST routes already works in both modes.
3. Demo is read-only: every write path must no-op through `blockWriteInDemo()`/`blockWriteInDemoWithError()` (`packages/drystack/src/app/demo-guard.ts`), never silently succeed or throw an unhandled error.
4. If a feature genuinely can't work in demo (e.g. it needs a real signed-in identity), gate its UI off `isR2Config`/`isDemoConfig` rather than crashing - see `packages/drystack/src/app/shell/sidebar/index.tsx`'s `SidebarFooter`/`SidebarHeader` for the pattern (r2 gets the identity-aware footer, demo moves the theme menu to the header instead).

## Configuration

The Keystatic-based CMS config file is `drystack.config.ts` at the project root (this fork renames it from upstream's `keystatic.config.ts`). The Astro integration (`packages/astro/src/index.ts`) resolves the `virtual:drystack-config` module to this filename and lists it in Vite's `optimizeDeps.entries` - if renamed again, update both spots plus any direct imports (e.g. `src/pages/index.astro`).

## Media library

Uploads via `openMediaLibrary()` / `useMediaLibraryUpload` (`packages/drystack/src/app/media-library/`) write files to disk immediately but intentionally do **not** update the global tree state - see the comment in `useMediaLibraryUpload.ts`. This avoids resetting unsaved form edits, but it means tree-based lookups (`useMediaLibraryPreviewURL`, which resolves a blob sha from the tree) can't find a just-uploaded file until the tree naturally refreshes (e.g. after Save). Any UI that needs to preview a freshly picked/uploaded file should cache the bytes returned in `MediaLibraryPick.content` locally instead of relying solely on the tree lookup.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
