/** 页面桥接（MAIN world 与 ISOLATED world）用的常量通道。 */
export const BRIDGE_CHANNEL = '__mapbridge_v1__';

export interface BridgeCommand {
  mb: typeof BRIDGE_CHANNEL;
  /** 命令类型。dev-* 仅开发版注册。 */
  type: 'extract' | 'import' | 'ping' | 'whoami' | 'dev-read-fav' | 'dev-clear-fav';
  /** import 时为 provider 特有 payload。 */
  payload?: unknown;
}

export interface BridgeReply {
  mb: typeof BRIDGE_CHANNEL;
  type: 'pong' | 'whoami';
  provider: 'baidu' | 'amap' | 'tencent';
  loggedIn?: boolean;
}

export interface BridgeEvent {
  mb: typeof BRIDGE_CHANNEL;
  type: 'ready' | 'pong' | 'extract-data' | 'import-progress' | 'import-result' | 'dev-fav-data' | 'dev-fav-cleared' | 'dev-fav-progress';
  data?: unknown;
}

export function isBridgeCommand(msg: unknown): msg is BridgeCommand {
  return Boolean(msg && typeof msg === 'object' && (msg as { mb?: unknown }).mb === BRIDGE_CHANNEL);
}

export function isBridgeEvent(msg: unknown): msg is BridgeEvent {
  return Boolean(msg && typeof msg === 'object' && (msg as { mb?: unknown }).mb === BRIDGE_CHANNEL);
}

export function postCommand(cmd: BridgeCommand): void {
  window.postMessage(cmd, '*');
}

export function postEvent(ev: BridgeEvent): void {
  window.postMessage(ev, '*');
}