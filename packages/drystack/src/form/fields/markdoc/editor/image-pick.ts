import {
  MediaLibraryPick,
  UNHYDRATED_MEDIA_BYTES,
} from "../../../../app/media-library/bridge";

// decides whether a picked image should be embedded (bytes stored as a
// sibling file of this entry) or referenced (an unhydrated node pointing at
// the shared library directory, resolved lazily) - references are only safe
// where the field's serialization format supports resolving them back, see
// `EditorConfig.supportsMediaLibraryReferences`
export function imageAttrsForPick(
  picked: MediaLibraryPick,
  transformFilename: (originalFilename: string) => string,
  supportsMediaLibraryReferences: boolean,
): { src: Uint8Array; filename: string } {
  const filename = transformFilename(picked.filename);
  if (picked.source === "library" && supportsMediaLibraryReferences) {
    return { src: UNHYDRATED_MEDIA_BYTES, filename };
  }
  return { src: picked.content, filename };
}

/**
 * The picked image's intrinsic width/height ratio, or null if it can't be
 * measured (a decode failure, or an SVG with no intrinsic size).
 *
 * Measures `picked.content` rather than the node's `src`: `imageAttrsForPick`
 * hands back `UNHYDRATED_MEDIA_BYTES` - an *empty* array - for a library
 * reference, so `src` is not something that can be decoded, while `content`
 * always carries the real bytes whatever the pick's source.
 */
export async function naturalRatioForPick(
  picked: MediaLibraryPick,
): Promise<number | null> {
  // an SVG only decodes with the right type; other formats are sniffed
  const blob = new Blob([picked.content as BlobPart], {
    type: picked.filename.endsWith(".svg") ? "image/svg+xml" : undefined,
  });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) return null;
    return img.naturalWidth / img.naturalHeight;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
