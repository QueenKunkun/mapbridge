import { z } from 'zod';

export const ProviderId = z.enum(['baidu', 'amap', 'tencent']);
export type ProviderId = z.infer<typeof ProviderId>;

export const Crs = z.enum(['wgs84', 'gcj02', 'bd09', 'bd09mc', 'amap_pixel']);
export type Crs = z.infer<typeof Crs>;

export const ProviderCrs: Record<ProviderId, Crs> = {
  baidu: 'bd09mc',
  amap: 'gcj02',
  tencent: 'gcj02',
};

export const LngLat = z.object({
  lng: z.number(),
  lat: z.number(),
});
export type LngLat = z.infer<typeof LngLat>;

export const GeoPoint = z.object({
  crs: Crs,
  lng: z.number(),
  lat: z.number(),
});
export type GeoPoint = z.infer<typeof GeoPoint>;

export const CanonicalPlace = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().default(''),
  tags: z.array(z.string()).default([]),
  note: z.string().default(''),
  wgs84: LngLat,
  source: z.object({
    provider: ProviderId,
    crs: Crs,
    original: GeoPoint.optional(),
    raw: z.record(z.string(), z.unknown()).optional(),
  }),
  metadata: z
    .object({
      uid: z.string().optional(),
      phone: z.string().optional(),
      folder: z.string().optional(),
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
    })
    .default({}),
});
export type CanonicalPlace = z.infer<typeof CanonicalPlace>;

/** v2 文档中的几何类型。当前先落地 POI，线几何供后续 Route/Mark/Track 使用。 */
export const PointGeometry = z.object({ type: z.literal('point'), point: LngLat });
export type PointGeometry = z.infer<typeof PointGeometry>;

export const Geometry = z.discriminatedUnion('type', [
  PointGeometry,
  z.object({ type: z.literal('line'), points: z.array(LngLat).min(2) }),
]);
export type Geometry = z.infer<typeof Geometry>;

/** v2 文档中的有限来源信息；默认导出不携带 provider raw payload。 */
export const CanonicalSource = z.object({
  provider: ProviderId,
  crs: Crs,
  original: GeoPoint.optional(),
  recordId: z.string().optional(),
  adapterVersion: z.string().optional(),
});
export type CanonicalSource = z.infer<typeof CanonicalSource>;

/** 当前支持迁移/导出的 v2 项目类型。后续按真实 fixture 扩展 Route/Mark/Track。 */
export const CanonicalPoi = z.object({
  kind: z.literal('poi'),
  id: z.string(),
  identity: z.string().optional(),
  name: z.string(),
  address: z.string().default(''),
  tags: z.array(z.string()).default([]),
  note: z.string().default(''),
  geometry: PointGeometry,
  source: CanonicalSource,
  metadata: z
    .object({
      uid: z.string().optional(),
      phone: z.string().optional(),
      folder: z.string().optional(),
      createdAt: z.string().optional(),
      updatedAt: z.string().optional(),
    })
    .default({}),
});
export type CanonicalPoi = z.infer<typeof CanonicalPoi>;

// 目前仅启用 POI，避免在没有真实协议和 fixture 前虚构其他类型的字段语义。
export const CanonicalItem = CanonicalPoi;
export type CanonicalItem = CanonicalPoi;

export const Collection = z.object({
  id: z.string(),
  name: z.string(),
  provider: ProviderId,
  folder: z.string().optional(),
  placeCount: z.number().default(0),
  createdAt: z.string(),
});
export type Collection = z.infer<typeof Collection>;

export const ExtractResult = z.object({
  collection: Collection,
  places: z.array(CanonicalPlace),
  skipped: z.array(
    z.object({
      index: z.number(),
      reason: z.string(),
    }),
  ),
  rawCount: z.number(),
});
export type ExtractResult = z.infer<typeof ExtractResult>;
