import { getAdapter, getAdapterForHost } from '@/adapters';
import type { RawExtract, RawImportResult } from '@/adapters/types';
import type { BgRequest, BgResponse, ContentEvent } from '@/utils/messaging';
import { BRIDGE_CHANNEL } from '@/utils/bridge';
import { getSettings, saveSettings, saveJob, getJob, listJobs, deleteJob, DEFAULT_SETTINGS, type AppSettings } from '@/storage/db';
import { createJob, applyExtraction, applyExtractionItems, applyPreviewPlaces, startImport, progressImport, finalizeImport, type Job, type JobProgress } from '@/core/jobs';
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
  await saveJob(applyExtractionItems({ ...job, existingPlaces: job.existingPlaces }, result.items, places, result.rawCount));
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
  command: { type: 'extract' | 'import' | 'ping' | 'dev-read-fav' | 'dev-clear-fav' | 'delete-fav-ids'; payload?: unknown; ids?: string[] },
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
  if (job.places.length === 0) return { type: 'error', message: '没有可导入的收藏' };

  const target = getAdapter(job.targetProvider);
  if (!target.capabilities.canImport) {
    return { type: 'error', message: `${target.name} 暂不支持自动导入` };
  }

  try {
    const payload = target.buildImportPayload(job.places);
    // 取消此前卡住的导入任务，避免 import-result 关联到错误的 job
    const jobs = await listJobs();
    for (const j of jobs) {
      if (j.id !== jobId && j.status === 'importing') {
        await saveJob({ ...j, status: 'failed', error: '已取消（新导入开始）', updatedAt: now() });
      }
    }
    const started = startImport(job, payload);
    await saveJob(started);
    await sendCommandToTab(tabId, { type: 'import', payload });
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
  }
  await saveJob(finalizeImport(job, data, report));
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
        resolve({ ok: false, error: '撤销超时：请确认高德页面已打开并登录' });
      }, 600000),
    };
    sendCommandToTab(tabId, { type: 'delete-fav-ids', ids }).catch((e) => {
      log('undo-import send failed', String(e?.message ?? e));
      resolve({ ok: false, error: '无法连接页面脚本：' + String(e?.message ?? e) });
    });
  });
  if (!result.ok) return { type: 'error', message: result.error ?? '撤销失败' };
  const data = result.data as { deleted: number; failed: number; remaining: number; ok: boolean; error?: string };
  const updated = { ...job, report: { ...job.report, undone: true } };
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
          if (d.ok === false) resolvePendingDev(false, undefined, d.error ?? '清空失败');
          else resolvePendingDev(true, event.data);
        }
      } else if (event.type === 'dev-fav-progress') {
        devClearProgress = event.data as { deleted: number; failed: number; total: number; done: number };
      } else if (event.type === 'fav-ids-deleted') {
        if (pendingUndo) {
          const d = event.data as { ok?: boolean; error?: string };
          if (d.ok === false) pendingUndo.resolve({ ok: false, error: d.error ?? '撤销失败' });
          else pendingUndo.resolve({ ok: true, data: event.data });
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
        const job = createJob(req.source, req.target);
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
      case 'preview-update': {
        const job = await getJob(req.jobId);
        if (!job) return { type: 'error', message: '任务不存在' };
        const updated: Job = applyPreviewPlaces(job, req.places);
        await saveJob(updated);
        return { type: 'job', job: updated };
      }
      case 'import': {
        return await handleImport(req.jobId, req.tabId);
      }
      case 'import-file': {
        // 从 MapBridge 导出文件导入：以文件声明来源（仅展示用），目标为选定地图。
        const src = (req.places[0]?.source?.provider as ProviderId | undefined) ?? 'amap';
        const job = createJob(src, req.target);
        await saveJob(job);
        const applied = applyExtraction({ ...job }, req.places, req.places.length);
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
