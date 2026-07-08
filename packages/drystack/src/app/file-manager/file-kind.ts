const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif']);

export function isImagePath(path: string) {
  const ext = path.split('.').pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}

export type HighlightLanguage = 'json' | 'yaml';

export function getHighlightLanguage(path: string): HighlightLanguage | null {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'json') return 'json';
  if (ext === 'yaml' || ext === 'yml') return 'yaml';
  return null;
}
