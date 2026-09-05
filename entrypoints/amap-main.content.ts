import { installResponseCapture } from '@/utils/capture';
import { BRIDGE_CHANNEL, postEvent, isBridgeCommand } from '@/utils/bridge';
import { mergeImportItems } from '@/core/import-merge';

const log = (...args: unknown[]): void => console.log('[mb:main:amap]', ...args);

/** 高德收藏页 getFav 响应里提取 items。 */
function extractAmapRecords(json: unknown): unknown[] {
  if (!json || typeof json !== 'object') return [];
  const data = (json as Record<string, unknown>)['data'];
  if (!data || typeof data !== 'object') return [];
  const items = (data as Record<string, unknown>)['items'];
  return Array.isArray(items) ? items : [];
}

interface AmapItem {
  id?: string;
  type?: number;
  data?: Record<string, unknown>;
}

/**
 * 高德收藏页 MAIN world 执行器。
 * - 提取：拦截 /service/fav/getFav 响应。
 * - 导入：读现有收藏 -> 合并 payload -> syncFaves 一次性提交 -> 验证。
 */
export default defineContentScript({
  matches: ['*://ditu.amap.com/*', '*://www.amap.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    const capture = installResponseCapture((url) => url.includes('/service/fav/getFav'));
    log('capture installed');

    // 高德页面请求封装：- 优先原生 fetch（amap.get 在某些情况下不回调，导致卡死）。
    function getJson(url: string): Promise<unknown> {
      return new Promise((resolve, reject) => {
        void fetch(url, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' },
        })
          .then((r) => r.json())
          .then(resolve, reject);
      });
    }

    function formEncode(value: unknown): string {
      const pairs: string[] = [];
      const add = (key: string, item: unknown): void => {
        pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(item == null ? '' : String(item)));
      };
      const visit = (key: string, item: unknown): void => {
        if (Array.isArray(item)) {
          item.forEach((entry, index) => visit(`${key}[${entry && typeof entry === 'object' ? index : ''}]`, entry));
        } else if (item && typeof item === 'object') {
          Object.keys(item as Record<string, unknown>).forEach((childKey) =>
            visit(`${key}[${childKey}]`, (item as Record<string, unknown>)[childKey]),
          );
        } else {
          add(key, item);
        }
      };
      visit('', value);
      return pairs.join('&');
    }

    function getCsrfToken(): string {
      const m = document.cookie.match(/x-csrf-token=([^;]+)/);
      return m?.[1] ? decodeURIComponent(m[1]) : '';
    }

    function postForm(url: string, body: Record<string, unknown>): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const amap = (window as unknown as { amap?: { post?: (u: string, d: unknown, cb: (d: unknown) => void, type: string) => void } }).amap;
        const jq = (window as unknown as { jQuery?: { ajax: (opts: unknown) => void }; $?: { ajax: (opts: unknown) => void } }).jQuery
          ?? (window as unknown as { $?: { ajax: (opts: unknown) => void } }).$;
        if (amap?.post) {
          amap.post(url, body, resolve, 'json');
        } else if (jq?.ajax) {
          jq.ajax({ url, type: 'POST', data: body, dataType: 'json', success: resolve, error: reject });
        } else {
          const headers: Record<string, string> = {
            Accept: 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          };
          const csrf = getCsrfToken();
          if (csrf) headers['x-csrf-token'] = csrf;
          fetch(url, {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: formEncode(body),
          })
            .then((r) => r.json())
            .then(resolve, reject);
        }
      });
    }

    function postJson(url: string, body: Record<string, unknown>): Promise<unknown> {
      const headers: Record<string, string> = { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' };
      const csrf = getCsrfToken();
      if (csrf) headers['x-csrf-token'] = csrf;
      return fetch(url, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) }).then((r) => r.json());
    }

    async function runImport(payload: unknown): Promise<void> {
      const favorites = (payload ?? []) as AmapItem[];
      const emit = (ev: { phase: string; processed?: number; total?: number; message?: string }) =>
        postEvent({ mb: BRIDGE_CHANNEL, type: 'import-progress', data: ev });

      log('runImport: payloadItems=', favorites.length);
      if (!location.hostname.includes('amap.com')) {
        throw new Error('请在已登录的高德网页（ditu.amap.com/faves）执行导入');
      }

      emit({ phase: 'read-existing', message: '读取现有收藏…' });
      const current = (await getJson('/service/fav/getFav?')) as { status?: string | number; data?: { items?: AmapItem[]; ver?: string } };
      log('getFav: status=', current.status, 'items=', current.data?.items?.length);
      if (String(current.status) !== '1') {
        throw new Error('读取高德收藏失败，请确认已在 ditu.amap.com/faves 登录');
      }

      const amap = (window as unknown as { amap?: { favesStore?: { getFave?: (k: string) => unknown; update?: (d: unknown) => void } } }).amap;
      const currentItems = current.data?.items ?? [];
      const ver = current.data?.ver ?? (amap?.favesStore?.getFave ? String(amap.favesStore.getFave('ver') ?? '') : '');

      const merge = mergeImportItems(currentItems, favorites);
      const detail = merge.detail;
      const imported = merge.imported;
      const duplicates = merge.duplicates;
      const routeFavorites = favorites.filter((item) => [102, 103, 104, 117].includes(Number(item.type)));
      const poiFavorites = favorites.filter((item) => ![102, 103, 104, 117].includes(Number(item.type)));
      const importedRouteIds = new Set(
        detail.filter((item) => item.status === 'imported' && routeFavorites.some((route) => route.id === item.id)).map((item) => item.id),
      );
      const importedRoutes = routeFavorites.filter((item) => item.id && importedRouteIds.has(item.id));
      let poiSyncData: unknown;

      emit({ phase: 'sync', processed: imported, total: favorites.length, message: `合并 ${imported} 条，跳过重复 ${duplicates} 条…` });
      if (importedRoutes.length > 0) {
        const routeSync = (await postJson('https://amap-pc-ssr.amap.com/ssr/api/cloudSync', { data: importedRoutes, ver })) as { code?: number };
        log('cloudSync routes: code=', routeSync.code, 'items=', importedRoutes.length);
        if (routeSync.code !== 1) throw new Error('高德路线同步失败');
      }
      if (poiFavorites.length > 0) {
        const poiMerge = mergeImportItems(currentItems, poiFavorites);
        const syncResult = (await postForm('/service/fav/syncFaves?', { data: poiMerge.merged, ver })) as { status?: string | number; data?: unknown };
        poiSyncData = syncResult.data;
        log('syncFaves POI: status=', syncResult.status);
        if (String(syncResult.status) !== '1') {
          throw new Error('高德地点同步失败：' + JSON.stringify(syncResult).slice(0, 500));
        }
      }
      if (poiSyncData !== undefined && amap?.favesStore?.update) amap.favesStore.update(poiSyncData);

      emit({ phase: 'verify', message: '验证结果…' });
      const after = (await getJson('/service/fav/getFav?')) as { status?: string | number; data?: { items?: AmapItem[] } };
      const targetCount = after.data?.items?.length ?? undefined;
      log('verify: targetCount=', targetCount);

      postEvent({
        mb: BRIDGE_CHANNEL,
        type: 'import-result',
        data: {
          provider: 'amap',
          done: true,
          targetCount,
          raw: { detail, beforeServerItems: currentItems.length },
        },
      });
    }

    async function deleteFavIds(ids: string[]): Promise<{ deleted: number; failed: number; remaining: number }> {
      const current = (await getJson('/service/fav/getFav?')) as { status?: string | number; data?: { items?: AmapItem[]; ver?: string } };
      const currentItems = current.data?.items ?? [];
      const ver = current.data?.ver ?? '';
      const favapi = (window as unknown as { amap?: { favapi?: { deletefav?: (p: unknown, cb: (r: unknown) => void) => void } } }).amap?.favapi;
      const del = favapi?.deletefav;
      const found = currentItems.filter((item) => item.id && ids.includes(item.id));
      if (found.length > 0) {
        try {
          const response = await postJson('https://amap-pc-ssr.amap.com/ssr/api/cloudSync', {
            data: found.map((item) => ({ ...item, act: 'd' })),
            ver,
          }) as { code?: number };
          log('cloudSync delete: code=', response.code, 'items=', found.length);
        } catch {
          log('cloudSync delete request failed');
        }
      }
      // Older Amap pages may not support cloudSync for every favorite type.
      // Retry only records still present, so a successful cloudSync deletion is
      // never duplicated through the legacy API.
      const afterCloudSync = (await getJson('/service/fav/getFav?')) as { data?: { items?: AmapItem[] } };
      const remainingAfterCloudSync = new Set((afterCloudSync.data?.items ?? []).map((item) => item.id).filter(Boolean));
      const fallbackItems = found.filter((item) => item.id && remainingAfterCloudSync.has(item.id));
      if (fallbackItems.length > 0 && del) {
        for (const rec of fallbackItems) {
          await deleteOne(del, rec);
        }
      } else if (fallbackItems.length > 0) {
        log('legacy delete unavailable: count=', fallbackItems.length);
      }
      const after = (await getJson('/service/fav/getFav?')) as { status?: string | number; data?: { items?: AmapItem[] } };
      const remaining = after.data?.items?.length ?? 0;
      const remainingIds = new Set((after.data?.items ?? []).map((item) => item.id).filter(Boolean));
      const deleted = found.filter((item) => item.id && !remainingIds.has(item.id)).length;
      const failed = found.length - deleted;
      const amap = (window as unknown as { amap?: { favesStore?: { update?: (d: unknown) => void } } }).amap;
      if (amap?.favesStore?.update && after.data) amap.favesStore.update(after.data);
      return { deleted, failed, remaining };
    }

    // ---- 撤销导入：删除本次写入的目标收藏（复用串行删除，避免挂起）----
    async function runDeleteFavIds(ids: string[]): Promise<void> {
      log('delete-fav-ids', ids.length);
      try {
        if (!location.hostname.includes('amap.com')) {
          throw new Error('请在已登录的高德网页（ditu.amap.com/faves）执行撤销');
        }
        const res = await deleteFavIds(ids);
        log('delete-fav-ids done', res);
        postEvent({
          mb: BRIDGE_CHANNEL,
          type: 'fav-ids-deleted',
          data: { ...res, ok: res.failed === 0, error: res.failed > 0 ? `撤销后仍有 ${res.failed} 条收藏未删除` : undefined },
        });
      } catch (e) {
        postEvent({
          mb: BRIDGE_CHANNEL,
          type: 'fav-ids-deleted',
          data: { deleted: 0, failed: ids.length, remaining: -1, ok: false, error: String(e instanceof Error ? e.message : e) },
        });
      }
    }

    // ---- 开发版工具：备份 + 清空高德收藏（仅 DEV 构建注册）----
    async function runDevReadFav(): Promise<void> {
      log('dev-read-fav');
      try {
        const raw = await getJson('/service/fav/getFav?');
        let store: unknown = null;
        const favesStore = (window as unknown as { amap?: { favesStore?: { get?: () => Promise<unknown> } } }).amap?.favesStore;
        if (favesStore?.get) store = await favesStore.get();
        postEvent({
          mb: BRIDGE_CHANNEL,
          type: 'dev-fav-data',
          data: { provider: 'amap', fav: { raw, store, savedAt: Date.now() } },
        });
      } catch (e) {
        postEvent({ mb: BRIDGE_CHANNEL, type: 'dev-fav-data', data: { provider: 'amap', error: String(e instanceof Error ? e.message : e) } });
      }
    }

    async function deleteOne(
      del: (p: unknown, cb: (r: unknown) => void) => void,
      item: AmapItem,
    ): Promise<void> {
      // 只用回调确认“本次删除请求已返回”，成功与否以最终 getFav 剩余数量为准，
      // 避免依赖 deletefav 回调里不稳定的 status 字段。
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
        };
        // 单条删除加超时：避免 deletefav 回调不触发时永久挂起
        const timer = setTimeout(done, 8000);
        try {
          del(
            { id: item.id, type: item.type != null ? item.type : 101, data: item.data },
            () => done(),
          );
        } catch {
          done();
        }
      });
    }

    async function runDevClearFav(): Promise<void> {
      log('dev-clear-fav');
      try {
        const current = (await getJson('/service/fav/getFav?')) as { status?: string | number; data?: { items?: AmapItem[] } };
        const items = current.data?.items ?? [];
        const favapi = (window as unknown as { amap?: { favapi?: { deletefav?: (p: unknown, cb: (r: unknown) => void) => void } } }).amap?.favapi;
        const del = favapi?.deletefav;
        const total = items.length;
        // 串行删除：同一 favapi 实例可能不支持并发请求，并发会丢失回调导致挂起
        for (const [i, item] of items.entries()) {
          if (del) await deleteOne(del, item);
          postEvent({ mb: BRIDGE_CHANNEL, type: 'dev-fav-progress', data: { deleted: i + 1, failed: 0, total, done: i + 1 } });
          await new Promise((r) => setTimeout(r, 100));
        }
        // 以清空后的真实剩余数量计算删除结果（不依赖回调 status）
        const after = (await getJson('/service/fav/getFav?')) as { status?: string | number; data?: { items?: AmapItem[] } };
        const remaining = after.data?.items?.length ?? 0;
        const deleted = Math.max(0, total - remaining);
        const failed = Math.max(0, remaining);
        log('dev-clear-fav done', { deleted, failed, remaining });
        postEvent({
          mb: BRIDGE_CHANNEL,
          type: 'dev-fav-cleared',
          data: { provider: 'amap', deleted, failed, remaining, ok: remaining === 0 },
        });
      } catch (e) {
        postEvent({
          mb: BRIDGE_CHANNEL,
          type: 'dev-fav-cleared',
          data: { provider: 'amap', deleted: 0, failed: 0, remaining: -1, ok: false, error: String(e instanceof Error ? e.message : e) },
        });
      }
    }

    window.addEventListener('message', async (event) => {
      if (event.source !== window) return;
      if (!isBridgeCommand(event.data)) return;
      const cmd = event.data;

      if (cmd.type === 'extract') {
        let records: unknown[] = [];
        // 优先直接读接口（导入流程已验证可靠），再回退到网络捕获
        try {
          const live = (await getJson('/service/fav/getFav?')) as { data?: { items?: unknown[] } };
          log('extract: live fetched, items=', (live as { data?: { items?: unknown[] } })?.data?.items?.length ?? 0);
          records = extractAmapRecords(live);
        } catch (e) {
          log('extract: live fetch failed:', String(e));
        }
        if (records.length === 0) {
          const fromCapture = capture.responses.flatMap((r) => extractAmapRecords(r));
          log('extract: capture responses=', capture.responses.length, 'fromCapture=', fromCapture.length);
          records = fromCapture;
        } else {
          log('extract: using live records=', records.length);
        }
        log('extract: final records=', records.length);
        postEvent({
          mb: BRIDGE_CHANNEL,
          type: 'extract-data',
          data: {
            provider: 'amap',
            records,
            exhausted: true,
            hint: records.length === 0 ? '未捕获到收藏数据。请打开 https://ditu.amap.com/faves 并确认已登录后重试。' : undefined,
          },
        });
      } else if (cmd.type === 'import') {
        log('recv import command');
        runImport(cmd.payload)
          .catch((error) => {
            postEvent({
              mb: BRIDGE_CHANNEL,
              type: 'import-result',
              data: { provider: 'amap', done: false, error: String(error?.message ?? error) },
            });
          });
      } else if (cmd.type === 'ping') {
        log('pong');
        postEvent({ mb: BRIDGE_CHANNEL, type: 'pong' });
      } else if (import.meta.env.DEV && cmd.type === 'dev-read-fav') {
        void runDevReadFav();
      } else if (import.meta.env.DEV && cmd.type === 'dev-clear-fav') {
        void runDevClearFav();
      } else if (cmd.type === 'delete-fav-ids') {
        void runDeleteFavIds(Array.isArray(cmd.ids) ? cmd.ids : []);
      }
    });

    postEvent({ mb: BRIDGE_CHANNEL, type: 'ready' });
    log('ready posted');
  },
});
