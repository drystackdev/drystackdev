export type ReadonlyPropPath = readonly (string | number)[];

export function areArraysEqual(a: readonly unknown[], b: readonly unknown[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
