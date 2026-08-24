import { describe, expect, it } from 'vitest';
import { chooseBaiduPoiMatch, chooseBaiduSearchCity } from './baidu-poi';

describe('Baidu POI matching', () => {
  it('chooses the closest city from a nationwide search response', () => {
    const response = { content: [
      { code: 131, geo: '1|12959238.56,4825347.47;12959238.56,4825347.47|' },
      { code: 286, geo: '1|12979309.45,4196147.53;12979309.45,4196147.53|' },
    ] };
    expect(chooseBaiduSearchCity(response, { x: 12949071, y: 4152031 })).toBe(286);
  });

  it('uses only an exact-name nearby POI and converts search coordinates', () => {
    const response = { content: [
      { uid: 'nearby', name: '真武庙', x: 1294907366, y: 415202119 },
      { uid: 'far', name: '真武庙', x: 1292386847, y: 425173313 },
      { uid: 'similar', name: '真武大帝庙', x: 1294907100, y: 415203100 },
    ] };
    expect(chooseBaiduPoiMatch(response, { name: '真武庙', x: 12949071, y: 4152031 })).toEqual({
      uid: 'nearby', name: '真武庙', x: 12949073.66, y: 4152021.19,
    });
  });

  it('does not match a same-name POI that is too far away', () => {
    const response = { content: [{ uid: 'far', name: '真武庙', x: 1292386847, y: 425173313 }] };
    expect(chooseBaiduPoiMatch(response, { name: '真武庙', x: 12949071, y: 4152031 })).toBeUndefined();
  });
});
