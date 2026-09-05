import { migratePlaceToPoi } from './export';
import type { CanonicalItem, CanonicalPlace, ProviderId } from './model';
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
  /** 实际写入目标地图的收藏 id（用于撤销导入）。 */
  importedIds?: string[];
  /** 本次导入是否已被撤销。 */
  undone?: boolean;
  targetCount?: number;
  raw?: unknown;
}

export interface ExtractionSkip {
  index: number;
  reason: string;
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
  /** 统一模型项目；places 是当前 POI 导入链路的兼容视图。 */
  items: CanonicalItem[];
  /** 提取或文件解析阶段产生的可恢复提示。 */
  warnings: string[];
  /** 提取阶段明确跳过的原始记录，供结果分类展示。 */
  extractionSkipped: ExtractionSkip[];
  /** 提取阶段收到的原始记录数。 */
  rawCount: number;
  /** 目标导入 payload（幂等构建一次，重试复用）。 */
  importPayload?: unknown;
  /** 目标地图已有的收藏（用于去重提示，可选）。 */
  existingPlaces?: CanonicalPlace[];
  progress: JobProgress;
  report?: ImportReport;
  error?: string;
}

type PersistedJob = Omit<Job, 'items' | 'warnings' | 'extractionSkipped' | 'rawCount'>
  & Partial<Pick<Job, 'items' | 'warnings' | 'extractionSkipped' | 'rawCount'>>;

/** Fill fields introduced after the first persisted Job format. */
export function hydrateJob(job: PersistedJob): Job {
  return {
    ...job,
    items: job.items ?? job.places.map(migratePlaceToPoi),
    warnings: job.warnings ?? [],
    extractionSkipped: job.extractionSkipped ?? [],
    rawCount: job.rawCount ?? job.places.length,
  };
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
    items: [],
    warnings: [],
    extractionSkipped: [],
    rawCount: 0,
    progress: { processed: 0, total: 0 },
  };
}

export function applyExtraction(job: Job, places: CanonicalPlace[], rawCount: number): Job {
  return applyExtractionItems(job, places.map(migratePlaceToPoi), places, rawCount);
}

export function applyExtractionItems(
  job: Job,
  items: CanonicalItem[],
  places: CanonicalPlace[],
  rawCount: number,
  warnings: string[] = [],
  extractionSkipped: ExtractionSkip[] = [],
): Job {
  return {
    ...job,
    items,
    places,
    warnings,
    extractionSkipped,
    rawCount,
    status: 'preview',
    progress: { processed: 0, total: places.length },
    updatedAt: new Date().toISOString(),
  };
}

export function applyPreviewPlaces(job: Job, places: CanonicalPlace[]): Job {
  return {
    ...job,
    items: [...job.items.filter((item) => item.kind !== 'poi'), ...places.map(migratePlaceToPoi)],
    places,
    status: job.status === 'draft' || job.status === 'extracting' ? 'preview' : job.status,
    progress: { processed: 0, total: places.length },
    updatedAt: new Date().toISOString(),
  };
}

/** Apply a preview edit; changing the name invalidates a derived canonical identity. */
export function updatePreviewPlace(place: CanonicalPlace, patch: Partial<CanonicalPlace>): CanonicalPlace {
  return {
    ...place,
    ...patch,
    ...(patch.name !== undefined && patch.name !== place.name ? { identity: undefined } : {}),
  };
}

export function startImport(job: Job, payload: unknown): Job {
  return {
    ...job,
    importPayload: payload,
    status: 'importing',
    progress: { processed: 0, total: job.items.length },
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
