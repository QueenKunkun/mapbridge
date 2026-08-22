import { BRIDGE_CHANNEL, isBridgeEvent } from '@/utils/bridge';
import type { BridgeCommand, BridgeReply } from '@/utils/bridge';

const log = (...args: unknown[]): void => console.log('[mb:content:baidu]', ...args);

function isLoggedIn(): boolean {
  const username = document.querySelector('.username');
  if (username?.textContent?.trim()) return true;
  return !document.querySelector('.not-login-wrapper');
}

/**
 * 百度收藏页 ISOLATED 桥接：
 * background ──tabs.sendMessage──▶ 这里 ──postMessage──▶ MAIN world 提取器
 * MAIN ──postMessage──▶ 这里 ──runtime.sendMessage──▶ background
 */
export default defineContentScript({
  matches: ['*://map.baidu.com/*', '*://ditu.baidu.com/*', '*://newclient.map.baidu.com/*'],
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
          const reply: BridgeReply = { mb: BRIDGE_CHANNEL, type: 'whoami', provider: 'baidu', loggedIn: isLoggedIn() };
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