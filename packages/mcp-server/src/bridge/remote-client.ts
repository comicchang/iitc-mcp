/**
 * Remote BridgeClient — 通过 HTTP 连接独立 broker
 * 供多个 MCP server 共享同一个浏览器 session
 */
import type {
	BridgeMethod,
	BridgeEvent,
	BridgeError,
} from "@iitc-mcp/protocol";
import type { SessionStatus, BridgeClient } from "./broker.js";

export interface RemoteBrokerOptions {
	brokerUrl: string;
	token?: string;
}

export class RemoteBridgeClient implements BridgeClient {
	private readonly baseUrl: string;
	private readonly token?: string;

	constructor(opts: RemoteBrokerOptions) {
		this.baseUrl = opts.brokerUrl.replace(/\/$/, "");
		this.token = opts.token;
	}

	private buildHeaders(extra?: Record<string, string>): Record<string, string> {
		const headers: Record<string, string> = { ...extra };
		if (this.token) {
			headers.Authorization = `Bearer ${this.token}`;
		}
		return headers;
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
			opts.signal.addEventListener("abort", () => controller.abort(), {
				once: true,
			});
		}
		try {
			const resp = await fetch(`${this.baseUrl}/mcp/call`, {
				method: "POST",
				headers: this.buildHeaders({ "Content-Type": "application/json" }),
				body: JSON.stringify({ method, params, timeoutMs }),
				signal: controller.signal,
			});
			if (!resp.ok) {
				let errBody: { error?: BridgeError } | undefined;
				try {
					errBody = (await resp.json()) as { error?: BridgeError };
				} catch {
					// non-JSON error response
				}
				throw (
					errBody?.error ?? {
						code: resp.status === 401 ? "UNAUTHORIZED" : "UPSTREAM_ERROR",
						message: `Broker HTTP ${resp.status}`,
						retryable: resp.status >= 500,
					}
				);
			}
			const body = (await resp.json()) as {
				ok: boolean;
				result?: unknown;
				error?: BridgeError;
			};
			if (!body.ok)
				throw (
					body.error ?? {
						code: "INTERNAL",
						message: "Unknown error",
						retryable: false,
					}
				);
			return body.result;
		} finally {
			clearTimeout(timer);
		}
	}

	async getConnectionStatus(): Promise<SessionStatus> {
		const resp = await fetch(`${this.baseUrl}/mcp/status`, {
			headers: this.buildHeaders(),
		});
		if (!resp.ok) {
			throw {
				code: resp.status === 401 ? "UNAUTHORIZED" : "UPSTREAM_ERROR",
				message: `Broker HTTP ${resp.status}`,
				retryable: resp.status >= 500,
			} satisfies BridgeError;
		}
		return resp.json() as Promise<SessionStatus>;
	}

	async getRecentEvents(count = 100): Promise<BridgeEvent[]> {
		const resp = await fetch(`${this.baseUrl}/mcp/events?count=${count}`, {
			headers: this.buildHeaders(),
		});
		if (!resp.ok) {
			throw {
				code: resp.status === 401 ? "UNAUTHORIZED" : "UPSTREAM_ERROR",
				message: `Broker HTTP ${resp.status}`,
				retryable: resp.status >= 500,
			} satisfies BridgeError;
		}
		const body = (await resp.json()) as { events: BridgeEvent[] };
		return body.events;
	}
}
