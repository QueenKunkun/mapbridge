import { describe, expect, it } from 'vitest';
import {
  amapPixelToGcj02,
  bd09mcToBd09,
  bd09mcToGcj02,
  bd09ToBd09mc,
  bd09ToGcj02,
  fromWgs84,
  gcj02ToAmapPixel,
  gcj02ToBd09,
  gcj02ToBd09mc,
  gcj02ToWgs84,
  toWgs84,
  wgs84ToBd09mc,
  wgs84ToGcj02,
} from '@/core/coords';

// 真实迁移验证向量（参考 Get_BaiduMAP_favorites_to_AMAP）
// bd09mc(11582672.01, 3564275.74) -> bd09 -> gcj02(104.0413541, 30.63498682)
//                                  -> amap pixel(211796584, 110201320)
const MC_X = 11582672.01;
const MC_Y = 3564275.74;
const GCJ_LNG = 104.0413541;
const GCJ_LAT = 30.63498682;
const PX_X = 211796584;
const PX_Y = 110201320;

describe('bd09mc -> gcj02', () => {
  it('matches verified conversion vector', () => {
    const r = bd09mcToGcj02(MC_X, MC_Y);
    expect(r.lng).toBeCloseTo(GCJ_LNG, 6);
    expect(r.lat).toBeCloseTo(GCJ_LAT, 6);
  });
});

describe('gcj02 -> amap pixel', () => {
  it('matches verified pixel vector', () => {
    const px = gcj02ToAmapPixel(GCJ_LNG, GCJ_LAT);
    expect(px.x).toBe(PX_X);
    expect(px.y).toBe(PX_Y);
  });

  it('round-trips through amapPixelToGcj02 within ~0.5m', () => {
    const back = amapPixelToGcj02(PX_X, PX_Y);
    // 亚像素级误差：经度约 0.000005 度，纬度约 0.000003 度
    expect(Math.abs(back.lng - GCJ_LNG)).toBeLessThan(0.00001);
    expect(Math.abs(back.lat - GCJ_LAT)).toBeLessThan(0.00001);
  });
});

describe('bd09 <-> gcj02', () => {
  it('inverts', () => {
    const gcj = bd09ToGcj02(116.404, 39.915);
    const bd09 = gcj02ToBd09(gcj.lng, gcj.lat);
    expect(bd09.lng).toBeCloseTo(116.404, 6);
    expect(bd09.lat).toBeCloseTo(39.915, 6);
  });
});

describe('bd09mc <-> bd09 inverse', () => {
  it('bd09ToBd09mc inverts bd09mcToBd09 (verified vector)', () => {
    const bd09 = bd09mcToBd09(MC_X, MC_Y);
    const mc = bd09ToBd09mc(bd09.lng, bd09.lat);
    expect(mc.x).toBeCloseTo(MC_X, 2);
    expect(mc.y).toBeCloseTo(MC_Y, 2);
  });

  it('round-trips the user-captured geoptx/geopty', () => {
    const bd09 = bd09mcToBd09(12525945.05, 4086017.57);
    const mc = bd09ToBd09mc(bd09.lng, bd09.lat);
    expect(mc.x).toBeCloseTo(12525945.05, 2);
    expect(mc.y).toBeCloseTo(4086017.57, 2);
  });
});

describe('wgs84 <-> bd09mc', () => {
  it('wgs84ToBd09mc round-trips through toWgs84', () => {
    const p = { lng: 104.06, lat: 30.67 };
    const mc = wgs84ToBd09mc(p.lng, p.lat);
    const back = toWgs84({ crs: 'bd09mc', lng: mc.x, lat: mc.y });
    expect(back.lng).toBeCloseTo(p.lng, 4);
    expect(back.lat).toBeCloseTo(p.lat, 4);
  });

  it('gcj02ToBd09mc is the exact inverse of bd09mcToGcj02', () => {
    const mc = gcj02ToBd09mc(GCJ_LNG, GCJ_LAT);
    const gcj = bd09mcToGcj02(mc.x, mc.y);
    expect(gcj.lng).toBeCloseTo(GCJ_LNG, 5);
    expect(gcj.lat).toBeCloseTo(GCJ_LAT, 5);
  });
});

describe('wgs84 <-> gcj02', () => {
  it('gcj02ToWgs84(wgs84ToGcj02(p)) ~= p for China coords', () => {
    const p = { lng: 104.06, lat: 30.67 };
    const gcj = wgs84ToGcj02(p.lng, p.lat);
    const back = gcj02ToWgs84(gcj.lng, gcj.lat);
    expect(back.lng).toBeCloseTo(p.lng, 4);
    expect(back.lat).toBeCloseTo(p.lat, 4);
  });

  it('no-op outside China', () => {
    const p = { lng: -122.4, lat: 37.77 };
    expect(wgs84ToGcj02(p.lng, p.lat)).toEqual(p);
    expect(gcj02ToWgs84(p.lng, p.lat)).toEqual(p);
  });
});

describe('toWgs84 / fromWgs84 unified entry', () => {
  it('converts bd09mc source to wgs84 then to gcj02 target', () => {
    const wgs84 = toWgs84({ crs: 'bd09mc', lng: MC_X, lat: MC_Y });
    // 目标 gcj02 应与验证向量接近（含两次近似转换）
    const gcj02 = fromWgs84(wgs84, 'gcj02');
    expect(gcj02.lng).toBeCloseTo(GCJ_LNG, 4);
    expect(gcj02.lat).toBeCloseTo(GCJ_LAT, 4);
  });

  it('passes through wgs84', () => {
    const p = { lng: 120, lat: 30 };
    expect(toWgs84({ crs: 'wgs84', ...p })).toEqual(p);
  });
});