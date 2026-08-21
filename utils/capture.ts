/** 在页面 MAIN world 中拦截 fetch/XHR，捕获符合 URL 条件的 JSON 响应。 */

export type RelevantUrlFn = (url: string) => boolean;

/** 处理 JSONP（`cb({...})`）与标准 JSON。 */
export function parseMaybeJsonp(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  const match = /^[\w$.]+\((.*)\)\s*;?\s*$/.exec(trimmed);
  if (match && match[1]) {
    try {
      return JSON.parse(match[1]);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** 从响应 JSON 中提取收藏记录数组（兼容多个已知形态）。 */
export function extractRecordsFromJson(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];

  const obj = json as Record<string, unknown>;

  const collect = (v: unknown): unknown[] | null =>
    Array.isArray(v) ? v : null;

  // 顶层直接数组字段
  for (const key of ['fav', 'newdata', 'items', 'list', 'records', 'favorites']) {
    const found = collect(obj[key]);
    if (found) return found;
  }

  // 分享页：{ favdatas: { tag, fav: [...] } }
  const favdatas = obj['favdatas'];
  if (favdatas && typeof favdatas === 'object') {
    const fav = collect((favdatas as Record<string, unknown>)['fav']);
    if (fav) return fav;
  }

  // 收藏页：{ sync: { newdata: [...] } }
  const sync = obj['sync'];
  if (sync && typeof sync === 'object') {
    const nd = collect((sync as Record<string, unknown>)['newdata']);
    if (nd) return nd;
  }

  // { data: { items|list|fav|... } }
  const data = obj['data'];
  if (data && typeof data === 'object') {
    for (const key of ['items', 'list', 'fav', 'newdata', 'records', 'favorites']) {
      const found = collect((data as Record<string, unknown>)[key]);
      if (found) return found;
    }
  }

  return [];
}

declare global {
  interface XMLHttpRequest {
    __mbUrl?: string;
  }
}

export interface ResponseCapture {
  /** 已捕获的响应 JSON 列表。 */
  responses: unknown[];
  /** 按 URL 去重后的记录列表（多次分页会合并）。 */
  getRecords(): unknown[];
  /** 卸载钩子。 */
  dispose(): void;
}

/** 安装网络捕获。返回句柄。 */
export function installResponseCapture(isRelevantUrl: RelevantUrlFn): ResponseCapture {
  const responses: unknown[] = [];

  const onText = (url: string, text: string): void => {
    if (!isRelevantUrl(url)) return;
    const json = parseMaybeJsonp(text);
    if (json !== undefined) responses.push(json);
  };

  // hook fetch
  const origFetch = window.fetch;
  window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
    const promise = origFetch.apply(this, arguments as never) as Promise<Response>;
    if (isRelevantUrl(url)) {
      promise
        .then((res) => res.clone().text())
        .then((text) => onText(url, text))
        .catch(() => undefined);
    }
    return promise;
  } as typeof fetch;

  // hook XHR
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: [async?: boolean, user?: string | null, password?: string | null]
  ) {
    this.__mbUrl = typeof url === 'string' ? url : String(url);
    return origOpen.call(this, method, url, ...(rest as [boolean, string | null, string | null]));
  };
  XMLHttpRequest.prototype.send = function (...args: unknown[]) {
    const url = this.__mbUrl ?? '';
    if (isRelevantUrl(url)) {
      this.addEventListener('load', () => {
        try {
          onText(url, this.responseText);
        } catch {
          /* ignore */
        }
      });
    }
    return origSend.apply(this, args as never);
  };

  return {
    responses,
    getRecords() {
      const seen = new Set<string>();
      const records: unknown[] = [];
      for (const json of responses) {
        for (const record of extractRecordsFromJson(json)) {
          const key = JSON.stringify(record);
          if (!seen.has(key)) {
            seen.add(key);
            records.push(record);
          }
        }
      }
      return records;
    },
    dispose() {
      window.fetch = origFetch;
      XMLHttpRequest.prototype.open = origOpen;
      XMLHttpRequest.prototype.send = origSend;
    },
  };
}