import { describe, expect, it } from 'vitest';
import { filterDuplicateBaiduImportItems } from '@/core/baidu-import';

const route = (type: string) => ({ type, extdata: {
  sfavnode: { geoptx: 100, geopty: 200 },
  efavnode: { geoptx: 300, geopty: 400 },
  wp: [],
} });

describe('Baidu target import deduplication', () => {
  it('deduplicates routes by mode and ordered stop coordinates', () => {
    const result = filterDuplicateBaiduImportItems([route('20')], [route('20'), route('22')]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.type).toBe('22');
    expect(result.duplicates).toHaveLength(1);
  });

  it('deduplicates POIs by normalized name and Baidu coordinates', () => {
    const current = [{ type: '11', extdata: { name: ' 测试点 ', geoptx: '100.00', geopty: '200.00' } }];
    const result = filterDuplicateBaiduImportItems(current, [
      { type: '11', extdata: { name: '测试点', geoptx: 100.4, geopty: 200.4 } },
      { type: '11', extdata: { name: '新点', geoptx: 100, geopty: 200 } },
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
  });
});
