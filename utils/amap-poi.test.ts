import { describe, expect, it } from 'vitest';
import { chooseAmapPoiMatch, parseAmapPoiCandidates } from './amap-poi';
import type { CanonicalPlace } from '@/core/model';
import { wgs84ToGcj02 } from '@/core/coords';

const source: CanonicalPlace = {
  id: 'source-1',
  name: '华润大厦',
  address: '',
  tags: [],
  note: '',
  wgs84: { lng: 116.4, lat: 39.9 },
  source: { provider: 'baidu', crs: 'bd09mc' },
  metadata: {},
};

describe('Amap POI matching', () => {
  const matchingLocation = (() => {
    const point = wgs84ToGcj02(source.wgs84.lng, source.wgs84.lat);
    return `${point.lng},${point.lat}`;
  })();

  it('parses SSR candidates and converts GCJ-02 coordinates to WGS-84', () => {
    const candidates = parseAmapPoiCandidates({
      code: 1,
      data: { data: { poi_list: [{ poiid: 'B1', name: '华润大厦', address: '建国路', location: matchingLocation, adcode: '110105', cityname: '北京' }] } },
    }, source);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ poiid: 'B1', name: '华润大厦', cityCode: '110105', cityName: '北京' });
    expect(candidates[0]!.distanceMeters).toBeLessThan(30);
  });

  it('accepts one high-confidence nearby candidate', () => {
    const candidates = parseAmapPoiCandidates({ data: { data: { poi_list: [{ poiid: 'B1', name: '华润大厦', location: matchingLocation }] } } }, source);
    const result = chooseAmapPoiMatch(candidates);
    expect(result.status).toBe('matched');
    if (result.status === 'matched') expect(result.candidate.poiid).toBe('B1');
  });

  it('does not match a distant or ambiguous candidate', () => {
    const distant = parseAmapPoiCandidates({ data: { data: { poi_list: [{ poiid: 'B1', name: '华润大厦', location: '117,40' }] } } }, source);
    expect(chooseAmapPoiMatch(distant).status).toBe('not-found');

    const ambiguous = [
      { poiid: 'B1', name: '华润大厦', address: '', location: source.wgs84, distanceMeters: 10, nameScore: 1 },
      { poiid: 'B2', name: '华润大厦', address: '', location: source.wgs84, distanceMeters: 20, nameScore: 1 },
    ];
    expect(chooseAmapPoiMatch(ambiguous).status).toBe('ambiguous');
  });
});
