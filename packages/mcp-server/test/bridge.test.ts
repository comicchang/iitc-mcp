/**
 * Bridge broker + HTTP server tests
 * 纯本地，无真实 Niantic 访问
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import { setConfigDir, getToken, getOrCreateToken, rotateToken } from "../src/token.js";
import { BridgeBroker } from "../src/bridge/broker.js";
import { startServer, type BridgeServerHandle } from "../src/bridge/http-server.js";

// ─── Token management ──────────────────────────────────────

describe("token management", () => {
  let tempDir: string;
  let origEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "iitc-mcp-test-"));
    origEnv = process.env.IITC_MCP_TOKEN;
    delete process.env.IITC_MCP_TOKEN;
    setConfigDir(tempDir);
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.IITC_MCP_TOKEN = origEnv;
    } else {
      delete process.env.IITC_MCP_TOKEN;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("getToken returns env token when IITC_MCP_TOKEN is set", () => {
    process.env.IITC_MCP_TOKEN = "test-token-from-env";
    const info = getToken();
    expect(info.token).toBe("test-token-from-env");
    expect(info.source).toBe("env");
  });

  it("getToken returns file token when file exists", () => {
    writeFileSync(join(tempDir, "token"), "file-token-123", { mode: 0o600 });
    const info = getToken();
    expect(info.token).toBe("file-token-123");
    expect(info.source).toBe("file");
  });

  it("getToken returns empty when no env and no file", () => {
    const info = getToken();
    expect(info.token).toBe("");
    expect(info.source).toBe("generated");
  });

  it("getOrCreateToken generates and persists a new token", () => {
    const info = getOrCreateToken();
    expect(info.token).toBeTruthy();
    expect(info.source).toBe("generated");
    expect(existsSync(join(tempDir, "token"))).toBe(true);
    const stored = readFileSync(join(tempDir, "token"), "utf-8").trim();
    expect(stored).toBe(info.token);
  });

  it("getOrCreateToken returns existing file token", () => {
    writeFileSync(join(tempDir, "token"), "existing-token", { mode: 0o600 });
    const info = getOrCreateToken();
    expect(info.token).toBe("existing-token");
    expect(info.source).toBe("file");
  });

  it("rotateToken generates a new token different from the old one", () => {
    const first = getOrCreateToken();
    const rotated = rotateToken();
    expect(rotated).not.toBe(first.token);
    expect(readFileSync(join(tempDir, "token"), "utf-8").trim()).toBe(rotated);
  });

  it("token files are created with 0600 mode", () => {
    getOrCreateToken();
    const stat = statSync(join(tempDir, "token"));
    const mode = (stat.mode & 0o777).toString(8);
    expect(mode).toBe("600");
  });

  it("lock file is cleaned up after write", () => {
    getOrCreateToken();
    expect(existsSync(join(tempDir, "token.lock"))).toBe(false);
  });
});

// ─── Broker ────────────────────────────────────────────────

describe("BridgeBroker", () => {
  let broker: InstanceType<typeof BridgeBroker>;

  const validConnect = {
    protocolVersion: 1 as const,
    pluginVersion: "1.0.0",
    iitcVersion: "0.40.0",
    tabId: "test-tab-1",
    capabilities: ["map", "portal", "comm"],
  };

  beforeEach(() => {
    broker = new BridgeBroker();
  });

  function connect(req = validConnect) {
    return broker.handleConnect(req);
  }
  function connectReady(req = validConnect) {
    const result = broker.handleConnect(req);
    broker.markBridgeReady();
    return result;
  }
  it("handles valid connect request", () => {
    const result = connect();
    expect(result.status).toBe(200);
    const body = result.body as { sessionId: string; leaseMs: number; heartbeatMs: number; maxBodyBytes: number };
    expect(body.sessionId).toBeTruthy();
    expect(body.leaseMs).toBe(45_000);
    expect(body.heartbeatMs).toBe(15_000);
    expect(body.maxBodyBytes).toBe(1_048_576);
  });

  it("rejects connect with wrong protocolVersion", () => {
    const result = connect({ ...validConnect, protocolVersion: 2 as 1 });
    expect(result.status).toBe(400);
    const body = result.body as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_ARGUMENT");
  });

  it("rejects second tab with different tabId (409) with descriptive message", () => {
    connect();
    const result = connect({ ...validConnect, tabId: "other-tab" });
    expect(result.status).toBe(409);
    const body = result.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("SESSION_CONFLICT");
    expect(body.error.message).toContain("Another IITC tab is already connected");
    expect(body.error.message).toContain("plugin v1.0.0");
    expect(body.error.message).toContain("IITC v0.40.0");
    expect(body.error.message).toContain("close the other tab");
    expect(body.error.message).toContain("另一个 Intel 标签页已连接");
  });

  it("accepts new tab after old session lease expires", () => {
    broker = new BridgeBroker({ leaseMs: 1000 });
    connect();
    // Simulate lease expiry by advancing time past lastPollAt + leaseMs
    // We can't easily fake time, so we manipulate the session's lastPollAt
    const session = (broker as unknown as { session: { lastPollAt: number } }).session;
    session.lastPollAt = Date.now() - 2000; // 2s ago, lease is 1s
    const result = connect({ ...validConnect, tabId: "new-tab" });
    expect(result.status).toBe(200);
  });

  it("allows same tabId to reconnect", () => {
    const r1 = connect();
    const r2 = connect(validConnect);
    expect(r2.status).toBe(200);
    const b1 = r1.body as { sessionId: string };
    const b2 = r2.body as { sessionId: string };
    expect(b2.sessionId).not.toBe(b1.sessionId);
  });

  it("poll returns longPoll flag when no pending commands", () => {
    const { body } = connect();
    const sid = (body as { sessionId: string }).sessionId;
    const result = broker.handlePoll({ sessionId: sid, completed: [] });
    expect(result.status).toBe(200);
    expect(result.longPoll).toBe(true);
  });

  it("poll rejects invalid sessionId", () => {
    connect();
    const result = broker.handlePoll({ sessionId: "bad-sid", completed: [] });
    expect(result.status).toBe(401);
  });

  it("poll rejects malformed body", () => {
    const result = broker.handlePoll({ invalid: true });
    expect(result.status).toBe(400);
  });

  it("events returns 204 on valid request", () => {
    const { body } = connect();
    const sid = (body as { sessionId: string }).sessionId;
    const result = broker.handleEvents({
      sessionId: sid,
      events: [{
        eventId: "evt-1",
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "bridge.ready",
        payload: {},
      }],
    });
    expect(result.status).toBe(204);
  });

  it("events rejects invalid sessionId", () => {
    connect();
    const result = broker.handleEvents({ sessionId: "bad", events: [] });
    expect(result.status).toBe(401);
  });

  it("call returns NOT_READY when no session", async () => {
    await expect(broker.call("map.get_state", {})).rejects.toMatchObject({
      code: "NOT_READY",
    });
  });

  it("call dispatches and resolves on completion", async () => {
    const { body } = connectReady();
    const sid = (body as { sessionId: string }).sessionId;

    const resultP = broker.call("map.get_state", {});

    const pollResult = broker.handlePoll({ sessionId: sid, completed: [] });
    expect(pollResult.status).toBe(200);
    const commands = (pollResult.body as { commands: Array<{ id: string; method: string }> }).commands;
    expect(commands).toHaveLength(1);
    expect(commands[0].method).toBe("map.get_state");

    broker.handlePoll({
      sessionId: sid,
      completed: [{ id: commands[0].id, ok: true, result: { center: { lat: 0, lng: 0 } } }],
    });

    const result = await resultP;
    expect(result).toEqual({ center: { lat: 0, lng: 0 } });
  });

  it("call rejects on error completion", async () => {
    const { body } = connectReady();
    const sid = (body as { sessionId: string }).sessionId;

    const resultP = broker.call("portal.get_details", { guid: "bad" });

    const pollResult = broker.handlePoll({ sessionId: sid, completed: [] });
    const commands = (pollResult.body as { commands: Array<{ id: string }> }).commands;

    broker.handlePoll({
      sessionId: sid,
      completed: [{
        id: commands[0].id,
        ok: false,
        error: { code: "NOT_FOUND", message: "Portal not found", retryable: false },
      }],
    });

    await expect(resultP).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("getConnectionStatus returns disconnected when no session", async () => {
    const status = await broker.getConnectionStatus();
    expect(status.connected).toBe(false);
    expect(status.sessionId).toBeNull();
  });

  it("getConnectionStatus returns connected after connect", async () => {
    connect();
    const status = await broker.getConnectionStatus();
    expect(status.connected).toBe(true);
    expect(status.sessionId).toBeTruthy();
    expect(status.tabId).toBe("test-tab-1");
  });

  it("getRecentEvents returns pushed events", async () => {
    const { body } = connect();
    const sid = (body as { sessionId: string }).sessionId;
    broker.handleEvents({
      sessionId: sid,
      events: [
        { eventId: "e1", sequence: 1, occurredAt: new Date().toISOString(), type: "map.changed", payload: {} },
        { eventId: "e2", sequence: 2, occurredAt: new Date().toISOString(), type: "entities.changed", payload: {} },
      ],
    });
    const events = await broker.getRecentEvents();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("map.changed");
  });

  it("event ring caps at 1000", async () => {
    const { body } = connect();
    const sid = (body as { sessionId: string }).sessionId;
    const events = Array.from({ length: 1005 }, (_, i) => ({
      eventId: `e${i}`,
      sequence: i,
      occurredAt: new Date().toISOString(),
      type: "map.changed" as const,
      payload: {},
    }));
    broker.handleEvents({ sessionId: sid, events });
    const recent = await broker.getRecentEvents(2000);
    expect(recent).toHaveLength(1000);
    expect(recent[0].eventId).toBe("e5");
  });

  it("destroySession rejects all pending commands", async () => {
    connectReady();
    const p1 = broker.call("map.get_state", {});
    const p2 = broker.call("portal.get_details", { guid: "x" });
    broker.destroySession();
    await expect(p1).rejects.toMatchObject({ code: "NOT_READY" });
    await expect(p2).rejects.toMatchObject({ code: "NOT_READY" });
  });

  it("hasSession tracks session lifecycle", () => {
    expect(broker.hasSession()).toBe(false);
    connect();
    expect(broker.hasSession()).toBe(true);
    broker.destroySession();
    expect(broker.hasSession()).toBe(false);
  });

  it("command IDs are monotonic decimal strings", () => {
    const { body } = connectReady();
    const sid = (body as { sessionId: string }).sessionId;

    broker.call("map.get_state", {});
    broker.call("map.get_state", {});
    broker.call("map.get_state", {});

    const pollResult = broker.handlePoll({ sessionId: sid, completed: [] });
    const commands = (pollResult.body as { commands: Array<{ id: string }> }).commands;
    expect(commands).toHaveLength(3);
    expect(commands[0].id).toBe("1");
    expect(commands[1].id).toBe("2");
    expect(commands[2].id).toBe("3");
  });

  it("aborted command is rejected with CANCELLED", async () => {
    connectReady();
    const ac = new AbortController();
    const p = broker.call("map.get_state", {}, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("handleEvents marks bridge.ready", async () => {
    const { body } = connect();
    const sid = (body as { sessionId: string }).sessionId;
    broker.handleEvents({
      sessionId: sid,
      events: [{
        eventId: "ready-1",
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "bridge.ready",
        payload: {},
      }],
    });
    const events = await broker.getRecentEvents();
    expect(events.some((e) => e.type === "bridge.ready")).toBe(true);
  });

  it("successful map.get_state completion marks bridge ready", async () => {
    const { body } = connect();
    const sid = (body as { sessionId: string }).sessionId;

    // map.get_state is exempt from ready gate
    const statePromise = broker.call("map.get_state", {});

    // Poll dispatches the queued command
    const poll1 = broker.handlePoll({ sessionId: sid, completed: [] });
    const stateId = (poll1.body as { commands: Array<{ id: string }> }).commands[0].id;

    // Complete map.get_state
    broker.handlePoll({
      sessionId: sid,
      completed: [{ id: stateId, ok: true, result: { center: { lat: 0, lng: 0 }, zoom: 1, bounds: { south: 0, west: 0, north: 1, east: 1 }, selectedPortalGuid: null, dataStatus: { short: "ok" } } }],
    });
    await expect(statePromise).resolves.toBeDefined();

    // Gate lifted — set_view should not be rejected with NOT_READY
    const setPromise = broker.call("map.set_view", { lat: 1, lng: 1 });
    const poll2 = broker.handlePoll({ sessionId: sid, completed: [] });
    const setId = (poll2.body as { commands: Array<{ id: string }> }).commands[0].id;
    broker.handlePoll({
      sessionId: sid,
      completed: [{ id: setId, ok: true, result: { center: { lat: 1, lng: 1 }, zoom: 1, bounds: { south: 0, west: 0, north: 2, east: 2 }, selectedPortalGuid: null, dataStatus: { short: "ok" } } }],
    });
    await expect(setPromise).resolves.toBeDefined();
  });
});

// ─── HTTP helpers ──────────────────────────────────────────

function makeReq(port: number, token: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    const r = httpRequest({
      hostname: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...extraHeaders,
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const rawHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined) rawHeaders[k] = Array.isArray(v) ? v.join(",") : String(v);
        }
        resolve({
          status: res.statusCode ?? 0,
          headers: rawHeaders,
          body: Buffer.concat(chunks).toString("utf-8"),
        });
      });
    });
    r.on("error", reject);
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}

function makeGetReq(port: number, token: string, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const r = httpRequest({
      hostname: "127.0.0.1",
      port,
      path,
      method: "GET",
      headers: {},
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") }));
    });
    r.on("error", reject);
    r.end();
  });
}

// ─── HTTP Server ───────────────────────────────────────────

describe("HTTP bridge server", () => {
  let server: BridgeServerHandle;
  let broker: InstanceType<typeof BridgeBroker>;
  let tempDir: string;
  const TOKEN = "test-bridge-token";

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "iitc-mcp-bridge-"));
    process.env.IITC_MCP_TOKEN = TOKEN;
    setConfigDir(tempDir);
    broker = new BridgeBroker();
    server = await startServer(broker, { port: 0 });
  });

  afterEach(async () => {
    broker.destroySession();
    await server.close();
    delete process.env.IITC_MCP_TOKEN;
    rmSync(tempDir, { recursive: true, force: true });
  });

  const validConnect = {
    protocolVersion: 1,
    pluginVersion: "1.0.0",
    iitcVersion: "0.40.0",
    tabId: "http-tab-1",
    capabilities: ["map"],
  };

  it("rejects GET with 405", async () => {
    const res = await makeGetReq(server.port, TOKEN, "/bridge/v1/connect");
    expect(res.status).toBe(405);
  });

  it("returns 404 for unknown path", async () => {
    const res = await makeReq(server.port, TOKEN, "/bridge/v1/unknown");
    expect(res.status).toBe(404);
  });

  it("connect returns 200 with session info", async () => {
    const res = await makeReq(server.port, TOKEN, "/bridge/v1/connect", validConnect);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sessionId).toBeTruthy();
    expect(body.leaseMs).toBe(45_000);
    expect(body.heartbeatMs).toBe(15_000);
    expect(body.maxBodyBytes).toBe(1_048_576);
  });

  it("connect rejects invalid body with 400", async () => {
    const res = await makeReq(server.port, TOKEN, "/bridge/v1/connect", { invalid: true });
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("INVALID_ARGUMENT");
  });

  it("events returns 204 with empty body and Cache-Control", async () => {
    const connectRes = await makeReq(server.port, TOKEN, "/bridge/v1/connect", validConnect);
    const sid = JSON.parse(connectRes.body).sessionId;
    const res = await makeReq(server.port, TOKEN, "/bridge/v1/events", {
      sessionId: sid,
      events: [{
        eventId: "evt-1",
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "bridge.ready",
        payload: {},
      }],
    });
    expect(res.status).toBe(204);
    expect(res.body).toBe("");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("events invalid body returns JSON error", async () => {
    const connectRes = await makeReq(server.port, TOKEN, "/bridge/v1/connect", validConnect);
    const sid = JSON.parse(connectRes.body).sessionId;
    const res = await makeReq(server.port, TOKEN, "/bridge/v1/events", { sessionId: sid, events: "not-an-array" });
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("INVALID_ARGUMENT");
  });

  it("all JSON responses have Cache-Control: no-store", async () => {
    const res = await makeReq(server.port, TOKEN, "/bridge/v1/connect", validConnect);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("connect with session conflict returns 409", async () => {
    await makeReq(server.port, TOKEN, "/bridge/v1/connect", validConnect);
    const res = await makeReq(server.port, TOKEN, "/bridge/v1/connect", { ...validConnect, tabId: "other-tab" });
    expect(res.status).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("SESSION_CONFLICT");
  });

  it("poll with pending commands returns immediately", async () => {
    const connectRes = await makeReq(server.port, TOKEN, "/bridge/v1/connect", validConnect);
    const sid = JSON.parse(connectRes.body).sessionId;

    const cmdP = broker.call("map.get_state", {});

    const pollRes = await makeReq(server.port, TOKEN, "/bridge/v1/poll", { sessionId: sid, completed: [] });
    expect(pollRes.status).toBe(200);
    const body = JSON.parse(pollRes.body);
    expect(body.commands).toHaveLength(1);
    expect(body.commands[0].method).toBe("map.get_state");

    broker.destroySession();
    await cmdP.catch(() => {});
  });

  it("poll rejects invalid sessionId", async () => {
    await makeReq(server.port, TOKEN, "/bridge/v1/connect", validConnect);
    const res = await makeReq(server.port, TOKEN, "/bridge/v1/poll", { sessionId: "bad-sid", completed: [] });
    expect(res.status).toBe(401);
  });

  it("rejects body over 1 MiB", async () => {
    const bigBody = { data: "x".repeat(1_048_577) };
    const res = await makeReq(server.port, TOKEN, "/bridge/v1/connect", bigBody);
    expect(res.status).toBe(413);
  });

  it("rejects non-loopback Host header", async () => {
    const res = await makeReq(server.port, TOKEN, "/bridge/v1/connect", validConnect, { Host: "evil.com:27342" });
    expect(res.status).toBe(400);
  });
});

// ─── Combined: broker + HTTP round-trip ────────────────────

describe("broker + HTTP round-trip", () => {
  let server: BridgeServerHandle;
  let broker: InstanceType<typeof BridgeBroker>;
  let tempDir: string;
  const TOKEN = "roundtrip-token";

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "iitc-mcp-rt-"));
    process.env.IITC_MCP_TOKEN = TOKEN;
    setConfigDir(tempDir);
    broker = new BridgeBroker();
    server = await startServer(broker, { port: 0 });
  });

  afterEach(async () => {
    broker.destroySession();
    await server.close();
    delete process.env.IITC_MCP_TOKEN;
    rmSync(tempDir, { recursive: true, force: true });
  });

  function post(path: string, body?: unknown): Promise<{ status: number; body: string }> {
    return makeReq(server.port, TOKEN, path, body);
  }

  it("full round-trip: connect → enqueue → poll → complete → resolve", async () => {
    // 1. Connect
    const connectRes = await post("/bridge/v1/connect", {
      protocolVersion: 1,
      pluginVersion: "1.0.0",
      iitcVersion: "0.40.0",
      tabId: "rt-tab-1",
      capabilities: ["map"],
    });
    expect(connectRes.status).toBe(200);
    const { sessionId } = JSON.parse(connectRes.body) as { sessionId: string };

    // 2. Enqueue command from MCP side
    const cmdP = broker.call("map.get_state", {});

    // 3. IITC side polls — gets the command
    const pollRes = await post("/bridge/v1/poll", { sessionId, completed: [] });
    expect(pollRes.status).toBe(200);
    const { commands } = JSON.parse(pollRes.body) as { commands: Array<{ id: string; method: string }> };
    expect(commands).toHaveLength(1);
    expect(commands[0].method).toBe("map.get_state");

    // 4. IITC side sends completion via broker directly (avoids 25s long-poll)
    broker.handlePoll({
      sessionId,
      completed: [{ id: commands[0].id, ok: true, result: { center: { lat: 51.5, lng: -0.1 }, zoom: 14 } }],
    });

    // 5. MCP side gets the result
    const result = await cmdP;
    expect(result).toEqual({ center: { lat: 51.5, lng: -0.1 }, zoom: 14 });
  });

  it("second tab gets 409", async () => {
    await post("/bridge/v1/connect", {
      protocolVersion: 1,
      pluginVersion: "1.0.0",
      iitcVersion: "0.40.0",
      tabId: "tab-1",
      capabilities: [],
    });
    const res = await post("/bridge/v1/connect", {
      protocolVersion: 1,
      pluginVersion: "1.0.0",
      iitcVersion: "0.40.0",
      tabId: "tab-2",
      capabilities: [],
    });
    expect(res.status).toBe(409);
  });

  it("events endpoint returns 204", async () => {
    const connectRes = await post("/bridge/v1/connect", {
      protocolVersion: 1,
      pluginVersion: "1.0.0",
      iitcVersion: "0.40.0",
      tabId: "evt-tab",
      capabilities: [],
    });
    const { sessionId } = JSON.parse(connectRes.body) as { sessionId: string };
    const res = await post("/bridge/v1/events", {
      sessionId,
      events: [{
        eventId: "test-evt",
        sequence: 1,
        occurredAt: new Date().toISOString(),
        type: "map.changed",
        payload: {},
      }],
    });
    expect(res.status).toBe(204);
    expect(res.body).toBe("");
  });

  it("token rotate revokes session", async () => {
    const connectRes = await post("/bridge/v1/connect", {
      protocolVersion: 1,
      pluginVersion: "1.0.0",
      iitcVersion: "0.40.0",
      tabId: "revoke-tab",
      capabilities: [],
    });
    const { sessionId } = JSON.parse(connectRes.body) as { sessionId: string };
    expect(broker.hasSession()).toBe(true);

    broker.revokeSession();
    expect(broker.hasSession()).toBe(false);

    const pollRes = await post("/bridge/v1/poll", { sessionId, completed: [] });
    expect(pollRes.status).toBe(401);
  });
});
