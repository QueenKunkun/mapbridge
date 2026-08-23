import type { CanonicalPlace, Collection, Crs, ProviderId } from '@/core/model';
import type { ImportReport } from '@/core/jobs';

/** 内容脚本运行所在页面的上下文（由 background 从 tab 信息构造）。 */
export interface PageContext {
  tabId: number;
  url: string;
  hostname: string;
  loggedIn: boolean;
}

/** 提取阶段：MAIN world 收集到的原始记录集合。 */
export interface RawExtract {
  provider: ProviderId;
  /** 原始记录列表（provider 特有结构，未 normalize）。 */
  records: unknown[];
  /** 页面是否已加载到"无更多"状态；false 表示可能还有分页未加载。 */
  exhausted: boolean;
  /** 提示文案（例如"请先打开收藏夹页面"）。 */
  hint?: string;
}

/** 导入阶段：MAIN world 执行器返回的结果（provider 特有结构）。 */
export interface RawImportResult {
  provider: ProviderId;
  /** 导入是否完成（HTTP/接口层面成功与否）。 */
  done: boolean;
  /** 报告给目标页面的最终收藏数量（如有）。 */
  targetCount?: number;
  /** 错误信息（如有）。 */
  error?: string;
  /** provider 特有明细。 */
  raw?: unknown;
}

/** MAIN world 执行器在导入过程中上报的进度。 */
export interface RawImportProgress {
  phase: 'read-existing' | 'sync' | 'verify';
  processed?: number;
  total?: number;
  message?: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  name: string;
  /** 匹配的页面 host 列表。 */
  hosts: string[];
  /** 供 UI 提示的引导页。 */
  extractPage: string;
  importPage: string;
  /** 该 provider 收藏数据的源坐标系。 */
  crs: Crs;
  capabilities: {
    canExtract: boolean;
    canImport: boolean;
  };

  /**
   * 规范化单条原始记录 -> CanonicalPlace（内部坐标统一为 WGS-84）。
   * 数据不足以构成有效收藏时返回 null。
   */
  normalize(raw: unknown): CanonicalPlace | null;

  /** 将一批原始记录转为提取结果（含去重、skip 记录、来源收藏夹名）。 */
  buildExtractResult(raw: RawExtract): {
    collection: Collection;
    places: CanonicalPlace[];
    skipped: { index: number; reason: string }[];
    rawCount: number;
  };

  /**
   * 将待导入的 CanonicalPlace 列表转为 provider 特有的可序列化 payload，
   * 传给 MAIN world 执行器。此处在 WGS-84 -> 目标 CRS 之间做坐标转换。
   */
  buildImportPayload(places: CanonicalPlace[]): unknown;

  /** 将 MAIN world 返回的导入结果规整为统一报告。 */
  summarizeImportResult(result: RawImportResult): ImportReport;
}