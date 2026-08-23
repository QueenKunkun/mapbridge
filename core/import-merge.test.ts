import { describe, expect, it } from 'vitest';
import { mergeImportItems } from '@/core/import-merge';

describe('mergeImportItems', () => {
  it('imports new items and reports them as imported', () => {
    const result = mergeImportItems(
      [],
      [
        { id: 'a', type: 101, data: { name: 'A' } },
        { id: 'b', type: 101, data: { name: 'B' } },
      ],
    );
    expect(result.imported).toBe(2);
    expect(result.duplicates).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.detail.map((d) => d.status)).toEqual(['imported', 'imported']);
    expect(result.merged).toHaveLength(2);
  });

  it('flags items whose id already exists as duplicates', () => {
    const result = mergeImportItems(
      [{ id: 'a', data: { name: 'A-existing' } }],
      [
        { id: 'a', type: 101, data: { name: 'A' } },
        { id: 'b', type: 101, data: { name: 'B' } },
      ],
    );
    expect(result.imported).toBe(1);
    expect(result.duplicates).toBe(1);
    // 现有项保留，新增项合并进来，总数 = 2
    expect(result.merged).toHaveLength(2);
    expect(result.detail.map((d) => d.status)).toEqual(['duplicate', 'imported']);
  });

  it('flags missing id/data as failed and skips them', () => {
    const result = mergeImportItems(
      [],
      [
        { id: '', data: { name: 'no-id' } },
        { id: 'a', type: 101 },
      ],
    );
    expect(result.failed).toBe(2);
    expect(result.imported).toBe(0);
    expect(result.merged).toHaveLength(0);
  });

  it('cross-source duplicates (same id) collapse to one import', () => {
    // 百度与高德原生提取的同一地点现在生成相同 amap id（见 adapters/amap amapFavoriteId）
    const result = mergeImportItems(
      [],
      [
        { id: 'same-id', type: 101, data: { name: 'X' } },
        { id: 'same-id', type: 101, data: { name: 'X' } },
      ],
    );
    expect(result.imported).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.merged).toHaveLength(1);
  });
});
