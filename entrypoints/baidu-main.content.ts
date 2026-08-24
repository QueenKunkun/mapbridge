import { installResponseCapture, extractRecordsFromJson, parseMaybeJsonp } from '@/utils/capture';
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

    // ---- 开发版工具：备份 + 清空百度收藏（仅 DEV 构建注册）----
    function baiduFavSid(record: unknown): string | undefined {
      const r = record as Record<string, unknown>;
      const at = (obj: unknown, key: string): unknown =>
        obj && typeof obj === 'object' && key in (obj as Record<string, unknown>)
          ? (obj as Record<string, unknown>)[key]
          : undefined;
      const sid =
        (at(r, 'sid') as string | undefined) ??
        (at(at(r, 'detail'), 'data') as string | undefined) ??
        (at(r, 'sourcedata') as string | undefined) ??
        (at(r, 'extdata') as string | undefined);
      return typeof sid === 'string' && sid ? sid : undefined;
    }

    function readCookie(name: string): string | undefined {
      const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return m ? decodeURIComponent(m[1] ?? '') : undefined;
    }

    async function runDevReadFav(): Promise<void> {
      log('dev-read-fav (baidu)');
      try {
        const records = capture.getRecords();
        postEvent({
          mb: BRIDGE_CHANNEL,
          type: 'dev-fav-data',
          data: { provider: 'baidu', fav: { raw: records, savedAt: Date.now() } },
        });
      } catch (e) {
        postEvent({
          mb: BRIDGE_CHANNEL,
          type: 'dev-fav-data',
          data: { provider: 'baidu', error: String(e instanceof Error ? e.message : e) },
        });
      }
    }

    async function runDevClearFav(): Promise<void> {
      log('dev-clear-fav (baidu)');
      const baseUrl = capture.lastUrl;
      if (!baseUrl) {
        postEvent({
          mb: BRIDGE_CHANNEL,
          type: 'dev-fav-cleared',
          data: { provider: 'baidu', deleted: 0, failed: 0, remaining: -1, ok: false, error: '未捕获到收藏列表请求，请先在收藏页滚动加载后重试' },
        });
        return;
      }
      const records = capture.getRecords();
      const sids = records.map(baiduFavSid).filter((s): s is string => Boolean(s));
      const total = sids.length;
      postEvent({ mb: BRIDGE_CHANNEL, type: 'dev-fav-progress', data: { deleted: 0, failed: 0, total, done: 0 } });
      if (total === 0) {
        postEvent({ mb: BRIDGE_CHANNEL, type: 'dev-fav-cleared', data: { provider: 'baidu', deleted: 0, failed: 0, remaining: 0, ok: true } });
        return;
      }
      try {
        const deleteUrl = new URL(baseUrl);
        deleteUrl.searchParams.set('mode', 'delete');
        const validate = readCookie('validate') ?? '';
        const body =
          'data=' + encodeURIComponent(JSON.stringify(sids.map((s) => ({ sid: s, action: 'del' })))) +
          '&validate=' + encodeURIComponent(validate);
        const res = await fetch(deleteUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body,
          credentials: 'include',
        });
        log('baidu clear POST status', res.status);
        // 重新拉取列表，核对剩余数量
        const syncUrl = new URL(baseUrl);
        syncUrl.searchParams.set('mode', 'sync');
        let remaining = -1;
        try {
          const r2 = await fetch(syncUrl.toString(), { method: 'GET', credentials: 'include' });
          const json = parseMaybeJsonp(await r2.text());
          remaining = extractRecordsFromJson(json).length;
        } catch {
          /* ignore */
        }
        const deleted = remaining >= 0 ? Math.max(0, total - remaining) : total;
        const failed = remaining >= 0 ? Math.max(0, remaining) : 0;
        postEvent({ mb: BRIDGE_CHANNEL, type: 'dev-fav-progress', data: { deleted, failed, total, done: total } });
        postEvent({
          mb: BRIDGE_CHANNEL,
          type: 'dev-fav-cleared',
          data: { provider: 'baidu', deleted, failed, remaining, ok: remaining === 0 },
        });
      } catch (e) {
        postEvent({
          mb: BRIDGE_CHANNEL,
          type: 'dev-fav-cleared',
          data: { provider: 'baidu', deleted: 0, failed: total, remaining: -1, ok: false, error: String(e instanceof Error ? e.message : e) },
        });
      }
    }

    async function runImport(payload: unknown): Promise<void> {
      const items = (payload ?? []) as Array<Record<string, unknown>>;
      const emit = (ev: { phase: string; processed?: number; total?: number; message?: string }) =>
        postEvent({ mb: BRIDGE_CHANNEL, type: 'import-progress', data: ev });
      log('runImport: items=', items.length);
      if (!location.hostname.includes('map.baidu.com')) {
        throw new Error('请在已登录的百度收藏页（map.baidu.com/fav）执行导入');
      }
      const base = capture.lastUrl;
      if (!base) {
        throw new Error('未捕获到收藏列表请求，请先在收藏页滚动加载后重试');
      }
      const validate = readCookie('validate') ?? '';
      emit({ phase: 'sync', processed: 0, total: items.length, message: `准备写入 ${items.length} 条…` });
      const results: { ok: boolean; info?: string }[] = [];
      let processed = 0;
      for (const it of items) {
        const u = new URL(base);
        u.searchParams.set('mode', 'add');
        u.searchParams.set('type', 'favdata');
        u.searchParams.delete('action');
        const body = 'data=' + encodeURIComponent(JSON.stringify(it)) + '&validate=' + encodeURIComponent(validate);
        try {
          const res = await fetch(u.toString(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body,
            credentials: 'include',
          });
          const text = await res.text();
          const ok = res.status === 200 && !/["']?status["']?\s*:\s*["']?[1-9]/.test(text);
          results.push({ ok, info: ok ? undefined : text.slice(0, 200) });
        } catch (e) {
          results.push({ ok: false, info: String(e instanceof Error ? e.message : e) });
        }
        processed++;
        emit({ phase: 'sync', processed, total: items.length, message: `已写入 ${processed}/${items.length}` });
        await new Promise((r) => setTimeout(r, 400));
      }
      emit({ phase: 'verify', message: '验证结果…' });
      let targetCount: number | undefined;
      try {
        const v = new URL(base);
        v.searchParams.set('mode', 'sync');
        const txt = await (await fetch(v.toString(), { credentials: 'include' })).text();
        targetCount = extractRecordsFromJson(parseMaybeJsonp(txt)).length;
      } catch {
        /* ignore */
      }
      const imported = results.filter((r) => r.ok).length;
      const failed = results.length - imported;
      postEvent({
        mb: BRIDGE_CHANNEL,
        type: 'import-result',
        data: { provider: 'baidu', done: true, targetCount, raw: { imported, failed, results } },
      });
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
        let records = capture.getRecords();
        // 兜底：若首屏加载早于内容脚本注入导致未捕获到响应，直接读一次收藏接口
        if (records.length === 0 && capture.lastUrl) {
          try {
            const syncUrl = new URL(capture.lastUrl);
            syncUrl.searchParams.set('mode', 'sync');
            const text = await (await fetch(syncUrl.toString(), { credentials: 'include' })).text();
            records = extractRecordsFromJson(parseMaybeJsonp(text));
          } catch {
            /* ignore */
          }
        }
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
      } else if (cmd.type === 'import') {
        log('recv import command');
        void runImport(cmd.payload).catch((error) => {
          postEvent({
            mb: BRIDGE_CHANNEL,
            type: 'import-result',
            data: { provider: 'baidu', done: false, error: String(error?.message ?? error) },
          });
        });
      } else if (cmd.type === 'ping') {
        log('pong');
        postEvent({ mb: BRIDGE_CHANNEL, type: 'pong' });
      } else if (import.meta.env.DEV && cmd.type === 'dev-read-fav') {
        void runDevReadFav();
      } else if (import.meta.env.DEV && cmd.type === 'dev-clear-fav') {
        void runDevClearFav();
      }
    });

    postEvent({ mb: BRIDGE_CHANNEL, type: 'ready' });
  },
});