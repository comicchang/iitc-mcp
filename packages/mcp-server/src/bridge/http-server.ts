/**
 * Bridge HTTP Server — 监听 127.0.0.1:27342
 * 纯 Node http，无 express
 * 安全模型：严格 loopback Host/Origin 校验；/mcp/* 支持恒定时间 Bearer token 认证（配置 authToken/getAuthToken 时强制校验）
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import type { BridgeBroker } from "./broker.js";
import { BridgeMethodSchema, DEFAULT_PORT, MAX_BODY_BYTES } from "@iitc-mcp/protocol";

export interface BridgeServerOptions {
  port?: number;
  /** 静态 Bearer token（用于保护 /mcp/* 端点） */
  authToken?: string;
  /** 动态读取当前 Bearer token（支持 token rotate 立即生效） */
  getAuthToken?: () => string;
}

export interface BridgeServerHandle {
  port: number;
  close: () => Promise<void>;
}

function constantTimeTokenEquals(expected: string, provided: string): boolean {
  const a = createHash("sha256").update(expected, "utf-8").digest();
  const b = createHash("sha256").update(provided, "utf-8").digest();
  return timingSafeEqual(a, b);
}

function isAuthorized(req: IncomingMessage, expectedToken: string): boolean {
  if (!expectedToken) return true;
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return false;
  const provided = header.slice("Bearer ".length).trim();
  if (!provided) return false;
  return constantTimeTokenEquals(expectedToken, provided);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const chunks: Buffer[] = [];
  let size = 0;
  let oversize = false;
  req.on("data", (chunk: Buffer) => {
    if (oversize) return;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY_BYTES) {
      oversize = true;
      reject(new Error("BODY_TOO_LARGE"));
      return;
    }
    chunks.push(buf);
  });
  req.on("end", () => { if (!oversize) resolve(Buffer.concat(chunks)); });
  req.on("error", reject);
  return promise;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function empty204(res: ServerResponse): void {
  if (res.headersSent || res.writableEnded || res.destroyed) return;
  res.writeHead(204, {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end();
}

function errorJson(res: ServerResponse, status: number, code: string, message: string): void {
  json(res, status, { error: { code, message, retryable: false } });
}

function isLoopbackHost(host: string, port: number): boolean {
  const m = host.trim().match(/^(127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?$/i);
  if (!m) return false;
  if (m[2] !== undefined && Number(m[2]) !== port) return false;
  return true;
}

function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  if (!origin) return true;
  if (origin === "https://intel.ingress.com" || origin === "https://intel-x.ingress.com") {
    return true;
  }
  const m = origin.match(/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):(\d+)$/i);
  return Boolean(m && Number(m[2]) === port);
}

async function parseBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | null> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.startsWith("application/json")) {
    errorJson(res, 415, "INVALID_ARGUMENT", "Content-Type must be application/json");
    return null;
  }
  try {
    const raw = await readBody(req);
    return JSON.parse(raw.toString("utf-8"));
  } catch (err: unknown) {
    const isTooLarge = err instanceof Error && err.message === "BODY_TOO_LARGE";
    const msg = isTooLarge ? "Request body exceeds 1 MiB" : "Invalid JSON body";
    errorJson(res, isTooLarge ? 413 : 400, "INVALID_ARGUMENT", msg);
    return null;
  }
}

export function startServer(
  broker: BridgeBroker,
  opts?: BridgeServerOptions,
): Promise<BridgeServerHandle> {
  const requestedPort = opts?.port ?? DEFAULT_PORT;
  const resolveExpectedToken = (): string => {
    if (opts?.getAuthToken) return opts.getAuthToken();
    return opts?.authToken ?? "";
  };

  let actualPort = requestedPort;

  const server: Server = createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const parsedUrl = new URL(req.url ?? "/", "http://localhost");
      const reqPath = parsedUrl.pathname;
      const query = parsedUrl.searchParams;

      // 仅允许 loopback Host 与受信任 Origin（防 DNS Rebinding / 跨站 CSRF）
      const host = req.headers.host;
      if (!host || !isLoopbackHost(host, actualPort)) {
        errorJson(res, 400, "INVALID_ARGUMENT", "Host must be loopback");
        return;
      }
      if (!isAllowedOrigin(req.headers.origin, actualPort)) {
        errorJson(res, 403, "FORBIDDEN", "Origin not allowed");
        return;
      }

      // 轻量健康探针（不暴露敏感信息）
      if (reqPath === "/healthz" && method === "GET") {
        json(res, 200, {
          ok: true,
          connected: broker.hasSession(),
          readOnly: broker.isReadOnly(),
        });
        return;
      }

      // MCP 控制面鉴权（配置 token 时强制校验 Bearer）
      if (reqPath.startsWith("/mcp/")) {
        const expectedToken = resolveExpectedToken();
        if (expectedToken && !isAuthorized(req, expectedToken)) {
          errorJson(res, 401, "UNAUTHORIZED", "Missing or invalid Bearer token");
          return;
        }
      }

      // MCP 控制面（GET + POST）
      if (reqPath === "/mcp/status" && method === "GET") {
        const status = await broker.getConnectionStatus();
        json(res, 200, status);
        return;
      }

      if (reqPath === "/mcp/events" && method === "GET") {
        const rawCount = Number.parseInt(query.get("count") ?? "100", 10);
        const count = Number.isFinite(rawCount) ? Math.min(1000, Math.max(1, rawCount)) : 100;
        const events = await broker.getRecentEvents(count);
        json(res, 200, { events });
        return;
      }

      if (reqPath === "/mcp/call" && method === "POST") {
        const body = await parseBody(req, res);
        if (body === null) return;
        if (typeof body !== "object" || Array.isArray(body)) {
          errorJson(res, 400, "INVALID_ARGUMENT", "Request body must be a JSON object");
          return;
        }
        const { method: rawMethod, params, timeoutMs } = body as {
          method?: unknown;
          params?: unknown;
          timeoutMs?: unknown;
        };
        const parsedMethod = BridgeMethodSchema.safeParse(rawMethod);
        if (!parsedMethod.success) {
          errorJson(res, 400, "INVALID_ARGUMENT", `Invalid bridge method: ${String(rawMethod)}`);
          return;
        }
        const validTimeoutMs =
          typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
            ? timeoutMs
            : undefined;
        const ac = new AbortController();
        const onClose = (): void => {
          if (!res.writableEnded) ac.abort();
        };
        res.on("close", onClose);
        try {
          const result = await broker.call(parsedMethod.data, params, {
            signal: ac.signal,
            timeoutMs: validTimeoutMs,
          });
          if (!res.writableEnded && !res.destroyed) {
            json(res, 200, { ok: true, result });
          }
        } catch (err: unknown) {
          if (!res.writableEnded && !res.destroyed) {
            const error = err as { code?: string; message?: string; retryable?: boolean };
            json(res, 200, { ok: false, error });
          }
        } finally {
          res.off("close", onClose);
        }
        return;
      }

      // Bridge 端点（仅 POST）
      if (method !== "POST") {
        errorJson(res, 405, "UNSUPPORTED", "Method not allowed");
        return;
      }

      const path = reqPath;

      if (path === "/bridge/v1/connect") {
        const body = await parseBody(req, res);
        if (body === null) return;
        const result = broker.handleConnect(body);
        json(res, result.status, result.body);
        return;
      }

      if (path === "/bridge/v1/poll") {
        const body = await parseBody(req, res);
        if (body === null) return;
        const result = broker.handlePoll(body);
        if (result.longPoll) {
          res.setHeader("Cache-Control", "no-store");
          const onCommands = (commands: unknown[]) => {
            if (res.writableEnded || res.destroyed) return;
            json(res, 200, { commands });
          };
          res.once("close", () => {
            if (!res.writableEnded) {
              broker.cancelLongPoll(onCommands);
            }
          });
          broker.setupLongPoll(onCommands);
          return;
        }
        json(res, result.status, result.body);
        return;
      }

      if (path === "/bridge/v1/events") {
        const body = await parseBody(req, res);
        if (body === null) return;
        const result = broker.handleEvents(body);
        if (result.status === 204) {
          empty204(res);
        } else {
          json(res, result.status, result.body);
        }
        return;
      }

      errorJson(res, 404, "NOT_FOUND", `Unknown path: ${path}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal server error";
      errorJson(res, 500, "INTERNAL", message);
    }
  });

  const { promise, resolve, reject } = Promise.withResolvers<BridgeServerHandle>();
  const onListenError = (err: Error) => reject(err);
  server.once("error", onListenError);
  server.listen(requestedPort, "127.0.0.1", () => {
    server.off("error", onListenError);
    server.on("error", (err) => {
      console.error("[iitc-mcp] HTTP server error:", err.message);
    });
    const addr = server.address();
    actualPort = typeof addr === "object" && addr ? addr.port : requestedPort;
    resolve({
      port: actualPort,
      close: () => {
        broker.destroySession();
        const { promise: closeP, resolve: closeR, reject: closeJ } = Promise.withResolvers<void>();
        server.close((err) => (err ? closeJ(err) : closeR()));
        server.closeAllConnections?.();
        return closeP;
      },
    });
  });
  return promise;
}
