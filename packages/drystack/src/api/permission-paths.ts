import { Config } from '../config';
import { getCollectionPath, getSingletonPath } from '../app/path-utils';
import {
  PermissionAction,
  collectionPermission,
  singletonPermission,
} from './permissions';

// Maps an R2 object path back to the collection/singleton that owns it, so
// tree/blob/update can ask "does this session have <action> on the thing
// this path belongs to" (plan/user-managent.md mục 5). Root path only (not
// the full nested-field directory expansion `getAllowedDirectories` computes)
// - every real entry lives under its collection/singleton's own root, and
// this keeps ownership resolution simple and cheap. Shared paths with no
// single owner (media library uploads, trash, collection templates) resolve
// to `null` - only the existing "must have a valid session" gate applies to
// those, no per-collection permission on top (see callers in api-r2.ts).
export type PathOwner = {
  kind: 'collection' | 'singleton';
  key: string;
  prefix: string;
};

export function getPathOwners(config: Config): PathOwner[] {
  const owners: PathOwner[] = [];
  for (const key of Object.keys(config.collections ?? {})) {
    owners.push({ kind: 'collection', key, prefix: getCollectionPath(config, key) });
  }
  for (const key of Object.keys(config.singletons ?? {})) {
    owners.push({ kind: 'singleton', key, prefix: getSingletonPath(config, key) });
  }
  // Longest prefix wins, so a singleton/collection nested under another's
  // path (if a site's config ever does that) resolves to the more specific
  // owner rather than whichever happened to be declared first.
  return owners.sort((a, b) => b.prefix.length - a.prefix.length);
}

export function ownerForPath(owners: PathOwner[], filepath: string): PathOwner | null {
  return owners.find(o => filepath.startsWith(o.prefix)) ?? null;
}

export function permissionForPath(
  owners: PathOwner[],
  filepath: string,
  action: PermissionAction
): string | null {
  const owner = ownerForPath(owners, filepath);
  if (!owner) return null;
  return owner.kind === 'collection'
    ? collectionPermission(owner.key, action)
    : singletonPermission(owner.key, action);
}
