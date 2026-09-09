import { describe, expect, it } from 'vitest';
import { chooseAmapPoiMatch, parseAmapPoiCandidates, serializeAmapPoiMatch } from './amap-poi';
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
    const candidates = parseAmapPoiCandidates(
      {
        code: 1,
        data: {
          data: {
            poi_list: [
              {
                poiid: 'B1',
                name: '华润大厦',
                address: '建国路',
                location: matchingLocation,
                adcode: '110105',
                cityname: '北京',
              },
            ],
          },
        },
      },
      source,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      poiid: 'B1',
      name: '华润大厦',
      cityCode: '110105',
      cityName: '北京',
    });
    expect(candidates[0]!.distanceMeters).toBeLessThan(30);
  });

  it('accepts one high-confidence nearby candidate', () => {
    const candidates = parseAmapPoiCandidates(
      {
        data: {
          data: { poi_list: [{ poiid: 'B1', name: '华润大厦', location: matchingLocation }] },
        },
      },
      source,
    );
    const result = chooseAmapPoiMatch(candidates);
    expect(result.status).toBe('matched');
    if (result.status === 'matched') {
      expect(result.candidate.poiid).toBe('B1');
      expect(result.candidates).toHaveLength(1);
      expect(serializeAmapPoiMatch(result)).toMatchObject({
        status: 'matched',
        candidates: [{ poiid: 'B1' }],
      });
    }
  });

  it('does not match a distant or ambiguous candidate', () => {
    const distant = parseAmapPoiCandidates(
      { data: { data: { poi_list: [{ poiid: 'B1', name: '华润大厦', location: '117,40' }] } } },
      source,
    );
    expect(chooseAmapPoiMatch(distant).status).toBe('not-found');

    const ambiguous = [
      {
        poiid: 'B1',
        name: '华润大厦',
        address: '',
        location: source.wgs84,
        distanceMeters: 10,
        nameScore: 1,
      },
      {
        poiid: 'B2',
        name: '华润大厦',
        address: '',
        location: source.wgs84,
        distanceMeters: 20,
        nameScore: 1,
      },
    ];
    expect(chooseAmapPoiMatch(ambiguous).status).toBe('ambiguous');
  });

  it('honors a caller-provided maximum matching distance', () => {
    const candidate = [
      {
        poiid: 'B3',
        name: '华润大厦',
        address: '',
        location: source.wgs84,
        distanceMeters: 200,
        nameScore: 1,
      },
    ];
    expect(chooseAmapPoiMatch(candidate).status).toBe('not-found');
    expect(chooseAmapPoiMatch(candidate, { maxDistanceMeters: 250 }).status).toBe('matched');
  });

  it('explains why returned candidates were rejected', () => {
    const candidates = parseAmapPoiCandidates(
      {
        data: {
          data: {
            poi_list: [
              {
                poiid: 'far',
                name: '华润大厦',
                location: '117,40',
              },
            ],
          },
        },
      },
      source,
    );
    const result = chooseAmapPoiMatch(candidates);
    expect(result.status).toBe('not-found');
    if (result.status === 'not-found') {
      expect(result.reason).toContain('距离');
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]!.nameScore).toBe(1);
    }
  });

  it('parses the shared poiTipsSearchlite response used by the new page', () => {
    const source: CanonicalPlace = {
      id: 'jinpinghu',
      name: '金平湖公园',
      address: '',
      tags: [],
      note: '',
      wgs84: { lng: 116.3843, lat: 35.0777 },
      source: { provider: 'baidu', crs: 'bd09mc' },
      metadata: {},
    };
    const response = {
      data: {
        result: 'true',
        tip_list: [
          {
            tip: {
              id: 'B0FFH19M92',
              poiid: 'B0FFH19M92',
              name: '金平湖公园',
              x: '116.384309',
              y: '35.077687',
              adcode: '370828',
              city_name: '济宁市',
              district_name: '金乡县',
            },
          },
        ],
      },
    };

    const candidates = parseAmapPoiCandidates(response, source);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      poiid: 'B0FFH19M92',
      name: '金平湖公园',
      address: '金乡县济宁市',
      cityCode: '370828',
      cityName: '济宁市',
    });
  });

  it('parses nested tip candidates with object coordinates', () => {
    const candidates = parseAmapPoiCandidates(
      {
        data: {
          tip_list: [
            {
              data: {
                poiid: 'B-HOUSE',
                name: '住建佳苑',
                location: { lng: 116.3438, lat: 35.0702 },
              },
            },
          ],
        },
      },
      {
        ...source,
        name: '住建佳苑',
        wgs84: { lng: 116.3438, lat: 35.0702 },
      },
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.poiid).toBe('B-HOUSE');
  });

  it('parses tip candidates that expose entrance coordinates instead of x/y', () => {
    const candidates = parseAmapPoiCandidates(
      {
        data: {
          result: 'true',
          total: 10,
          tip_list: [
            {
              tip: {
                id: 'B-HOUSE-ENTRANCE',
                name: '住建佳苑',
                x_entr: '116.3438',
                y_entr: '35.0702',
                city_name: '济宁市',
              },
            },
          ],
        },
        status: '1',
      },
      {
        ...source,
        name: '住建佳苑',
        wgs84: { lng: 116.3438, lat: 35.0702 },
      },
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.poiid).toBe('B-HOUSE-ENTRANCE');
  });

  it('parses the full house suggestion shape even with an extra response wrapper', () => {
    const candidates = parseAmapPoiCandidates(
      {
        data: {
          data: {
            result: 'true',
            tip_list: [
              {
                tip: {
                  id: 'B0FFFZD19R',
                  name: '住建佳苑',
                  x: '116.349403',
                  y: '35.069764',
                  x_entr: '116.348192',
                  y_entr: '35.069933',
                  poiid: 'B0FFFZD19R',
                },
              },
            ],
          },
        },
        status: '1',
      },
      {
        ...source,
        name: '住建佳苑',
        address: '山东省济宁市金乡县光明路与泰康路交叉口东南180米',
        wgs84: { lng: 116.343774, lat: 35.070243 },
      },
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ poiid: 'B0FFFZD19R', name: '住建佳苑' });
  });
});
