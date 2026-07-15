/**
 * Transport — sandbox↔broker HTTP 通信
 * 使用 GM_xmlhttpRequest 的半双工 pull-RPC
 *
 * - 连接循环: connect → poll → dispatch via CustomEvent → poll
 * - 心跳: 每 5 秒发一次, page adapter ACK
 * - Watchdog: 首次 5s 无 ACK 或连续 3 次缺失 → 停止
 * - 退避: 网络失败 1/2/4/8/15s + jitter
 * - Completion cache: 防止 comm.send/redeem.submit 重放
 */

import type {
  BridgeCommand,
  BridgeCompletion,
  BridgeEvent,
  BridgeError,
  ConnectResponse,
  PollResponse,
} from "@iitc-mcp/protocol";

// ─── GM 类型声明 ──────────────────────────────────────────

/** Tampermonkey GM_xmlhttpRequest 回调 details */
export interface GMDetails {
  method: string;
  url: string;
  headers: Record<string, string>;
  data?: string;
  redirect?: string;
  onload: (resp: GMResponse) => void;
  onerror: (resp: GMResponse) => void;
  ontimeout: (resp: GMResponse) => void;
}

/** Tampermonkey GM_xmlhttpRequest response 对象 */
export interface GMResponse {
  status: number;
  statusText: string;
  responseText: string;
  responseHeaders: string;
  finalUrl: string;
}

/** GM_xmlhttpRequest 函数签名 */
export type GMXmlHttpRequest = (details: GMDetails) => void;

/** GM_getValue 函数签名 */
export type GMGetValue = (key: string, defaultValue: string) => string;

/** GM_setValue 函数签名 */
export type GMSetValue = (key: string, value: string) => void;

/** GM_registerMenuCommand 函数签名 */
export type GMRegisterMenuCommand = (
  label: string,
  callback: () => void,
) => void;

// ─── 传输层配置 ──────────────────────────────────────────

export interface BridgeTransportOptions {
  channelId: string;
  gmXmlHttpRequest: GMXmlHttpRequest;
  onConnectionChange?: (connected: boolean) => void;
}

// ─── 内部常量 ────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 5_000;
const FIRST_HEARTBEAT_TIMEOUT_MS = 5_000;
const MAX_MISSED_HEARTBEATS = 3;
const BACKOFF_DELAYS_S = [1, 2, 4, 8, 15];
const MAX_JITTER_S = 1;
const COMPLETION_CACHE_MAX = 256;
const EVENT_ITEM_MAX_BYTES = 512 * 1024; // 512 KiB

const BRIDGE_CAPABILITIES = [
  "map",
  "entities",
  "portal",
  "search",
  "comm",
  "redeem",
  "self",
  "tracker",
];

// ─── BridgeTransport ─────────────────────────────────────

export class BridgeTransport {
  private static readonly DEFAULT_ORIGIN = "http://127.0.0.1:27342";

  private origin: string;
  private channelId: string;
  private gmXmlHttpRequest: GMXmlHttpRequest;
  private onConnectionChange?: (connected: boolean) => void;

  private sessionId: string | null = null;
  private connected = false;
  private running = false;

  private pendingCompletions: BridgeCompletion[] = [];
  private pendingEvents: BridgeEvent[] = [];
  private eventSequence = 0;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private missedHeartbeats = 0;

  /** completion cache: sessionId:commandId → true */
  private completionCache = new Map<string, boolean>();

  /** page event listener cleanup */
  private cleanupPageListeners: (() => void) | null = null;

  private backoffIndex = 0;

  constructor(options: BridgeTransportOptions) {
    this.origin = BridgeTransport.DEFAULT_ORIGIN;
    this.channelId = options.channelId;
    this.gmXmlHttpRequest = options.gmXmlHttpRequest;
    this.onConnectionChange = options.onConnectionChange;
  }

  /** 停止传输层 */
  stop(): void {
    this.running = false;
    this.cleanup();
    this.setConnected(false);
  }

  /** 是否已连接 */
  isConnected(): boolean {
    return this.connected;
  }

  /** 是否正在运行 */
  isRunning(): boolean {
    return this.running;
  }

  /** 在传输循环已停止时重新建立 bridge 连接。 */
  reconnect(): void {
    if (!this.running) void this.start();
  }

  // ─── 连接循环 ────────────────────────────────────────

  /** 启动连接循环 */
  async start(): Promise<void> {
    this.running = true;
    this.registerPageListeners();
    this.startHeartbeat();
    this.startFirstHeartbeatWatchdog();

    while (this.running) {
      try {
        if (!this.connected) {
          await this.connectOnce();
        }
        if (this.connected) {
          await this.pollOnce();
        }
      } catch (err) {
        if (!this.running) return;
        const error = err as Partial<BridgeError> & { status?: number };
        if (error.status === 401) {
          this.stop();
          return;
        }
        if (error.status === 409) {
          this.setConnected(false);
          this.sessionId = null;
          await this.retryBackoff();
          continue;
        }
        this.setConnected(false);
        await this.retryBackoff();
      }
    }
  }

  /** 单次 connect */
  private async connectOnce(): Promise<void> {
    // 安全读取 IITC 版本
    const w = typeof window !== "undefined"
      ? (window as unknown as Record<string, unknown>)
      : undefined;
    const scriptInfo = w?.script_info as Record<string, unknown> | undefined;
    const script = scriptInfo?.script as Record<string, unknown> | undefined;
    const iitcVersion = typeof script?.version === "string"
      ? script.version
      : "unknown";

    const req = {
      protocolVersion: 1,
      pluginVersion: "1.0.0",
      iitcVersion,
      tabId: this.generateId(),
      capabilities: BRIDGE_CAPABILITIES,
    };


    const resp = await this.httpRequest<ConnectResponse>(
      "POST",
      "/bridge/v1/connect",
      req,
    );

    this.sessionId = resp.sessionId;
    this.connected = true;
    this.pendingCompletions = [];
    this.eventSequence = 0;
    this.completionCache.clear();
    this.missedHeartbeats = 0;
    this.backoffIndex = 0;
    this.onConnectionChange?.(true);
  }

  /** 单次 poll */
  private async pollOnce(): Promise<void> {
    if (!this.sessionId) return;

    const completions = [...this.pendingCompletions];
    this.pendingCompletions = [];

    const resp = await this.httpRequest<PollResponse>(
      "POST",
      "/bridge/v1/poll",
      {
        sessionId: this.sessionId,
        completed: completions,
      },
    );

    // 验证响应 — 简单检查，MCP server 端已做完整 schema 验证
    if (!resp || !Array.isArray(resp.commands)) {
      throw { code: "UPSTREAM_ERROR", message: "Invalid poll response", retryable: true } satisfies BridgeError;
    }
    // 重置 watchdog (收到 poll 响应说明 broker 存活)
    this.resetWatchdog();

    if (resp.commands.length > 0) {
      await this.dispatchCommands(resp.commands);
    }

    // 发送 pending events
    if (this.pendingEvents.length > 0) {
      const events = [...this.pendingEvents];
      this.pendingEvents = [];
      await this.httpRequest<void>("POST", "/bridge/v1/events", {
        sessionId: this.sessionId,
        events,
      });
    }
  }

  // ─── CustomEvent 通信 ──────────────────────────────

  /** 注册 page event listeners */
  private registerPageListeners(): void {
    this.cleanupPageListeners?.();

    const prefix = `iitc-mcp:${this.channelId}:`;

    const onHeartbeatAck = (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.detail?.dir === "ping") return;
      this.missedHeartbeats = 0;
      this.clearWatchdogTimer();
    };

    const onComplete = (e: Event) => {
      const ce = e as CustomEvent;
      if (!ce.detail) return;
      const d = ce.detail;
      if (typeof d !== "object" || d === null || typeof d.id !== "string") {
        console.warn("[iitc-mcp] Invalid completion payload: missing id");
        return;
      }
      const completion = d as BridgeCompletion;
      const cacheKey = `${this.sessionId}:${completion.id}`;
      if (this.completionCache.has(cacheKey)) return;
      this.addToCompletionCache(cacheKey);
      this.pendingCompletions.push(completion);
    };

    const onPageEvent = (e: Event) => {
      const ce = e as CustomEvent;
      if (!ce.detail) return;
      const d = ce.detail;
      if (typeof d !== "object" || d === null || typeof d.type !== "string") {
        console.warn("[iitc-mcp] Invalid event payload: missing type");
        return;
      }
      this.pendingEvents.push(d as BridgeEvent);
    };

    const onStatusRequest = () => {
      document.dispatchEvent(
        new CustomEvent(`${prefix}status`, { detail: { connected: this.connected } }),
      );
    };

    document.addEventListener(`${prefix}heartbeat`, onHeartbeatAck);
    document.addEventListener(`${prefix}completion`, onComplete);
    document.addEventListener(`${prefix}event`, onPageEvent);
    document.addEventListener(`${prefix}status-request`, onStatusRequest);

    this.cleanupPageListeners = () => {
      document.removeEventListener(`${prefix}heartbeat`, onHeartbeatAck);
      document.removeEventListener(`${prefix}completion`, onComplete);
      document.removeEventListener(`${prefix}event`, onPageEvent);
      document.removeEventListener(`${prefix}status-request`, onStatusRequest);
    };
  }

  /** 派发命令到 page via CustomEvent */
  private async dispatchCommands(commands: BridgeCommand[]): Promise<void> {
    for (const cmd of commands) {
      if (!this.running) return;
      this.dispatchCommand(cmd);
    }
  }

  private dispatchCommand(cmd: BridgeCommand): void {
    const detail = JSON.stringify(cmd);
    if (detail.length > EVENT_ITEM_MAX_BYTES) {
      this.pendingCompletions.push({
        id: cmd.id,
        ok: false,
        error: {
          code: "INTERNAL",
          message: "Command too large",
          retryable: false,
          details: { reason: "EVENT_ITEM_TOO_LARGE" },
        },
      });
      return;
    }
    const ev = new CustomEvent(`iitc-mcp:${this.channelId}:command`, {
      detail: cmd,
    });
    document.dispatchEvent(ev);
  }

  // ─── 心跳 ──────────────────────────────────────────

  private startHeartbeat(): void {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setInterval(() => {
      if (!this.running) return;
      this.sendHeartbeat();
      this.missedHeartbeats++;
      if (this.missedHeartbeats >= MAX_MISSED_HEARTBEATS) {
        this.failHeartbeat("PAGE_ADAPTER_UNREACHABLE");
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private sendHeartbeat(): void {
    const ev = new CustomEvent(`iitc-mcp:${this.channelId}:heartbeat`, {
      detail: { ts: Date.now(), dir: "ping" },
    });
    document.dispatchEvent(ev);
  }

  private failHeartbeat(_reason: string): void {
    this.running = false;
    this.cleanup();
    this.setConnected(false);
    this.onConnectionChange?.(false);
  }

  // ─── Watchdog ────────────────────────────────────────

  /** 首次心跳超时 5s watchdog */
  private startFirstHeartbeatWatchdog(): void {
    this.clearWatchdogTimer();
    this.watchdogTimer = setTimeout(() => {
      if (this.missedHeartbeats >= 1 && this.running) {
        this.failHeartbeat("PAGE_ADAPTER_UNREACHABLE");
      }
    }, FIRST_HEARTBEAT_TIMEOUT_MS);
  }

  private resetWatchdog(): void {
    this.clearWatchdogTimer();
    this.missedHeartbeats = 0;
  }

  // ─── HTTP ────────────────────────────────────────────

  /** 发起 HTTP 请求到 broker */
  private httpRequest<T>(
    method: string,
    path: string,
    body: unknown,
  ): Promise<T> {
    const url = `${this.origin}${path}`;
    const data = JSON.stringify(body);
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
    };
    return new Promise<T>((resolve, reject) => {
      this.gmXmlHttpRequest({
        method,
        url,
        headers,
        data,
        redirect: "error",
        onload: (resp: GMResponse) => {
          if (resp.finalUrl && !resp.finalUrl.startsWith(this.origin)) {
            reject({
              code: "INVALID_ARGUMENT",
              message: `Redirect to unexpected origin: ${resp.finalUrl}`,
              retryable: false,
            } satisfies BridgeError);
            return;
          }
          if (resp.status < 200 || resp.status >= 300) {
            const err: BridgeError & { status: number } = {
              code: "UPSTREAM_ERROR",
              message: `HTTP ${resp.status}: ${resp.statusText || "error"}`,
              retryable: resp.status >= 500,
              status: resp.status,
            };
            reject(err);
            return;
          }
          if (path === "/bridge/v1/events") {
            resolve(undefined as T);
            return;
          }
          try {
            resolve(JSON.parse(resp.responseText) as T);
          } catch {
            reject({
              code: "UPSTREAM_ERROR",
              message: "Invalid JSON response from broker",
              retryable: true,
            } satisfies BridgeError);
          }
        },
        onerror: (resp: GMResponse) => {
          reject({
            code: "UPSTREAM_ERROR",
            message: `HTTP ${resp.status}: ${resp.statusText || "error"}`,
            retryable: resp.status >= 500,
            status: resp.status,
          } satisfies BridgeError & { status: number });
        },
        ontimeout: () => {
          reject({
            code: "TIMEOUT",
            message: "Request timed out",
            retryable: true,
          } satisfies BridgeError);
        },
      });
    });
  }

  // ─── 退避 ────────────────────────────────────────────

  private async retryBackoff(): Promise<void> {
    const delayS =
      BACKOFF_DELAYS_S[Math.min(this.backoffIndex, BACKOFF_DELAYS_S.length - 1)];
    const jitter = Math.random() * MAX_JITTER_S;
    const totalMs = (delayS + jitter) * 1000;
    this.backoffIndex++;
    await new Promise<void>((resolve) => setTimeout(resolve, totalMs));
    if (this.connected) {
      this.backoffIndex = 0;
    }
  }

  // ─── 工具方法 ────────────────────────────────────────

  private generateId(): string {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    let binary = "";
    for (const byte of buf) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  private addToCompletionCache(key: string): void {
    this.completionCache.set(key, true);
    if (this.completionCache.size > COMPLETION_CACHE_MAX) {
      const firstKey = this.completionCache.keys().next().value;
      if (firstKey !== undefined) {
        this.completionCache.delete(firstKey);
      }
    }
  }

  private setConnected(connected: boolean): void {
    if (this.connected !== connected) {
      this.connected = connected;
      this.onConnectionChange?.(connected);
    }
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearWatchdogTimer(): void {
    if (this.watchdogTimer !== null) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private cleanup(): void {
    this.clearHeartbeatTimer();
    this.clearWatchdogTimer();
    this.cleanupPageListeners?.();
    this.cleanupPageListeners = null;
  }
}

// ─── 验证 origin ──────────────────────────────────────

/** 验证 origin 格式: 仅允许 http://127.0.0.1:<port> */
export function validateOrigin(origin: string): boolean {
  const match = origin.match(/^http:\/\/127\.0\.0\.1:(\d+)$/);
  if (!match) return false;
  const port = parseInt(match[1], 10);
  return port >= 1 && port <= 65535;
}
