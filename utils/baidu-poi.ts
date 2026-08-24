export interface BaiduMercatorPoint {
  x: number;
  y: number;
}

export interface BaiduPoiMatch extends BaiduMercatorPoint {
  uid: string;
  name: string;
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
    ? content.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    : [];
}

/** 从全国搜索的城市聚合结果中选取离目标坐标最近的城市。 */
export function chooseBaiduSearchCity(response: unknown, target: BaiduMercatorPoint): number | undefined {
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
  const candidates = records(response)
    .map((item) => {
      const uid = typeof item['uid'] === 'string' ? item['uid'] : '';
      const name = typeof item['name'] === 'string' ? item['name'] : '';
      const rawX = Number(item['x']);
      const rawY = Number(item['y']);
      const x = Math.abs(rawX) > 100_000_000 ? rawX / 100 : rawX;
      const y = Math.abs(rawY) > 100_000_000 ? rawY / 100 : rawY;
      const distance = Math.hypot(x - target.x, y - target.y);
      return { uid, name, x, y, distance };
    })
    .filter((item) => item.uid && item.name === target.name && Number.isFinite(item.x) && Number.isFinite(item.y))
    .sort((a, b) => a.distance - b.distance);
  const best = candidates[0];
  return best && best.distance <= maxDistance ? { uid: best.uid, name: best.name, x: best.x, y: best.y } : undefined;
}
