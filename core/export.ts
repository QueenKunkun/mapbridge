import type { CanonicalPlace, ProviderId } from './model';
import { CanonicalPlace as CanonicalPlaceSchema } from './model';

export interface PlacesExport {
  format: 'mapbridge-places';
  version: number;
  exportedAt: string;
  provider?: ProviderId;
  places: CanonicalPlace[];
}

/** 将归一化收藏序列化为可移植的 JSON 文本（跨地图/跨设备复用）。 */
export function serializePlaces(places: CanonicalPlace[], provider?: ProviderId): string {
  const data: PlacesExport = {
    format: 'mapbridge-places',
    version: 1,
    exportedAt: new Date().toISOString(),
    provider,
    places,
  };
  return JSON.stringify(data, null, 2);
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
  if (obj.format !== 'mapbridge-places') {
    throw new Error('不是 MapBridge 导出文件（format 不匹配）');
  }
  const places = obj.places;
  if (!Array.isArray(places)) throw new Error('文件中缺少 places 数组');

  const valid: CanonicalPlace[] = [];
  const errors: string[] = [];
  for (let i = 0; i < places.length; i++) {
    const r = CanonicalPlaceSchema.safeParse(places[i]);
    if (r.success) valid.push(r.data);
    else errors.push(`第 ${i + 1} 条：${r.error.issues[0]?.message ?? '字段缺失'}`);
  }
  if (valid.length === 0) {
    throw new Error('没有有效的收藏记录：' + errors.slice(0, 3).join('；'));
  }
  return {
    format: 'mapbridge-places',
    version: Number(obj.version) || 1,
    exportedAt: String(obj.exportedAt ?? ''),
    provider: obj.provider as ProviderId | undefined,
    places: valid,
  };
}
