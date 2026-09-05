import { randomUUID } from '@/utils/uuid';
import type { CanonicalItem, CanonicalPlace, CanonicalRoute, Collection, RouteStop } from '@/core/model';
import { Crs } from '@/core/model';
import { placeIdentity, routeIdentity } from '@/core/dedup';
import { migratePlaceToPoi } from '@/core/export';
import { toWgs84, wgs84ToBd09mc } from '@/core/coords';
import type { ProviderAdapter, RawExtract, RawImportResult } from '../types';

interface BaiduMercator {
  x: number;
  y: number;
}

/** 沿路径安全取值：返回第一个已定义值。 */
function pick(record: Record<string, unknown>, paths: string[][]): unknown {
  for (const path of paths) {
    let node: unknown = record;
    let found = true;
    for (const key of path) {
      if (!node || typeof node !== 'object' || !(key in (node as Record<string, unknown>))) {
        found = false;
        break;
      }
      node = (node as Record<string, unknown>)[key];
    }
    if (found) return node;
  }
  return undefined;
}

/** 从多种已知百度收藏字段形态里读取墨卡托坐标。 */
function readMercator(raw: Record<string, unknown>): BaiduMercator | null {
  const asNumber = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  const ext = pick(raw, [['extdata'], ['detail', 'data', 'extdata']]) as Record<string, unknown> | undefined;
  const detailPoint = pick(raw, [
    ['sourcedata', 'ext', 'detail_info', 'point'],
    ['detail', 'data', 'sourcedata', 'ext', 'detail_info', 'point'],
    ['raw', 'sourcedata', 'ext', 'detail_info', 'point'],
  ]) as Record<string, unknown> | undefined;

  const x = asNumber(
    pick(raw, [
      ['locx'],
      ['bd09mc_x'],
      ['bd_mercator_x'],
      ['location', 'bd09mc_x'],
      ['detail', 'data', 'location', 'bd09mc_x'],
    ]) ??
      (ext && (ext['geoptx'] ?? ext['getptx'])) ??
      (detailPoint && detailPoint['x']),
  );
  const y = asNumber(
    pick(raw, [
      ['locy'],
      ['bd09mc_y'],
      ['bd_mercator_y'],
      ['location', 'bd09mc_y'],
      ['detail', 'data', 'location', 'bd09mc_y'],
    ]) ??
      (ext && (ext['geopty'] ?? ext['getpty'])) ??
      (detailPoint && detailPoint['y']),
  );

  if (Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0)) {
    return { x, y };
  }
  return null;
}

function readName(raw: Record<string, unknown>): string {
  return String(
    pick(raw, [
      ['name'],
      ['detail', 'data', 'name'],
      ['extdata', 'name'],
      ['detail', 'data', 'extdata', 'name'],
      ['sourcedata', 'name'],
      ['detail', 'data', 'sourcedata', 'name'],
      ['raw', 'sourcedata', 'name'],
    ]) ?? '',
  ).trim();
}

/** 从 extdata.content（`地址:...<br/>电话:...`）解析出地址与电话。 */
function readFromContent(content: unknown): { address: string; phone: string } {
  const raw = String(content ?? '')
    .replace(/<br\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ');
  let address = '';
  let phone = '';
  for (const line of raw.split('\n')) {
    const addrMatch = /^\s*地址[:：]\s*(.*)$/.exec(line);
    const telMatch = /^\s*电话[:：]\s*(.*)$/.exec(line);
    if (addrMatch) address = (addrMatch[1] ?? '').trim();
    else if (telMatch) phone = (telMatch[1] ?? '').trim();
  }
  return { address, phone };
}

function readAddress(raw: Record<string, unknown>): string {
  const content = readFromContent(
    pick(raw, [['extdata', 'content'], ['detail', 'data', 'extdata', 'content']]),
  );
  return (
    String(
      pick(raw, [
        ['addr'],
        ['address'],
        ['detail', 'data', 'addr'],
        ['sourcedata', 'addr'],
        ['detail', 'data', 'sourcedata', 'addr'],
        ['raw', 'sourcedata', 'addr'],
      ]) ?? '',
    ).trim() || content.address
  );
}

function readTags(raw: Record<string, unknown>): string[] {
  const tags = pick(raw, [['tags'], ['detail', 'data', 'tags']]);
  if (Array.isArray(tags)) {
    return tags
      .map((t) => (t && typeof t === 'object' && 'name' in t ? String((t as { name: unknown }).name) : String(t ?? '')))
      .filter(Boolean);
  }
  return String(tags ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function readUid(raw: Record<string, unknown>): string {
  return String(
    pick(raw, [
      ['uid'],
      ['fid'],
      ['sid'],
      ['sourceid'],
      ['sourcedata', 'uid'],
      ['detail', 'data', 'sourcedata', 'uid'],
      ['detail', 'data', 'extdata', 'uid'],
      ['raw', 'sourcedata', 'uid'],
    ]) ?? '',
  );
}

function readPhone(raw: Record<string, unknown>): string {
  const content = readFromContent(
    pick(raw, [['extdata', 'content'], ['detail', 'data', 'extdata', 'content']]),
  );
  return (
    String(
      pick(raw, [
        ['tel'],
        ['sourcedata', 'tel'],
        ['detail', 'data', 'sourcedata', 'tel'],
        ['raw', 'sourcedata', 'tel'],
      ]) ?? '',
    ).trim() || content.phone
  );
}

function readCreatedAt(raw: Record<string, unknown>): string | undefined {
  const t = pick(raw, [['ctime'], ['detail', 'data', 'ctime']]);
  return t == null || t === '' ? undefined : String(t);
}

export function normalizeBaidu(raw: unknown): CanonicalPlace | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  const name = readName(record);
  const point = readMercator(record);
  if (!name || !point) return null;

  const wgs84 = toWgs84({ crs: 'bd09mc', lng: point.x, lat: point.y });

  const place: CanonicalPlace = {
    id: randomUUID(),
    name,
    address: readAddress(record),
    tags: readTags(record),
    note: '',
    wgs84,
    source: {
      provider: 'baidu',
      crs: 'bd09mc',
      original: { crs: 'bd09mc', lng: point.x, lat: point.y },
    },
    metadata: {
      uid: readUid(record),
      phone: readPhone(record) || undefined,
      createdAt: readCreatedAt(record),
    },
  };
  place.identity = placeIdentity(place);
  return place;
}

interface BaiduRouteNode {
  name: string;
  point: BaiduMercator;
  uid?: string;
}

function readRouteNode(extdata: Record<string, unknown>, key: 'sfavnode' | 'efavnode'): BaiduRouteNode | null {
  const node = extdata[key];
  if (!node || typeof node !== 'object') return null;
  const record = node as Record<string, unknown>;
  const x = Number(record['geoptx']);
  const y = Number(record['geopty']);
  const name = String(record['name'] ?? '').trim();
  if (!name || !Number.isFinite(x) || !Number.isFinite(y) || (x === 0 && y === 0)) return null;
  return { name, point: { x, y }, uid: record['uid'] ? String(record['uid']) : undefined };
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : undefined;
}

function baiduRecordLabel(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const detail = record['detail'] && typeof record['detail'] === 'object' ? record['detail'] as Record<string, unknown> : undefined;
  const data = detail?.['data'] && typeof detail['data'] === 'object' ? detail['data'] as Record<string, unknown> : record;
  const ext = data['extdata'] && typeof data['extdata'] === 'object' ? data['extdata'] as Record<string, unknown> : undefined;
  const type = data['type'];
  const name = ext?.['pathname'] ?? ext?.['name'] ?? record['name'];
  const id = record['sid'] ?? record['cid'] ?? data['fid'];
  const parts = [type != null ? `type:${String(type)}` : '', name ? String(name).trim() : '', id ? `ID:${String(id)}` : ''].filter(Boolean);
  return parts.join(' · ') || undefined;
}

/** 将百度 type 20/21/22/23 路线收藏归一化为有序 stops，不将 stops 伪装成道路几何。 */
export function normalizeBaiduRoute(raw: unknown): CanonicalRoute | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const detail = record['detail'];
  const data = detail && typeof detail === 'object'
    ? (detail as Record<string, unknown>)['data']
    : record;
  if (!data || typeof data !== 'object') return null;
  const routeData = data as Record<string, unknown>;
  const routeType = String(routeData['type'] ?? '');
  if (!['20', '21', '22', '23'].includes(routeType)) return null;
  const extdata = routeData['extdata'];
  if (!extdata || typeof extdata !== 'object') return null;
  const ext = extdata as Record<string, unknown>;
  const start = readRouteNode(ext, 'sfavnode');
  const end = readRouteNode(ext, 'efavnode');
  const pathname = String(ext['pathname'] ?? '').trim();
  if (!start || !end || !pathname) return null;

  const toStop = (node: BaiduRouteNode, role: RouteStop['role']): RouteStop => ({
    role,
    name: node.name,
    point: toWgs84({ crs: 'bd09mc', lng: node.point.x, lat: node.point.y }),
    sourceRecordId: node.uid,
  });
  const routing = {
    pathType: readOptionalNumber(ext, 'pathtype'),
    planKind: readOptionalNumber(ext, 'plankind'),
    transitKind: String(ext['transkind'] ?? '') || undefined,
    pageNumber: readOptionalNumber(ext, 'pagenumber'),
    busIndex: readOptionalNumber(ext, 'busidx'),
  };
  const route: CanonicalRoute = {
    kind: 'route',
    id: randomUUID(),
    name: pathname,
    stops: [toStop(start, 'start'), toStop(end, 'end')],
    // Baidu route favorite types identify the mode even when transkind is empty.
    travelMode: ({ '20': 'driving', '21': 'transit', '22': 'walking', '23': 'cycling' } as Record<string, string>)[routeType] ?? routing.transitKind,
    routing,
    source: {
      provider: 'baidu',
      crs: 'bd09mc',
      recordId: String(record['sid'] ?? record['cid'] ?? routeData['fid'] ?? '') || undefined,
    },
    metadata: {
      createdAt: readCreatedAt(record),
      updatedAt: routeData['mtime'] == null ? undefined : String(routeData['mtime']),
    },
  };
  route.identity = routeIdentity(route);
  return route;
}

export const baiduAdapter: ProviderAdapter = {
  id: 'baidu',
  name: '百度地图',
  hosts: ['map.baidu.com', 'ditu.baidu.com', 'newclient.map.baidu.com'],
  extractPage: 'https://map.baidu.com/fav/',
  importPage: 'https://map.baidu.com/fav/',
  crs: 'bd09mc',
  capabilities: { canExtract: true, canImport: true, extractKinds: ['poi', 'route'], importKinds: ['poi', 'route'] },

  normalize: normalizeBaidu,

  buildExtractResult(raw: RawExtract) {
    const items: CanonicalItem[] = [];
    const places: CanonicalPlace[] = [];
    const skipped: { index: number; reason: string; label?: string }[] = [];
    const seenIds = new Set<string>();

    raw.records.forEach((record, index) => {
      if (!record || typeof record !== 'object') {
        skipped.push({ index, reason: '空记录' });
        return;
      }
      const r = record as Record<string, unknown>;
      const detail = r['detail'] as Record<string, unknown> | undefined;
      if (r['action'] === 'del' || detail?.data === false) {
        skipped.push({ index, reason: '源地图已标记为删除，已跳过', label: baiduRecordLabel(record) });
        return;
      }
      const route = normalizeBaiduRoute(record);
      if (route) {
        items.push(route);
        return;
      }
      const place = normalizeBaidu(record);
      if (!place) {
        skipped.push({ index, reason: '缺少名称或百度墨卡托坐标', label: baiduRecordLabel(record) });
        return;
      }
      const dedupKey = `${place.name}|${place.wgs84.lng.toFixed(5)}|${place.wgs84.lat.toFixed(5)}`;
      if (seenIds.has(dedupKey)) {
        skipped.push({ index, reason: '重复收藏', label: baiduRecordLabel(record) });
        return;
      }
      seenIds.add(dedupKey);
      places.push(place);
      items.push(migratePlaceToPoi(place));
    });

    const collection: Collection = {
      id: randomUUID(),
      name: '百度地图收藏夹',
      provider: 'baidu',
      placeCount: items.length,
      createdAt: new Date().toISOString(),
    };

    return { collection, items, places, skipped, rawCount: raw.records.length };
  },

  buildImportPayload(places: CanonicalPlace[]): unknown {
    return places.map((p) => {
      const mc = wgs84ToBd09mc(p.wgs84.lng, p.wgs84.lat);
      const extdata: Record<string, string> = {
        name: p.name,
        geoptx: mc.x.toFixed(2),
        geopty: mc.y.toFixed(2),
      };
      // 跨地图导入没有百度 POI uid，不能伪装成 type 10（百度原生 POI 收藏）。
      // 百度页面对无 uid 的地点使用 type 11，并将可显示的信息放入 content。
      const content = [p.address ? `地址:${p.address}` : '', p.metadata.phone ? `电话:${p.metadata.phone}` : '']
        .filter(Boolean)
        .join('<br/>');
      if (content) extdata.content = content;
      return {
        type: '11',
        sourceid: '',
        plateform: 3,
        fromapp: '百度地图',
        extdata,
      };
    });
  },

  buildImportItemsPayload(items: CanonicalItem[], places: CanonicalPlace[]): unknown[] {
    const payload = this.buildImportPayload(places) as unknown[];
    const routeTypes: Record<string, string> = {
      driving: '20',
      drive: '20',
      car: '20',
      transit: '21',
      bus: '21',
      walking: '22',
      walk: '22',
      foot: '22',
      cycling: '23',
      ride: '23',
      '13': '23',
      '14': '23',
    };
    for (const item of items) {
      if (item.kind !== 'route') continue;
      const type = routeTypes[item.travelMode?.toLowerCase() ?? ''];
      if (!type) throw new Error('Baidu Route import requires an explicit supported travel mode');
      const start = item.stops[0]!;
      const end = item.stops[item.stops.length - 1]!;
      const point = (stop: typeof start) => {
        const mc = wgs84ToBd09mc(stop.point.lng, stop.point.lat);
        return {
          cityid: 0,
          geoptx: Number(mc.x.toFixed(2)),
          geopty: Number(mc.y.toFixed(2)),
          uid: stop.sourceRecordId ?? '',
          name: stop.name,
          type: 1,
        };
      };
      payload.push({
        type,
        plateform: 3,
        fromapp: '百度地图',
        extdata: {
          sfavnode: point(start),
          efavnode: point(end),
          pathname: item.name,
          pathtype: item.routing.pathType ?? 0,
          plankind: item.routing.planKind ?? 0,
          transkind: item.routing.transitKind ?? '',
          pagenumber: item.routing.pageNumber ?? 0,
          wp: item.stops.slice(1, -1).map(point),
          curcityid: 0,
          busidx: item.routing.busIndex ?? 0,
          type: 1,
          routeIndex: 0,
        },
      });
    }
    return payload;
  },

  summarizeImportResult(result: RawImportResult) {
    const raw = result.raw as { imported?: number; duplicates?: number; failed?: number } | undefined;
    const imported = raw?.imported ?? (result.done ? 1 : 0);
    const failed = raw?.failed ?? (result.error ? 1 : 0);
    return {
      imported,
      skippedDuplicates: raw?.duplicates ?? 0,
      failed,
      failedItems: result.error ? [{ placeId: '', error: result.error }] : [],
      targetCount: result.targetCount,
      raw: result.raw,
    };
  },
};
