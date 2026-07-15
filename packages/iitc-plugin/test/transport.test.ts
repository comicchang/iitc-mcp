/**
 * Transport 单元测试 — sandbox↔broker HTTP 通信
 * 使用 fake GM_xmlhttpRequest、fake timers、mock document
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  GMXmlHttpRequest,
  GMGetValue,
  GMSetValue,
  GMRegisterMenuCommand,
  GMResponse,
  GMDetails,
} from "../src/transport.js";
import { BridgeTransport, validateOrigin } from "../src/transport.js";

// ─── Mock Document ──────────────────────────────────────

interface ListenerEntry {
  type: string;
  listener: (e: Event) => void;
}

function createMockDocument() {
  const listeners: ListenerEntry[] = [];
  return {
    addEventListener(type: string, listener: (e: Event) => void) {
      listeners.push({ type, listener });
    },
    removeEventListener(type: string, listener: (e: Event) => void) {
      const idx = listeners.findIndex(
        (l) => l.type === type && l.listener === listener,
      );
      if (idx !== -1) listeners.splice(idx, 1);
    },
    dispatchEvent(event: Event) {
      const ce = event as CustomEvent;
      for (const l of [...listeners]) {
        if (l.type === ce.type) l.listener(ce);
      }
    },
    listeners,
  };
}

type MockDocument = {
  addEventListener: (type: string, listener: (e: Event) => void) => void;
  removeEventListener: (type: string, listener: (e: Event) => void) => void;
  dispatchEvent: (event: Event) => void;
  listeners: ListenerEntry[];
};

let activeMockDocument: MockDocument | undefined;

// ─── Helpers ────────────────────────────────────────────

const ORIGIN = "http://127.0.0.1:27342";
const TOKEN = "test-token-abc";
const CHANNEL = "test-channel-123";
const SESSION = "sess-xyz-789";

function makeGMResponse(overrides: Partial<GMResponse> = {}): GMResponse {
  return {
    status: 200,
    statusText: "OK",
    responseText: "{}",
    responseHeaders: "content-type: application/json",
    finalUrl: ORIGIN,
    ...overrides,
  };
}

type RequestHandler = (details: GMDetails) => void;

/** Sequential handler: each call pops the next handler */
function once(handlers: RequestHandler[]): GMXmlHttpRequest {
  let i = 0;
  return ((details: GMDetails) => {
    if (i < handlers.length) {
      handlers[i++](details);
    }
  }) as GMXmlHttpRequest;
}


/** Respond to a specific path with JSON */
function respondJson(path: string, data: unknown): RequestHandler {
  return (details) => {
    if (new URL(details.url).pathname === path) {
      details.onload(makeGMResponse({ responseText: JSON.stringify(data) }));
    } else {
      details.onerror(makeGMResponse({ status: 404, statusText: "Not Found" }));
    }
  };
}

/** Respond to a specific path with HTTP error */
function respondError(path: string, status: number): RequestHandler {
  return (details) => {
    if (new URL(details.url).pathname === path) {
      details.onerror(makeGMResponse({ status }));
    }
  };
}

/** Standard connect response payload */
const CONNECT_RESP = {
  sessionId: SESSION,
  leaseMs: 45000,
  heartbeatMs: 15000,
  maxBodyBytes: 1_048_576,
};

function makeMockDocument(): MockDocument {
  const mockDoc = createMockDocument();
  activeMockDocument = mockDoc;
  (globalThis as Record<string, unknown>).document = mockDoc;
  (globalThis as Record<string, unknown>).window = mockDoc;
  return mockDoc;
}

function makeTransport(
  gm: GMXmlHttpRequest,
  opts?: {
    onConnectionChange?: (c: boolean) => void;
    onPairRequired?: () => void;
  },
): BridgeTransport {
  return new BridgeTransport({
    origin: ORIGIN,
    token: TOKEN,
    channelId: CHANNEL,
    gmXmlHttpRequest: gm,
    gmGetValue: (() => "") as GMGetValue,
    gmSetValue: (() => {}) as GMSetValue,
    gmRegisterMenuCommand: (() => {}) as GMRegisterMenuCommand,
    onConnectionChange: opts?.onConnectionChange,
    onPairRequired: opts?.onPairRequired,
  });
}

/** Flush microtasks by advancing fake timers by 0ms, repeated n times */
async function flush(n = 3): Promise<void> {
  for (let i = 0; i < n; i++) {
    await vi.advanceTimersByTimeAsync(0);
  }
}
// ─── Tests ──────────────────────────────────────────────

describe("validateOrigin", () => {
  it("accepts http://127.0.0.1:27342", () => {
    expect(validateOrigin("http://127.0.0.1:27342")).toBe(true);
  });
  it("accepts port 1", () => {
    expect(validateOrigin("http://127.0.0.1:1")).toBe(true);
  });
  it("accepts port 65535", () => {
    expect(validateOrigin("http://127.0.0.1:65535")).toBe(true);
  });
  it("rejects https", () => {
    expect(validateOrigin("https://127.0.0.1:27342")).toBe(false);
  });
  it("rejects domain name", () => {
    expect(validateOrigin("http://localhost:27342")).toBe(false);
  });
  it("rejects trailing path", () => {
    expect(validateOrigin("http://127.0.0.1:27342/")).toBe(false);
  });
  it("rejects port 0", () => {
    expect(validateOrigin("http://127.0.0.1:0")).toBe(false);
  });
  it("rejects port 65536", () => {
    expect(validateOrigin("http://127.0.0.1:65536")).toBe(false);
  });
  it("rejects empty string", () => {
    expect(validateOrigin("")).toBe(false);
  });
});

describe("BridgeTransport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    activeMockDocument = undefined;
    makeMockDocument();
    vi.spyOn(crypto, "getRandomValues").mockImplementation(
      <T extends ArrayBufferView | null>(arr: T): T => {
        if (arr && "fill" in arr) (arr as Uint8Array).fill(0x42);
        return arr;
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>).document;
  });

  // ─── Connection ───────────────────────────────────────

  it("sends correct connect body without auth header", async () => {
    const captured: Array<{ headers: Record<string, string>; body: unknown }> = [];
    const gm = once([
      (d) => {
        const body = d.data ? JSON.parse(d.data) : undefined;
        captured.push({ headers: d.headers as Record<string, string>, body });
        d.onload(makeGMResponse({ responseText: JSON.stringify(CONNECT_RESP) }));
      },
      (d) => { d.onload(makeGMResponse({ responseText: '{"commands":[]}' })); },
    ]);
    const transport = makeTransport(gm);
    transport.start();
    await flush();

    expect(captured[0].headers.Authorization).toBeUndefined();
    expect(captured[0].headers["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(captured[0].body).toMatchObject({
      protocolVersion: 1,
      pluginVersion: "1.0.0",
      capabilities: expect.arrayContaining(["map", "entities", "portal", "self", "tracker"]),
    });
  });

  it("sends poll body with sessionId and completed[]", async () => {
    let pollBody: unknown;
    const gm = once([
      respondJson("/bridge/v1/connect", CONNECT_RESP),
      (d) => {
        if (d.data) pollBody = JSON.parse(d.data);
        d.onload(makeGMResponse({ responseText: '{"commands":[]}' }));
      },
    ]);
    const transport = makeTransport(gm);
    transport.start();
    await flush();

    expect(pollBody).toMatchObject({
      sessionId: SESSION,
      completed: [],
    });
  });

  it("becomes connected after successful connect+poll", async () => {
    const changeCb = vi.fn();
    const gm = once([
      respondJson("/bridge/v1/connect", CONNECT_RESP),
      respondJson("/bridge/v1/poll", { commands: [] }),
    ]);
    const transport = makeTransport(gm, { onConnectionChange: changeCb });
    transport.start();
    await flush();

    expect(transport.isConnected()).toBe(true);
    expect(transport.isRunning()).toBe(true);
    expect(changeCb).toHaveBeenCalledWith(true);
  });

  it("preserves page events received while connecting", async () => {
    let eventBody: unknown;
    const mockDocument = activeMockDocument;
    if (!mockDocument) throw new Error("Mock document was not initialized");
    const readyEvent = {
      eventId: "event-ready",
      sequence: 0,
      occurredAt: new Date().toISOString(),
      type: "bridge.ready",
      payload: {},
    };
    const gm = once([
      (details) => {
        mockDocument.dispatchEvent(
          new CustomEvent(`iitc-mcp:${CHANNEL}:event`, { detail: readyEvent }),
        );
        details.onload(makeGMResponse({ responseText: JSON.stringify(CONNECT_RESP) }));
      },
      respondJson("/bridge/v1/poll", { commands: [] }),
      (details) => {
        eventBody = details.data ? JSON.parse(details.data) : undefined;
        details.onload(makeGMResponse());
      },
    ]);
    const transport = makeTransport(gm);

    transport.start();
    await flush(6);

    expect(eventBody).toMatchObject({
      sessionId: SESSION,
      events: [readyEvent],
    });
  });

  // ─── Redirect / finalUrl ──────────────────────────────

  it("rejects response with mismatched finalUrl and retries", async () => {
    const gm: GMXmlHttpRequest = ((d: GMDetails) => {
      if (d.url.includes("/bridge/v1/connect")) {
        d.onload(
          makeGMResponse({
            responseText: JSON.stringify(CONNECT_RESP),
            finalUrl: "http://evil.com/bridge/v1/connect",
          }),
        );
      }
    }) as GMXmlHttpRequest;
    const transport = makeTransport(gm);
    transport.start();
    await flush();

    expect(transport.isConnected()).toBe(false);
  });

  // ─── Heartbeat ────────────────────────────────────────

  it("sends heartbeat ping every 5s and ACK resets counter", async () => {
    const heartbeatPings: Array<{ ts: number; dir: string }> = [];
    const gm = once([
      respondJson("/bridge/v1/connect", CONNECT_RESP),
      respondJson("/bridge/v1/poll", { commands: [] }),
    ]);
    const transport = makeTransport(gm);
    const mockDoc = (globalThis as unknown as { document: MockDocument })
      .document;
    // Listen for heartbeat pings and send ACK back (without dir:"ping")
    mockDoc.addEventListener(`iitc-mcp:${CHANNEL}:heartbeat`, (e: Event) => {
      const ce = e as CustomEvent;
      if (ce.detail?.dir === "ping") {
        heartbeatPings.push(ce.detail);
        // Send ACK back — same event name, but no dir:"ping"
        mockDoc.dispatchEvent(
          new CustomEvent(`iitc-mcp:${CHANNEL}:heartbeat`, {
            detail: { ack: true },
          }),
        );
      }
    });
    transport.start();
    await flush();

    // First heartbeat ping at 5s
    await vi.advanceTimersByTimeAsync(5000);
    expect(heartbeatPings).toHaveLength(1);
    expect(heartbeatPings[0].dir).toBe("ping");

    // Second heartbeat ping at 10s
    await vi.advanceTimersByTimeAsync(5000);
    expect(heartbeatPings).toHaveLength(2);
  });

  // ─── 3 consecutive missed heartbeats ──────────────────

  it("stops after 3 consecutive missed heartbeats", async () => {
    const changeCb = vi.fn();
    const gm = once([
      respondJson("/bridge/v1/connect", CONNECT_RESP),
      respondJson("/bridge/v1/poll", { commands: [] }),
      // no more handlers — next poll stays pending
    ]);
    const transport = makeTransport(gm, { onConnectionChange: changeCb });
    const mockDoc = (globalThis as unknown as { document: MockDocument })
      .document;
    // Listen for heartbeat pings but DON'T send ACK back
    mockDoc.addEventListener(`iitc-mcp:${CHANNEL}:heartbeat`, () => {
      // no ACK — missed heartbeats accumulate
    });
    transport.start();
    await flush();

    // At 5s: heartbeat interval fires, missedHeartbeats=1
    await vi.advanceTimersByTimeAsync(5000);
    expect(changeCb).not.toHaveBeenCalledWith(false);

    // At 15s total: missedHeartbeats=3 → failHeartbeat
    await vi.advanceTimersByTimeAsync(10000);
    expect(changeCb).toHaveBeenCalledWith(false);
    expect(transport.isRunning()).toBe(false);
  });

  // ─── 401 stops transport ──────────────────────────────

  it("401 stops transport", async () => {
    const gm = once([respondError("/bridge/v1/connect", 401)]);
    const transport = makeTransport(gm);
    transport.start();
    await flush();

    expect(transport.isRunning()).toBe(false);
    expect(transport.isConnected()).toBe(false);
  });

  // ─── Backoff after failed connect ─────────────────────

  it("uses backoff delay after failed connect", async () => {
    const requestUrls: string[] = [];
    const gm = once([
      (d) => {
        requestUrls.push(d.url);
        d.onerror(makeGMResponse({ status: 500, statusText: "Error" }));
      },
      (d) => {
        requestUrls.push(d.url);
        d.onload(
          makeGMResponse({ responseText: JSON.stringify(CONNECT_RESP) }),
        );
      },
      (d) => {
        d.onload(makeGMResponse({ responseText: '{"commands":[]}' }));
      },
    ]);
    const transport = makeTransport(gm);
    transport.start();
    await flush();

    expect(requestUrls).toHaveLength(1);

    // Advance past backoff (1s + jitter 0-1s ≤ 2s)
    await vi.advanceTimersByTimeAsync(2100);

    expect(requestUrls).toHaveLength(2);
    expect(requestUrls[0]).toContain("/bridge/v1/connect");
    expect(requestUrls[1]).toContain("/bridge/v1/connect");
  });

  it("409 resets session and retries with backoff", async () => {
    const changeCb = vi.fn();
    const connectBodies: unknown[] = [];
    const gm = once([
      (d) => { connectBodies.push(d.data ? JSON.parse(d.data) : undefined); d.onload(makeGMResponse({ responseText: JSON.stringify(CONNECT_RESP) })); },
      respondJson("/bridge/v1/poll", { commands: [] }),
      (d) => { d.onerror(makeGMResponse({ status: 409, statusText: "Conflict" })); },
      (d) => { connectBodies.push(d.data ? JSON.parse(d.data) : undefined); d.onload(makeGMResponse({ responseText: JSON.stringify({ sessionId: "sess-new-999", leaseMs: 45000, heartbeatMs: 15000, maxBodyBytes: 1_048_576 }) })); },
      respondJson("/bridge/v1/poll", { commands: [] }),
    ]);
    const transport = makeTransport(gm, { onConnectionChange: changeCb });
    transport.start();
    // Let connect+poll complete, then 409 fires on next poll
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
    expect(transport.isConnected()).toBe(false);
    // Advance past backoff
    await vi.advanceTimersByTimeAsync(2500);
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
    expect(transport.isConnected()).toBe(true);
    expect(connectBodies).toHaveLength(2);
  });

  it("dispatches received commands to page via CustomEvent", async () => {
    const dispatchedCmds: unknown[] = [];
    const gm = once([
      respondJson("/bridge/v1/connect", CONNECT_RESP),
      respondJson("/bridge/v1/poll", {
        commands: [{ id: "1", method: "map.get_state", params: {}, deadlineMs: Date.now() + 30000 }],
      }),
    ]);
    const transport = makeTransport(gm);
    const mockDoc = (globalThis as unknown as { document: MockDocument }).document;
    mockDoc.addEventListener(`iitc-mcp:${CHANNEL}:command`, (e: Event) => {
      dispatchedCmds.push((e as CustomEvent).detail);
    });
    transport.start();
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
    expect(dispatchedCmds).toHaveLength(1);
    expect(dispatchedCmds[0]).toMatchObject({ id: "1", method: "map.get_state" });
  });
  it("completion cache prevents duplicate command completion", async () => {
    const pollBodies: unknown[] = [];
    const mockDoc = (globalThis as unknown as { document: MockDocument }).document;
    let firstPoll = true;
    const gm = once([
      respondJson("/bridge/v1/connect", CONNECT_RESP),
      // First poll: dispatch completions AFTER pollOnce drains pendingCompletions.
      // The dispatch fires during onload (synchronous), which resolves as a microtask.
      // The while loop then calls pollOnce again, which picks up the dispatched completion.
      (d) => {
        if (d.data) pollBodies.push(JSON.parse(d.data));
        if (firstPoll) {
          firstPoll = false;
          d.onload(makeGMResponse({ responseText: '{"commands":[]}' }));
          const completion = { id: "cmd-42", ok: true as const, result: { accepted: true } };
          mockDoc.dispatchEvent(new CustomEvent(`iitc-mcp:${CHANNEL}:completion`, { detail: completion }));
          mockDoc.dispatchEvent(new CustomEvent(`iitc-mcp:${CHANNEL}:completion`, { detail: completion }));
        } else {
          d.onload(makeGMResponse({ responseText: '{"commands":[]}' }));
        }
      },
      // Second poll: captures the completions
      (d) => { if (d.data) pollBodies.push(JSON.parse(d.data)); d.onload(makeGMResponse({ responseText: '{"commands":[]}' })); },
    ]);
    const transport = makeTransport(gm);
    transport.start();
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);

    const pollWithCompletions = pollBodies.find((b: unknown) => {
      const body = b as { completed?: unknown[] };
      return body.completed && body.completed.length > 0;
    });
    expect(pollWithCompletions).toBeDefined();
    const body = pollWithCompletions as { completed: unknown[] };
    expect(body.completed).toHaveLength(1);
    expect(body.completed[0]).toMatchObject({ id: "cmd-42", ok: true });
  });

  // ─── 512 KiB command limit ────────────────────────────

  it("returns INTERNAL error for command exceeding 512 KiB", async () => {
    const completions: unknown[] = [];
    // The big command is returned by broker via poll response
    const bigCmd = {
      id: "big-1",
      method: "comm.send",
      params: { message: "x".repeat(512 * 1024) },
      deadlineMs: Date.now() + 30000,
    };
    const gm = once([
      respondJson("/bridge/v1/connect", CONNECT_RESP),
      // First poll returns the big command
      respondJson("/bridge/v1/poll", { commands: [bigCmd] }),
      // Second poll captures the error completion
      (d) => {
        const body = d.data ? JSON.parse(d.data) : undefined;
        if (body?.completed) completions.push(...body.completed);
        d.onload(makeGMResponse({ responseText: '{"commands":[]}' }));
      },
    ]);
    const transport = makeTransport(gm);
    transport.start();
    await flush();

    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({
      id: "big-1",
      ok: false,
      error: {
        code: "INTERNAL",
        details: { reason: "EVENT_ITEM_TOO_LARGE" },
      },
    });
  });
});
