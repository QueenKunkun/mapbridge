import { describe, expect, it } from 'vitest';
import { normalizeAmap, amapAdapter } from '@/adapters/amap';
import { md5 } from '@/utils/md5';

// Synthetic records (structurally identical to captured favorites; all names/coords/ids are fictional).
const amapGetFav = {
  status: '1',
  data: {
    ver: 'synthetic-ver-1',
    items: [
      {
        id: '000000000000000000000000000000aa',
        type: 101,
        data: {
          name: 'Alpha Tech Park',
          custom_name: 'Alpha Tech Park',
          address: 'No.8 Gaoshengqiao East Rd, Wuhou District, Chengdu',
          custom_address: 'No.8 Gaoshengqiao East Rd, Wuhou District, Chengdu',
          point_x: 211796584,
          point_y: 110201320,
          tag: '房产;成都市',
          phone_numbers: '028-88886666',
          custom_phone_numbers: '028-88886666',
          city_name: '成都市',
        },
      },
      {
        id: '000000000000000000000000000000bb',
        type: 101,
        data: {
          name: 'Beta International Airport',
          custom_name: 'Beta International Airport',
          address: 'Shuangliu, Chengdu',
          custom_address: 'Shuangliu, Chengdu',
          point_x: 212370112,
          point_y: 110348904,
          tag: '交通;成都市',
          phone_numbers: '',
          custom_phone_numbers: '',
          city_name: '成都市',
        },
      },
    ],
  },
};

// WGS-84 中转会有 ~1m（~7px）的近似误差，属于 BD-09↔GCJ-02 误差预算内。
const PX_TOLERANCE = 8;

describe('amap adapter', () => {
  it('normalizes a getFav item (pixel coords)', () => {
    const items = (amapGetFav.data as { items: unknown[] }).items;
    const place = normalizeAmap(items[0]!);
    expect(place).not.toBeNull();
    expect(place!.name).toBe('Alpha Tech Park');
    expect(place!.address).toContain('Gaoshengqiao East Rd');
    // pixel(211796584, 110201320) -> gcj02 -> wgs84
    expect(place!.wgs84.lng).toBeCloseTo(104.03890550485319, 5);
    expect(place!.wgs84.lat).toBeCloseTo(30.637468772592385, 5);
    expect(place!.metadata.uid).toBe('000000000000000000000000000000aa');
    expect(place!.metadata.phone).toBe('028-88886666');
    expect(place!.tags).toEqual(['房产', '成都市']);
  });

  it('buildExtractResult collects places', () => {
    const items = (amapGetFav.data as { items: unknown[] }).items;
    const result = amapAdapter.buildExtractResult({ provider: 'amap', records: items, exhausted: true });
    expect(result.places).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
  });

  it('buildImportPayload reproduces the verified amap favorite payload', () => {
    const place = normalizeAmap(((amapGetFav.data as { items: unknown[] }).items)[0]!)!;
    const payload = amapAdapter.buildImportPayload([place]) as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(1);
    const item = payload[0]!;
    const data = item.data as Record<string, unknown>;
    // 像素坐标经 wgs84 中转后有亚像素漂移，允许 ~1m
    expect(Math.abs(Number(data.point_x) - 211796584)).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(Math.abs(Number(data.point_y) - 110201320)).toBeLessThanOrEqual(PX_TOLERANCE);
    // id 恒为 md5(point_x + "+" + point_y + "+" + name)，且与 payload 自身一致
    expect(item.id).toBe(md5(`${data.point_x}+${data.point_y}+${place.name}`));
    expect(data.custom_name).toBe('Alpha Tech Park');
    expect(data.phone_numbers).toBe('028-88886666');
  });

  it('buildImportPayload converts wgs84 -> gcj02 pixel round trip', () => {
    const place = normalizeAmap(((amapGetFav.data as { items: unknown[] }).items)[1]!)!;
    const payload = amapAdapter.buildImportPayload([place]) as Array<Record<string, unknown>>;
    const data = payload[0]!.data as Record<string, unknown>;
    expect(Math.abs(Number(data.point_x) - 212370112)).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(Math.abs(Number(data.point_y) - 110348904)).toBeLessThanOrEqual(PX_TOLERANCE);
  });

  it('summarizeImportResult counts detail items', () => {
    const report = amapAdapter.summarizeImportResult({
      provider: 'amap',
      done: true,
      targetCount: 3,
      raw: {
        detail: [
          { id: 'a', status: 'imported' },
          { id: 'b', status: 'duplicate' },
          { id: 'c', status: 'failed', error: 'boom' },
        ],
      },
    });
    expect(report.imported).toBe(1);
    expect(report.skippedDuplicates).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.failedItems[0]).toMatchObject({ placeId: 'c', error: 'boom' });
  });
});