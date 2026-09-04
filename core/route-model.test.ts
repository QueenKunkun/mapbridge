import { describe, expect, it } from 'vitest';
import { CanonicalRoute } from '@/core/model';
import { routeIdentity } from '@/core/dedup';

const route = {
  kind: 'route' as const,
  id: 'route-1',
  name: '自驾路线',
  stops: [
    { role: 'start' as const, name: '起点', point: { lng: 104, lat: 30 } },
    { role: 'end' as const, name: '终点', point: { lng: 105, lat: 31 } },
  ],
  travelMode: 'driving',
  routing: {},
  source: { provider: 'baidu' as const, crs: 'bd09mc' as const },
  metadata: {},
};

describe('route model', () => {
  it('accepts a route with ordered start and end stops', () => {
    const result = CanonicalRoute.safeParse(route);
    expect(result.success).toBe(true);
  });

  it('rejects routes with fewer than two stops', () => {
    const result = CanonicalRoute.safeParse({ ...route, stops: [route.stops[0]] });
    expect(result.success).toBe(false);
  });

  it('keeps stop order in route identity', () => {
    const reversed = { ...route, stops: [...route.stops].reverse() };
    expect(routeIdentity(route)).not.toBe(routeIdentity(reversed));
  });

  it('does not invent a route geometry from stops', () => {
    const parsed = CanonicalRoute.parse(route);
    expect(parsed).not.toHaveProperty('geometry');
  });

  it('preserves provider-neutral routing metadata', () => {
    const parsed = CanonicalRoute.parse({
      ...route,
      routing: { pathType: 1, planKind: 2, pageNumber: 3 },
    });
    expect(parsed.routing).toEqual({ pathType: 1, planKind: 2, pageNumber: 3 });
  });
});
