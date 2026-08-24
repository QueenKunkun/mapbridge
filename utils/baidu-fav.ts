import { parseMaybeJsonp } from './capture';

/** 百度 fav 写接口的成功标志在顶层 `result.error`，记录本身的 `status: "100"` 不是错误。 */
export function isBaiduFavWriteSuccess(httpStatus: number, text: string): boolean {
  if (httpStatus < 200 || httpStatus >= 300) return false;
  const response = parseMaybeJsonp(text);
  if (!response || typeof response !== 'object') return false;
  const result = (response as Record<string, unknown>)['result'];
  if (!result || typeof result !== 'object') return false;
  return Number((result as Record<string, unknown>)['error']) === 0;
}
