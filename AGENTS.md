## Project nature

drystack is a customized fork of Keystatic.

> **⚠️ Standing rule - no exceptions:** every feature (file manager, uploads, trash/delete, editing, media library, etc.) **must work in both `storage.kind === 'local'` and `storage.kind === 'github'`.** This applies to every change, not just new features - if you touch a write path, verify both modes before calling the work done.

Checklist for any change that reads or writes content:

1. Find the relevant `isLocalConfig`/`isGitHubConfig` (or `config.storage.kind`) call sites in `packages/drystack/src/app/utils.ts` and the feature's own files.
2. Wire up the GitHub path via `useCommitFileChanges` / GraphQL `createCommitOnBranch` (`packages/drystack/src/app/shell/useCommitFileChanges.ts`) - don't rely solely on the local-only `/update` REST API.
3. If GitHub support genuinely can't land in the same change, gate the feature's UI so it's hidden for GitHub mode (pattern: `packages/drystack/src/app/shell/sidebar/index.tsx`'s "File management" nav item) and leave a comment explaining what's still local-only.
4. Prefer implementing the GitHub path over gating when the underlying primitive already supports it (e.g. `useCommitFileChanges` already batches `additions`+`deletions` in one commit) - don't hide a feature just because the first draft only touched local mode.

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
