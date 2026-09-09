export interface BaiduMercatorPoint {
  x: number;
  y: number;
}

export interface BaiduPoiMatch extends BaiduMercatorPoint {
  uid: string;
  name: string;
  address?: string;
  cityCode?: string;
  cityName?: string;
  districtCode?: string;
  districtName?: string;
  category?: string;
}

export interface BaiduPoiCandidate extends BaiduPoiMatch {
  distance: number;
}

function readPoint(value: unknown): BaiduMercatorPoint | undefined {
  const text = String(value ?? '');
  const match = /\|(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?);/.exec(text);
  if (!match) return undefined;
  const x = Number(match[1]);
  const y = Number(match[2]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

function records(response: unknown): Record<string, unknown>[] {
  if (!response || typeof response !== 'object') return [];
  const content = (response as Record<string, unknown>)['content'];
  return Array.isArray(content)
    ? content.filter(
        (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
      )
    : [];
}

function text(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

/** 将百度正式搜索接口的 content[] 转为可匹配的候选 POI。 */
export function parseBaiduPoiCandidates(response: unknown): BaiduPoiMatch[] {
  return records(response).flatMap((item) => {
    const uid = text(item, 'uid');
    const name = text(item, 'name');
    const rawX = Number(item['x']);
    const rawY = Number(item['y']);
    const x = Math.abs(rawX) > 100_000_000 ? rawX / 100 : rawX;
    const y = Math.abs(rawY) > 100_000_000 ? rawY / 100 : rawY;
    if (!uid || !name || !Number.isFinite(x) || !Number.isFinite(y)) return [];
    const admin =
      item['admin_info'] && typeof item['admin_info'] === 'object'
        ? (item['admin_info'] as Record<string, unknown>)
        : undefined;
    const apiAdmin =
      item['api_admin_info'] && typeof item['api_admin_info'] === 'object'
        ? (item['api_admin_info'] as Record<string, unknown>)
        : undefined;
    return [
      {
        uid,
        name,
        x,
        y,
        address: text(item, 'addr', 'poi_address') || undefined,
        cityCode: text(apiAdmin ?? {}, 'city_code') || text(admin ?? {}, 'city_id') || undefined,
        cityName: text(apiAdmin ?? {}, 'city_name') || text(admin ?? {}, 'city_name') || undefined,
        districtCode: text(admin ?? {}, 'area_id') || undefined,
        districtName: text(admin ?? {}, 'area_name') || undefined,
        category: text(item, 'std_tag', 'di_tag') || undefined,
      },
    ];
  });
}

/** 从全国搜索的城市聚合结果中选取离目标坐标最近的城市。 */
export function chooseBaiduSearchCity(
  response: unknown,
  target: BaiduMercatorPoint,
): number | undefined {
  let best: { code: number; distance: number } | undefined;
  for (const item of records(response)) {
    const code = Number(item['code']);
    const point = readPoint(item['geo']);
    if (!Number.isFinite(code) || !point) continue;
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    if (!best || distance < best.distance) best = { code, distance };
  }
  return best?.code;
}

/**
 * 只接受同名且足够接近的百度 POI，避免把同名异地地点导入为原生收藏。
 * 百度搜索响应中的 x/y 单位为百度墨卡托坐标的 1/100。
 */
export function chooseBaiduPoiMatch(
  response: unknown,
  target: BaiduMercatorPoint & { name: string },
  maxDistance = 3_000,
): BaiduPoiMatch | undefined {
  const candidates = parseBaiduPoiCandidates(response)
    .map((item) => ({ ...item, distance: Math.hypot(item.x - target.x, item.y - target.y) }))
    .filter((item) => normalizeName(item.name) === normalizeName(target.name))
    .sort((a, b) => a.distance - b.distance);
  const best = candidates[0];
  if (!best || best.distance > maxDistance) return undefined;
  const { distance: _distance, ...match } = best;
  return match;
}
import { normalizeName } from '@/core/dedup';
