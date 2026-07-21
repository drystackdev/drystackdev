import {
  getCollectionPath,
  getSingletonFormat,
  getSingletonPath,
} from '../app/path-utils';
import { Config } from '../config';
import { getDirectoriesForTreeKey } from '../app/tree-key';
import { fields } from '../form/api';
import {
  MEDIA_LIBRARY_DIRECTORY,
  TRASH_DIRECTORY,
} from '../app/media-library/constants';

// Lives in its own module (rather than read-local.ts, its original home) so
// the workerd-run R2 handler (api-r2.ts) can compute the write allowlist
// without pulling in read-local's top-level `node:fs` imports.
export function getAllowedDirectories(config: Config) {
  const allowedDirectories: string[] = [];
  for (const [collection, collectionConfig] of Object.entries(
    config.collections ?? {}
  )) {
    allowedDirectories.push(
      ...getDirectoriesForTreeKey(
        fields.object(collectionConfig.schema),
        getCollectionPath(config, collection),
        undefined,
        { contentField: undefined, dataLocation: 'index' }
      )
    );
    if (collectionConfig.template) {
      allowedDirectories.push(collectionConfig.template);
    }
  }
  for (const [singleton, singletonConfig] of Object.entries(
    config.singletons ?? {}
  )) {
    allowedDirectories.push(
      ...getDirectoriesForTreeKey(
        fields.object(singletonConfig.schema),
        getSingletonPath(config, singleton),
        undefined,
        getSingletonFormat(config, singleton)
      )
    );
  }
  allowedDirectories.push(MEDIA_LIBRARY_DIRECTORY);
  allowedDirectories.push(TRASH_DIRECTORY);
  return [...new Set(allowedDirectories)];
}
