import type { CanonicalPlace, Collection } from '@/core/model';
import { Crs } from '@/core/model';
import type { ProviderAdapter, RawExtract, RawImportResult } from '../types';

/**
 * 腾讯地图收藏夹数据形态待抓包确认（map.qq.com 收藏接口）。
 * 先占位，保持注册表与 UI 完整，功能后续按真实抓包补齐。
 */
export const tencentAdapter: ProviderAdapter = {
  id: 'tencent',
  name: '腾讯地图',
  hosts: ['map.qq.com', 'lbs.qq.com'],
  extractPage: 'https://map.qq.com/fav',
  importPage: 'https://map.qq.com/fav',
  crs: 'gcj02',
  capabilities: { canExtract: false, canImport: false },

  normalize(): CanonicalPlace | null {
    return null;
  },

  buildExtractResult(_raw: RawExtract) {
    return {
      collection: { id: '', name: '腾讯地图收藏夹', provider: 'tencent', placeCount: 0, createdAt: '' } as Collection,
      items: [],
      places: [],
      skipped: [],
      rawCount: 0,
    };
  },

  buildImportPayload() {
    throw new Error('腾讯地图导入尚未实现');
  },

  summarizeImportResult(result: RawImportResult) {
    return {
      imported: result.done ? 1 : 0,
      skippedDuplicates: 0,
      failed: result.error ? 1 : 0,
      failedItems: result.error ? [{ placeId: '', error: result.error }] : [],
      targetCount: result.targetCount,
    };
  },
};
