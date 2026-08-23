import type { CanonicalPlace, ProviderId } from '@/core/model';
import type { Job } from '@/core/jobs';
import type { AppSettings } from '@/storage/db';
import type { BridgeCommand, BridgeEvent } from './bridge';

/** popup/options -> background 的消息。 */
export type BgRequest =
  | { type: 'get-state' }
  | { type: 'list-jobs' }
  | { type: 'get-job'; id: string }
  | { type: 'new-job'; source: ProviderId; target: ProviderId }
  | { type: 'delete-job'; id: string }
  | { type: 'extract'; jobId: string; tabId: number }
  | { type: 'preview-update'; jobId: string; places: CanonicalPlace[] }
  | { type: 'import'; jobId: string; tabId: number }
  | { type: 'get-settings' }
  | { type: 'save-settings'; settings: AppSettings }
  | { type: 'open-tab'; url: string }
  | { type: 'get-active-tab' }
  | { type: 'detect-map-tabs' }
  | { type: 'dev-fav-read'; tabId: number }
  | { type: 'dev-fav-clear'; tabId: number }
  | { type: 'dev-fav-progress' };

export type BgResponse =
  | { type: 'state'; jobs: Job[]; settings: AppSettings }
  | { type: 'job'; job: Job | undefined }
  | { type: 'jobs'; jobs: Job[] }
  | { type: 'settings'; settings: AppSettings }
  | { type: 'ok' }
  | { type: 'error'; message: string }
  | { type: 'active-tab'; tabId: number; url?: string; providerId?: ProviderId }
  | { type: 'detected'; tabs: { providerId: ProviderId; tabId: number }[] }
  | { type: 'dev-fav-data'; data: { provider: 'amap'; fav: unknown; error?: string } }
  | { type: 'dev-fav-cleared'; data: { provider: 'amap'; deleted: number; failed: number; remaining: number; ok: boolean; error?: string } }
  | { type: 'dev-progress'; deleted: number; failed: number; total: number; done: number };

/** background -> content (ISOLATED) 的消息。 */
export type ContentRequest = { type: 'mb:command'; command: BridgeCommand };

/** content (ISOLATED) -> background 的消息。 */
export type ContentEvent = { type: 'mb:event'; event: BridgeEvent };

export async function sendBg(req: BgRequest): Promise<BgResponse> {
  return (await browser.runtime.sendMessage(req)) as BgResponse;
}