import React from 'react';
import type { Config } from '@drystack/core';
import { Keystatic as GenericKeystatic } from '@drystack/core/ui';

const appSlug = {
  envName: 'PUBLIC_KEYSTATIC_GITHUB_APP_SLUG',
  value: import.meta.env.PUBLIC_KEYSTATIC_GITHUB_APP_SLUG,
};

export function makePage(config: Config<any, any>, basePath?: string) {
  return function Keystatic() {
    return (
      <GenericKeystatic
        config={config}
        appSlug={appSlug}
        basePath={basePath}
      />
    );
  };
}
