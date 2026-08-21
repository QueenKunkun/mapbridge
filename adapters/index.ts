import { baiduAdapter } from './baidu';
import { amapAdapter } from './amap';
import { tencentAdapter } from './tencent';
import { register } from './registry';

export { register };
export { getAdapter, getAdapterForHost, listAdapters, adapters } from './registry';
export type {
  ProviderAdapter,
  PageContext,
  RawExtract,
  RawImportResult,
  RawImportProgress,
} from './types';
export { normalizeBaidu } from './baidu';
export { normalizeAmap } from './amap';

// 注册所有已实现适配器。
register(baiduAdapter);
register(amapAdapter);
register(tencentAdapter);