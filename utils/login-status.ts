/** Parse the login signal returned by Amap's read-only favorites endpoint. */
export function readAmapLoginStatus(payload: unknown, httpStatus = 200): boolean | undefined {
  if (httpStatus === 401 || httpStatus === 403) return false;
  if (!payload || typeof payload !== 'object') return undefined;
  const status = (payload as { status?: unknown }).status;
  if (String(status) === '1') return true;
  const data = (payload as { data?: unknown }).data;
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) return true;
  if (status !== undefined && status !== null) return false;
  return undefined;
}
