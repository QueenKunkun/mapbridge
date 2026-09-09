export type AmapPageVersion = 'new' | 'legacy';

export function detectAmapPageVersion(url?: string): AmapPageVersion | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).pathname.startsWith('/ssr') ? 'new' : 'legacy';
  } catch {
    return undefined;
  }
}
