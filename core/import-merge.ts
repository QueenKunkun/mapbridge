/**
 * 导入合并：将待导入项合并进目标地图现有收藏，并逐条标注导入结果。
 * 抽成纯函数便于单测（跨来源重复收藏的判重逻辑）。
 */

export interface ImportMergeInputItem {
  id?: string;
  type?: number;
  data?: Record<string, unknown>;
}

export type ImportMergeStatus = 'imported' | 'duplicate' | 'failed';

export interface ImportMergeDetail {
  id: string;
  status: ImportMergeStatus;
  error?: string;
}

export interface ImportMergeItem {
  id: string;
  type: number;
  act: string;
  data: Record<string, unknown>;
}

export interface ImportMergeResult {
  /** 合并后的完整收藏列表（现有 + 新增），可直接提交给同步接口。 */
  merged: ImportMergeItem[];
  /** 逐条结果，供报告与后续撤销使用。 */
  detail: ImportMergeDetail[];
  imported: number;
  duplicates: number;
  failed: number;
}

export function mergeImportItems(
  currentItems: ImportMergeInputItem[],
  payloadItems: ImportMergeInputItem[],
): ImportMergeResult {
  const merged = new Map<string, ImportMergeItem>();
  for (const item of currentItems) {
    if (item?.id && item.data) {
      merged.set(item.id, { id: item.id, type: item.type || 101, act: 'c', data: item.data as Record<string, unknown> });
    }
  }

  const detail: ImportMergeDetail[] = [];
  let imported = 0;
  let duplicates = 0;
  let failed = 0;

  for (const item of payloadItems) {
    if (!item.id || !item.data) {
      detail.push({ id: item.id ?? '', status: 'failed', error: '缺少 id/data' });
      failed += 1;
      continue;
    }
    if (merged.has(item.id)) {
      duplicates += 1;
      detail.push({ id: item.id, status: 'duplicate' });
      continue;
    }
    merged.set(item.id, { id: item.id, type: item.type || 101, act: 'c', data: item.data as Record<string, unknown> });
    imported += 1;
    detail.push({ id: item.id, status: 'imported' });
  }

  return { merged: Array.from(merged.values()), detail, imported, duplicates, failed };
}
