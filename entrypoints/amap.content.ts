import { BRIDGE_CHANNEL, isBridgeEvent } from '@/utils/bridge';
import type { BridgeCommand, BridgeReply } from '@/utils/bridge';
import { readAmapLoginStatus } from '@/utils/login-status';

const log = (...args: unknown[]): void => console.log('[mb:content:amap]', ...args);

function readDomLoginStatus(): boolean | undefined {
  if (
    document.querySelector('.user-name') ||
    document.querySelector('.quit-login') ||
    document.querySelector('.user-panel .user-portrait')
  ) return true;
  // 高德页面结构和登录组件会异步变化；没有命中选择器不能证明未登录。
  return undefined;
}

async function detectLoginStatus(): Promise<boolean | undefined> {
  try {
    const response = await fetch('/service/fav/getFav?', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' },
    });
    const status = readAmapLoginStatus(await response.json(), response.status);
    if (status !== undefined) return status;
  } catch {
    // Network failures are inconclusive; use the best available DOM signal.
  }
  return readDomLoginStatus();
}

/** 高德收藏页 ISOLATED 桥接（与百度桥接同理）。 */
export default defineContentScript({
  matches: ['*://ditu.amap.com/*', '*://www.amap.com/*'],
  runAt: 'document_start',
  main() {
    log('content script loaded');
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (isBridgeEvent(data) && data.mb === BRIDGE_CHANNEL) {
        log('relay event -> background', data.type);
        browser.runtime.sendMessage({ type: 'mb:event', event: data });
      }
    });

    browser.runtime.onMessage.addListener((msg: unknown) => {
      const request = msg as { type?: string; command?: BridgeCommand };
      if (request?.type === 'mb:command' && request.command) {
        log('recv command, relay -> MAIN', request.command.type);
        if (request.command.type === 'ping' || request.command.type === 'whoami') {
          return detectLoginStatus().then((loggedIn) => {
            const reply: BridgeReply = { mb: BRIDGE_CHANNEL, type: 'whoami', provider: 'amap', loggedIn };
            log('reply to background', reply);
            return reply;
          });
        }
        window.postMessage(request.command, '*');
      } else {
        log('recv unknown message', msg);
      }
      return undefined;
    });
  },
});
