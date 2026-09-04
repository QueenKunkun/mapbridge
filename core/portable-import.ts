import { XMLParser } from 'fast-xml-parser';
import { randomUUID } from '@/utils/uuid';
import { placeIdentity } from './dedup';
import type { CanonicalPoi, CanonicalPlace, ProviderId } from './model';

export interface PortableImportResult {
  items: CanonicalPoi[];
  places: CanonicalPlace[];
  warnings: string[];
}

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (value && typeof value === 'object' && '#text' in value) return text((value as Record<string, unknown>)['#text']);
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function extensionValue(extensions: Record<string, unknown> | undefined, name: string): string {
  return text(extensions?.[`mapbridge:${name}`] ?? extensions?.[name]);
}

function coordinates(value: unknown): { lng: number; lat: number } | null {
  const parts = text(value).split(',');
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
}

function createPoi(
  name: string,
  point: { lng: number; lat: number },
  description: string,
  provider: ProviderId,
  adapterVersion: string,
  metadata: Record<string, string | undefined> = {},
): CanonicalPoi {
  const place: CanonicalPlace = {
    id: randomUUID(),
    name: name || '未命名地点',
    address: description,
    tags: metadata.tags ? metadata.tags.split(';').filter(Boolean) : [],
    note: '',
    wgs84: point,
    source: { provider, crs: 'wgs84', recordId: metadata.sourceRecordId },
    metadata: { phone: metadata.phone, folder: metadata.folder },
  };
  return {
    kind: 'poi',
    id: place.id,
    identity: metadata.identity || placeIdentity(place),
    name: place.name,
    address: place.address,
    tags: place.tags,
    note: place.note,
    geometry: { type: 'point', point },
    source: { provider, crs: 'wgs84', recordId: metadata.sourceRecordId, adapterVersion },
    metadata: place.metadata,
  };
}

function parseGpx(raw: Record<string, unknown>, provider: ProviderId): PortableImportResult {
  const gpx = raw.gpx as Record<string, unknown> | undefined;
  const items: CanonicalPoi[] = [];
  const warnings: string[] = [];
  for (const waypoint of asArray(gpx?.wpt as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    const point = coordinates(`${text(waypoint['@_lon'])},${text(waypoint['@_lat'])}`);
    if (!point) {
      warnings.push('GPX 中有 waypoint 缺少有效坐标，已跳过');
      continue;
    }
    const extension = waypoint.extensions as Record<string, unknown> | undefined;
    items.push(createPoi(
      text(waypoint.name), point, text(waypoint.desc), provider, 'gpx', {
        tags: extensionValue(extension, 'tags'), phone: extensionValue(extension, 'phone'), folder: extensionValue(extension, 'folder'),
        identity: extensionValue(extension, 'identity'), sourceRecordId: extensionValue(extension, 'sourceRecordId'),
      },
    ));
  }
  if (asArray(gpx?.rte as unknown).length > 0) warnings.push('GPX 中包含 Route，当前仅支持导入 waypoint，Route 已跳过');
  if (items.length === 0) throw new Error(`没有可导入的 GPX waypoint${warnings.length ? `：${warnings.join('；')}` : ''}`);
  return { items, places: items.map(poiToPlace), warnings };
}

function parseKml(raw: Record<string, unknown>, provider: ProviderId): PortableImportResult {
  const kml = raw.kml as Record<string, unknown> | undefined;
  const document = kml?.Document as Record<string, unknown> | undefined;
  const items: CanonicalPoi[] = [];
  const warnings: string[] = [];
  for (const placemark of asArray(document?.Placemark as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    const pointNode = placemark.Point as Record<string, unknown> | undefined;
    const point = coordinates(pointNode?.coordinates);
    if (!point) {
      if (placemark.LineString) warnings.push('KML 中包含 LineString，当前仅支持导入 Point，路线已跳过');
      else warnings.push('KML 中有 Placemark 缺少有效 Point 坐标，已跳过');
      continue;
    }
    const data = asArray(((placemark.ExtendedData as Record<string, unknown> | undefined)?.Data) as Record<string, unknown> | Record<string, unknown>[] | undefined);
    const metadata: Record<string, string | undefined> = {};
    for (const entry of data) {
      const key = text(entry['@_name']);
      const value = text((entry.value as unknown));
      if (key === 'tags' || key === 'phone' || key === 'folder' || key === 'identity' || key === 'sourceRecordId') metadata[key] = value;
    }
    items.push(createPoi(text(placemark.name), point, text(placemark.description), provider, 'kml', metadata));
  }
  if (items.length === 0) throw new Error(`没有可导入的 KML Point${warnings.length ? `：${warnings.join('；')}` : ''}`);
  return { items, places: items.map(poiToPlace), warnings };
}

export function poiToPlace(item: CanonicalPoi): CanonicalPlace {
  return {
    id: item.id,
    identity: item.identity,
    name: item.name,
    address: item.address,
    tags: item.tags,
    note: item.note,
    wgs84: item.geometry.point,
    source: item.source,
    metadata: item.metadata,
  };
}

export function parsePortableImport(textValue: string, provider: ProviderId): PortableImportResult {
  let raw: unknown;
  try {
    raw = new XMLParser({ ignoreAttributes: false }).parse(textValue);
  } catch {
    throw new Error('文件不是合法的 GPX/KML XML');
  }
  if (!raw || typeof raw !== 'object') throw new Error('文件不是有效的 GPX/KML 文档');
  const record = raw as Record<string, unknown>;
  if (record.gpx) return parseGpx(record, provider);
  if (record.kml) return parseKml(record, provider);
  throw new Error('不支持的 XML 文件格式：仅支持 GPX 或 KML');
}
