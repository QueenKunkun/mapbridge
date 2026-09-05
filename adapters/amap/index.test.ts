import { describe, expect, it } from 'vitest';
import { normalizeAmap, normalizeAmapRoute, amapAdapter, amapFavoriteId, buildAmapRoutePayload } from '@/adapters/amap';
import { md5 } from '@/utils/md5';
import { placeFingerprint } from '@/core/dedup';
import type { CanonicalPlace } from '@/core/model';

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
  it('declares POI and Route extraction with POI-only provider import', () => {
    expect(amapAdapter.capabilities.extractKinds).toEqual(['poi', 'route']);
    expect(amapAdapter.capabilities.importKinds).toEqual(['poi']);
  });

  it('normalizes the SSR type 117 route payload into ordered stops', () => {
    const route = normalizeAmapRoute({
      id: 'route-117',
      type: 117,
      data: {
        rideType: 0,
        startPoi: { name: 'Start', poiid: 'start-1', lon: 120.741393, lat: 21.919339, x: 224249036, y: 117459570 },
        endPoi: { name: 'End', poiid: '', lon: 120.741353, lat: 21.917311, x: 224249006, y: 117461198 },
        midPois: [],
        length: 523,
        time: 167,
        routeType: '13',
      },
    });
    expect(route).not.toBeNull();
    expect(route!.stops.map((stop) => stop.role)).toEqual(['start', 'end']);
    expect(route!.stops[0]!.sourceRecordId).toBe('start-1');
    expect(route!.routing).toMatchObject({ routeType: '13', rideType: 0, distanceMeters: 523, durationSeconds: 167 });
    expect(route!.source.recordId).toBe('route-117');
    expect(route!.source.crs).toBe('amap_pixel');
  });

  it('includes type 117 routes in items without adding them to POI places', () => {
    const result = amapAdapter.buildExtractResult({
      provider: 'amap',
      records: [{ type: 117, data: { startPoi: { name: 'A', lon: 120.1, lat: 30.1 }, endPoi: { name: 'B', lon: 120.2, lat: 30.2 }, midPois: [], routeType: '13' } }],
      exhausted: true,
    });
    expect(result.items.map((item) => item.kind)).toEqual(['route']);
    expect(result.places).toHaveLength(0);
  });

  it('builds a deterministic SSR type 117 route payload with converted points', () => {
    const route = normalizeAmapRoute({
      id: 'route-117',
      type: 117,
      data: {
        startPoi: { name: 'Start', poiid: 'start-1', lon: 120.741393, lat: 21.919339, x: 224249036, y: 117459570 },
        endPoi: { name: 'End', poiid: '', lon: 120.741353, lat: 21.917311, x: 224249006, y: 117461198 },
        midPois: [],
        routeType: '13',
        rideType: 0,
        length: 523,
        time: 167,
      },
    })!;
    const item = buildAmapRoutePayload(route, 1788574307);
    const data = item.data as Record<string, unknown>;
    expect(item.type).toBe(117);
    expect(item.id).toMatch(/^[a-f0-9]{32}$/);
    expect(item.id).toBe(buildAmapRoutePayload(route, 1788574307).id);
    expect(data).toMatchObject({ id: item.id, rideType: 0, length: 523, time: 167, routeType: '13' });
    expect(data.startPoi).toMatchObject({ name: 'Start', poiid: 'start-1' });
    expect(data.endPoi).toMatchObject({ name: 'End', typeCode: '' });
    expect(data.midPois).toEqual([]);
    expect(Number((data.startPoi as Record<string, unknown>).x)).toBeGreaterThan(0);
    expect(Number((data.startPoi as Record<string, unknown>).y)).toBeGreaterThan(0);
  });

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
    expect(place!.identity).toContain('alphatechpark|104.03891|30.63747');
  });

  it('buildExtractResult collects places', () => {
    const items = (amapGetFav.data as { items: unknown[] }).items;
    const result = amapAdapter.buildExtractResult({ provider: 'amap', records: items, exhausted: true });
    expect(result.items).toHaveLength(2);
    expect(result.items.every((item) => item.kind === 'poi')).toBe(true);
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
    // id 现在基于归一化坐标指纹（跨来源稳定），而非像素坐标（易因亚像素精度差异产生重复）
    expect(item.id).toBe(amapFavoriteId(place));
    expect(item.id).toBe(md5(placeFingerprint(place)));
    expect(data.item_id).toBe(item.id);
    expect(data.custom_name).toBe('Alpha Tech Park');
    expect(data.phone_numbers).toBe('028-88886666');
  });

  it('amapFavoriteId is stable across conversion chains for the same place', () => {
    // 同一地点分别经 百度(bd09mc) 与 高德原生(amap_pixel) 两条转换链，
    // 得到的 wgs84 在 5 位小数（~1m）内一致 -> 指纹相同 -> amap id 相同 -> 不会被重复导入。
    const base: CanonicalPlace = {
      id: 'x',
      name: 'Same Place 国际中心',
      address: '',
      tags: [],
      note: '',
      wgs84: { lng: 104.03890, lat: 30.63746 },
      source: { provider: 'amap', crs: 'wgs84' },
      metadata: {},
    };
    // 模拟另一条转换链带来 <1m 的浮点漂移（落在同一 5 位小数桶内）
    const fromBaidu: CanonicalPlace = { ...base, id: 'y', wgs84: { lng: 104.038905, lat: 30.637464 }, metadata: {} };
    expect(placeFingerprint(base)).toBe(placeFingerprint(fromBaidu));
    expect(amapFavoriteId(base)).toBe(amapFavoriteId(fromBaidu));
    // 旧方案（像素坐标）在亚像素漂移下可能给出不同 id —— 此处确认新方案不再受其影响
    expect(amapFavoriteId(base)).toBe(md5(placeFingerprint(base)));
  });

  it('amapFavoriteId differs for genuinely different places', () => {
    const a: CanonicalPlace = {
      id: 'a', name: 'Place A', address: '', tags: [], note: '',
      wgs84: { lng: 104.0, lat: 30.0 }, source: { provider: 'amap', crs: 'wgs84' }, metadata: {},
    };
    const b: CanonicalPlace = {
      id: 'b', name: 'Place B', address: '', tags: [], note: '',
      wgs84: { lng: 105.0, lat: 31.0 }, source: { provider: 'amap', crs: 'wgs84' }, metadata: {},
    };
    expect(amapFavoriteId(a)).not.toBe(amapFavoriteId(b));
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
