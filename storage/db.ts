import { createStore, get, set, del, keys } from 'idb-keyval';
import { hydrateJob, type Job } from '@/core/jobs';
import type { ProviderId } from '@/core/model';

const store = createStore('mapbridge', 'kv');

const JOB_PREFIX = 'job:';

export async function saveJob(job: Job): Promise<void> {
  await set(`${JOB_PREFIX}${job.id}`, job, store);
}

export async function getJob(id: string): Promise<Job | undefined> {
  const job = (await get(`${JOB_PREFIX}${id}`, store)) as Job | undefined;
  if (!job) return undefined;
  return hydrateJob(job);
}

export async function listJobs(): Promise<Job[]> {
  const all = await keys(store);
  const ids = all.filter((k) => typeof k === 'string' && k.startsWith(JOB_PREFIX));
  const jobs = await Promise.all(ids.map((id) => getJob(String(id).slice(JOB_PREFIX.length))));
  return jobs
    .filter((j): j is Job => Boolean(j))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function deleteJob(id: string): Promise<void> {
  await del(`${JOB_PREFIX}${id}`, store);
}

export interface AppSettings {
  /** 导入批间隔毫秒（限速）。 */
  importDelayMs: number;
  /** 失败重试次数。 */
  retryCount: number;
  /** 默认目标收藏夹名。 */
  defaultFolder: string;
  /** 是否在导入时跳过与目标已有收藏指纹重复的项。 */
  skipExisting: boolean;
  /** 高德 POI 每批最多同步条数。 */
  amapSyncBatchSize: number;
  /** 高德导入重复判断的像素坐标容差。 */
  amapDedupPixelTolerance: number;
}

export const AMAP_SYNC_BATCH_SIZE_MIN = 1;
export const AMAP_SYNC_BATCH_SIZE_MAX = 200;
export const AMAP_SYNC_BATCH_SIZE_DEFAULT = 50;
export const AMAP_DEDUP_PIXEL_TOLERANCE_MIN = 1;
export const AMAP_DEDUP_PIXEL_TOLERANCE_MAX = 64;
export const AMAP_DEDUP_PIXEL_TOLERANCE_DEFAULT = 8;

export const DEFAULT_SETTINGS: AppSettings = {
  importDelayMs: 500,
  retryCount: 2,
  defaultFolder: '',
  skipExisting: true,
  amapSyncBatchSize: AMAP_SYNC_BATCH_SIZE_DEFAULT,
  amapDedupPixelTolerance: AMAP_DEDUP_PIXEL_TOLERANCE_DEFAULT,
};

const SETTINGS_KEY = 'settings';

export async function getSettings(): Promise<AppSettings> {
  const stored = await get(SETTINGS_KEY, store);
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...(stored ?? {}) } as AppSettings);
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await set(SETTINGS_KEY, normalizeSettings(settings), store);
}

function normalizeSettings(settings: AppSettings): AppSettings {
  const value = Number(settings.amapSyncBatchSize);
  const tolerance = Number(settings.amapDedupPixelTolerance);
  return {
    ...settings,
    amapSyncBatchSize: Number.isFinite(value)
      ? Math.min(AMAP_SYNC_BATCH_SIZE_MAX, Math.max(AMAP_SYNC_BATCH_SIZE_MIN, Math.floor(value)))
      : AMAP_SYNC_BATCH_SIZE_DEFAULT,
    amapDedupPixelTolerance: Number.isFinite(tolerance)
      ? Math.min(AMAP_DEDUP_PIXEL_TOLERANCE_MAX, Math.max(AMAP_DEDUP_PIXEL_TOLERANCE_MIN, Math.floor(tolerance)))
      : AMAP_DEDUP_PIXEL_TOLERANCE_DEFAULT,
  };
}

export type UiMode = 'migrate' | 'export' | 'import-file';

export interface UiSelection {
  source?: ProviderId;
  target?: ProviderId;
  mode?: UiMode;
}

const UI_SELECTION_KEY = 'ui-selection';

export async function getUiSelection(): Promise<UiSelection> {
  return ((await get(UI_SELECTION_KEY, store)) as UiSelection) ?? {};
}

export async function saveUiSelection(sel: UiSelection): Promise<void> {
  await set(UI_SELECTION_KEY, sel, store);
}
