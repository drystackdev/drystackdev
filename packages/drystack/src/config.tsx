import { ColorScheme } from '@keystar/ui/types';
import { ReactElement } from 'react';

import { ComponentSchema, SlugFormField } from './form/api';
import * as fields from './form/fields';
import type { Locale } from './app/l10n/locales';
import { RepoConfig } from './app/repo-config';
import { REDIRECTS_DIR } from './app/redirects';

// Common
// ----------------------------------------------------------------------------

export type Format = {
  contentField?: string | [string, ...string[]];
};
export type EntryLayout = 'content' | 'form';
export type Glob = '*' | '**';
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

type CommonConfig<Collections, Singletons> = {
  locale?: Locale;
  ui?: UserInterface<Collections, Singletons>;
  ai?: AiConfig<Collections, Singletons>;
};

// AI ("Magic write")
// ----------------------------------------------------------------------------

// Opt-in, admin-only content generation. Omitting `ai` disables the feature
// outright — no button, no banner, no request. The API key never lives here:
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
   * description of what the entry *is* — this string goes straight into the
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
  colorScheme: Exclude<ColorScheme, 'auto'>; // we resolve "auto" to "light" or "dark" on the client
}) => ReactElement;
export const NAVIGATION_DIVIDER_KEY = '---';
// Reserved singleton key `config()` always injects for the redirect-on-
// rename feature (see the definition below and `config()`'s implementation).
// It's never part of a site's own `Collections`/`Singletons` generics, and a
// site can't list it in `ui.navigation` either — it always renders on its
// own, in a fixed "System" nav section (see useNavItems.tsx), independent of
// the site's collections/singletons grouping. That section's label isn't
// configurable, so the key is deliberately left out of the `Navigation`
// union below.
export const REDIRECTS_SINGLETON_KEY = '__redirects';
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
  kind: 'github';
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

type LocalStorageConfig = { kind: 'local' };

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
  storage: LocalStorageConfig | GitHubStorageConfig;
  collections?: Collections;
  singletons?: Singletons;
} & ({} extends Collections ? {} : { collections: Collections }) &
  ({} extends Singletons ? {} : { singletons: Singletons }) &
  CommonConfig<Collections, Singletons>;

// ============================================================================
// Functions
// ============================================================================

// Injected into every resolved config by `config()` below — never declared by
// a site's own `drystack.config.ts`. Baking the schema/path in here (rather
// than asking each site to declare a matching singleton, as earlier drafts of
// this feature did) means the redirect-on-rename write path
// (app/updating.tsx) and the Astro build step (packages/astro/src/index.ts)
// can rely on this shape always existing, exactly as defined — a site can't
// rename, re-path, or accidentally drop the fields the write path depends on.
const redirectsSingleton = singleton({
  label: 'Redirects (301)',
  path: `${REDIRECTS_DIR}/`,
  schema: {
    entries: fields.array(
      fields.object({
        from: fields.text({ label: 'Old URL' }),
        to: fields.text({ label: 'New URL' }),
        createdAt: fields.text({ label: 'Created' }),
      }),
      {
        label: 'Redirect list',
        itemLabel: props =>
          `${props.fields.from.value || '?'} → ${props.fields.to.value || '?'}`,
      }
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
  return {
    ...userConfig,
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
  collection: Collection<Schema, SlugField & string>
): Collection<Schema, SlugField & string> {
  return collection;
}

export function singleton<Schema extends Record<string, ComponentSchema>>(
  collection: Singleton<Schema>
): Singleton<Schema> {
  return collection;
}
