/**
 * Bridge Broker — 会话管理、命令队列、事件环形缓冲
 * 只允许一个活动 IITC tab；相同 tabId 重连替换旧 session
 */
import type {
  ConnectResponse,
  PollResponse,
  BridgeCommand,
  BridgeCompletion,
  BridgeEvent,
  BridgeMethod,
  BridgeError,
} from "@iitc-mcp/protocol";
import {
  ConnectRequestSchema,
  PollRequestSchema,
  EventsRequestSchema,
  BridgeEventSchema,
} from "@iitc-mcp/protocol";
import { randomBytes } from "node:crypto";

export interface SessionStatus {
  connected: boolean;
  sessionId: string | null;
  tabId: string | null;
  pluginVersion: string | null;
  iitcVersion: string | null;
  capabilities: string[];
  connectedAt: number | null;
}

export interface PendingCall {
  method: BridgeMethod;
  params: unknown;
  deadlineMs: number;
  resolve: (result: unknown) => void;
  reject: (error: BridgeError) => void;
  timeout: NodeJS.Timeout;
  dispatched: boolean;
}

export interface BridgeBrokerOptions {
  leaseMs?: number;
  maxEvents?: number;
}

export interface BridgeClient {
  call(method: BridgeMethod, params: unknown, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
  getConnectionStatus(): SessionStatus;
  getRecentEvents(count?: number): BridgeEvent[];
}

const LEASE_MS = 45_000;
const MAX_EVENTS = 1000;
const POLL_WAIT_MS = 25_000;

export class BridgeBroker implements BridgeClient {
  private session: {
    sessionId: string;
    tabId: string;
    pluginVersion: string;
    iitcVersion: string;
    capabilities: string[];
    connectedAt: number;
    lastPollAt: number;
  } | null = null;

  private leaseMs: number;
  private commandSeq = 0;
  private pendingCommands = new Map<string, PendingCall>();
  private eventRing: BridgeEvent[] = [];
  private maxEvents: number;
  private pollWaiter: {
    resolve: (commands: BridgeCommand[]) => void;
    timer: NodeJS.Timeout;
  } | null = null;

  private readyBeforeBridgeReady = false;

  constructor(opts?: BridgeBrokerOptions) {
    this.leaseMs = opts?.leaseMs ?? LEASE_MS;
    this.maxEvents = opts?.maxEvents ?? MAX_EVENTS;
  }

  /** 处理 connect 请求 */
  handleConnect(req: unknown): { status: number; body: unknown } {
    const parsed = ConnectRequestSchema.safeParse(req);
    if (!parsed.success) {
      return this.errorResponse(400, "INVALID_ARGUMENT", parsed.error.message);
    }

    const { tabId, pluginVersion, iitcVersion, capabilities } = parsed.data;

    // 相同 tabId 重连替换旧 session；不同 tabId 检查 lease 是否过期
    if (this.session && this.session.tabId !== tabId) {
      // 如果旧 session 的 lease 已过期，销毁旧 session 接受新 tab
      if (Date.now() - this.session.lastPollAt > this.leaseMs) {
        this.destroySession();
      } else {
        const remainingSec = Math.ceil((this.leaseMs - (Date.now() - this.session.lastPollAt)) / 1000);
        return this.errorResponse(409, "SESSION_CONFLICT",
          `Another IITC tab is already connected (plugin v${this.session.pluginVersion}, ` +
          `IITC v${this.session.iitcVersion}), connected ${Math.floor((Date.now() - this.session.connectedAt) / 1000)}s ago. ` +
          `Please close the other tab or wait ~${remainingSec}s for its session lease to expire. ` +
          `(中: 另一个 Intel 标签页已连接，请关闭该标签页或等待约${remainingSec}秒会话租约过期)`);
      }
    }

    // 撤销旧 session 的 pending commands
    if (this.session) {
      this.failAllPending("NOT_READY", "Session replaced");
    }

    const sessionId = randomBytes(16).toString("base64url");
    this.session = {
      sessionId,
      tabId,
      pluginVersion,
      iitcVersion,
      capabilities,
      connectedAt: Date.now(),
      lastPollAt: Date.now(),
    };
    this.commandSeq = 0;
    this.readyBeforeBridgeReady = false;

    const response: ConnectResponse = {
      sessionId,
      leaseMs: this.leaseMs,
      heartbeatMs: 15_000,
      maxBodyBytes: 1_048_576,
    };
    return { status: 200, body: response };
  }

  /** 处理 poll 请求 — 等待命令或超时 */
  handlePoll(req: unknown): { status: number; body: unknown; longPoll?: true } {
    const parsed = PollRequestSchema.safeParse(req);
    if (!parsed.success) {
      return this.errorResponse(400, "INVALID_ARGUMENT", parsed.error.message);
    }

    const { sessionId, completed } = parsed.data;

    if (!this.session || this.session.sessionId !== sessionId) {
      return this.errorResponse(401, "UNAUTHORIZED", "Invalid session");
    }

    // 检查 lease 过期
    if (Date.now() - this.session.lastPollAt > this.leaseMs) {
      this.destroySession();
      return this.errorResponse(401, "UNAUTHORIZED", "Session lease expired");
    }

    this.session.lastPollAt = Date.now();

    // 处理完成的命令
    for (const comp of completed) {
      this.handleCompletion(comp);
    }

    // 获取待派发的命令
    const commands = this.collectPendingCommands();

    if (commands.length > 0) {
      // 立即返回
      const response: PollResponse = { commands };
      return { status: 200, body: response };
    }

    // 没有命令，进入 long-poll 等待
    return { status: 200, body: null, longPoll: true };
  }

  /** 设置 long-poll 等待器 */
  setupLongPoll(callback: (commands: BridgeCommand[]) => void): NodeJS.Timeout {
    this.clearPollWaiter();
    const timer = setTimeout(() => {
      this.pollWaiter = null;
      callback([]);
    }, POLL_WAIT_MS);
    this.pollWaiter = { resolve: callback, timer };
    return timer;
  }

  /** 处理 events 请求 */
  handleEvents(req: unknown): { status: number; body: unknown } {
    const parsed = EventsRequestSchema.safeParse(req);
    if (!parsed.success) {
      return this.errorResponse(400, "INVALID_ARGUMENT", parsed.error.message);
    }

    const { sessionId, events } = parsed.data;

    if (!this.session || this.session.sessionId !== sessionId) {
      return this.errorResponse(401, "UNAUTHORIZED", "Invalid session");
    }

    for (const evt of events) {
      const validEvt = BridgeEventSchema.safeParse(evt);
      if (validEvt.success) {
        this.pushEvent(validEvt.data);
      }
    }

    return { status: 204, body: null };
  }

  /** 入队命令，等待完成 (BridgeClient.call) */
  call(method: BridgeMethod, params: unknown, opts?: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown> {
    if (!this.session) {
      return Promise.reject(this.makeError("NOT_READY", "No active session"));
    }
    if (!this.readyBeforeBridgeReady && !this.canCallBeforeReady(method)) {
      return Promise.reject(this.makeError("NOT_READY", "Page adapter not ready (waiting for bridge.ready)"));
    }

    const timeoutMs = opts?.timeoutMs ?? 30_000;
    const id = String(++this.commandSeq);
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const deadlineMs = Date.now() + timeoutMs;
    const entry: PendingCall = {
      method,
      params,
      deadlineMs,
      resolve,
      reject,
      timeout: setTimeout(() => {
        this.pendingCommands.delete(id);
        reject(this.makeError("TIMEOUT", `Command ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs),
      dispatched: false,
    };
    this.pendingCommands.set(id, entry);

    if (opts?.signal) {
      opts.signal.addEventListener("abort", () => {
        const e = this.pendingCommands.get(id);
        if (e) {
          clearTimeout(e.timeout);
          this.pendingCommands.delete(id);
          reject(this.makeError("CANCELLED", "Command cancelled by client"));
        }
      }, { once: true });
    }

    this.tryDispatch();
    return promise;
  }

  /** 获取连接状态 */
  getConnectionStatus(): SessionStatus {
    if (!this.session) {
      return {
        connected: false,
        sessionId: null,
        tabId: null,
        pluginVersion: null,
        iitcVersion: null,
        capabilities: [],
        connectedAt: null,
      };
    }
    return {
      connected: true,
      sessionId: this.session.sessionId,
      tabId: this.session.tabId,
      pluginVersion: this.session.pluginVersion,
      iitcVersion: this.session.iitcVersion,
      capabilities: this.session.capabilities,
      connectedAt: this.session.connectedAt,
    };
  }

  /** 获取最近事件 */
  getRecentEvents(count = 100): BridgeEvent[] {
    return this.eventRing.slice(-count);
  }

  /** 标记 bridge.ready 已收到 */
  markBridgeReady(): void {
    this.readyBeforeBridgeReady = true;
  }

  /** 销毁当前 session */
  destroySession(): void {
    this.failAllPending("NOT_READY", "Session destroyed");
    this.session = null;
    this.clearPollWaiter();
  }

  /** 撤销 session（token rotate 用） */
  revokeSession(): void {
    this.destroySession();
  }

  /** 是否有活跃 session */
  hasSession(): boolean {
    return this.session !== null;
  }

  // ─── private ────────────────────────────────────────────

  private canCallBeforeReady(method: BridgeMethod): boolean {
    return method === "map.get_state";
  }

  private collectPendingCommands(): BridgeCommand[] {
    const commands: BridgeCommand[] = [];
    for (const [id, entry] of this.pendingCommands) {
      if (!entry.dispatched) {
        entry.dispatched = true;
        commands.push({
          id,
          method: entry.method,
          params: entry.params,
          deadlineMs: entry.deadlineMs,
        });
      }
    }
    return commands;
  }

  private tryDispatch(): void {
    if (!this.pollWaiter) return;
    const commands = this.collectPendingCommands();
    if (commands.length === 0) return;

    const waiter = this.pollWaiter;
    this.pollWaiter = null;
    clearTimeout(waiter.timer);
    waiter.resolve(commands);
  }

  private handleCompletion(comp: BridgeCompletion): void {
    const entry = this.pendingCommands.get(comp.id);
    if (!entry) return; // late or unknown

    clearTimeout(entry.timeout);
    this.pendingCommands.delete(comp.id);

    if (comp.ok) {
      if (entry.method === "map.get_state" && !this.readyBeforeBridgeReady) {
        this.markBridgeReady();
      }
      entry.resolve(comp.result);
    } else {
      entry.reject(comp.error as BridgeError);
    }
  }

  private pushEvent(evt: BridgeEvent): void {
    // bridge.ready 标记
    if (evt.type === "bridge.ready") {
      this.markBridgeReady();
    }
    this.eventRing.push(evt);
    if (this.eventRing.length > this.maxEvents) {
      this.eventRing.splice(0, this.eventRing.length - this.maxEvents);
    }
  }

  private failAllPending(code: string, message: string): void {
    const err = this.makeError(code as BridgeError["code"], message);
    for (const [, entry] of this.pendingCommands) {
      clearTimeout(entry.timeout);
      entry.reject(err);
    }
    this.pendingCommands.clear();
  }

  private clearPollWaiter(): void {
    if (this.pollWaiter) {
      clearTimeout(this.pollWaiter.timer);
      this.pollWaiter.resolve([]);
      this.pollWaiter = null;
    }
  }

  private makeError(code: BridgeError["code"], message: string): BridgeError {
    return {
      code,
      message,
      retryable: code === "TIMEOUT" || code === "NOT_READY",
    };
  }

  private errorResponse(status: number, code: string, message: string): { status: number; body: unknown } {
    return {
      status,
      body: {
        error: {
          code,
          message,
          retryable: false,
        },
      },
    };
  }
}
