import { useMediaLibraryPreviewURL } from "../media-library/useMediaLibraryPreviewURL";
import { ImageThumbFrame } from "./ChangePreviewDialog";

// Resolves via the tree-sha-keyed preview cache (see ImageFieldInput, which
// uses the same hook) - same known gap documented in CLAUDE.md's media
// library section: a file picked in this session but not yet saved has no
// tree entry yet, so its "after" thumbnail can't resolve until the entry is
// saved and the tree refreshes.
export function AdminImageThumb({ path }: { path: string }) {
  const objectUrl = useMediaLibraryPreviewURL(path || null);
  return <ImageThumbFrame path={path} src={objectUrl ?? path} />;
}
