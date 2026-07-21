import { ColorScheme } from "@keystar/ui/types";
import { ReactElement } from "react";

import { ComponentSchema, SlugFormField } from "./form/api";
import * as fields from "./form/fields";
import type { Locale } from "./app/l10n/locales";
import { RepoConfig } from "./app/repo-config";
import { REDIRECTS_DIR } from "./app/redirects";

// Common
// ----------------------------------------------------------------------------

export type Format = {
  contentField?: string | [string, ...string[]];
};
export type EntryLayout = "content" | "form";
export type Glob = "*" | "**";
export type Collection<
  Schema extends Record<string, ComponentSchema>,
  SlugField extends string,
> = {
  label: string;
  path?: `${string}/${Glob}` | `${string}/${Glob}/${string}`;
  entryLayout?: EntryLayout;
  format?: Format;
  previewUrl?: string;
  template?: string;
  parseSlugForSort?: (slug: string) => string | number;
  slugField: SlugField;
  schema: Schema;
};

export type Singleton<Schema extends Record<string, ComponentSchema>> = {
  label: string;
  path?: string;
  entryLayout?: EntryLayout;
  format?: Format;
  previewUrl?: string;
  schema: Schema;
};

// The editable shape of a native-auth user (r2 mode only). Deliberately NOT a
// `Collection`: there's no `slugField` because the user's identity is its email
// (a built-in, never a schema field), and no `path` because users don't live in
// the content tree - they're `auth/native/<email>.json` objects behind the auth
// API (see api/api-r2.ts). `schema` holds only the *profile* fields the site
// owner wants to edit (name, role, ...), stored in the user file's `profile`
// JSON. `avatar` and `password` are built-ins handled outside this schema:
// avatar bytes go to `auth/avatars/<email>` via the auth API ("an image, but
// not routed through the normal content-image path"), and a password is never
// a field at all. Don't key a field `email`/`avatar`/`password`/`createdAt` -
// those names are reserved for the built-ins above and are silently dropped
// (see RESERVED_USER_FIELD_KEYS in app/users/UserDetailForm.tsx).
export type UserConfig<
  Schema extends Record<string, ComponentSchema> = Record<
    string,
    ComponentSchema
  >,
> = {
  label?: string;
  schema: Schema;
};

type CommonConfig<Collections, Singletons> = {
  locale?: Locale;
  ui?: UserInterface<Collections, Singletons>;
  ai?: AiConfig<Collections, Singletons>;
  // Only consumed in r2 mode (native auth) - harmless elsewhere. Erased to the
  // non-generic `UserConfig` here, the same way `Config` erases collections'
  // schemas; `user()` below preserves the precise schema for the author.
  user?: UserConfig;
};

// AI ("Magic write")
// ----------------------------------------------------------------------------

// Opt-in, admin-only content generation. Omitting `ai` disables the feature
// outright - no button, no banner, no request. The API key never lives here:
// it's read server-side from DRY_AI_KEY (see api/ai/env.ts), so nothing in
// this config object is secret and it can ship to the browser as-is.
export type AiConfig<Collections, Singletons> = {
  /**
   * Output language, as a BCP 47 tag (e.g. 'vi-VN'). Falls back to the
   * top-level `locale` when omitted.
   */
  lang?: string;
  /**
   * Which collections/singletons get a "Magic write" button, mapped to a
   * description of what the entry *is* - this string goes straight into the
   * prompt, so write it for the model ("bài viết chi tiết về SEO, giọng
   * chuyên gia"), not as a UI label. A key that isn't listed here has no
   * button, and the generate route rejects it.
   *
   * Keyed off the site's own collections/singletons so a typo is a type
   * error at the config, not a silently missing button.
   */
  for?: Partial<
    Record<(keyof Collections & string) | (keyof Singletons & string), string>
  >;
};

type CommonRemoteStorageConfig = {
  pathPrefix?: string;
  branchPrefix?: string;
};

// Interface
// ----------------------------------------------------------------------------

type BrandMark = (props: {
  colorScheme: Exclude<ColorScheme, "auto">; // we resolve "auto" to "light" or "dark" on the client
}) => ReactElement;
export const NAVIGATION_DIVIDER_KEY = "---";
// Reserved singleton key `config()` always injects for the redirect-on-
// rename feature (see the definition below and `config()`'s implementation).
// It's never part of a site's own `Collections`/`Singletons` generics, and a
// site can't list it in `ui.navigation` either - it always renders on its
// own, in a fixed "System" nav section (see useNavItems.tsx), independent of
// the site's collections/singletons grouping. That section's label isn't
// configurable, so the key is deliberately left out of the `Navigation`
// union below.
export const REDIRECTS_SINGLETON_KEY = "__redirects";
type UserInterface<Collections, Singletons> = {
  brand?: {
    mark?: BrandMark;
    name: string;
  };
  navigation?: Navigation<
    | (keyof Collections & string)
    | (keyof Singletons & string)
    | typeof NAVIGATION_DIVIDER_KEY
  >;
};

type Navigation<K> = K[] | { [section: string]: K[] };

// Storage
// ----------------------------------------------------------------------------

type GitHubStorageConfig = {
  kind: "github";
  repo: RepoConfig;
} & CommonRemoteStorageConfig;

export type GitHubConfig<
  Collections extends {
    [key: string]: Collection<Record<string, ComponentSchema>, string>;
  } = {
    [key: string]: Collection<Record<string, ComponentSchema>, string>;
  },
  Singletons extends {
    [key: string]: Singleton<Record<string, ComponentSchema>>;
  } = {
    [key: string]: Singleton<Record<string, ComponentSchema>>;
  },
> = {
  storage: GitHubStorageConfig;
  collections?: Collections;
  singletons?: Singletons;
} & CommonConfig<Collections, Singletons>;

type LocalStorageConfig = {
  kind: "local";
};

// Read-only public demo. Its own `storage.kind` (not a flag on local
// storage): still shares local's entire shape otherwise (one tree, no
// branches, no OAuth), so every call site that wants "local-shaped" behavior
// for local, demo and r2 uses `isLocalShapedConfig`/`LocalShapedConfig`
// (see app/storage-mode.ts) instead of hand-rolling an `||`. Only the handful
// of places that need demo-specific behavior branch on `isDemoConfig`/`kind
// === 'demo'` directly.
//
// What distinguishes it from plain local:
// - reads come from a prebuilt `/__data.zip` instead of `/api/<base>/tree`
//   and `/api/<base>/blob/...` (see app/demo-source.ts)
// - every write path no-ops with a toast (see app/demo-guard.ts)
// - AI calls go to `DRYSTACK_AI_URL` on another origin instead of
//   `/api/<base>/ai/*`, since a demo build is fully static and has no
//   `/api` routes at all. No config here for that: the site owner sets the
//   env var (see app/ai/demo-ai-env.ts) and nothing else - unset means the
//   feature is simply off, no fallback to the top-level `ai`/DRY_AI_KEY path.
type DemoStorageConfig = {
  kind: "demo";
};

// Content lives in a Cloudflare R2 bucket instead of the filesystem or a
// GitHub repo. Local-shaped on the client (one tree, no branches, no OAuth):
// the admin app talks to the exact same `/api/<base>/tree|blob|update` REST
// routes as local mode - only the server side swaps `fs` for the R2 binding
// (see api/api-r2.ts). Unlike local mode the deployment is public, so
// `/drystack`, VEI and every write route are gated behind the native
// email/password login (JWT signed with DRYSTACK_SECRET - see
// api/native-auth.ts); reads stay public per the auth plan, except the
// `auth/` prefix which is never served.
type R2StorageConfig = {
  kind: "r2";
};

export type LocalConfig<
  Collections extends {
    [key: string]: Collection<Record<string, ComponentSchema>, string>;
  } = {
    [key: string]: Collection<Record<string, ComponentSchema>, string>;
  },
  Singletons extends {
    [key: string]: Singleton<Record<string, ComponentSchema>>;
  } = {
    [key: string]: Singleton<Record<string, ComponentSchema>>;
  },
> = {
  storage: LocalStorageConfig;
  collections?: Collections;
  singletons?: Singletons;
} & CommonConfig<Collections, Singletons>;

export type DemoConfig<
  Collections extends {
    [key: string]: Collection<Record<string, ComponentSchema>, string>;
  } = {
    [key: string]: Collection<Record<string, ComponentSchema>, string>;
  },
  Singletons extends {
    [key: string]: Singleton<Record<string, ComponentSchema>>;
  } = {
    [key: string]: Singleton<Record<string, ComponentSchema>>;
  },
> = {
  storage: DemoStorageConfig;
  collections?: Collections;
  singletons?: Singletons;
} & CommonConfig<Collections, Singletons>;

export type R2Config<
  Collections extends {
    [key: string]: Collection<Record<string, ComponentSchema>, string>;
  } = {
    [key: string]: Collection<Record<string, ComponentSchema>, string>;
  },
  Singletons extends {
    [key: string]: Singleton<Record<string, ComponentSchema>>;
  } = {
    [key: string]: Singleton<Record<string, ComponentSchema>>;
  },
> = {
  storage: R2StorageConfig;
  collections?: Collections;
  singletons?: Singletons;
} & CommonConfig<Collections, Singletons>;

// "Local-shaped" configs - real local storage, the read-only public demo and
// R2 storage, which all share local's client shape (one tree, no branches, no
// OAuth; reads/writes over the local REST routes rather than GitHub's
// GraphQL). Used by call sites that want the pre-split `isLocalConfig`
// behavior (see app/storage-mode.ts's `isLocalShapedConfig`) rather than
// distinguishing the three.
export type LocalShapedConfig<
  Collections extends {
    [key: string]: Collection<Record<string, ComponentSchema>, string>;
  } = {
    [key: string]: Collection<Record<string, ComponentSchema>, string>;
  },
  Singletons extends {
    [key: string]: Singleton<Record<string, ComponentSchema>>;
  } = {
    [key: string]: Singleton<Record<string, ComponentSchema>>;
  },
> =
  | LocalConfig<Collections, Singletons>
  | DemoConfig<Collections, Singletons>
  | R2Config<Collections, Singletons>;

export type Config<
  Collections extends {
    [key: string]: Collection<Record<string, ComponentSchema>, string>;
  } = {
    [key: string]: Collection<Record<string, ComponentSchema>, string>;
  },
  Singletons extends {
    [key: string]: Singleton<Record<string, ComponentSchema>>;
  } = {
    [key: string]: Singleton<Record<string, ComponentSchema>>;
  },
> = {
  storage:
    | LocalStorageConfig
    | DemoStorageConfig
    | GitHubStorageConfig
    | R2StorageConfig;
  collections?: Collections;
  singletons?: Singletons;
} & ({} extends Collections ? {} : { collections: Collections }) &
  ({} extends Singletons ? {} : { singletons: Singletons }) &
  CommonConfig<Collections, Singletons>;

// ============================================================================
// Functions
// ============================================================================

// Injected into every resolved config by `config()` below - never declared by
// a site's own `drystack.config.ts`. Baking the schema/path in here (rather
// than asking each site to declare a matching singleton, as earlier drafts of
// this feature did) means the redirect-on-rename write path
// (app/updating.tsx) and the Astro build step (packages/astro/src/index.ts)
// can rely on this shape always existing, exactly as defined - a site can't
// rename, re-path, or accidentally drop the fields the write path depends on.
const redirectsSingleton = singleton({
  label: "Redirects (301)",
  path: `${REDIRECTS_DIR}/`,
  schema: {
    entries: fields.array(
      fields.object({
        from: fields.text({ label: "Old URL" }),
        to: fields.text({ label: "New URL" }),
        createdAt: fields.text({ label: "Created" }),
      }),
      {
        label: "Redirect list",
        itemLabel: (props) =>
          `${props.fields.from.value || "?"} → ${props.fields.to.value || "?"}`,
      },
    ),
  },
});

export function config<
  Collections extends {
    [key: string]: Collection<Record<string, ComponentSchema>, string>;
  },
  Singletons extends {
    [key: string]: Singleton<Record<string, ComponentSchema>>;
  },
>(userConfig: Config<Collections, Singletons>) {
  // Env access here is deliberately written the awkward-looking way, because
  // this function is evaluated in three different module contexts:
  //   1. Raw Bun import, no Vite  - isDemoBuild() in packages/astro/src/index.ts
  //   2. Vite SSR bundle          - server pages / API routes
  //   3. Vite CLIENT bundle       - the VEI toolbar imports
  //      virtual:drystack-config (-> this file) straight from the browser.
  // Vite/esbuild statically replaces the *exact* text `import.meta.env.PUBLIC_X`
  // with its literal value for the client bundle - but ONLY that exact form:
  // a computed `import.meta.env[name]` or an access through an aliased
  // variable is left untouched and reads back `undefined` in the browser
  // (confirmed with esbuild `define`). So each var is spelled out inline -
  // never factored through a helper, a loop, or a `const env = import.meta.env`
  // alias - and must keep the `PUBLIC_` prefix (Astro's default envPrefix) to
  // reach the client at all.
  //
  // The discriminator between contexts is `typeof import.meta.env`, NOT
  // `typeof process` (as an earlier version of this code assumed): `import.meta`
  // is always a real object per spec, so `.env` is always a safe (non-throwing)
  // property read, and Vite genuinely provides `import.meta.env` whenever it has
  // processed the file - contexts (2) and (3) both satisfy this. `process`
  // looked like the right discriminator for (1) vs (3), but Astro's client
  // bundle polyfills a bare `globalThis.process = { env: {} }` for other
  // dependencies' sake (confirmed in the built output), so `typeof process !==
  // "undefined"` is ALSO true in the pure-browser case - checking it first (as
  // this code used to) silently reads the empty polyfilled `process.env`
  // instead of the correctly Vite-inlined literal, so a real `PUBLIC_DEMO=true`
  // build still shipped `storage:{kind:"github",...}` to the browser. See the
  // drystack-demo-mode-fail-open-fixed note for the empirical trail.
  type ViteMeta = { env: Record<string, string | undefined> };

  const viteEnvIsDefined =
    typeof (import.meta as unknown as ViteMeta).env !== "undefined";

  const isDemoBuild =
    (viteEnvIsDefined
      ? (import.meta as unknown as ViteMeta).env.PUBLIC_DEMO
      : typeof process !== "undefined"
        ? process.env.PUBLIC_DEMO
        : undefined) === "true";

  // Same shape and caveats as PUBLIC_DEMO above (exact-text inline access,
  // PUBLIC_ prefix so the client bundle sees it). PUBLIC_R2=true flips the
  // whole deployment to R2 storage without editing the config file; demo wins
  // if both are somehow set, since demo is the strictly-safer (read-only)
  // mode.
  const isR2Build =
    (viteEnvIsDefined
      ? (import.meta as unknown as ViteMeta).env.PUBLIC_R2
      : typeof process !== "undefined"
        ? process.env.PUBLIC_R2
        : undefined) === "true";

  return {
    ...userConfig,
    storage: isDemoBuild
      ? { kind: "demo" }
      : isR2Build
        ? { kind: "r2" }
        : userConfig.storage,
    singletons: {
      ...userConfig.singletons,
      [REDIRECTS_SINGLETON_KEY]: redirectsSingleton,
    },
  } as Config<
    Collections,
    Singletons & { [REDIRECTS_SINGLETON_KEY]: typeof redirectsSingleton }
  >;
}

export function collection<
  Schema extends Record<string, ComponentSchema>,
  SlugField extends {
    [K in keyof Schema]: Schema[K] extends SlugFormField<any, any, any, any>
      ? K
      : never;
  }[keyof Schema],
>(
  collection: Collection<Schema, SlugField & string>,
): Collection<Schema, SlugField & string> {
  return collection;
}

export function singleton<Schema extends Record<string, ComponentSchema>>(
  collection: Singleton<Schema>,
): Singleton<Schema> {
  return collection;
}

// Declares the editable profile schema for native-auth users (r2 mode). Mirrors
// `collection()`/`singleton()` ergonomics but has no `slugField` (a user's
// identity is its email, a built-in) and no `path` (users aren't content-tree
// entries - they're stored behind the auth API). `schema` should hold only
// JSON-serializable fields (text, select, checkbox, ...); avatar and password
// are built-ins handled outside it.
export function user<Schema extends Record<string, ComponentSchema>>(
  user: UserConfig<Schema>,
): UserConfig<Schema> {
  return user;
}
