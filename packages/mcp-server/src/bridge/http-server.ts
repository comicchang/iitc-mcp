/**
 * Bridge HTTP Server — 监听 127.0.0.1:27342
 * 纯 Node http，无 express；只接受三个 POST path
 * 安全模型：仅依赖 loopback 绑定，无 token 认证
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { BridgeBroker } from "./broker.js";
import type { BridgeMethod } from "@iitc-mcp/protocol";

const MAX_BODY_BYTES = 1_048_576;
const DEFAULT_PORT = 27342;

export interface BridgeServerHandle {
  port: number;
  close: () => Promise<void>;
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
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function empty204(res: ServerResponse): void {
  res.writeHead(204, { "Cache-Control": "no-store" });
  res.end();
}

function errorJson(res: ServerResponse, status: number, code: string, message: string): void {
  json(res, status, { error: { code, message, retryable: false } });
}

function isLoopbackHost(host: string, port: number): boolean {
  const [hostname, portStr] = host.includes(":") ? host.split(":") : [host, ""];
  if (portStr && parseInt(portStr, 10) !== port) return false;
  return hostname === "127.0.0.1" || hostname === "localhost";
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
  opts?: { port?: number },
): Promise<BridgeServerHandle> {
  const requestedPort = opts?.port ?? DEFAULT_PORT;

  let actualPort = requestedPort;

  const server: Server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const reqPath = req.url?.split("?")[0] ?? "";
    const query = new URL(req.url ?? "", "http://localhost").searchParams;

    // 仅允许 loopback
    const host = req.headers.host;
    if (!host || !isLoopbackHost(host, actualPort)) {
      errorJson(res, 400, "INVALID_ARGUMENT", "Host must be loopback");
      return;
    }

    // MCP 控制面（GET + POST）
    if (reqPath === "/mcp/status" && method === "GET") {
      const status = await broker.getConnectionStatus();
      json(res, 200, status);
      return;
    }

    if (reqPath === "/mcp/events" && method === "GET") {
      const count = parseInt(query.get("count") ?? "100", 10);
      const events = await broker.getRecentEvents(count);
      json(res, 200, { events });
      return;
    }

    if (reqPath === "/mcp/call" && method === "POST") {
      const body = await parseBody(req, res);
      if (body === null) return;
      const { method: bridgeMethod, params, timeoutMs } = body as { method: string; params: unknown; timeoutMs?: number };
      try {
        const result = await broker.call(bridgeMethod as BridgeMethod, params, { timeoutMs });
        json(res, 200, { ok: true, result });
      } catch (err: unknown) {
        const error = err as { code?: string; message?: string; retryable?: boolean };
        json(res, 200, { ok: false, error });
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
        broker.setupLongPoll((commands) => {
          json(res, 200, { commands });
        });
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
  });

  const { promise, resolve, reject } = Promise.withResolvers<BridgeServerHandle>();
  server.on("error", reject);
  server.listen(requestedPort, "127.0.0.1", () => {
    const addr = server.address();
    actualPort = typeof addr === "object" && addr ? addr.port : requestedPort;
    resolve({
      port: actualPort,
      close: () => {
        const { promise: closeP, resolve: closeR, reject: closeJ } = Promise.withResolvers<void>();
        server.close((err) => (err ? closeJ(err) : closeR()));
        return closeP;
      },
    });
  });
  return promise;
}
