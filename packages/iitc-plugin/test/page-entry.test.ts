import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

interface ListenerEntry {
  type: string;
  listener: (e: Event) => void;
}

function createFakeEnv() {
  const docListeners: ListenerEntry[] = [];
  const winListeners: ListenerEntry[] = [];
  const iitcHooks = new Map<string, Set<(...args: unknown[]) => void>>();
  const mapHandlers = new Map<string, Set<() => void>>();
  const dispatchedEvents: Array<{ type: string; detail: unknown }> = [];

  const mockDocument = {
    addEventListener(type: string, listener: (e: Event) => void) {
      docListeners.push({ type, listener });
    },
    removeEventListener(type: string, listener: (e: Event) => void) {
      const idx = docListeners.findIndex((l) => l.type === type && l.listener === listener);
      if (idx !== -1) docListeners.splice(idx, 1);
    },
    dispatchEvent(event: Event) {
      const ce = event as CustomEvent;
      dispatchedEvents.push({ type: ce.type, detail: ce.detail });
      for (const l of [...docListeners]) {
        if (l.type === ce.type) l.listener(ce);
      }
      return true;
    },
    getElementById: () => null,
    createElement: () => ({
      id: "",
      textContent: "",
      title: "",
      style: { setProperty: vi.fn() },
      addEventListener: vi.fn(),
    }),
  };

  const mockWindow: Record<string, unknown> = {
    iitcLoaded: true,
    plugin: {},
    map: {
      on: vi.fn((event: string, handler: () => void) => {
        if (!mapHandlers.has(event)) mapHandlers.set(event, new Set());
        mapHandlers.get(event)!.add(handler);
      }),
      off: vi.fn((event: string, handler: () => void) => {
        mapHandlers.get(event)?.delete(handler);
      }),
    },
    addHook: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!iitcHooks.has(event)) iitcHooks.set(event, new Set());
      iitcHooks.get(event)!.add(handler);
    }),
    removeHook: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      iitcHooks.get(event)?.delete(handler);
    }),
    addEventListener(type: string, listener: (e: Event) => void) {
      winListeners.push({ type, listener });
    },
    removeEventListener(type: string, listener: (e: Event) => void) {
      const idx = winListeners.findIndex((l) => l.type === type && l.listener === listener);
      if (idx !== -1) winListeners.splice(idx, 1);
    },
  };

  const totalHookCount = () => {
    let n = 0;
    for (const set of iitcHooks.values()) n += set.size;
    for (const set of mapHandlers.values()) n += set.size;
    return n;
  };

  return { mockDocument, mockWindow, docListeners, winListeners, iitcHooks, mapHandlers, dispatchedEvents, totalHookCount };
}

describe("page-entry hook gating & zero idle overhead", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("registers IITC/Leaflet hooks only while connected and unregisters when disconnected", async () => {
    const env = createFakeEnv();
    vi.stubGlobal("document", env.mockDocument);
    vi.stubGlobal("window", env.mockWindow);

    await import("../src/page-entry.js");
    const pageMain = env.mockWindow.iitcMcpPageMain as (channel: string) => void;
    const cleanup = env.mockWindow.iitcMcpCleanup as () => void;

    const channel = "ch-gate-test";
    pageMain(channel);

    // Not connected yet: 0 IITC/Leaflet hooks and 0 periodic timers
    expect(env.totalHookCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    // Bridge connects -> all 9 hooks (1 Leaflet moveend + 8 IITC hooks) become active
    env.mockDocument.dispatchEvent(
      new CustomEvent(`iitc-mcp:${channel}:status`, { detail: { connected: true } }),
    );
    expect(env.totalHookCount()).toBe(9);

    // Trigger an entity hook to queue a debounced change
    for (const h of env.iitcHooks.get("portalAdded") ?? []) {
      h("portal-123");
    }
    expect(vi.getTimerCount()).toBe(1);

    // Bridge disconnects -> all 9 hooks unregistered & pending entity timer cleared
    env.mockDocument.dispatchEvent(
      new CustomEvent(`iitc-mcp:${channel}:status`, { detail: { connected: false } }),
    );
    expect(env.totalHookCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    // Heartbeat ping answered on demand without starting any interval
    env.dispatchedEvents.length = 0;
    env.mockDocument.dispatchEvent(
      new CustomEvent(`iitc-mcp:${channel}:heartbeat`, { detail: { dir: "ping", ts: Date.now() } }),
    );
    expect(env.dispatchedEvents.some((e) =>
      e.type === `iitc-mcp:${channel}:heartbeat` && (e.detail as { type?: string })?.type === "heartbeat",
    )).toBe(true);
    expect(vi.getTimerCount()).toBe(0);

    // Cleanup removes all document/window listeners
    cleanup();
    expect(env.docListeners).toHaveLength(0);
    expect(env.winListeners).toHaveLength(0);
  });
});
