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
  | { type: 'import-file'; target: ProviderId; places: CanonicalPlace[]; warnings?: string[] }
  | { type: 'get-settings' }
  | { type: 'save-settings'; settings: AppSettings }
  | { type: 'open-tab'; url: string }
  | { type: 'get-active-tab' }
  | { type: 'detect-map-tabs' }
  | { type: 'dev-fav-read'; tabId: number }
  | { type: 'dev-fav-clear'; tabId: number }
  | { type: 'dev-fav-progress' }
  | { type: 'undo-import'; jobId: string; tabId: number };

export type BgResponse =
  | { type: 'state'; jobs: Job[]; settings: AppSettings }
  | { type: 'job'; job: Job | undefined }
  | { type: 'jobs'; jobs: Job[] }
  | { type: 'settings'; settings: AppSettings }
  | { type: 'ok' }
  | { type: 'error'; message: string }
  | { type: 'active-tab'; tabId: number; url?: string; providerId?: ProviderId }
  | { type: 'detected'; tabs: { providerId: ProviderId; tabId: number }[] }
  | { type: 'dev-fav-data'; data: { provider: 'amap' | 'baidu'; fav: unknown; error?: string } }
  | { type: 'dev-fav-cleared'; data: { provider: 'amap' | 'baidu'; deleted: number; failed: number; remaining: number; ok: boolean; error?: string } }
  | { type: 'dev-progress'; deleted: number; failed: number; total: number; done: number }
  | { type: 'undo-result'; data: { deleted: number; failed: number; remaining: number; ok: boolean; error?: string } };

/** background -> content (ISOLATED) 的消息。 */
export type ContentRequest = { type: 'mb:command'; command: BridgeCommand };

/** content (ISOLATED) -> background 的消息。 */
export type ContentEvent = { type: 'mb:event'; event: BridgeEvent };

export async function sendBg(req: BgRequest): Promise<BgResponse> {
  return (await browser.runtime.sendMessage(req)) as BgResponse;
}
