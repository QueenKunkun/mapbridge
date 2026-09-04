import { describe, expect, it } from 'vitest';
import { applyExtractionItems, applyPreviewPlaces, createJob } from '@/core/jobs';
import type { CanonicalItem, CanonicalPlace } from '@/core/model';

const place: CanonicalPlace = {
  id: 'poi-1', name: 'POI', address: '', tags: [], note: '', wgs84: { lng: 104, lat: 30 },
  source: { provider: 'baidu', crs: 'bd09mc' }, metadata: {},
};
const route: CanonicalItem = {
  kind: 'route', id: 'route-1', name: 'Route',
  stops: [
    { role: 'start', name: 'Start', point: { lng: 104, lat: 30 } },
    { role: 'end', name: 'End', point: { lng: 105, lat: 31 } },
  ],
  routing: {}, source: { provider: 'baidu', crs: 'bd09mc' }, metadata: {},
};

describe('core/jobs unified items', () => {
  it('persists Route items while keeping POI places as the import view', () => {
    const job = applyExtractionItems(createJob('baidu', 'amap'), [route, { kind: 'poi', ...place, geometry: { type: 'point', point: place.wgs84 } }], [place], 2);
    expect(job.items.map((item) => item.kind)).toEqual(['route', 'poi']);
    expect(job.places).toEqual([place]);
  });

  it('updates POI preview without dropping retained Route items', () => {
    const job = applyExtractionItems(createJob('baidu', 'amap'), [route], [], 1);
    const updated = applyPreviewPlaces(job, [place]);
    expect(updated.items.map((item) => item.kind)).toEqual(['route', 'poi']);
    expect(updated.places).toEqual([place]);
  });
});
