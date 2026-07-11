import React from 'react';
import { createRoot } from 'react-dom/client';
import type { Config } from '@drystack/core';
import { Toolbar } from './Toolbar';
import { applyPendingEdits, discardEditsIfBuildIsNewer } from './bind';

const ROOT_ID = 'drystack-editor-root';

const OUTLINE_STYLE = `
  body.editing [data-dry] {
    outline: 2px solid rgba(0, 128, 255, 0.5);
    outline-offset: 2px;
    cursor: text;
  }
  body.editing [data-dry]:hover {
    outline-color: rgba(0, 128, 255, 0.8);
  }
`;

export async function mount(
  config: Config<any, any>,
  buildVersion?: number
): Promise<void> {
  if (document.getElementById(ROOT_ID)) return;

  await discardEditsIfBuildIsNewer(config, buildVersion);
  await applyPendingEdits();

  const style = document.createElement('style');
  style.textContent = OUTLINE_STYLE;
  document.head.appendChild(style);

  const host = document.createElement('div');
  host.id = ROOT_ID;
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);

  createRoot(mountPoint).render(<Toolbar config={config} />);
}
