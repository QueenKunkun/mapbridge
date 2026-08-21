import { randomUUID } from '@/utils/uuid';
import type { CanonicalPlace, Collection } from '@/core/model';
import { Crs } from '@/core/model';
import { toWgs84 } from '@/core/coords';
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

  return {
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
}

export const baiduAdapter: ProviderAdapter = {
  id: 'baidu',
  name: '百度地图',
  hosts: ['map.baidu.com', 'ditu.baidu.com', 'newclient.map.baidu.com'],
  extractPage: 'https://map.baidu.com/fav/',
  importPage: 'https://map.baidu.com/fav/',
  crs: 'bd09mc',
  capabilities: { canExtract: true, canImport: false },

  normalize: normalizeBaidu,

  buildExtractResult(raw: RawExtract) {
    const places: CanonicalPlace[] = [];
    const skipped: { index: number; reason: string }[] = [];
    const seenIds = new Set<string>();

    raw.records.forEach((record, index) => {
      if (!record || typeof record !== 'object') {
        skipped.push({ index, reason: '空记录' });
        return;
      }
      const r = record as Record<string, unknown>;
      const detail = r['detail'] as Record<string, unknown> | undefined;
      if (r['action'] === 'del' || detail?.data === false) {
        skipped.push({ index, reason: '已删除' });
        return;
      }
      const place = normalizeBaidu(record);
      if (!place) {
        skipped.push({ index, reason: '缺少名称或百度墨卡托坐标' });
        return;
      }
      const dedupKey = `${place.name}|${place.wgs84.lng.toFixed(5)}|${place.wgs84.lat.toFixed(5)}`;
      if (seenIds.has(dedupKey)) {
        skipped.push({ index, reason: '重复收藏' });
        return;
      }
      seenIds.add(dedupKey);
      places.push(place);
    });

    const collection: Collection = {
      id: randomUUID(),
      name: '百度地图收藏夹',
      provider: 'baidu',
      placeCount: places.length,
      createdAt: new Date().toISOString(),
    };

    return { collection, places, skipped, rawCount: raw.records.length };
  },

  buildImportPayload(_places) {
    // 百度导入接口需抓包确认；当前不可导入。
    throw new Error('百度导入尚未实现（需要抓包确认收藏写入接口）');
  },

  summarizeImportResult(result: RawImportResult) {
    return {
      imported: result.done ? 1 : 0,
      skippedDuplicates: 0,
      failed: result.error ? 1 : 0,
      failedItems: result.error ? [{ placeId: '', error: result.error }] : [],
      targetCount: result.targetCount,
      raw: result.raw,
    };
  },
};