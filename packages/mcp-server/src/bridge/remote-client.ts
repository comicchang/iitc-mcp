/**
 * Remote BridgeClient — 通过 HTTP 连接独立 broker
 * 供多个 MCP server 共享同一个浏览器 session
 */
import type { BridgeMethod, BridgeEvent, BridgeError } from "@iitc-mcp/protocol";
import type { SessionStatus } from "./broker.js";

export interface RemoteBrokerOptions {
  brokerUrl: string;
}

export class RemoteBridgeClient {
  private readonly baseUrl: string;

  constructor(opts: RemoteBrokerOptions) {
    this.baseUrl = opts.brokerUrl.replace(/\/$/, "");
  }

  async call(
    method: BridgeMethod,
    params: unknown,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<unknown> {
    const timeoutMs = opts?.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (opts?.signal) {
      opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      const resp = await fetch(`${this.baseUrl}/mcp/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, params, timeoutMs }),
        signal: controller.signal,
      });
      const body = await resp.json() as { ok: boolean; result?: unknown; error?: BridgeError };
      if (!body.ok) throw body.error ?? { code: "INTERNAL", message: "Unknown error", retryable: false };
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async getConnectionStatus(): Promise<SessionStatus> {
    const resp = await fetch(`${this.baseUrl}/mcp/status`);
    return resp.json() as Promise<SessionStatus>;
  }

  async getRecentEvents(count = 100): Promise<BridgeEvent[]> {
    const resp = await fetch(`${this.baseUrl}/mcp/events?count=${count}`);
    const body = await resp.json() as { events: BridgeEvent[] };
    return body.events;
  }
}
