import { describe, expect, it } from 'vitest';
import { CanonicalItem, Geometry } from '@/core/model';

const source = { provider: 'amap' as const, crs: 'wgs84' as const };

describe('v2 model schemas', () => {
  it('accepts a valid point geometry and POI item', () => {
    const result = CanonicalItem.safeParse({
      kind: 'poi',
      id: 'poi-1',
      identity: 'same-place|104.00000|30.00000',
      name: 'Test POI',
      geometry: { type: 'point', point: { lng: 104, lat: 30 } },
      source,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.address).toBe('');
      expect(result.data.tags).toEqual([]);
    }
  });

  it('rejects a line with fewer than two points', () => {
    const result = Geometry.safeParse({ type: 'line', points: [{ lng: 104, lat: 30 }] });
    expect(result.success).toBe(false);
  });

  it('rejects future item kinds until their protocol is defined', () => {
    const result = CanonicalItem.safeParse({
      kind: 'route',
      id: 'route-1',
      name: 'Future route',
      geometry: { type: 'line', points: [{ lng: 104, lat: 30 }, { lng: 105, lat: 31 }] },
      source,
    });
    expect(result.success).toBe(false);
  });

  it('strips provider raw payload from the v2 source schema', () => {
    const result = CanonicalItem.parse({
      kind: 'poi',
      id: 'poi-1',
      name: 'Test POI',
      geometry: { type: 'point', point: { lng: 104, lat: 30 } },
      source: { ...source, raw: { token: 'should-not-export' } },
    });

    expect(result.source).not.toHaveProperty('raw');
  });
});
