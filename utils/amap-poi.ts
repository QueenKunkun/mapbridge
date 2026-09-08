import type { CanonicalPlace, LngLat } from '@/core/model';
import { gcj02ToWgs84 } from '@/core/coords';
import { normalizeName } from '@/core/dedup';

export interface AmapPoiCandidate {
  poiid: string;
  name: string;
  address: string;
  location: LngLat;
  cityCode?: string;
  cityName?: string;
  distanceMeters: number;
  nameScore: number;
}

export type AmapPoiMatch =
  | { status: 'matched'; candidate: AmapPoiCandidate }
  | { status: 'ambiguous' | 'not-found'; candidates: AmapPoiCandidate[] };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
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
  const location = readString(record, 'location', 'locationStr', 'lonlat');
  if (location) {
    const [lng, lat] = location.split(',').map(Number);
    if (Number.isFinite(lng) && Number.isFinite(lat)) return gcj02ToWgs84(lng!, lat!);
  }
  const lng = Number(record.longitude ?? record.lon ?? record.lng);
  const lat = Number(record.latitude ?? record.lat);
  return Number.isFinite(lng) && Number.isFinite(lat) ? gcj02ToWgs84(lng, lat) : undefined;
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j]!;
      row[j] = a[i - 1] === b[j - 1]
        ? diagonal
        : Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + 1);
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
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Extract the SSR search result list without depending on provider response wrappers elsewhere. */
export function parseAmapPoiCandidates(response: unknown, source: CanonicalPlace): AmapPoiCandidate[] {
  const root = asRecord(response);
  const outer = asRecord(root?.data);
  const data = asRecord(outer?.data) ?? outer;
  const list = data?.['poi_list'];
  if (!Array.isArray(list)) return [];

  return list.flatMap((value) => {
    const record = asRecord(value);
    if (!record) return [];
    const poiid = readString(record, 'poiid', 'id', 'uid');
    const name = readString(record, 'name', 'title');
    const location = readLocation(record);
    if (!poiid || !name || !location) return [];
    return [{
      poiid,
      name,
      address: readString(record, 'address', 'addr'),
      location,
      cityCode: readString(record, 'adcode', 'citycode', 'city_code') || undefined,
      cityName: readString(record, 'cityname', 'city_name', 'city') || undefined,
      distanceMeters: distanceMeters(source.wgs84, location),
      nameScore: nameScore(source.name, name),
    }];
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
  if (nearby.length === 0) return { status: 'not-found', candidates: [] };
  const first = nearby[0]!;
  const second = nearby[1];
  if (second && Math.abs(second.distanceMeters - first.distanceMeters) < 20 && second.nameScore >= first.nameScore - 0.03) {
    return { status: 'ambiguous', candidates: nearby.slice(0, 5) };
  }
  return { status: 'matched', candidate: first };
}
