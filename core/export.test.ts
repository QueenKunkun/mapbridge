import { describe, expect, it } from 'vitest';
import { serializePlaces, parsePlacesFile } from '@/core/export';
import type { CanonicalPlace } from '@/core/model';

const place: CanonicalPlace = {
  id: 'abc',
  name: 'Test POI 测试点',
  address: 'Some road',
  tags: ['x'],
  note: '',
  wgs84: { lng: 104.0389, lat: 30.6374 },
  source: { provider: 'amap', crs: 'wgs84' },
};

describe('core/export', () => {
  it('round-trips serialize -> parse', () => {
    const text = serializePlaces([place], 'amap');
    const parsed = parsePlacesFile(text);
    expect(parsed.provider).toBe('amap');
    expect(parsed.places).toHaveLength(1);
    expect(parsed.places[0]!.name).toBe('Test POI 测试点');
    expect(parsed.places[0]!.wgs84.lng).toBeCloseTo(104.0389, 4);
  });

  it('rejects non-mapbridge JSON', () => {
    expect(() => parsePlacesFile('{"hello":"world"}')).toThrow(/不是 MapBridge/);
  });

  it('rejects invalid JSON', () => {
    expect(() => parsePlacesFile('not json')).toThrow(/合法的 JSON/);
  });

  it('drops malformed places but keeps valid ones', () => {
    const text = JSON.stringify({
      format: 'mapbridge-places',
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      provider: 'amap',
      places: [
        { id: 'ok', name: 'Good', wgs84: { lng: 1, lat: 2 }, source: { provider: 'amap', crs: 'wgs84' } },
        { id: 'bad', name: 'No coords', source: { provider: 'amap', crs: 'wgs84' } },
      ],
    });
    const parsed = parsePlacesFile(text);
    expect(parsed.places).toHaveLength(1);
    expect(parsed.places[0]!.id).toBe('ok');
  });
});
