import { getAdapter, getAdapterForHost } from '@/adapters';
import type { RawExtract, RawImportResult } from '@/adapters/types';
import type { BgRequest, BgResponse, ContentEvent } from '@/utils/messaging';
import { BRIDGE_CHANNEL } from '@/utils/bridge';
import { getSettings, saveSettings, saveJob, getJob, listJobs, deleteJob, DEFAULT_SETTINGS, type AppSettings } from '@/storage/db';
import { createJob, applyExtraction, applyExtractionItems, applyPreviewPlaces, startImport, progressImport, finalizeImport, type Job, type JobProgress, type AmapPoiMatchRecord, type AmapPoiResolution } from '@/core/jobs';
import { dedupPlaces } from '@/core/dedup';
import type { ProviderId } from '@/core/model';

function now(): string {
  return new Date().toISOString();
}

function log(...args: unknown[]): void {
  console.log('[mb:bg]', now(), ...args);
}

/** 提取操作结果（在 content 事件里被 resolve）。 */
interface PendingExtract {
  jobId: string;
  resolve: (result: { ok: boolean; error?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
  graceTimer?: ReturnType<typeof setTimeout>;
  bestRecords?: unknown[];
}

let pendingExtract: PendingExtract | undefined;
let pendingAmapMatch: { jobId: string; placeIds: string[]; resolve: (result: { ok: boolean; resolutions?: Record<string, AmapPoiResolution>; matches?: Record<string, AmapPoiMatchRecord>; error?: string }) => void; timer: ReturnType<typeof setTimeout> } | undefined;

async function resolvePendingExtract(ok: boolean, error?: string): Promise<void> {
  const pending = pendingExtract;
  if (!pending) return;
  pendingExtract = undefined;
  clearTimeout(pending.timer);
  if (pending.graceTimer) clearTimeout(pending.graceTimer);
  pending.resolve({ ok, error });
}

async function applyExtractData(data: RawExtract): Promise<void> {
  const pending = pendingExtract;
  if (!pending) return;
  const job = await getJob(pending.jobId);
  if (!job) {
    await resolvePendingExtract(false, '任务不存在');
    return;
  }
  const source = getAdapter(job.sourceProvider);
  const result = source.buildExtractResult(data);
  const settings = await getSettings();
  let places = result.places;
  if (settings.skipExisting) {
    places = dedupPlaces(result.places, job.existingPlaces ?? []).unique;
  }
  log('applyExtractData: rawCount=', result.rawCount, 'places=', places.length);
  const warnings = result.skipped.map((item) => `第 ${item.index + 1} 条：${item.reason}`);
  await saveJob(applyExtractionItems({ ...job, existingPlaces: job.existingPlaces }, result.items, places, result.rawCount, warnings, result.skipped));
  await resolvePendingExtract(true);
}

/** 开发版工具（备份/清空收藏）的挂起结果。 */
interface PendingDev {
  kind: 'read' | 'clear';
  resolve: (result: { ok: boolean; data?: unknown; error?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}

let pendingDev: PendingDev | undefined;
let devClearProgress: { deleted: number; failed: number; total: number; done: number } | undefined;
let pendingUndo: { resolve: (r: { ok: boolean; data?: unknown; error?: string }) => void; timer?: ReturnType<typeof setTimeout> } | undefined;

function resolvePendingDev(ok: boolean, data?: unknown, error?: string): void {
  const pending = pendingDev;
  if (!pending) return;
  pendingDev = undefined;
  clearTimeout(pending.timer);
  pending.resolve({ ok, data, error });
}

async function sendCommandToTab(
  tabId: number,
  command: { type: 'extract' | 'import' | 'match-poi' | 'ping' | 'dev-read-fav' | 'dev-clear-fav' | 'delete-fav-ids'; payload?: unknown; ids?: string[]; options?: { importDelayMs?: number; poiMatchDelayMs?: number; baiduPoiMatchDelayMs?: number; baiduPoiMatchDistanceMeters?: number; poiMatchDistanceMeters?: number; amapSyncBatchSize?: number; baiduSyncBatchSize?: number; dedupDistanceMeters?: number } },
): Promise<void> {
  log('sendCommandToTab -> tab', tabId, command.type);
  await browser.tabs.sendMessage(tabId, {
    type: 'mb:command',
    command: { mb: BRIDGE_CHANNEL, ...command },
  } as never);
}

async function handleExtract(jobId: string, tabId: number): Promise<BgResponse> {
  const job = await getJob(jobId);
  if (!job) return { type: 'error', message: '任务不存在' };

  const source = getAdapter(job.sourceProvider);
  if (!source.capabilities.canExtract) {
    return { type: 'error', message: `${source.name} 暂不支持提取` };
  }

  await saveJob({ ...job, status: 'extracting', updatedAt: now() });

  const outcome = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    pendingExtract = {
      jobId,
      resolve,
      timer: setTimeout(() => {
        log('extract timeout', jobId);
        void resolvePendingExtract(false, '提取超时：请确认已在源地图收藏页登录后重试');
      }, 25000),
    };
    sendCommandToTab(tabId, { type: 'extract' }).catch((e) => {
      log('sendCommandToTab extract failed', String(e?.message ?? e));
      void resolvePendingExtract(false, '无法连接页面脚本：' + String(e?.message ?? e));
    });
  });
  log('extract outcome', jobId, outcome);
  return outcome.ok ? { type: 'job', job: await getJob(jobId) } : { type: 'error', message: outcome.error ?? '提取失败' };
}

async function handleImport(jobId: string, tabId: number): Promise<BgResponse> {
  const job = await getJob(jobId);
  if (!job) return { type: 'error', message: '任务不存在' };
  if (job.items.length === 0) return { type: 'error', message: '没有可导入的收藏' };

  const target = getAdapter(job.targetProvider);
  if (!target.capabilities.canImport) {
    return { type: 'error', message: `${target.name} 暂不支持自动导入` };
  }
  const unsupportedKinds = [...new Set(job.items.map((item) => item.kind))]
    .filter((kind) => !target.capabilities.importKinds.includes(kind));
  const supportedItems = job.items.filter((item) => target.capabilities.importKinds.includes(item.kind));
  if (unsupportedKinds.length > 0 && supportedItems.length === 0) {
    return { type: 'error', message: `${target.name} 暂不支持导入：${unsupportedKinds.join('、')}` };
  }

  try {
    const settings = await getSettings();
    const hasRoutes = supportedItems.some((item) => item.kind === 'route');
    if (hasRoutes && !target.buildImportItemsPayload) {
      throw new Error(`${target.name} 暂不支持导入路线`);
    }
    const payload = hasRoutes
      ? target.buildImportItemsPayload!(supportedItems, job.places, { amapPoiResolutions: job.amapPoiResolutions })
      : target.buildImportPayload(job.places, { amapPoiResolutions: job.amapPoiResolutions });
    // 取消此前卡住的导入任务，避免 import-result 关联到错误的 job
    const jobs = await listJobs();
    for (const j of jobs) {
      if (j.id !== jobId && j.status === 'importing') {
        await saveJob({ ...j, status: 'failed', error: '已取消（新导入开始）', updatedAt: now() });
      }
    }
    const started = startImport(job, payload);
    await saveJob(started);
    await sendCommandToTab(tabId, {
      type: 'import',
      payload,
      options: {
        importDelayMs: settings.importDelayMs,
        poiMatchDelayMs: settings.poiMatchDelayMs,
        baiduPoiMatchDelayMs: settings.baiduPoiMatchDelayMs,
        baiduPoiMatchDistanceMeters: settings.baiduPoiMatchDistanceMeters,
        amapSyncBatchSize: settings.amapSyncBatchSize,
        baiduSyncBatchSize: settings.baiduSyncBatchSize,
        dedupDistanceMeters: settings.dedupDistanceMeters,
      },
    });
    return { type: 'ok' };
  } catch (e) {
    await saveJob({ ...job, status: 'failed', error: String(e instanceof Error ? e.message : e), updatedAt: now() });
    return { type: 'error', message: String(e instanceof Error ? e.message : e) };
  }
}

async function handleExtractData(event: ContentEvent['event'], data: RawExtract): Promise<void> {
  log('handleExtractData', 'pending=', Boolean(pendingExtract), 'records=', data.records?.length);
  if (!pendingExtract) {
    log('handleExtractData: no pending extract, dropping');
    return;
  }

  const records = data.records ?? [];
  // 内容脚本可能因页面启动期的多次注入而先发来空响应，记录最佳（记录数最多）的结果并等待更完整的响应。
  if (!pendingExtract.bestRecords || records.length > pendingExtract.bestRecords.length) {
    pendingExtract.bestRecords = records;
  }
  log('handleExtractData: bestRecords now=', (pendingExtract.bestRecords ?? []).length);

  if (records.length > 0) {
    log('handleExtractData: got non-empty, applying immediately');
    await applyExtractData(data);
    return;
  }

  // 空响应：给一个宽限期等待后续非空响应（通常来自真正完成加载的页面实例）。
  if (!pendingExtract.graceTimer) {
    pendingExtract.graceTimer = setTimeout(() => {
      const pending = pendingExtract;
      if (!pending) return;
      void (async () => {
        const job = await getJob(pending.jobId);
        if (!job) {
          await resolvePendingExtract(false, '任务不存在');
          return;
        }
        const best = (pending.bestRecords ?? []) as unknown[];
        await applyExtractData({
          provider: job.sourceProvider,
          records: best,
          exhausted: true,
          hint: best.length === 0 ? '未捕获到收藏数据。请打开 https://ditu.amap.com/faves 并确认已登录后重试。' : undefined,
        });
      })();
    }, 4000);
  }
}

async function handleMatchAmapPoi(jobId: string, tabId: number, requestedPlaceIds?: string[]): Promise<BgResponse> {
  const job = await getJob(jobId);
  if (!job || job.targetProvider !== 'amap') return { type: 'error', message: '仅支持匹配导入到高德的地点' };
  if (job.places.length === 0) return { type: 'error', message: '没有可匹配的地点' };
  const placeIds = requestedPlaceIds?.length ? requestedPlaceIds.filter((id) => job.places.some((place) => place.id === id)) : job.places.map((place) => place.id);
  if (placeIds.length === 0) return { type: 'error', message: '没有找到要匹配的地点' };
  const settings = await getSettings();
  const currentMatches = { ...(job.amapPoiMatches ?? {}) };
  for (const placeId of placeIds) currentMatches[placeId] = { status: 'matching' };
  await saveJob(progressImport(job, {
    phase: 'match-poi',
    processed: 0,
    total: placeIds.length,
    message: '正在连接高德页面…',
  } as Partial<JobProgress>));
  await saveJob({ ...(await getJob(jobId) ?? job), amapPoiMatches: currentMatches, updatedAt: now() });
  const result = await new Promise<{ ok: boolean; resolutions?: Record<string, AmapPoiResolution>; matches?: Record<string, AmapPoiMatchRecord>; error?: string }>((resolve) => {
    pendingAmapMatch = {
      jobId,
      placeIds,
      resolve,
      timer: setTimeout(() => {
        pendingAmapMatch = undefined;
        resolve({ ok: false, error: '高德 POI 匹配超时' });
      }, 30000),
    };
    sendCommandToTab(tabId, { type: 'match-poi', payload: job.places.filter((place) => placeIds.includes(place.id)), options: { poiMatchDelayMs: settings.poiMatchDelayMs, poiMatchDistanceMeters: settings.poiMatchDistanceMeters } }).catch((e) => {
      if (pendingAmapMatch) {
        clearTimeout(pendingAmapMatch.timer);
        pendingAmapMatch = undefined;
      }
      resolve({ ok: false, error: '无法连接高德页面：' + String(e instanceof Error ? e.message : e) });
    });
  });
  const latest = await getJob(jobId);
  if (!result.ok) {
    if (latest) {
      const failed = { ...(latest.amapPoiMatches ?? {}) };
      for (const placeId of placeIds) failed[placeId] = { status: 'failed', error: result.error ?? '高德 POI 匹配失败' };
      await saveJob({ ...latest, amapPoiMatches: failed, progress: { ...latest.progress, processed: 0, total: placeIds.length, message: result.error ?? '高德 POI 匹配失败' }, updatedAt: now() });
    }
    return { type: 'error', message: result.error ?? '高德 POI 匹配失败' };
  }
  const updated = await getJob(jobId);
  if (!updated) return { type: 'error', message: '任务不存在' };
  await saveJob({
    ...updated,
    amapPoiResolutions: { ...(updated.amapPoiResolutions ?? {}), ...(result.resolutions ?? {}) },
    amapPoiMatches: { ...(updated.amapPoiMatches ?? {}), ...(result.matches ?? {}) },
    updatedAt: now(),
  });
  return { type: 'job', job: await getJob(jobId) };
}

async function handleSelectAmapPoi(jobId: string, placeId: string, candidate: AmapPoiResolution): Promise<BgResponse> {
  const job = await getJob(jobId);
  if (!job || job.targetProvider !== 'amap') return { type: 'error', message: '仅支持选择高德 POI' };
  if (!job.places.some((place) => place.id === placeId) || !candidate.poiid) return { type: 'error', message: '地点或 POI 候选不存在' };
  await saveJob({
    ...job,
    amapPoiResolutions: { ...(job.amapPoiResolutions ?? {}), [placeId]: candidate },
    amapPoiMatches: {
      ...(job.amapPoiMatches ?? {}),
      [placeId]: { ...(job.amapPoiMatches?.[placeId] ?? {}), status: 'matched' },
    },
    updatedAt: now(),
  });
  return { type: 'job', job: await getJob(jobId) };
}

async function handleCancelJob(jobId: string): Promise<BgResponse> {
  const job = await getJob(jobId);
  if (!job) return { type: 'error', message: '任务不存在' };
  if (job.status === 'importing') return { type: 'error', message: '导入已经开始，不能取消；请等待完成后再撤销已写入记录' };
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return { type: 'error', message: '当前任务已经结束' };
  const cancelled: Job = { ...job, status: 'cancelled', updatedAt: now() };
  await saveJob(cancelled);
  return { type: 'job', job: cancelled };
}

async function handleImportEvent(data: RawImportResult): Promise<void> {
  const jobs = await listJobs();
  const job = jobs.find((j) => j.status === 'importing');
  log('handleImportEvent', 'importingJob=', job?.id, 'done=', data.done, 'error=', data.error, 'targetCount=', data.targetCount);
  if (!job) return;
  const target = getAdapter(job.targetProvider);
  const report = target.summarizeImportResult(data);
  // 记录实际写入的目标收藏 id，供"撤销导入"使用
  const detail = data.raw && typeof data.raw === 'object'
    ? (data.raw as { detail?: Array<{ id?: string; status?: string }> }).detail
    : undefined;
  if (Array.isArray(detail)) {
    report.importedIds = detail
      .filter((d) => d.status === 'imported' && d.id)
      .map((d) => d.id as string);
  } else if (data.raw && typeof data.raw === 'object' && Array.isArray((data.raw as { importedIds?: unknown }).importedIds)) {
    report.importedIds = (data.raw as { importedIds: unknown[] }).importedIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
  }
  await saveJob(finalizeImport(job, data, report));
}

async function handleAmapMatchResult(data: unknown): Promise<void> {
  const pending = pendingAmapMatch;
  if (!pending) return;
  const job = await getJob(pending.jobId);
  if (job) {
    await saveJob(progressImport(job, {
      phase: 'match-poi',
      processed: job.progress.total,
      total: job.progress.total,
      message: '高德 POI 匹配完成',
    }));
  }
  pendingAmapMatch = undefined;
  clearTimeout(pending.timer);
  const value = data && typeof data === 'object' ? data as { done?: boolean; resolutions?: Record<string, AmapPoiResolution>; matches?: Record<string, AmapPoiMatchRecord>; error?: string } : {};
  if (value.error) {
    pending.resolve({ ok: false, matches: value.matches, error: value.error });
    return;
  }
  pending.resolve(value.done ? { ok: true, resolutions: value.resolutions ?? {}, matches: value.matches ?? {} } : { ok: false, matches: value.matches, error: '高德 POI 匹配未完成' });
}

async function handleDevFavRead(tabId: number): Promise<BgResponse> {
  const result = await new Promise<{ ok: boolean; data?: unknown; error?: string }>((resolve) => {
    pendingDev = {
      kind: 'read',
      resolve,
      timer: setTimeout(() => {
        log('dev-fav-read timeout');
        resolvePendingDev(false, undefined, '读取超时：请确认高德页面已打开并登录');
      }, 30000),
    };
    sendCommandToTab(tabId, { type: 'dev-read-fav' }).catch((e) => {
      log('dev-fav-read send failed', String(e?.message ?? e));
      resolvePendingDev(false, undefined, '无法连接页面脚本：' + String(e?.message ?? e));
    });
  });
  return result.ok ? { type: 'dev-fav-data', data: result.data as { provider: 'amap' | 'baidu'; fav: unknown; error?: string } } : { type: 'error', message: result.error ?? '读取失败' };
}

async function handleDevFavClear(tabId: number): Promise<BgResponse> {
  const result = await new Promise<{ ok: boolean; data?: unknown; error?: string }>((resolve) => {
    pendingDev = {
      kind: 'clear',
      resolve,
      timer: setTimeout(() => {
        log('dev-clear-fav timeout');
        resolvePendingDev(false, undefined, '清空超时');
      }, 600000),
    };
    sendCommandToTab(tabId, { type: 'dev-clear-fav' }).catch((e) => {
      log('dev-clear-fav send failed', String(e?.message ?? e));
      resolvePendingDev(false, undefined, '无法连接页面脚本：' + String(e?.message ?? e));
    });
  });
  return result.ok
    ? { type: 'dev-fav-cleared', data: result.data as { provider: 'amap' | 'baidu'; deleted: number; failed: number; remaining: number; ok: boolean; error?: string } }
    : result.data
      ? { type: 'dev-fav-cleared', data: result.data as { provider: 'amap' | 'baidu'; deleted: number; failed: number; remaining: number; ok: boolean; error?: string } }
      : { type: 'error', message: result.error ?? '清空失败' };
}

async function handleUndoImport(jobId: string, tabId: number): Promise<BgResponse> {
  const job = await getJob(jobId);
  const ids = job?.report?.importedIds ?? [];
  if (!job || ids.length === 0) return { type: 'error', message: '没有可撤销的导入记录' };
  if (!job.report) return { type: 'error', message: '导入记录缺失' };
  if (job.report.undone) return { type: 'error', message: '该次导入已撤销' };
  const result = await new Promise<{ ok: boolean; data?: unknown; error?: string }>((resolve) => {
    pendingUndo = {
      resolve,
      timer: setTimeout(() => {
        log('undo-import timeout');
        resolve({ ok: false, error: '撤销超时：请确认目标地图收藏页已打开并登录' });
      }, 600000),
    };
    sendCommandToTab(tabId, { type: 'delete-fav-ids', ids }).catch((e) => {
      log('undo-import send failed', String(e?.message ?? e));
      resolve({ ok: false, error: '无法连接页面脚本：' + String(e?.message ?? e) });
    });
  });
  if (!result.ok) return { type: 'error', message: result.error ?? '撤销失败' };
  const data = result.data as { deleted: number; failed: number; remaining: number; ok: boolean; error?: string };
  const updated = {
    ...job,
    report: {
      ...job.report,
      undone: data.failed === 0,
      undoDeleted: data.deleted,
      undoFailed: data.failed,
    },
  };
  await saveJob(updated);
  return { type: 'undo-result', data };
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(async (msg: unknown): Promise<BgResponse | undefined> => {
    const request = msg as BgRequest | ContentEvent;

    // 内容脚本上报
    if ((request as ContentEvent).type === 'mb:event') {
      const event = (request as ContentEvent).event;
      log('recv mb:event', event?.type);
      if (event.type === 'extract-data') {
        await handleExtractData(event as never, event.data as RawExtract);
      } else if (event.type === 'poi-match-result') {
        await handleAmapMatchResult(event.data);
      } else if (event.type === 'poi-match-progress') {
        const jobs = await listJobs();
        const matchJobId = pendingAmapMatch?.jobId;
        const job = matchJobId ? jobs.find((j) => j.id === matchJobId) : undefined;
        if (job) {
          // 完成事件可能与最后一次进度事件乱序到达；完成后丢弃迟到的旧进度。
          if (!pendingAmapMatch || pendingAmapMatch.jobId !== job.id) return undefined;
          const p = event.data as { processed?: number; total?: number; message?: string };
          await saveJob(progressImport(job, {
            phase: 'match-poi',
            processed: Math.max(job.progress.processed, p.processed ?? 0),
            total: p.total ?? job.progress.total,
            message: p.message,
          }));
        }
      } else if (event.type === 'import-progress') {
        const jobs = await listJobs();
        const job = jobs.find((j) => j.status === 'importing');
        if (job) {
          const p = event.data as { phase?: JobProgress['phase']; processed?: number; total?: number; message?: string };
          await saveJob(progressImport(job, { phase: p?.phase, processed: p?.processed, total: p?.total, message: p?.message }));
        }
      } else if (event.type === 'import-result') {
        await handleImportEvent(event.data as RawImportResult);
      } else if (event.type === 'dev-fav-data') {
        if (pendingDev?.kind === 'read') {
          const d = event.data as { provider?: string; fav?: unknown; error?: string };
          if (d.error) resolvePendingDev(false, undefined, d.error);
          else resolvePendingDev(true, { provider: d.provider, fav: d.fav });
        }
      } else if (event.type === 'dev-fav-cleared') {
        if (pendingDev?.kind === 'clear') {
          const d = event.data as { ok?: boolean; error?: string };
          // Preserve partial-cleanup statistics even when some records remain;
          // the options page should report deleted/failed/remaining instead of
          // collapsing the result into a generic error.
          resolvePendingDev(d.ok !== false, event.data, d.ok === false ? d.error : undefined);
        }
      } else if (event.type === 'dev-fav-progress') {
        devClearProgress = event.data as { deleted: number; failed: number; total: number; done: number };
      } else if (event.type === 'fav-ids-deleted') {
        if (pendingUndo) {
          pendingUndo.resolve({ ok: true, data: event.data });
        }
      }
      return undefined;
    }

    const req = request as BgRequest;
    log('recv req', req.type, (req as { jobId?: string }).jobId ?? '');
    switch (req.type) {
      case 'get-state': {
        return { type: 'state', jobs: await listJobs(), settings: await getSettings() };
      }
      case 'list-jobs': {
        return { type: 'jobs', jobs: await listJobs() };
      }
      case 'get-job': {
        return { type: 'job', job: await getJob(req.id) };
      }
      case 'new-job': {
        const job = createJob(req.source, req.target, req.workflow ?? 'migrate');
        await saveJob(job);
        return { type: 'job', job };
      }
      case 'delete-job': {
        await deleteJob(req.id);
        return { type: 'ok' };
      }
      case 'extract': {
        return await handleExtract(req.jobId, req.tabId);
      }
      case 'match-poi': {
        return await handleMatchAmapPoi(req.jobId, req.tabId, req.placeIds);
      }
      case 'select-poi-match': {
        return await handleSelectAmapPoi(req.jobId, req.placeId, req.candidate);
      }
      case 'cancel-job': {
        return await handleCancelJob(req.jobId);
      }
      case 'preview-update': {
        const job = await getJob(req.jobId);
        if (!job) return { type: 'error', message: '任务不存在' };
        const updated: Job = applyPreviewPlaces(job, req.places, req.previewTab);
        await saveJob(updated);
        return { type: 'job', job: updated };
      }
      case 'import': {
        return await handleImport(req.jobId, req.tabId);
      }
      case 'import-file': {
        // 从 MapBridge/GPX/KML 导出文件导入；v2 文件的 Route 也必须进入任务。
        const src = req.source ?? req.places[0]?.source.provider ?? req.items[0]?.source.provider ?? 'amap';
        const job = createJob(src, req.target, 'import-file');
        await saveJob(job);
        const applied = applyExtractionItems({ ...job }, req.items, req.places, req.items.length, req.warnings ?? []);
        await saveJob(applied);
        return { type: 'job', job: applied };
      }
      case 'get-settings': {
        return { type: 'settings', settings: await getSettings() };
      }
      case 'save-settings': {
        await saveSettings({ ...DEFAULT_SETTINGS, ...req.settings } as AppSettings);
        return { type: 'settings', settings: await getSettings() };
      }
      case 'open-tab': {
        await browser.tabs.create({ url: req.url });
        return { type: 'ok' };
      }
      case 'get-active-tab': {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { type: 'active-tab', tabId: -1 };
        const url = tab.url ?? tab.pendingUrl;
        let providerId: ProviderId | undefined;
        if (url) {
          try {
            const adapter = getAdapterForHost(new URL(url).hostname);
            providerId = adapter?.id;
          } catch {
            /* ignore invalid url */
          }
        }
        return { type: 'active-tab', tabId: tab.id, url, providerId };
      }
      case 'detect-map-tabs': {
        // 无需读取标签页 URL 权限：向所有标签页广播 whoami，能应答的就是已打开的地图收藏页
        const tabs = await browser.tabs.query({});
        const detected: { providerId: ProviderId; tabId: number; loggedIn?: boolean }[] = [];
        for (const t of tabs) {
          if (!t.id) continue;
          try {
            const resp = (await browser.tabs.sendMessage(
              t.id,
              { type: 'mb:command', command: { mb: BRIDGE_CHANNEL, type: 'whoami' } } as never,
            )) as { provider?: ProviderId; loggedIn?: boolean } | undefined;
            if (resp?.provider) detected.push({ providerId: resp.provider, tabId: t.id, loggedIn: resp.loggedIn });
          } catch {
            /* 无内容脚本的标签页 */
          }
        }
        log('detect-map-tabs ->', detected);
        return { type: 'detected', tabs: detected };
      }
      case 'dev-fav-read': {
        if (!import.meta.env.DEV) return { type: 'error', message: '仅开发版可用' };
        return await handleDevFavRead(req.tabId);
      }
      case 'dev-fav-clear': {
        if (!import.meta.env.DEV) return { type: 'error', message: '仅开发版可用' };
        return await handleDevFavClear(req.tabId);
      }
      case 'dev-fav-progress': {
        return { type: 'dev-progress', deleted: devClearProgress?.deleted ?? 0, failed: devClearProgress?.failed ?? 0, total: devClearProgress?.total ?? 0, done: devClearProgress?.done ?? 0 };
      }
      case 'undo-import': {
        return await handleUndoImport(req.jobId, req.tabId);
      }
      default:
        return { type: 'error', message: '未知请求' };
    }
  });
});
