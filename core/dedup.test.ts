import { describe, expect, it } from 'vitest';
import { placeFingerprint, placeIdentity } from '@/core/dedup';
import type { CanonicalPlace } from '@/core/model';

const place: CanonicalPlace = {
  id: '1', name: 'Cafe', address: '', tags: [], note: '', wgs84: { lng: 104, lat: 30 },
  source: { provider: 'amap', crs: 'wgs84' }, metadata: {},
};

describe('POI identity', () => {
  it('uses an explicit identity when present', () => {
    const withIdentity = { ...place, identity: 'shared-provider-key' };
    expect(placeIdentity(withIdentity)).toBe('shared-provider-key');
    expect(placeFingerprint(withIdentity)).toBe('cafe|104.00000|30.00000');
  });

  it('falls back to the deterministic name and coordinate fingerprint', () => {
    expect(placeIdentity(place)).toBe('cafe|104.00000|30.00000');
  });
});
