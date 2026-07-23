import React from 'react';
import type { Config } from '@drystack/core';
import { Drystack as GenericDrystack } from '@drystack/core/ui';

export function makePage(config: Config<any, any>, basePath?: string) {
  return function Drystack() {
    return <GenericDrystack config={config} basePath={basePath} />;
  };
}
