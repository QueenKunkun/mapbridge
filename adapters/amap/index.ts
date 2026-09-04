import { randomUUID } from '@/utils/uuid';
import { md5 } from '@/utils/md5';
import { migratePlaceToPoi } from '@/core/export';
import { placeFingerprint, placeIdentity } from '@/core/dedup';
import type { CanonicalPlace, Collection } from '@/core/model';
import { Crs } from '@/core/model';
import { fromWgs84, gcj02ToAmapPixel, toWgs84 } from '@/core/coords';
import type { ProviderAdapter, RawExtract, RawImportResult } from '../types';
import type { ImportReport } from '@/core/jobs';

/** 高德收藏记录：getFav items[].data 的结构。 */
interface AmapFavoriteData {
  name?: string;
  custom_name?: string;
  address?: string;
  custom_address?: string;
  point_x?: number | string;
  point_y?: number | string;
  tag?: string;
  phone_numbers?: string;
  custom_phone_numbers?: string;
  city_name?: string;
}

function readPixelData(raw: Record<string, unknown>): { x: number; y: number } | null {
  const data = (raw['data'] ?? raw) as Record<string, unknown> | undefined;
  if (!data) return null;
  const x = Number(data['point_x']);
  const y = Number(data['point_y']);
  if (Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0)) {
    return { x, y };
  }
  return null;
}

export function normalizeAmap(raw: unknown): CanonicalPlace | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const data = (record['data'] ?? record) as Record<string, unknown> | undefined;
  if (!data) return null;

  const name = String(data['custom_name'] ?? data['name'] ?? '').trim();
  const pixel = readPixelData(record);
  if (!name || !pixel) return null;

  const wgs84 = toWgs84({ crs: 'amap_pixel', lng: pixel.x, lat: pixel.y });
  const tags = String(data['tag'] ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  const place: CanonicalPlace = {
    id: randomUUID(),
    name,
    address: String(data['custom_address'] ?? data['address'] ?? '').trim(),
    tags,
    note: '',
    wgs84,
    source: {
      provider: 'amap',
      crs: 'amap_pixel',
      original: { crs: 'amap_pixel', lng: pixel.x, lat: pixel.y },
    },
    metadata: {
      uid: record['id'] ? String(record['id']) : undefined,
      phone: String(data['custom_phone_numbers'] ?? data['phone_numbers'] ?? '') || undefined,
    },
  };
  place.identity = placeIdentity(place);
  return place;
}

/** 高德收藏 id：基于归一化坐标指纹生成，跨来源稳定（见 buildImportPayload 说明）。 */
export function amapFavoriteId(place: CanonicalPlace): string {
  return md5(placeFingerprint(place));
}

export const amapAdapter: ProviderAdapter = {
  id: 'amap',
  name: '高德地图',
  hosts: ['ditu.amap.com', 'amap.com', 'www.amap.com'],
  extractPage: 'https://ditu.amap.com/faves',
  importPage: 'https://ditu.amap.com/faves',
  crs: 'amap_pixel',
  capabilities: { canExtract: true, canImport: true, extractKinds: ['poi'], importKinds: ['poi'] },

  normalize: normalizeAmap,

  buildExtractResult(raw: RawExtract) {
    const places: CanonicalPlace[] = [];
    const skipped: { index: number; reason: string }[] = [];
    const seenIds = new Set<string>();

    raw.records.forEach((record, index) => {
      const place = normalizeAmap(record);
      if (!place) {
        skipped.push({ index, reason: '缺少名称或高德像素坐标' });
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
      name: '高德地图收藏夹',
      provider: 'amap',
      placeCount: places.length,
      createdAt: new Date().toISOString(),
    };

    return { collection, items: places.map(migratePlaceToPoi), places, skipped, rawCount: raw.records.length };
  },

  buildImportPayload(places: CanonicalPlace[]): unknown[] {
    const payload: Array<Record<string, unknown>> = [];
    for (const place of places) {
      const gcj02 = fromWgs84(place.wgs84, 'gcj02');
      const px = gcj02ToAmapPixel(gcj02.lng, gcj02.lat);
      // 用归一化坐标指纹生成稳定 id，使跨来源（百度/高德原生）同一地点落到同一 id，
      // 从而在高德合并阶段被正确判重，避免亚像素精度差异导致的重复收藏。
      const id = amapFavoriteId(place);
      const address = place.address || '';
      const phone = place.metadata.phone ?? '';
      const tags = place.tags.join(';');

      payload.push({
        id,
        type: 101,
        data: {
          item_id: id,
          custom_address: address,
          poiid: '',
          custom_name: place.name,
          type: '0',
          address,
          phone_numbers: phone,
          comment: place.note,
          name: place.name,
          point_x: px.x,
          point_y: px.y,
          top_time: '',
          city_code: '',
          custom_phone_numbers: phone,
          city_name: '',
          tag: tags,
        },
        source: {
          uid: place.metadata.uid ?? '',
          folder: place.metadata.folder ?? '',
          wgs_lng: place.wgs84.lng,
          wgs_lat: place.wgs84.lat,
          gcj_lng: gcj02.lng,
          gcj_lat: gcj02.lat,
        },
      });
    }
    return payload;
  },

  summarizeImportResult(result: RawImportResult): ImportReport {
    const failedItems: { placeId: string; error: string }[] = [];
    let imported = 0;
    let skippedDuplicates = 0;

    if (result.error) {
      failedItems.push({ placeId: '', error: result.error });
    }

    // 若 MAIN 执行器带了明细（raw.detail），按条统计。
    const detail = result.raw && typeof result.raw === 'object'
      ? (result.raw as { detail?: Array<{ id?: string; status?: string; error?: string }> }).detail
      : undefined;
    if (Array.isArray(detail)) {
      for (const item of detail) {
        if (item.status === 'duplicate') skippedDuplicates += 1;
        else if (item.status === 'failed' || item.error) {
          failedItems.push({ placeId: item.id ?? '', error: item.error ?? '未知错误' });
        } else imported += 1;
      }
    }

    return {
      imported,
      skippedDuplicates,
      failed: failedItems.length,
      failedItems,
      targetCount: result.targetCount,
      raw: result.raw,
    };
  },
};
