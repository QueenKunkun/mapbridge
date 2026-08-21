import type { CanonicalPlace, ProviderId } from '@/core/model';
import type { ProviderAdapter } from './types';

export const adapters = new Map<ProviderId, ProviderAdapter>();

export function register(adapter: ProviderAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function getAdapter(id: ProviderId): ProviderAdapter {
  const adapter = adapters.get(id);
  if (!adapter) throw new Error(`Unknown provider: ${id}`);
  return adapter;
}

export function getAdapterForHost(hostname: string): ProviderAdapter | undefined {
  for (const adapter of adapters.values()) {
    if (adapter.hosts.some((host) => hostname === host || hostname.endsWith('.' + host))) {
      return adapter;
    }
  }
  return undefined;
}

export function listAdapters(): ProviderAdapter[] {
  return [...adapters.values()];
}