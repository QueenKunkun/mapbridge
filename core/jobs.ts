import type { CanonicalPlace, ProviderId } from './model';
import type { RawImportResult } from '@/adapters/types';

export type JobStatus =
  | 'draft'
  | 'extracting'
  | 'preview'
  | 'importing'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface JobProgress {
  processed: number;
  total: number;
  phase?: 'read-existing' | 'sync' | 'verify';
  message?: string;
}

export interface ImportReport {
  imported: number;
  skippedDuplicates: number;
  failed: number;
  failedItems: { placeId: string; error: string }[];
  targetCount?: number;
  raw?: unknown;
}

export interface Job {
  id: string;
  createdAt: string;
  updatedAt: string;
  sourceProvider: ProviderId;
  targetProvider: ProviderId;
  status: JobStatus;
  /** 归一化后的收藏（CDM），可被预览编辑。 */
  places: CanonicalPlace[];
  /** 目标导入 payload（幂等构建一次，重试复用）。 */
  importPayload?: unknown;
  /** 目标地图已有的收藏（用于去重提示，可选）。 */
  existingPlaces?: CanonicalPlace[];
  progress: JobProgress;
  report?: ImportReport;
  error?: string;
}

export function createJob(sourceProvider: ProviderId, targetProvider: ProviderId): Job {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    sourceProvider,
    targetProvider,
    status: 'draft',
    places: [],
    progress: { processed: 0, total: 0 },
  };
}

export function applyExtraction(job: Job, places: CanonicalPlace[], rawCount: number): Job {
  return {
    ...job,
    places,
    status: 'preview',
    progress: { processed: 0, total: places.length },
    updatedAt: new Date().toISOString(),
  };
}

export function startImport(job: Job, payload: unknown): Job {
  return {
    ...job,
    importPayload: payload,
    status: 'importing',
    progress: { processed: 0, total: job.places.length },
    updatedAt: new Date().toISOString(),
  };
}

export function progressImport(job: Job, progress: Partial<JobProgress>): Job {
  return {
    ...job,
    progress: { ...job.progress, ...progress },
    updatedAt: new Date().toISOString(),
  };
}

export function finalizeImport(job: Job, rawResult: RawImportResult, report: ImportReport): Job {
  return {
    ...job,
    status: rawResult.done && !rawResult.error ? 'done' : 'failed',
    report,
    error: rawResult.error,
    updatedAt: new Date().toISOString(),
  };
}