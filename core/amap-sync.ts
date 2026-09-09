export interface AmapSyncItem {
  id: string;
  type: number;
  act: string;
  data: Record<string, unknown>;
}

/** Count leaf values that become urlencoded form parameters. */
export function countFormParameters(value: unknown): number {
  if (Array.isArray(value))
    return value.reduce((total, item) => total + countFormParameters(item), 0);
  if (value && typeof value === 'object') {
    const entries = Object.values(value as Record<string, unknown>);
    let total = 0;
    for (const item of entries) total += countFormParameters(item);
    return total || 1;
  }
  return 1;
}

/** Split an incremental Amap sync into batches below the server parameter limit. */
export function batchAmapSyncItems(
  items: AmapSyncItem[],
  maxParameters = 700,
  maxItems = Number.POSITIVE_INFINITY,
): AmapSyncItem[][] {
  const batches: AmapSyncItem[][] = [];
  let batch: AmapSyncItem[] = [];
  let parameters = 0;
  for (const item of items) {
    const itemParameters = countFormParameters(item);
    if (
      batch.length > 0 &&
      (parameters + itemParameters > maxParameters || batch.length >= maxItems)
    ) {
      batches.push(batch);
      batch = [];
      parameters = 0;
    }
    batch.push(item);
    parameters += itemParameters;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}
