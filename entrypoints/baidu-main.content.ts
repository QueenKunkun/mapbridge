import { installResponseCapture, extractRecordsFromJson } from '@/utils/capture';
import { BRIDGE_CHANNEL, postEvent, isBridgeCommand } from '@/utils/bridge';

const log = (...args: unknown[]): void => console.log('[mb:main:baidu]', ...args);

/**
 * 百度地图收藏页 MAIN world 提取器。
 * 拦截页面自身的收藏接口响应，供后续 normalize 为规范收藏。
 *
 * 触发方式（ISOLATED world 转发）：{ mb, type: 'extract' }
 * 返回：{ mb, type: 'extract-data', data: { records, exhausted, hint } }
 */
export default defineContentScript({
  matches: ['*://map.baidu.com/*', '*://ditu.baidu.com/*', '*://newclient.map.baidu.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const capture = installResponseCapture((url) => {
      const u = url.toLowerCase();
      return (
        u.includes('fav') ||
        u.includes('favorite') ||
        u.includes('favorites') ||
        (u.includes('client/favorites') && u.includes('favdata'))
      );
    });
    log('capture installed');

    function findScrollContainer(): HTMLElement | null {
      let best: HTMLElement | null = null;
      let bestDelta = 0;
      const all = document.querySelectorAll<HTMLElement>('div,ul,main,section,aside');
      for (const el of all) {
        const delta = el.scrollHeight - el.clientHeight;
        if (delta > 100 && delta > bestDelta) {
          bestDelta = delta;
          best = el;
        }
      }
      return best;
    }

    async function loadAllFavorites(): Promise<void> {
      for (let i = 0; i < 12; i++) {
        const scroller = findScrollContainer();
        if (!scroller) return;
        const before = scroller.scrollTop;
        scroller.scrollTop = scroller.scrollHeight;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 700));
        if (scroller.scrollTop === before || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
          break;
        }
      }
    }

    window.addEventListener('message', async (event) => {
      if (event.source !== window) return;
      if (!isBridgeCommand(event.data)) return;
      const cmd = event.data;
      log('recv command', cmd.type);
      if (cmd.type === 'extract') {
        const prev = capture.getRecords().length;
        await loadAllFavorites();
        await new Promise((r) => setTimeout(r, 800));
        const records = capture.getRecords();
        const loadedMore = records.length > prev;
        log('extract: records=', records.length, 'loadedMore=', loadedMore);
        const exhausted = !loadedMore || records.length >= 200;
        const hint =
          records.length === 0
            ? '未捕获到收藏数据。请打开 https://map.baidu.com/fav/ 并确认已登录，然后再次点击提取。'
            : !exhausted
              ? `已捕获 ${records.length} 条。若收藏超过 200 条，请在收藏页滚动到底部加载更多后再点一次「提取」。`
              : undefined;
        postEvent({
          mb: BRIDGE_CHANNEL,
          type: 'extract-data',
          data: { provider: 'baidu', records, exhausted, hint },
        });
      } else if (cmd.type === 'ping') {
        log('pong');
        postEvent({ mb: BRIDGE_CHANNEL, type: 'pong' });
      }
    });

    postEvent({ mb: BRIDGE_CHANNEL, type: 'ready' });
  },
});