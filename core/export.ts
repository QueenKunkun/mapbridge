import type { CanonicalItem, CanonicalPlace, CanonicalPoi, MapBridgeDocument, ProviderId } from './model';
import { CanonicalItem as CanonicalItemSchema, CanonicalPlace as CanonicalPlaceSchema, MapBridgeDocument as MapBridgeDocumentSchema } from './model';
import { placeIdentity } from './dedup';

export interface PlacesExport {
  format: 'mapbridge';
  version: number;
  exportedAt: string;
  provider?: ProviderId;
  items: CanonicalItem[];
  /** v1 API compatibility for the current popup and adapter pipeline. */
  places: CanonicalPlace[];
  warnings?: string[];
}

export function serializeItems(items: CanonicalItem[], provider?: ProviderId): string {
  const document: MapBridgeDocument = {
    format: 'mapbridge',
    version: 2,
    exportedAt: new Date().toISOString(),
    provider,
    items,
  };
  return JSON.stringify(document, null, 2);
}

export function migratePlaceToPoi(place: CanonicalPlace): CanonicalPoi {
  return {
    kind: 'poi',
    id: place.id,
    identity: place.identity ?? placeIdentity(place),
    name: place.name,
    address: place.address,
    tags: place.tags,
    note: place.note,
    geometry: { type: 'point', point: place.wgs84 },
    source: place.source,
    metadata: place.metadata,
  };
}

function migratePoiToPlace(item: CanonicalPoi): CanonicalPlace {
  return {
    id: item.id,
    name: item.name,
    address: item.address,
    tags: item.tags,
    note: item.note,
    wgs84: item.geometry.point,
    source: {
      provider: item.source.provider,
      crs: item.source.crs,
      original: item.source.original,
      recordId: item.source.recordId,
    },
    identity: item.identity,
    metadata: item.metadata,
  };
}

/** 将归一化收藏序列化为可移植的 JSON 文本（跨地图/跨设备复用）。 */
export function serializePlaces(places: CanonicalPlace[], provider?: ProviderId): string {
  const items = places.map(migratePlaceToPoi);
  return serializeItems(items, provider);
}

export function parseMapBridgeDocument(text: string): MapBridgeDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('文件不是合法的 JSON');
  }
  const result = MapBridgeDocumentSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(issue?.path[0] === 'version'
      ? `不支持的 MapBridge 文件版本：${String((raw as Record<string, unknown>)?.version ?? '')}`
      : `MapBridge 文件格式不正确：${issue?.message ?? '字段缺失'}`);
  }
  return result.data;
}

/** 解析 MapBridge 导出文件；逐条用 schema 校验，返回合法记录（跳过非法项但至少需 1 条）。 */
export function parsePlacesFile(text: string): PlacesExport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('文件不是合法的 JSON');
  }
  if (!raw || typeof raw !== 'object') throw new Error('文件格式不正确');
  const obj = raw as Record<string, unknown>;
  const isV1 = obj.format === 'mapbridge-places';
  const isV2 = obj.format === 'mapbridge';
  if (!isV1 && !isV2) throw new Error('不是 MapBridge 导出文件（format 不匹配）');

  const valid: CanonicalPlace[] = [];
  const items: CanonicalItem[] = [];
  const errors: string[] = [];
  if (isV1) {
    const places = obj.places;
    if (!Array.isArray(places)) throw new Error('文件中缺少 places 数组');
    for (let i = 0; i < places.length; i++) {
      const r = CanonicalPlaceSchema.safeParse(places[i]);
      if (r.success) {
        valid.push(r.data);
        items.push(migratePlaceToPoi(r.data));
      } else errors.push(`第 ${i + 1} 条：${r.error?.issues[0]?.message ?? '字段缺失'}`);
    }
  } else {
    const document = parseMapBridgeDocument(text);
    for (let i = 0; i < document.items.length; i++) {
      const item = document.items[i]!;
      if (item.kind !== 'poi') {
        errors.push(`第 ${i + 1} 条：项目类型 ${item.kind} 当前不支持 provider 导入，已跳过`);
        continue;
      }
      const r = CanonicalItemSchema.safeParse(item);
      if (r.success && r.data.kind === 'poi') {
        items.push(r.data);
        valid.push(migratePoiToPlace(r.data));
      } else errors.push(`第 ${i + 1} 条：${r.error?.issues[0]?.message ?? '字段缺失'}`);
    }
  }
  if (valid.length === 0) {
    throw new Error('没有有效的收藏记录：' + errors.slice(0, 3).join('；'));
  }
  return {
    format: 'mapbridge',
    version: isV1 ? 1 : 2,
    exportedAt: String(obj.exportedAt ?? ''),
    provider: obj.provider as ProviderId | undefined,
    items,
    places: valid,
    warnings: errors,
  };
}
