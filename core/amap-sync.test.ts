import { describe, expect, it } from 'vitest';
import { batchAmapSyncItems, countFormParameters } from '@/core/amap-sync';

const item = (id: string): { id: string; type: number; act: string; data: Record<string, unknown> } => ({
  id, type: 101, act: 'c', data: { name: id, point: { x: 1, y: 2 } },
});

describe('Amap incremental sync batching', () => {
  it('counts nested form leaves', () => {
    expect(countFormParameters({ id: 'x', data: { name: 'X', point: { x: 1, y: 2 } } })).toBe(4);
  });

  it('keeps every item and splits before the parameter budget', () => {
    const batches = batchAmapSyncItems([item('a'), item('b'), item('c')], 12);
    expect(batches.map((batch) => batch.map((entry) => entry.id))).toEqual([['a', 'b'], ['c']]);
    expect(batches.flat()).toHaveLength(3);
  });

  it('keeps an individual oversized item instead of dropping it', () => {
    const oversized = { ...item('large'), data: { values: Array.from({ length: 20 }, (_, i) => i) } };
    expect(batchAmapSyncItems([oversized], 5)).toEqual([[oversized]]);
  });
});
