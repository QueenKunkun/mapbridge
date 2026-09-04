import { describe, expect, it } from 'vitest';
import { applyExtractionItems, applyPreviewPlaces, createJob, hydrateJob, updatePreviewPlace } from '@/core/jobs';
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

  it('persists extraction and file warnings with the job', () => {
    const job = applyExtractionItems(createJob('baidu', 'amap'), [route], [], 1, ['GPX 中跳过 1 条 Route']);
    expect(job.warnings).toEqual(['GPX 中跳过 1 条 Route']);
  });

  it('hydrates legacy jobs without items or warnings', () => {
    const current = createJob('baidu', 'amap');
    const { items: _items, warnings: _warnings, ...legacy } = { ...current, places: [place] };
    const hydrated = hydrateJob(legacy);
    expect(hydrated.items).toHaveLength(1);
    expect(hydrated.items[0]!.kind).toBe('poi');
    expect(hydrated.warnings).toEqual([]);
  });

  it('invalidates identity when a preview name changes', () => {
    const withIdentity = { ...place, identity: 'old-identity' };
    expect(updatePreviewPlace(withIdentity, { address: 'New address' }).identity).toBe('old-identity');
    expect(updatePreviewPlace(withIdentity, { name: 'Renamed' }).identity).toBeUndefined();
  });
});
