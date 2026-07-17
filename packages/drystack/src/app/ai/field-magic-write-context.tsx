import { ReactNode, createContext, useContext } from 'react';

import type { ComponentSchema } from '../../form/api';
import type { useMagicWrite } from './useMagicWrite';

export type FieldMagicWriteValue = {
  entryLabel: string;
  schema: Record<string, ComponentSchema>;
  state: Record<string, unknown>;
  magicWrite: ReturnType<typeof useMagicWrite>;
};

// `null` on pages with no AI (or entries not listed in `ai.for`), which is
// what the per-field button checks before rendering anything.
const FieldMagicWriteContext = createContext<FieldMagicWriteValue | null>(null);

export function useFieldMagicWrite() {
  return useContext(FieldMagicWriteContext);
}

/**
 * Carries what a per-field button needs down to the fields themselves. A
 * context because the button renders inside each field's own label row, far
 * below the page component that owns the entry's state.
 */
export function FieldMagicWriteProvider(props: {
  value: FieldMagicWriteValue | null;
  children: ReactNode;
}) {
  return (
    <FieldMagicWriteContext.Provider value={props.value}>
      {props.children}
    </FieldMagicWriteContext.Provider>
  );
}
