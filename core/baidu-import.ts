export interface BaiduImportRecord {
  type?: string | number;
  detail?: { data?: unknown };
  extdata?: Record<string, unknown>;
  [key: string]: unknown;
}

function unwrap(record: BaiduImportRecord): BaiduImportRecord {
  const data = record.detail?.data;
  return data && typeof data === 'object' ? data as BaiduImportRecord : record;
}

function pointKey(point: unknown): string {
  if (!point || typeof point !== 'object') return '';
  const p = point as Record<string, unknown>;
  const x = Number(p.geoptx);
  const y = Number(p.geopty);
  // Coordinate conversion between Amap and Baidu can move a point by a few
  // meters. Quantize to a small cell so round trips still match, while the
  // name/mode/ordered-stop constraints prevent broad false positives.
  return Number.isFinite(x) && Number.isFinite(y) ? `${Math.round(x / 100)},${Math.round(y / 100)}` : '';
}

/** Stable target-side key for Baidu POI and Route favorites. */
export function baiduImportKey(raw: BaiduImportRecord): string | undefined {
  const record = unwrap(raw);
  const type = String(record.type ?? raw.type ?? '');
  const ext = record.extdata && typeof record.extdata === 'object' ? record.extdata : undefined;
  if (!ext) return undefined;
  if (['20', '21', '22', '23'].includes(type)) {
    const start = pointKey(ext.sfavnode);
    const end = pointKey(ext.efavnode);
    if (!start || !end) return undefined;
    const middle = Array.isArray(ext.wp) ? ext.wp.map(pointKey).filter(Boolean).join('>') : '';
    return `route|${type}|${start}>${middle}>${end}`;
  }
  const point = pointKey(ext);
  const name = String(ext.name ?? '').replace(/\s+/g, '').toLowerCase();
  return name && point ? `poi|${name}|${point}` : undefined;
}

export function filterDuplicateBaiduImportItems<T extends BaiduImportRecord>(current: BaiduImportRecord[], payload: T[]): { items: T[]; duplicates: T[] } {
  const seen = new Set(current.map(baiduImportKey).filter((key): key is string => Boolean(key)));
  const items: T[] = [];
  const duplicates: T[] = [];
  for (const item of payload) {
    const key = baiduImportKey(item);
    if (key && seen.has(key)) duplicates.push(item);
    else {
      items.push(item);
      if (key) seen.add(key);
    }
  }
  return { items, duplicates };
}
