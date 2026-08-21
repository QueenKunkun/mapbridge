import { getAdapter, getAdapterForHost } from '@/adapters';
import type { RawExtract, RawImportResult } from '@/adapters/types';
import type { BgRequest, BgResponse, ContentEvent } from '@/utils/messaging';
import { BRIDGE_CHANNEL } from '@/utils/bridge';
import { getSettings, saveSettings, saveJob, getJob, listJobs, deleteJob, DEFAULT_SETTINGS, type AppSettings } from '@/storage/db';
import { createJob, applyExtraction, startImport, progressImport, finalizeImport, type Job, type JobProgress } from '@/core/jobs';
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
}

let pendingExtract: PendingExtract | undefined;

async function resolvePendingExtract(ok: boolean, error?: string): Promise<void> {
  const pending = pendingExtract;
  if (!pending) return;
  pendingExtract = undefined;
  clearTimeout(pending.timer);
  pending.resolve({ ok, error });
}

/** 开发版工具（备份/清空收藏）的挂起结果。 */
interface PendingDev {
  kind: 'read' | 'clear';
  resolve: (result: { ok: boolean; data?: unknown; error?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}

let pendingDev: PendingDev | undefined;

function resolvePendingDev(ok: boolean, data?: unknown, error?: string): void {
  const pending = pendingDev;
  if (!pending) return;
  pendingDev = undefined;
  clearTimeout(pending.timer);
  pending.resolve({ ok, data, error });
}

async function sendCommandToTab(
  tabId: number,
  command: { type: 'extract' | 'import' | 'ping' | 'dev-read-fav' | 'dev-clear-fav'; payload?: unknown },
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
  if (!pendingExtract) return;
  const job = await getJob(pendingExtract.jobId);
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

  await saveJob(applyExtraction({ ...job, existingPlaces: job.existingPlaces }, places, result.rawCount));
  await resolvePendingExtract(true);
}

async function handleImportEvent(data: RawImportResult): Promise<void> {
  const jobs = await listJobs();
  const job = jobs.find((j) => j.status === 'importing');
  log('handleImportEvent', 'importingJob=', job?.id, 'done=', data.done, 'error=', data.error, 'targetCount=', data.targetCount);
  if (!job) return;
  const target = getAdapter(job.targetProvider);
  const report = target.summarizeImportResult(data);
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
  return result.ok ? { type: 'dev-fav-data', data: result.data as { provider: 'amap'; fav: unknown; error?: string } } : { type: 'error', message: result.error ?? '读取失败' };
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
    ? { type: 'dev-fav-cleared', data: result.data as { provider: 'amap'; deleted: number; failed: number; remaining: number; ok: boolean; error?: string } }
    : { type: 'error', message: result.error ?? '清空失败' };
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
        const updated: Job = {
          ...job,
          places: req.places,
          status: job.status === 'draft' || job.status === 'extracting' ? 'preview' : job.status,
          progress: { processed: 0, total: req.places.length },
          updatedAt: now(),
        };
        await saveJob(updated);
        return { type: 'job', job: updated };
      }
      case 'import': {
        return await handleImport(req.jobId, req.tabId);
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
        const detected: { providerId: ProviderId; tabId: number }[] = [];
        for (const t of tabs) {
          if (!t.id) continue;
          try {
            const resp = (await browser.tabs.sendMessage(
              t.id,
              { type: 'mb:command', command: { mb: BRIDGE_CHANNEL, type: 'whoami' } } as never,
            )) as { provider?: ProviderId } | undefined;
            if (resp?.provider) detected.push({ providerId: resp.provider, tabId: t.id });
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
      default:
        return { type: 'error', message: '未知请求' };
    }
  });
});
