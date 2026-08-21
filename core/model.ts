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