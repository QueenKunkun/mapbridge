import { describe, expect, it } from 'vitest';
import { detectAmapPageVersion } from '@/utils/map-version';

describe('Amap page version detection', () => {
  it('recognizes SSR pages as the new version', () => {
    expect(detectAmapPageVersion('https://www.amap.com/ssr/faves')).toBe('new');
    expect(detectAmapPageVersion('https://ditu.amap.com/ssr/faves/')).toBe('new');
  });

  it('recognizes non-SSR favorite pages as the legacy version', () => {
    expect(detectAmapPageVersion('https://ditu.amap.com/faves')).toBe('legacy');
  });

  it('does not invent a version for missing or invalid URLs', () => {
    expect(detectAmapPageVersion()).toBeUndefined();
    expect(detectAmapPageVersion('not a URL')).toBeUndefined();
  });
});
