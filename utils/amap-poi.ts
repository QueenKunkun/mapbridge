import type { CanonicalPlace, LngLat } from '@/core/model';
import type { AmapPoiMatchRecord, AmapPoiMatchStatus } from '@/core/jobs';
import { gcj02ToWgs84 } from '@/core/coords';
import { normalizeName } from '@/core/dedup';

export interface AmapPoiCandidate {
  poiid: string;
  name: string;
  address: string;
  location: LngLat;
  cityCode?: string;
  cityName?: string;
  adcode?: string;
  distanceMeters: number;
  nameScore: number;
}

export type AmapPoiMatch =
  | { status: 'matched'; candidate: AmapPoiCandidate; candidates: AmapPoiCandidate[] }
  | { status: 'ambiguous' | 'not-found'; candidates: AmapPoiCandidate[]; reason?: string };

/** Convert a matcher result to the compact record persisted by the background job. */
export function serializeAmapPoiMatch(match: AmapPoiMatch): Omit<AmapPoiMatchRecord, 'status'> & {
  status: Exclude<AmapPoiMatchStatus, 'idle' | 'matching'>;
} {
  const candidates = match.candidates.slice(0, 5).map((candidate) => ({
    poiid: candidate.poiid,
    name: candidate.name,
    address: candidate.address,
    location: candidate.location,
    distanceMeters: candidate.distanceMeters,
    nameScore: candidate.nameScore,
    cityCode: candidate.cityCode,
    cityName: candidate.cityName,
    adcode: candidate.adcode,
  }));
  return {
    status: match.status,
    candidates,
    ...('reason' in match && match.reason ? { reason: match.reason } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function readLocation(record: Record<string, unknown>): LngLat | undefined {
  const nestedLocation = record.location;
  if (nestedLocation && typeof nestedLocation === 'object') {
    const nested = nestedLocation as Record<string, unknown>;
    const nestedLng = Number(nested.lng ?? nested.lon ?? nested.longitude ?? nested.x);
    const nestedLat = Number(nested.lat ?? nested.latitude ?? nested.y);
    if (Number.isFinite(nestedLng) && Number.isFinite(nestedLat))
      return gcj02ToWgs84(nestedLng, nestedLat);
  }
  const location = readString(record, 'location', 'locationStr', 'lonlat');
  if (location) {
    const [lng, lat] = location.split(',').map(Number);
    if (Number.isFinite(lng) && Number.isFinite(lat)) return gcj02ToWgs84(lng!, lat!);
  }
  const lng = Number(record.longitude ?? record.lon ?? record.lng);
  const lat = Number(record.latitude ?? record.lat);
  if (Number.isFinite(lng) && Number.isFinite(lat)) return gcj02ToWgs84(lng, lat);
  const x = Number(record.x ?? record.x_entr ?? record.longitude ?? record.lon ?? record.lng);
  const y = Number(record.y ?? record.y_entr ?? record.latitude ?? record.lat);
  return Number.isFinite(x) && Number.isFinite(y) ? gcj02ToWgs84(x, y) : undefined;
}

function unwrapCandidate(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  for (const key of ['tip', 'poi', 'data']) {
    const nested = asRecord(record[key]);
    if (nested) return nested;
  }
  return record;
}

function findCandidateList(value: unknown, depth = 0): unknown[] {
  if (depth > 4) return [];
  const record = asRecord(value);
  if (!record) return [];
  if (Array.isArray(record.poi_list)) return record.poi_list;
  if (Array.isArray(record.tip_list)) return record.tip_list;
  for (const child of Object.values(record)) {
    const found = findCandidateList(child, depth + 1);
    if (found.length > 0) return found;
  }
  return [];
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j]!;
      row[j] =
        a[i - 1] === b[j - 1] ? diagonal : Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + 1);
      diagonal = previous;
    }
  }
  return row[b.length]!;
}

function nameScore(source: string, candidate: string): number {
  const a = normalizeName(source);
  const b = normalizeName(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function distanceMeters(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Extract the SSR search result list without depending on provider response wrappers elsewhere. */
export function parseAmapPoiCandidates(
  response: unknown,
  source: CanonicalPlace,
): AmapPoiCandidate[] {
  const root = asRecord(response);
  const list = findCandidateList(root);
  if (!Array.isArray(list)) return [];

  return list.flatMap((value) => {
    const record = unwrapCandidate(value);
    if (!record) return [];
    const poiid = readString(record, 'poiid', 'poi_id', 'poiId', 'id', 'uid');
    const name = readString(record, 'name', 'name_ch', 'title');
    const location = readLocation(record);
    if (!poiid || !name || !location) return [];
    const district = readString(record, 'district_name', 'districtName');
    const city = readString(record, 'cityname', 'city_name', 'cityName', 'city');
    return [
      {
        poiid,
        name,
        address: readString(record, 'address', 'addr') || [district, city].filter(Boolean).join(''),
        location,
        cityCode: readString(record, 'adcode', 'citycode', 'city_code') || undefined,
        cityName: city || undefined,
        adcode: readString(record, 'adcode') || undefined,
        distanceMeters: distanceMeters(source.wgs84, location),
        nameScore: nameScore(source.name, name),
      },
    ];
  });
}

/** Select only a single, nearby, high-confidence native POI. */
export function chooseAmapPoiMatch(
  candidates: AmapPoiCandidate[],
  options: { maxDistanceMeters?: number } = {},
): AmapPoiMatch {
  const maxDistance = options.maxDistanceMeters ?? 150;
  const nearby = candidates
    .filter((candidate) => candidate.distanceMeters <= maxDistance && candidate.nameScore >= 0.85)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || b.nameScore - a.nameScore);
  if (nearby.length === 0) {
    const ranked = [...candidates].sort(
      (a, b) => a.distanceMeters - b.distanceMeters || b.nameScore - a.nameScore,
    );
    const best = ranked[0];
    const reason = !best
      ? '搜索接口没有返回可解析的 POI 候选'
      : `最佳候选“${best.name}”：距离 ${Math.round(best.distanceMeters)} 米，名称相似度 ${best.nameScore.toFixed(2)}；要求距离 ≤ ${maxDistance} 米且相似度 ≥ 0.85`;
    return { status: 'not-found', candidates: ranked.slice(0, 5), reason };
  }
  const first = nearby[0]!;
  const second = nearby[1];
  if (
    second &&
    Math.abs(second.distanceMeters - first.distanceMeters) < 20 &&
    second.nameScore >= first.nameScore - 0.03
  ) {
    return {
      status: 'ambiguous',
      candidates: nearby.slice(0, 5),
      reason: '存在距离和名称相似度都接近的多个候选',
    };
  }
  return { status: 'matched', candidate: first, candidates: nearby.slice(0, 5) };
}
