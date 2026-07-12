import { ReactNode, createContext, useContext, useMemo } from 'react';
import { ReadonlyPropPath } from '../prop-path';
import { Glob } from '../../..';

export function AddToPathProvider(props: {
  part: (string | number) | readonly (string | number)[];
  children: ReactNode;
}) {
  const path = useContext(PathContext);
  const newPath = useMemo(() => path.concat(props.part), [path, props.part]);

  return (
    <PathContext.Provider value={newPath}>
      {props.children}
    </PathContext.Provider>
  );
}

export type SlugFieldInfo = {
  field: string;
  slugs: Set<string>;
  glob: Glob;
};

export const SlugFieldContext = createContext<SlugFieldInfo | undefined>(
  undefined
);

export const SlugFieldProvider = SlugFieldContext.Provider;

export const PathContext = createContext<ReadonlyPropPath>([]);

export const PathContextProvider = PathContext.Provider;
