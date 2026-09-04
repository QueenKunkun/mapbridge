import { describe, expect, it } from 'vitest';
import { normalizeBaidu, normalizeBaiduRoute, baiduAdapter } from '@/adapters/baidu';

// Synthetic records (structurally identical to captured favorites; all names/coords/ids are fictional).
const shareItems: Record<string, unknown>[] = [
  {
    name: 'Alpha Tech Park',
    address: 'No.8 Gaoshengqiao East Rd, Wuhou District, Chengdu',
    tel: '028-88886666',
    bd_mercator_x: '11582672.01',
    bd_mercator_y: '3564275.74',
  },
  {
    name: 'Beta International Airport',
    locx: '12623000.00',
    locy: '2550000.00',
  },
];

const visitshareFav = {
  favdatas: {
    tag: { name: '咖啡店', status: '1' },
    fav: [
      { name: 'Alpha Tech Park', bd_mercator_x: '11582672.01', bd_mercator_y: '3564275.74', tags: [{ name: '咖啡店' }] },
      { name: 'Gamma Coffee', bd_mercator_x: '11582000.00', bd_mercator_y: '3563000.00', tags: [{ name: '咖啡店' }] },
    ],
  },
};

const favdataReal = {
  sync: {
    newdata: [
      {
        sid: 's1', cid: 'c1', status: '100',
        detail: { data: { type: '10', fid: 'f1', extdata: { name: 'Delta Seaside Hotel', content: '地址:No.1 Ocean Rd, Sanya<br/>电话:(0898)66600832', geoptx: '12192640.01', geopty: '2050703' } } },
        action: 'add', ver: 'v1',
      },
      { sid: 's2', cid: 'c2', status: '100', detail: { data: { type: '10', extdata: { name: 'Epsilon Resort', content: '地址:No.2 Bay Rd, Sanya<br/>电话:(0898)66601111', geoptx: '12190084.42', geopty: '2051648.76' } } }, action: 'add', ver: 'v1' },
      { sid: 's5', cid: 'c5', status: '100', detail: { data: { type: '10', extdata: { name: 'Zeta Mountain Lodge', content: '地址:No.5 Hill Rd, Sanya', geoptx: '12187000.00', geopty: '2052500.00' } } }, action: 'add', ver: 'v1' },
      { sid: 's6', cid: 'c6', status: '100', detail: { data: { type: '10', extdata: { name: 'Eta Plaza', content: '地址:No.6 Plaza St, Sanya', geoptx: '12184000.00', geopty: '2053000.00' } } }, action: 'add', ver: 'v1' },
      { sid: 's7', cid: 'c7', status: '100', detail: { data: { type: '10', extdata: { name: 'Theta Garden', content: '地址:No.7 Garden Rd, Sanya', geoptx: '12181000.00', geopty: '2054000.00' } } }, action: 'add', ver: 'v1' },
      { sid: 's8', cid: 'c8', status: '100', detail: { data: { type: '10', extdata: { name: 'Iota Mall', content: '地址:No.8 Mall Rd, Sanya', geoptx: '12178000.00', geopty: '2055000.00' } } }, action: 'add', ver: 'v1' },
      { sid: 's9', cid: 'c9', status: '100', detail: { data: { type: '10', extdata: { name: 'Kappa Park', content: '地址:No.9 Park Rd, Sanya', geoptx: '12175000.00', geopty: '2056000.00' } } }, action: 'add', ver: 'v1' },
      { sid: 's10', cid: 'c10', status: '100', detail: { data: { type: '10', extdata: { name: 'Lambda Bay', content: '地址:No.10 Bay Rd, Sanya', geoptx: '12172000.00', geopty: '2057000.00' } } }, action: 'add', ver: 'v1' },
      { action: 'del', sid: 's3', detail: { data: false } },
      { action: 'del', sid: 's4', detail: { data: false } },
    ],
  },
};

const routeFavorite = {
  sid: '20_route-1',
  cid: '20_route-1',
  status: '100',
  action: 'add',
  ver: 'route-ver',
  detail: {
    data: {
      type: '20',
      fid: '20_route-1',
      ctime: '1700000000',
      mtime: '1700000001',
      extdata: {
        pathname: '自驾路线',
        pathtype: 1,
        plankind: 2,
        transkind: 'driving',
        pagenumber: 0,
        busidx: 0,
        sfavnode: { cityid: 1, geoptx: 11582672.01, geopty: 3564275.74, uid: 'start-1', name: '起点', type: 1 },
        efavnode: { cityid: 1, geoptx: 11583000.01, geopty: 3564500.74, uid: 'end-1', name: '终点', type: 1 },
      },
    },
  },
};

describe('baidu adapter', () => {
  it('declares Route extraction but POI-only provider import', () => {
    expect(baiduAdapter.capabilities.extractKinds).toEqual(['poi', 'route']);
    expect(baiduAdapter.capabilities.importKinds).toEqual(['poi']);
  });

  it('normalizes a share-item record (bd_mercator_x/y fields)', () => {
    const place = normalizeBaidu(shareItems[0]!);
    expect(place).not.toBeNull();
    expect(place!.name).toBe('Alpha Tech Park');
    expect(place!.address).toContain('Gaoshengqiao East Rd');
    expect(place!.metadata.phone).toBe('028-88886666');
    // bd09mc(11582672.01, 3564275.74) -> wgs84 (104.03890, 30.63746)
    expect(place!.wgs84.lng).toBeCloseTo(104.03890680461457, 6);
    expect(place!.wgs84.lat).toBeCloseTo(30.637464954736895, 6);
    expect(place!.source.crs).toBe('bd09mc');
    expect(place!.identity).toContain('alphatechpark|104.03891|30.63746');
  });

  it('normalizes a locx/locy record', () => {
    const place = normalizeBaidu(shareItems[1]!);
    expect(place).not.toBeNull();
    expect(place!.name).toBe('Beta International Airport');
    expect(place!.wgs84.lng).toBeCloseTo(113.3811704492639, 6);
    expect(place!.wgs84.lat).toBeCloseTo(22.45331314423043, 6);
  });

  it('normalizes visitshare fav records and keeps tag', () => {
    const records = (visitshareFav.favdatas as { fav: unknown[] }).fav;
    const result = baiduAdapter.buildExtractResult({ provider: 'baidu', records, exhausted: true });
    expect(result.places).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);
    expect(result.collection.name).toBe('百度地图收藏夹');
  });

  it('skips records without coordinates', () => {
    const result = baiduAdapter.buildExtractResult({
      provider: 'baidu',
      records: [{ name: '无名点' }, { name: '坏点', bd_mercator_x: '0', bd_mercator_y: '0' }],
      exhausted: true,
    });
    expect(result.places).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
  });

  it('deduplicates identical name+coords', () => {
    const record = shareItems[0]!;
    const result = baiduAdapter.buildExtractResult({
      provider: 'baidu',
      records: [record, record],
      exhausted: true,
    });
    expect(result.places).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.reason).toBe('重复收藏');
  });

  it('buildImportPayload uses the custom-place format when no Baidu POI uid exists', () => {
    const place = {
      id: 'test-1',
      name: 'Alpha Tech Park',
      address: 'No.8 Gaoshengqiao East Rd',
      note: '',
      tags: ['咖啡店'],
      wgs84: { lng: 104.038906, lat: 30.637465 },
      source: { provider: 'baidu' as const, crs: 'bd09mc' as const, lng: 11582672.01, lat: 3564275.74 },
      metadata: {},
    };
    const payloads = baiduAdapter.buildImportPayload([place]) as Array<Record<string, unknown>>;
    expect(payloads).toHaveLength(1);
    const payload = payloads[0]!;
    expect(payload.type).toBe('11');
    expect(payload.sourceid).toBe('');
    expect(payload.plateform).toBe(3);
    expect(payload.fromapp).toBe('百度地图');
    const extdata = payload.extdata as Record<string, string>;
    expect(extdata.name).toBe('Alpha Tech Park');
    expect(extdata.content).toBe('地址:No.8 Gaoshengqiao East Rd');
    // geoptx/geopty must be Baidu mercator coordinates (wgs84 -> mc round-trips)
    expect(Math.abs(Number(extdata.geoptx) - 11582672.01)).toBeLessThan(1);
    expect(Math.abs(Number(extdata.geopty) - 3564275.74)).toBeLessThan(1);
  });

  it('normalizes favdata records (detail.data.extdata.geoptx/geopty)', () => {
    const records = (favdataReal.sync as { newdata: unknown[] }).newdata;
    const result = baiduAdapter.buildExtractResult({ provider: 'baidu', records, exhausted: true });
    expect(result.places.length).toBeGreaterThanOrEqual(8);
    const first = result.places[0]!;
    expect(first.name).toBe('Delta Seaside Hotel');
    expect(first.address).toContain('No.1 Ocean Rd');
    expect(first.metadata.phone).toBe('(0898)66600832');
    expect(first.source.crs).toBe('bd09mc');
    // geoptx/geopty are BD-09 mercator -> wgs84 sanity
    expect(first.wgs84.lng).toBeGreaterThan(100);
    expect(first.wgs84.lat).toBeGreaterThan(10);
  });

  it('skips deleted favdata records (action=del / detail.data=false)', () => {
    const records = (favdataReal.sync as { newdata: unknown[] }).newdata;
    const result = baiduAdapter.buildExtractResult({ provider: 'baidu', records, exhausted: true });
    const deleted = result.skipped.filter((s) => s.reason === '源地图已标记为删除，已跳过');
    expect(deleted.length).toBeGreaterThanOrEqual(2);
    expect(result.skipped.length).toBeGreaterThanOrEqual(2);
  });

  it('normalizes a confirmed type 20 route into ordered WGS-84 stops', () => {
    const route = normalizeBaiduRoute(routeFavorite);
    expect(route).not.toBeNull();
    expect(route!.kind).toBe('route');
    expect(route!.name).toBe('自驾路线');
    expect(route!.stops.map((stop) => stop.role)).toEqual(['start', 'end']);
    expect(route!.stops[0]!.name).toBe('起点');
    expect(route!.stops[1]!.sourceRecordId).toBe('end-1');
    expect(route!.stops[0]!.point.lng).toBeGreaterThan(100);
    expect(route!.routing).toMatchObject({ pathType: 1, planKind: 2, transitKind: 'driving' });
    expect(route!.source.recordId).toBe('20_route-1');
    expect(route!.identity).toContain('自驾路线|起点@');
  });

  it('includes confirmed routes in unified extraction items while keeping POI places compatible', () => {
    const result = baiduAdapter.buildExtractResult({ provider: 'baidu', records: [routeFavorite, shareItems[0]!], exhausted: true });
    expect(result.items.map((item) => item.kind)).toEqual(['route', 'poi']);
    expect(result.places).toHaveLength(1);
    expect(result.collection.placeCount).toBe(2);
  });

  it('rejects a type 20 route without a valid endpoint', () => {
    const invalid = structuredClone(routeFavorite) as Record<string, unknown>;
    (((invalid.detail as Record<string, unknown>).data as Record<string, unknown>).extdata as Record<string, unknown>).efavnode = {};
    expect(normalizeBaiduRoute(invalid)).toBeNull();
  });
});
