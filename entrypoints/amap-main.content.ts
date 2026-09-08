import { installResponseCapture } from '@/utils/capture';
import { BRIDGE_CHANNEL, postEvent, isBridgeCommand } from '@/utils/bridge';
import { mergeImportItems } from '@/core/import-merge';
import { batchAmapSyncItems } from '@/core/amap-sync';
import { distancePointKey } from '@/core/dedup';
import { toWgs84, wgs84ToGcj02 } from '@/core/coords';
import { chooseAmapPoiMatch, parseAmapPoiCandidates } from '@/utils/amap-poi';
import type { CanonicalPlace } from '@/core/model';

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

function normalizeAmapName(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '').toLowerCase();
}

function amapPointKey(x: unknown, y: unknown, crs: 'amap_pixel' | 'gcj02', toleranceMeters: number): string {
  const lng = Number(x);
  const lat = Number(y);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return '';
  return distancePointKey(toWgs84({ crs, lng, lat }), toleranceMeters);
}

/** Semantic key for old native Amap favorites whose id differs from a rebuilt payload id. */
function amapImportKey(item: AmapItem, toleranceMeters: number): string | undefined {
  const data = item.data;
  if (!data) return item.id;
  const type = Number(item.type ?? data['type']);
  if ([102, 103, 104, 117].includes(type)) {
    const start = data['startPoi'] as Record<string, unknown> | undefined;
    const end = data['endPoi'] as Record<string, unknown> | undefined;
    const legacyStart = data['from_poi'] as Record<string, unknown> | undefined;
    const legacyEnd = data['to_poi'] as Record<string, unknown> | undefined;
    const from = start ?? legacyStart;
    const to = end ?? legacyEnd;
    if (!from || !to) return item.id;
    const startX = from['x'] ?? from['mx'] ?? from['lon'];
    const startY = from['y'] ?? from['my'] ?? from['lat'];
    const endX = to['x'] ?? to['mx'] ?? to['lon'];
    const endY = to['y'] ?? to['my'] ?? to['lat'];
    const rideType = type === 117 ? String(data['rideType'] ?? '') : '';
    const pointCrs = start?.['x'] != null || start?.['y'] != null ? 'amap_pixel' : 'gcj02';
    const startKey = amapPointKey(startX, startY, pointCrs, toleranceMeters);
    const endKey = amapPointKey(endX, endY, pointCrs, toleranceMeters);
    return startKey && endKey ? `route|${type}|${rideType}|${startKey}|${endKey}` : item.id;
  }
  const name = normalizeAmapName(data['custom_name'] ?? data['name']);
  const point = amapPointKey(data['point_x'], data['point_y'], 'amap_pixel', toleranceMeters);
  return name && point ? `poi|${name}|${point}` : item.id;
}

/**
 * 高德收藏页 MAIN world 执行器。
 * - 提取：拦截 /service/fav/getFav 响应。
 * - 导入：读现有收藏 -> 增量分批提交 POI / cloudSync 提交 Route -> 验证。
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

    async function searchAmapSsr(place: CanonicalPlace): Promise<ReturnType<typeof parseAmapPoiCandidates>> {
      const center = wgs84ToGcj02(place.wgs84.lng, place.wgs84.lat);
      const span = 0.05;
      const pageUrl = new URL(location.href);
      const params = new URLSearchParams({
        words: place.name,
        geoobj: `${center.lng - span}|${center.lat - span}|${center.lng + span}|${center.lat + span}`,
        user_loc: `${center.lng},${center.lat}`,
      });
      const city = pageUrl.searchParams.get('city');
      if (city) params.set('city', city);
      const response = await fetch(`/service/poiTipsSearchlite?${params.toString()}`, {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' },
      });
      if (!response.ok) throw new Error(`SSR POI search HTTP ${response.status}`);
      return parseAmapPoiCandidates(await response.json(), place);
    }

    async function searchAmapSdk(place: CanonicalPlace): Promise<ReturnType<typeof parseAmapPoiCandidates>> {
      const page = window as unknown as { AMap?: { plugin?: (name: string[], callback: () => void) => void; PlaceSearch?: new (options: unknown) => { search: (keyword: string, callback: (status: string, result: unknown) => void) => void } } };
      if (!page.AMap?.plugin) throw new Error('Amap SDK unavailable');
      return new Promise((resolve, reject) => {
        page.AMap!.plugin!(['AMap.PlaceSearch'], () => {
          try {
            if (!page.AMap?.PlaceSearch) throw new Error('Amap PlaceSearch unavailable');
            const searcher = new page.AMap.PlaceSearch({ pageSize: 20, city: '全国' });
            searcher.search(place.name, (status, result) => {
              if (status !== 'complete') {
                reject(new Error(`Amap SDK POI search ${status}`));
                return;
              }
              const root = result && typeof result === 'object' ? result as { poiList?: { pois?: unknown[] } } : {};
              const pois = (root.poiList?.pois ?? []).flatMap((value) => {
                if (!value || typeof value !== 'object') return [];
                const poi = value as Record<string, unknown>;
                const location = poi.location && typeof poi.location === 'object' ? poi.location as { lng?: number; lat?: number } : undefined;
                if (!Number.isFinite(location?.lng) || !Number.isFinite(location?.lat)) return [];
                return [{
                  poiid: poi.id ?? poi.poiid,
                  name: poi.name,
                  address: poi.address,
                  location: `${location!.lng},${location!.lat}`,
                  adcode: poi.adcode,
                  cityname: poi.cityname,
                }];
              });
              resolve(parseAmapPoiCandidates({ data: { data: { poi_list: pois } } }, place));
            });
          } catch (error) {
            reject(error);
          }
        });
      });
    }

    async function runMatchPoi(payload: unknown, options?: { poiMatchDelayMs?: number; poiMatchDistanceMeters?: number }): Promise<void> {
      const places = Array.isArray(payload) ? payload as CanonicalPlace[] : [];
      const configuredDelay = Number(options?.poiMatchDelayMs);
      const delayMs = Number.isFinite(configuredDelay) ? Math.min(10_000, Math.max(300, Math.floor(configuredDelay))) : 1_000;
      const maxDistanceMeters = Number.isFinite(Number(options?.poiMatchDistanceMeters))
        ? Math.min(1_000, Math.max(50, Math.floor(Number(options?.poiMatchDistanceMeters))))
        : 150;
      const resolutions: Record<string, { poiid: string; cityCode?: string; cityName?: string; name?: string; address?: string }> = {};
      const matches: Record<string, { status: 'matched' | 'not-found' | 'ambiguous' | 'failed'; candidates?: Array<{ poiid: string; name: string; address: string; distanceMeters: number; cityCode?: string; cityName?: string }>; error?: string; reason?: string }> = {};
      postEvent({ mb: BRIDGE_CHANNEL, type: 'poi-match-progress', data: { processed: 0, total: places.length, message: '准备匹配高德 POI…' } });
      for (let index = 0; index < places.length; index++) {
        const place = places[index]!;
        const useSsrFirst = location.pathname.startsWith('/ssr');
        const searchers = useSsrFirst ? [searchAmapSsr, searchAmapSdk] : [searchAmapSdk, searchAmapSsr];
        for (const search of searchers) {
          try {
            const match = chooseAmapPoiMatch(await search(place), { maxDistanceMeters });
            if (match.status === 'matched') {
              resolutions[place.id] = {
                poiid: match.candidate.poiid,
                cityCode: match.candidate.cityCode,
                cityName: match.candidate.cityName,
                name: match.candidate.name,
                address: match.candidate.address,
              };
              matches[place.id] = { status: 'matched' };
              break;
            }
            matches[place.id] = {
              status: match.status,
              reason: match.reason,
              candidates: match.candidates.slice(0, 5).map((candidate) => ({
                poiid: candidate.poiid,
                name: candidate.name,
                address: candidate.address,
                distanceMeters: candidate.distanceMeters,
                cityCode: candidate.cityCode,
                cityName: candidate.cityName,
              })),
            };
          } catch (error) {
            log('Amap POI match strategy failed:', useSsrFirst ? 'ssr/sdk' : 'sdk/ssr', place.name, String(error));
          }
        }
        if (!matches[place.id]) matches[place.id] = { status: 'failed', error: '高德 POI 搜索失败' };
        postEvent({ mb: BRIDGE_CHANNEL, type: 'poi-match-progress', data: { processed: index + 1, total: places.length, message: `匹配高德 POI：${index + 1} / ${places.length}` } });
        if (index < places.length - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      postEvent({ mb: BRIDGE_CHANNEL, type: 'poi-match-result', data: { provider: 'amap', resolutions, matches, done: true } });
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
      return fetch(url, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) }).then(async (response) => {
        const bodyText = await response.text();
        let result: unknown;
        try {
          result = bodyText ? JSON.parse(bodyText) : undefined;
        } catch {
          result = bodyText.slice(0, 300);
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${typeof result === 'string' ? result : JSON.stringify(result)}`);
        return result;
      });
    }

    function deleteCloudFavorite(item: AmapItem, ver: string): Promise<void> {
      if (!item.id) return Promise.reject(new Error('收藏缺少 id'));
      const params = new URLSearchParams({ id: item.id, type: String(item.type ?? 101), ver });
      const headers: Record<string, string> = { Accept: 'application/json, text/plain, */*' };
      const csrf = getCsrfToken();
      if (csrf) headers['x-csrf-token'] = csrf;
      return fetch(`https://amap-pc-ssr.amap.com/ssr/api/cloudSync?${params.toString()}`, {
        method: 'DELETE',
        credentials: 'include',
        headers,
      }).then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await response.json().catch(() => undefined);
      });
    }

    async function runImport(payload: unknown, options?: { importDelayMs?: number; poiMatchDelayMs?: number; amapSyncBatchSize?: number; dedupDistanceMeters?: number }): Promise<void> {
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
      let ver = current.data?.ver ?? (amap?.favesStore?.getFave ? String(amap.favesStore.getFave('ver') ?? '') : '');
      const configuredTolerance = Number(options?.dedupDistanceMeters);
      const dedupTolerance = Number.isFinite(configuredTolerance) ? Math.min(100, Math.max(1, Math.floor(configuredTolerance))) : 1;
      const configuredDelay = Number(options?.importDelayMs);
      const importDelayMs = Number.isFinite(configuredDelay) ? Math.min(10_000, Math.max(300, Math.floor(configuredDelay))) : 500;
      const waitBetweenRequests = async (): Promise<void> => {
        await new Promise((resolve) => setTimeout(resolve, importDelayMs));
      };

      const merge = mergeImportItems(currentItems, favorites, (item) => amapImportKey(item, dedupTolerance));
      const detail = merge.detail;
      const imported = merge.imported;
      const duplicates = merge.duplicates;
      const routeFavorites = favorites.filter((item) => [102, 103, 104, 117].includes(Number(item.type)));
      const legacyRoutes = routeFavorites.filter((item) => [102, 103, 104].includes(Number(item.type)));
      const poiFavorites = favorites.filter((item) => ![102, 103, 104, 117].includes(Number(item.type)));
      const importedRouteIds = new Set(
        detail.filter((item) => item.status === 'imported' && routeFavorites.some((route) => route.id === item.id)).map((item) => item.id),
      );
      const importedRoutes = routeFavorites.filter((item) => item.id && importedRouteIds.has(item.id));
      let poiSyncData: unknown;

      emit({ phase: 'sync', processed: imported, total: favorites.length, message: `合并 ${imported} 条，跳过重复 ${duplicates} 条…` });
      const importedRideRoutes = importedRoutes.filter((item) => Number(item.type) === 117);
      if (importedRideRoutes.length > 0) {
        const routeSync = (await postJson('https://amap-pc-ssr.amap.com/ssr/api/cloudSync', { data: importedRideRoutes, ver })) as { code?: number | string; message?: string; msg?: string };
        log('cloudSync ride routes: code=', routeSync.code, 'items=', importedRideRoutes.length);
        if (String(routeSync.code) !== '1') {
          throw new Error(`高德骑行路线同步失败：${routeSync.message ?? routeSync.msg ?? JSON.stringify(routeSync).slice(0, 300)}`);
        }
      }
      const syncFavorites = [...poiFavorites, ...legacyRoutes];
      if (syncFavorites.length > 0) {
        const syncMerge = mergeImportItems(currentItems, syncFavorites, (item) => amapImportKey(item, dedupTolerance));
        const newSyncIds = new Set(syncMerge.detail.filter((item) => item.status === 'imported').map((item) => item.id));
        const newSyncItems = syncFavorites
          .filter((item) => item.id && newSyncIds.has(item.id))
          .map((item) => ({ id: item.id!, type: item.type || 101, act: 'c', data: item.data! }));
        const configuredBatchSize = Number(options?.amapSyncBatchSize);
        const batchSize = Number.isFinite(configuredBatchSize) ? Math.min(200, Math.max(1, Math.floor(configuredBatchSize))) : 50;
        const batches = batchAmapSyncItems(newSyncItems, 700, batchSize);
        let processed = 0;
        for (let index = 0; index < batches.length; index++) {
          const syncResult = (await postForm('/service/fav/syncFaves?', { data: batches[index], ver })) as { status?: string | number; ver?: string; data?: unknown };
          log('syncFaves POI/legacy-route batch:', index + 1, '/', batches.length, 'status=', syncResult.status, 'items=', batches[index]?.length);
          if (String(syncResult.status) !== '1') {
            throw new Error(`高德地点同步失败（第 ${index + 1} 批）：` + JSON.stringify(syncResult).slice(0, 500));
          }
          poiSyncData = syncResult.data;
          const responseData = syncResult.data && typeof syncResult.data === 'object' ? syncResult.data as Record<string, unknown> : undefined;
          ver = String(syncResult.ver ?? responseData?.['ver'] ?? ver);
          processed += batches[index]?.length ?? 0;
          emit({ phase: 'sync', processed, total: newSyncItems.length, message: `分批同步中：${processed} / ${newSyncItems.length} 条` });
          if (index === 0 && batches.length > 1) {
            const check = (await getJson('/service/fav/getFav?')) as { data?: { items?: AmapItem[] } };
            const checkIds = new Set((check.data?.items ?? []).map((item) => item.id).filter(Boolean));
            const missing = currentItems.filter((item) => item.id && !checkIds.has(item.id));
            if (missing.length > 0) throw new Error(`同步安全检查失败：目标端有 ${missing.length} 条原有收藏消失，已停止后续批次`);
          }
          if (index < batches.length - 1) await waitBetweenRequests();
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
        for (const item of found) {
          try {
            await deleteCloudFavorite(item, ver);
            log('cloudSync DELETE sent: type=', item.type);
          } catch (e) {
            log('cloudSync DELETE failed: type=', item.type, String(e));
          }
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
        const total = items.length;
        let deleted = 0;
        let failed = 0;
        let done = 0;
        // 复用新版撤销的 cloudSync DELETE，并逐条执行；旧 favapi 回调可能返回但服务端并未删除。
        for (const [i, item] of items.entries()) {
          if (!item.id) {
            failed++;
          } else {
            const result = await deleteFavIds([item.id]);
            deleted += result.deleted;
            failed += result.failed;
          }
          done = i + 1;
          postEvent({ mb: BRIDGE_CHANNEL, type: 'dev-fav-progress', data: { deleted, failed, total, done } });
          await new Promise((r) => setTimeout(r, 100));
        }
        // 以清空后的真实剩余数量计算结果，避免把请求返回当成删除成功。
        const after = (await getJson('/service/fav/getFav?')) as { status?: string | number; data?: { items?: AmapItem[] } };
        const remaining = after.data?.items?.length ?? 0;
        const actualDeleted = Math.max(0, total - remaining);
        const actualFailed = Math.max(failed, remaining);
        log('dev-clear-fav done', { deleted: actualDeleted, failed: actualFailed, remaining });
        postEvent({
          mb: BRIDGE_CHANNEL,
          type: 'dev-fav-cleared',
          data: { provider: 'amap', deleted: actualDeleted, failed: actualFailed, remaining, ok: remaining === 0 },
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

      if (cmd.type === 'match-poi') {
        try {
          await runMatchPoi(cmd.payload, cmd.options);
        } catch (error) {
          postEvent({
            mb: BRIDGE_CHANNEL,
            type: 'poi-match-result',
            data: { provider: 'amap', done: false, error: String(error instanceof Error ? error.message : error) },
          });
        }
        return;
      }

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
        runImport(cmd.payload, cmd.options)
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
