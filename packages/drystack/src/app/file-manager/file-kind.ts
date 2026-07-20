const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif']);

export function isImagePath(path: string) {
  const ext = path.split('.').pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}

// Human-facing file type derived from the extension, e.g. "photo.png" -> "PNG",
// "archive.zip" -> "ZIP". Extensionless files ("README") and dotfiles
// (".gitignore") have no meaningful type, so fall back to the localized
// generic "File" label.
export function getFileTypeLabel(
  name: string,
  fileTypeGenericLabel: string,
): string {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex <= 0) return fileTypeGenericLabel;
  return name.slice(dotIndex + 1).toUpperCase();
}

export type HighlightLanguage = 'json' | 'yaml';

export function getHighlightLanguage(path: string): HighlightLanguage | null {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'json') return 'json';
  if (ext === 'yaml' || ext === 'yml') return 'yaml';
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`;
}