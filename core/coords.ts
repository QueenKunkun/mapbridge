import type { Crs, LngLat } from './model';

export interface MercatorPoint {
  x: number;
  y: number;
}

/**
 * 高德 zoom-20 像素坐标（点索引体系，非屏幕坐标）。由 GCJ-02 经 Web Mercator 计算得出。
 */
export interface AmapPixelPoint {
  x: number;
  y: number;
}

/**
 * 百度墨卡托 -> BD-09 经纬度。
 * 系数表来自实际验证过的 BaiduMercatorWebMercatorUtils（MCBAND / MC2LL）。
 */
const MCBAND = [12890594.86, 8362377.87, 5591021, 3481989.83, 1678043.12, 0];
const MC2LL = [
  [1.410526172116255e-8, 0.00000898305509648872, -1.9939833816331, 200.9824383106796, -187.2403703815547, 91.6087516669843, -23.38765649603339, 2.57121317296198, -0.03801003308653, 17337981.2],
  [-7.435856389565537e-9, 0.000008983055097726239, -0.78625201886289, 96.32687599759846, -1.85204757529826, -59.36935905485877, 47.40033549296737, -16.50741931063887, 2.28786674699375, 10260144.86],
  [-3.030883460898826e-8, 0.00000898305509983578, 0.30071316287616, 59.74293618442277, 7.357984074871, -25.38371002664745, 13.45380521110908, -3.29883767235584, 0.32710905363475, 6856817.37],
  [-1.981981304930552e-8, 0.000008983055099779535, 0.03278182852591, 40.31678527705744, 0.65659298677277, -4.44255534477492, 0.85341911805263, 0.12923347998204, -0.04625736007561, 4482777.06],
  [3.09191371068437e-9, 0.000008983055096812155, 0.00006995724062, 23.10934304144901, -0.00023663490511, -0.6321817810242, -0.00663494467273, 0.03430082397953, -0.00466043876332, 2555164.4],
  [2.890871144776878e-9, 0.000008983055095805407, -0.00000003068298, 7.47137025468032, -0.00000353937994, -0.02145144861037, -0.00001234426596, 0.00010322952773, -0.00000323890364, 826088.5],
];

function mcConvertor(x: number, y: number, c: number[]): LngLat {
  const xTemp = c[0]! + c[1]! * Math.abs(x);
  const cc = Math.abs(y) / c[9]!;
  let yTemp =
    c[2]! + c[3]! * cc + c[4]! * cc ** 2 + c[5]! * cc ** 3 + c[6]! * cc ** 4 + c[7]! * cc ** 5 + c[8]! * cc ** 6;
  return { lng: x < 0 ? -xTemp : xTemp, lat: y < 0 ? -yTemp : yTemp };
}

export function bd09mcToBd09(x: number, y: number): LngLat {
  const absY = Math.abs(y);
  let coeff = MC2LL[MC2LL.length - 1]!;
  for (let i = 0; i < MCBAND.length; i++) {
    if (absY >= MCBAND[i]!) {
      coeff = MC2LL[i]!;
      break;
    }
  }
  return mcConvertor(x, y, coeff);
}

export function bd09ToGcj02(lng: number, lat: number): LngLat {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin((y * Math.PI * 3000) / 180);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos((x * Math.PI * 3000) / 180);
  return { lng: z * Math.cos(theta), lat: z * Math.sin(theta) };
}

export function gcj02ToBd09(lng: number, lat: number): LngLat {
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin((lat * Math.PI * 3000) / 180);
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos((lng * Math.PI * 3000) / 180);
  return { lng: z * Math.cos(theta) + 0.0065, lat: z * Math.sin(theta) + 0.006 };
}

const EARTH_A = 6378245;
const EE = 0.00669342162296594323;

function outOfChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret =
    -100 +
    2 * x +
    3 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  ret += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret =
    300 +
    x +
    2 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  ret += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  ret += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  ret += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return ret;
}

function delta(lng: number, lat: number): LngLat {
  const dLat = transformLat(lng - 105, lat - 35);
  const dLng = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const dLatDeg = (dLat * 180) / (((EARTH_A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
  const dLngDeg = (dLng * 180) / ((EARTH_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lng: dLngDeg, lat: dLatDeg };
}

export function wgs84ToGcj02(lng: number, lat: number): LngLat {
  if (outOfChina(lng, lat)) return { lng, lat };
  const d = delta(lng, lat);
  return { lng: lng + d.lng, lat: lat + d.lat };
}

export function gcj02ToWgs84(lng: number, lat: number): LngLat {
  if (outOfChina(lng, lat)) return { lng, lat };
  const d = delta(lng, lat);
  return { lng: lng - d.lng, lat: lat - d.lat };
}

export function bd09mcToGcj02(x: number, y: number): LngLat {
  const bd09 = bd09mcToBd09(x, y);
  return bd09ToGcj02(bd09.lng, bd09.lat);
}

export function gcj02ToBd09mc(lng: number, lat: number): MercatorPoint {
  // 参考实现无逆变换；用 MC2LL 数值反演近似不现实，改由百度接口层处理。
  // 当需要写回百度时，用公开的 bd09mc 计算库或接口；此处标记为不支持。
  throw new Error('gcj02ToBd09mc not implemented; use Baidu API or bd09mc library');
}

function clip(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * GCJ-02 -> 高德 zoom-20 像素坐标（Web Mercator，EPSG:3857 在 2^20 缩放下的像素）。
 */
export function gcj02ToAmapPixel(lng: number, lat: number): AmapPixelPoint {
  const tileSize = 256;
  const minLat = -85.0511287798;
  const maxLat = 85.0511287798;
  const minLng = -180;
  const maxLng = 180;
  const earthRadius = 6378137;
  const circumference = 2 * Math.PI * earthRadius;
  const latRad = (clip(lat, minLat, maxLat) * Math.PI) / 180;
  const lngRad = (clip(lng, minLng, maxLng) * Math.PI) / 180;
  const sinLatitude = Math.sin(latRad);
  const metersX = earthRadius * lngRad;
  const mercatorY = Math.log((1 + sinLatitude) / (1 - sinLatitude));
  const metersY = Math.trunc(earthRadius / 2) * mercatorY;
  const mapSize = tileSize << 20;
  const metersPerPixel = circumference / mapSize;
  const x = clip((circumference / 2 + metersX) / metersPerPixel + 0.5, 0, mapSize - 1);
  let y = circumference / 2 - metersY;
  y = Math.trunc(y);
  const py = clip(y / metersPerPixel + 0.5, 0, mapSize - 1);
  return { x: Math.trunc(x), y: Math.trunc(py) };
}

/**
 * 高德 zoom-20 像素坐标 -> GCJ-02 经纬度（反向，精度亚像素级，约 0.1m）。
 */
export function amapPixelToGcj02(x: number, y: number): LngLat {
  const tileSize = 256;
  const earthRadius = 6378137;
  const circumference = 2 * Math.PI * earthRadius;
  const mapSize = tileSize << 20;
  const metersPerPixel = circumference / mapSize;

  const metersX = (x - 0.5) * metersPerPixel - circumference / 2;
  const lngRad = metersX / earthRadius;
  const lng = (lngRad * 180) / Math.PI;

  const yFloor = y - 0.5;
  const metersY = circumference / 2 - yFloor * metersPerPixel;
  const mercatorY = metersY / Math.trunc(earthRadius / 2);
  const sinLat = (Math.exp(mercatorY) - 1) / (Math.exp(mercatorY) + 1);
  const lat = (Math.asin(clip(sinLat, -1, 1)) * 180) / Math.PI;
  return { lng, lat };
}

/** 统一入口：任意 source CRS 的经纬度/像素点 -> WGS-84。 */
export function toWgs84(point: { crs: Crs; lng: number; lat: number }): LngLat {
  const { crs, lng, lat } = point;
  switch (crs) {
    case 'wgs84':
      return { lng, lat };
    case 'gcj02':
      return gcj02ToWgs84(lng, lat);
    case 'bd09': {
      const gcj = bd09ToGcj02(lng, lat);
      return gcj02ToWgs84(gcj.lng, gcj.lat);
    }
    case 'bd09mc': {
      const gcj = bd09mcToGcj02(lng, lat);
      return gcj02ToWgs84(gcj.lng, gcj.lat);
    }
    case 'amap_pixel': {
      const gcj = amapPixelToGcj02(lng, lat);
      return gcj02ToWgs84(gcj.lng, gcj.lat);
    }
  }
}

/** 统一入口：WGS-84 -> 任意 target CRS 经纬度。bd09mc 目标需走接口，不支持。 */
export function fromWgs84(
  point: LngLat,
  crs: Exclude<Crs, 'bd09mc' | 'amap_pixel'>,
): LngLat {
  switch (crs) {
    case 'wgs84':
      return point;
    case 'gcj02':
      return wgs84ToGcj02(point.lng, point.lat);
    case 'bd09': {
      const g = wgs84ToGcj02(point.lng, point.lat);
      return gcj02ToBd09(g.lng, g.lat);
    }
  }
}