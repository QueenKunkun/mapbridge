import { describe, expect, it } from 'vitest';
import { amapAdapter } from '@/adapters/amap';
import { dedupPlaces } from '@/core/dedup';
import { migratePlaceToPoi, parseMapBridgeDocument, serializeItems } from '@/core/export';
import { applyExtractionItems, applyPreviewPlaces, createJob, updatePreviewPlace } from '@/core/jobs';
import type { CanonicalPlace } from '@/core/model';

const sourcePlace: CanonicalPlace = {
  id: 'baidu-poi-1',
  name: 'Coffee Shop',
  address: 'Main road',
  tags: ['coffee'],
  note: '',
  wgs84: { lng: 104.0389, lat: 30.6374 },
  source: { provider: 'baidu', crs: 'bd09mc', recordId: 'baidu-1' },
  metadata: {},
};

describe('POI migration workflow', () => {
  it('keeps one cross-provider POI through dedup, v2 document, preview, and target payload', () => {
    const existingTarget: CanonicalPlace = {
      ...sourcePlace,
      id: 'amap-existing',
      source: { provider: 'amap', crs: 'amap_pixel' },
    };
    const deduped = dedupPlaces([sourcePlace], [existingTarget]);
    expect(deduped.unique).toHaveLength(0);
    expect(deduped.duplicates[0]!.identity).toBe(sourcePlace.identity);

    const imported = { ...sourcePlace, id: 'new-poi' };
    const poi = migratePlaceToPoi(imported);
    const document = parseMapBridgeDocument(serializeItems([poi], 'baidu'));
    const job = applyExtractionItems(createJob('baidu', 'amap'), document.items, [imported], 1);
    const renamed = updatePreviewPlace(imported, { name: 'Renamed Coffee Shop' });
    const preview = applyPreviewPlaces(job, [renamed]);
    const payload = amapAdapter.buildImportPayload(preview.places) as Array<Record<string, unknown>>;

    expect(preview.items[0]!.kind).toBe('poi');
    expect(preview.places[0]!.identity).toBeUndefined();
    expect(payload).toHaveLength(1);
    expect((payload[0]!.data as Record<string, unknown>).name).toBe('Renamed Coffee Shop');
  });
});
