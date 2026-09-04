import type { CanonicalPlace, CanonicalRoute } from './model';

/** 规整化名称：去空白、转小写、折叠内部空格，用于指纹比对。 */
export function normalizeName(name: string): string {
  return name
    .replace(/\s+/g, '')
    .toLowerCase()
    .trim();
}

/**
 * 收藏指纹：规整化名称 + 5 位小数坐标（约 1m 精度）。
 * 与适配器内的去重保持一致；供跨来源合并与重复检测使用。
 */
export function placeFingerprint(place: CanonicalPlace): string {
  const lng = place.wgs84.lng.toFixed(5);
  const lat = place.wgs84.lat.toFixed(5);
  return `${normalizeName(place.name)}|${lng}|${lat}`;
}

/** 跨 provider 使用的 POI identity；保留可读指纹，目标平台再自行哈希。 */
export function placeIdentity(place: CanonicalPlace): string {
  return placeFingerprint(place);
}

/** Route identity：保留 stop 顺序，避免把相同端点但不同途经点的路线合并。 */
export function routeIdentity(route: CanonicalRoute): string {
  const stops = route.stops
    .map((stop) => `${normalizeName(stop.name)}@${stop.point.lng.toFixed(5)},${stop.point.lat.toFixed(5)}`)
    .join('>');
  return `${normalizeName(route.name)}|${stops}`;
}

export interface DedupResult {
  /** 保留下来的去重后集合。 */
  unique: CanonicalPlace[];
  /** 被判定重复、被移除的记录。 */
  duplicates: CanonicalPlace[];
}

/**
 * 去重。existing 可作为"已存在集合"（如目标地图现有收藏），
 * 指纹命中即视为重复。否则仅在传入集合内部去重。
 */
export function dedupPlaces(places: CanonicalPlace[], existing: CanonicalPlace[] = []): DedupResult {
  const seen = new Set(existing.map(placeIdentity));
  const unique: CanonicalPlace[] = [];
  const duplicates: CanonicalPlace[] = [];
  for (const place of places) {
    const fp = placeIdentity(place);
    if (seen.has(fp)) {
      duplicates.push(place);
    } else {
      seen.add(fp);
      unique.push(place);
    }
  }
  return { unique, duplicates };
}

/** 按名称近似搜索（用于预览编辑里的过滤）。 */
export function filterByName(places: CanonicalPlace[], query: string): CanonicalPlace[] {
  const q = normalizeName(query);
  if (!q) return places;
  return places.filter((p) => normalizeName(p.name).includes(q));
}
