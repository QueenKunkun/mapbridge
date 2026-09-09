import { describe, expect, it } from 'vitest';
import { migratePlaceToPoi } from '@/core/export';
import { applyExtractionItems, applyPreviewPlaces, createJob, finalizeImport, hydrateJob, previewPreviousStep, progressImport, startImport, updatePreviewPlace } from '@/core/jobs';
import type { CanonicalItem, CanonicalPlace } from '@/core/model';
import { restorePopupState } from '@/core/popup-state';

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
  it.each([
    ['migrate', 'extracting', 'extract'],
    ['migrate', 'preview', 'preview'],
    ['migrate', 'importing', 'report'],
    ['import-file', 'preview', 'preview'],
    ['import-file', 'importing', 'report'],
  ] as const)('restores %s %s to %s', (workflow, status, step) => {
    const job = { ...createJob('baidu', 'amap', workflow), status, updatedAt: '2026-09-09T00:00:00.000Z' };
    expect(restorePopupState([job], { mode: 'migrate' })).toMatchObject({ kind: 'active', mode: workflow, step, job });
  });

  it.each(['done', 'failed', 'cancelled', 'draft'] as const)('does not restore %s jobs', (status) => {
    const job = { ...createJob('baidu', 'amap'), status, updatedAt: '2026-09-09T00:00:00.000Z' };
    expect(restorePopupState([job], { mode: 'export' })).toEqual({ kind: 'idle', mode: 'export' });
  });

  it('never restores an export extraction as migration preview', () => {
    const job = { ...createJob('amap', 'amap', 'export'), status: 'preview' as const, updatedAt: '2026-09-09T00:00:00.000Z' };
    expect(restorePopupState([job], { mode: 'migrate' })).toEqual({ kind: 'idle', mode: 'migrate' });
  });

  it('restores the persisted import confirmation phase instead of preview', () => {
    const job = { ...createJob('baidu', 'amap'), status: 'preview' as const, phase: 'import' as const, updatedAt: '2026-09-09T00:00:00.000Z' };
    expect(restorePopupState([job], { mode: 'migrate' })).toMatchObject({ kind: 'active', mode: 'migrate', step: 'import' });
  });

  it('restores migration preview returned to extraction as the extraction step', () => {
    const job = applyPreviewPlaces(createJob('baidu', 'amap'), [place], 'places', 'extract');
    expect(job.status).toBe('preview');
    expect(restorePopupState([job], { mode: 'migrate' })).toMatchObject({ kind: 'active', step: 'extract' });
  });

  it('restores only the explicitly active job when an active id is available', () => {
    const older = { ...createJob('baidu', 'amap'), status: 'preview' as const, updatedAt: '2026-09-09T00:00:00.000Z' };
    const newer = { ...createJob('amap', 'baidu'), status: 'preview' as const, updatedAt: '2026-09-09T01:00:00.000Z' };
    expect(restorePopupState([older, newer], { mode: 'migrate' }, older.id)).toMatchObject({ kind: 'active', job: older });
  });

  it('does not restore another tab\'s task when the current tab has no active task', () => {
    const job = { ...createJob('baidu', 'amap'), status: 'preview' as const };
    expect(restorePopupState([job], { mode: 'migrate' }, undefined, true)).toEqual({ kind: 'idle', mode: 'migrate' });
  });

  it('returns to the correct entry step from the shared preview', () => {
    expect(previewPreviousStep('migrate')).toBe('extract');
    expect(previewPreviousStep('import-file')).toBe('setup');
    expect(previewPreviousStep('export')).toBe('setup');
  });

  it('keeps persisted POI matching records when hydrating a job', () => {
    const job = createJob('baidu', 'amap');
    const hydrated = hydrateJob({
      ...job,
      amapPoiMatches: { 'poi-1': { status: 'not-found' } },
    });
    expect(hydrated.amapPoiMatches?.['poi-1']?.status).toBe('not-found');
  });

  it('invalidates a POI match when the preview record changes', () => {
    const job = {
      ...createJob('baidu', 'amap'),
      places: [place],
      amapPoiResolutions: { [place.id]: { poiid: 'amap-1' } },
      amapPoiMatches: { [place.id]: { status: 'matched' as const } },
    };
    const updated = applyPreviewPlaces(job, [{ ...place, name: 'Renamed POI' }]);
    expect(updated.amapPoiResolutions).toBeUndefined();
    expect(updated.amapPoiMatches).toBeUndefined();
  });

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
    const job = applyExtractionItems(
      createJob('baidu', 'amap'),
      [route],
      [],
      3,
      ['第 1 条：源地图已标记为删除，已跳过', '第 2 条：缺少名称或坐标'],
      [
        { index: 0, reason: '源地图已标记为删除，已跳过', label: 'type:11 · Deleted' },
        { index: 1, reason: '缺少名称或坐标' },
      ],
    );
    expect(job.warnings).toEqual(['第 1 条：源地图已标记为删除，已跳过', '第 2 条：缺少名称或坐标']);
    expect(job.rawCount).toBe(3);
    expect(job.extractionSkipped).toHaveLength(2);
    expect(job.extractionSkipped[0]!.label).toBe('type:11 · Deleted');
  });

  it('hydrates legacy jobs without items or warnings', () => {
    const current = createJob('baidu', 'amap');
    const { items: _items, warnings: _warnings, extractionSkipped: _extractionSkipped, rawCount: _rawCount, ...legacy } = { ...current, places: [place] };
    const hydrated = hydrateJob(legacy);
    expect(hydrated.items).toHaveLength(1);
    expect(hydrated.items[0]!.kind).toBe('poi');
    expect(hydrated.warnings).toEqual([]);
    expect(hydrated.extractionSkipped).toEqual([]);
    expect(hydrated.rawCount).toBe(1);
  });

  it('invalidates identity when a preview name changes', () => {
    const withIdentity = { ...place, identity: 'old-identity' };
    expect(updatePreviewPlace(withIdentity, { address: 'New address' }).identity).toBe('old-identity');
    expect(updatePreviewPlace(withIdentity, { name: 'Renamed' }).identity).toBeUndefined();
  });

  it('transitions an import through progress to done', () => {
    const job = applyExtractionItems(createJob('baidu', 'amap'), [migratePlaceToPoi(place)], [place], 1);
    const started = startImport(job, [{ name: 'POI' }]);
    const progressing = progressImport(started, { processed: 1, total: 1, phase: 'verify' });
    const done = finalizeImport(progressing, { provider: 'amap', done: true, targetCount: 1 }, {
      imported: 1, skippedDuplicates: 0, failed: 0, failedItems: [], targetCount: 1,
    });
    expect(started.status).toBe('importing');
    expect(started.progress.total).toBe(1);
    expect(progressing.progress).toMatchObject({ processed: 1, phase: 'verify' });
    expect(done.status).toBe('done');
    expect(done.error).toBeUndefined();
  });

  it('counts Route items in import progress for Route-only jobs', () => {
    const job = applyExtractionItems(createJob('baidu', 'amap'), [route], [], 1);
    expect(startImport(job, []).progress.total).toBe(1);
  });

  it('marks a provider import failure as failed', () => {
    const job = startImport(createJob('baidu', 'amap'), []);
    const failed = finalizeImport(job, { provider: 'amap', done: false, error: 'network failed' }, {
      imported: 0, skippedDuplicates: 0, failed: 1, failedItems: [{ placeId: 'poi-1', error: 'network failed' }],
    });
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('network failed');
    expect(failed.report?.failed).toBe(1);
  });
});
