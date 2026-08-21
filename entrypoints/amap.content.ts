import { BRIDGE_CHANNEL, isBridgeEvent } from '@/utils/bridge';
import type { BridgeCommand, BridgeReply } from '@/utils/bridge';

const log = (...args: unknown[]): void => console.log('[mb:content:amap]', ...args);

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
        window.postMessage(request.command, '*');
        if (request.command.type === 'ping' || request.command.type === 'whoami') {
          const reply: BridgeReply = { mb: BRIDGE_CHANNEL, type: 'whoami', provider: 'amap' };
          log('reply to background', reply);
          return Promise.resolve(reply);
        }
      } else {
        log('recv unknown message', msg);
      }
      return undefined;
    });
  },
});