/**
 * Page Adapter 单元测试
 * 使用 fake IITC/Leaflet globals，无真实网络访问
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  BridgeCommand,
  BridgeCompletion,
  BridgeError,
  MapState,
  PortalSummary,
  PortalDetails,
  LinkSummary,
  FieldSummary,
  SearchResult,
  CommMessage,
} from "@iitc-mcp/protocol";
import { PageAdapter } from "../src/page-adapter.js";

// ─── Fake IITC Globals ─────────────────────────────────

function makeBounds(
  south: number, west: number, north: number, east: number,
) {
  return {
    getSouth: () => south,
    getWest: () => west,
    getNorth: () => north,
    getEast: () => east,
    contains: (ll: { lat: number; lng: number }) =>
      ll.lat >= south && ll.lat <= north && ll.lng >= west && ll.lng <= east,
    intersects: () => true,
  };
}

function makeFakeMap(overrides: Record<string, unknown> = {}) {
  let moveendHandler: (() => void) | null = null;
  const map = {
    getCenter: () => ({ lat: 51.5074, lng: -0.1278 }),
    getZoom: () => 14,
    getMinZoom: () => 1,
    getMaxZoom: () => 21,
    getBounds: () => makeBounds(51.49, -0.15, 51.52, -0.1),
    setView: vi.fn(),
    fitBounds: vi.fn(),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === "moveend") moveendHandler = handler;
    }),
    off: vi.fn((event: string, handler: () => void) => {
      if (event === "moveend" && moveendHandler === handler) moveendHandler = null;
    }),
    _triggerMoveEnd: () => { moveendHandler?.(); },
    ...overrides,
  };
  return map;
}

function makeFakePortal(guid: string, data: Record<string, unknown> = {}) {
  const d = { team: "R", latE6: 51507400, lngE6: -127800, ...data };
  return {
    options: { guid, data: d },
    getLatLng: () => ({ lat: d.latE6 / 1e6, lng: d.lngE6 / 1e6 }),
  };
}

function makeFakeLink(guid: string, data: Record<string, unknown> = {}) {
  return {
    options: {
      guid,
      data: {
        team: "R",
        oGuid: "portal-a", oLatE6: 51507400, oLngE6: -127800,
        dGuid: "portal-b", dLatE6: 51515000, dLngE6: -140000,
        ...data,
      },
    },
  };
}

function makeFakeField(guid: string, data: Record<string, unknown> = {}) {
  return {
    options: {
      guid,
      data: {
        team: "R",
        points: [
          { guid: "p-a", latE6: 51507400, lngE6: -127800 },
          { guid: "p-b", latE6: 51515000, lngE6: -140000 },
          { guid: "p-c", latE6: 51500000, lngE6: -110000 },
        ],
        ...data,
      },
    },
    getBounds: () => makeBounds(51.49, -0.15, 51.52, -0.1),
  };
}

function makeFakeWindow(overrides: Record<string, unknown> = {}) {
  return {
    map: makeFakeMap(),
    portals: {} as Record<string, ReturnType<typeof makeFakePortal>>,
    links: {} as Record<string, ReturnType<typeof makeFakeLink>>,
    fields: {} as Record<string, ReturnType<typeof makeFakeField>>,
    portalDetail: {
      get: vi.fn().mockReturnValue({}),
      isFresh: vi.fn().mockReturnValue(true),
      request: vi.fn().mockResolvedValue({}),
    },
    getPortalLinks: vi.fn().mockReturnValue({ in: ["link-1"], out: ["link-2"] }),
    getPortalFields: vi.fn().mockReturnValue(["field-1"]),
    selectedPortal: null as string | null,
    addHook: vi.fn(),
    removeHook: vi.fn(),
    runHooks: vi.fn(),
    postAjax: vi.fn(),
    renderPortalDetails: vi.fn(),
    ...overrides,
  };
}

// ─── Helpers ───────────────────────────────────────────

function cmd(method: string, params: unknown = {}): BridgeCommand {
  return {
    id: `cmd-${Math.random().toString(36).slice(2, 8)}`,
    method: method as BridgeCommand["method"],
    params,
    deadlineMs: Date.now() + 30_000,
  };
}

function ok(c: BridgeCompletion): c is { id: string; ok: true; result: unknown } {
  return c.ok === true;
}

function fail(c: BridgeCompletion): c is { id: string; ok: false; error: BridgeError } {
  return c.ok === false;
}

// ─── Tests ─────────────────────────────────────────────

describe("PageAdapter", () => {
  let adapter: PageAdapter;
  let fw: ReturnType<typeof makeFakeWindow>;

  beforeEach(() => {
    fw = makeFakeWindow();
    vi.stubGlobal("window", fw);
    adapter = new PageAdapter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ─── map.get_state ─────────────────────────────────

  describe("map.get_state", () => {
    it("returns current map state DTO", async () => {
      const r = await adapter.handleCommand(cmd("map.get_state"));
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      const s = r.result as MapState;
      expect(s.center.lat).toBeCloseTo(51.5074);
      expect(s.center.lng).toBeCloseTo(-0.1278);
      expect(s.zoom).toBe(14);
      expect(s.bounds.south).toBeCloseTo(51.49);
      expect(s.selectedPortalGuid).toBeNull();
      expect(s.dataStatus.short).toBe("ok");
    });

    it("reflects selected portal", async () => {
      fw.selectedPortal = "portal-abc";
      const r = await adapter.handleCommand(cmd("map.get_state"));
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      expect((r.result as MapState).selectedPortalGuid).toBe("portal-abc");
    });
  });

  // ─── map.set_view ──────────────────────────────────

  describe("map.set_view", () => {
    it("sets view and waits for moveend", async () => {
      const p = adapter.handleCommand(cmd("map.set_view", { lat: 48.8566, lng: 2.3522, zoom: 12 }));
      fw.map._triggerMoveEnd();
      const r = await p;
      expect(ok(r)).toBe(true);
      expect(fw.map.setView).toHaveBeenCalledWith([48.8566, 2.3522], 12);
    });

    it("returns immediately if center+zoom match", async () => {
      const r = await adapter.handleCommand(
        cmd("map.set_view", { lat: 51.5074, lng: -0.1278, zoom: 14 }),
      );
      expect(ok(r)).toBe(true);
      expect(fw.map.setView).not.toHaveBeenCalled();
    });

    it("rejects zoom out of range", async () => {
      const r = await adapter.handleCommand(cmd("map.set_view", { lat: 0, lng: 0, zoom: 0 }));
      expect(fail(r)).toBe(true);
      if (!fail(r)) return;
      expect(r.error.code).toBe("INVALID_ARGUMENT");
    });

    it("times out if moveend never fires", async () => {
      const p = adapter.handleCommand(cmd("map.set_view", { lat: 40, lng: -3, zoom: 10 }));
      await vi.advanceTimersByTimeAsync(5100);
      const r = await p;
      expect(fail(r)).toBe(true);
      if (!fail(r)) return;
      expect(r.error.code).toBe("TIMEOUT");
    });
  });

  // ─── map.fit_bounds ────────────────────────────────

  describe("map.fit_bounds", () => {
    it("fits bounds and waits for moveend", async () => {
      const p = adapter.handleCommand(
        cmd("map.fit_bounds", { south: 48.8, west: 2.3, north: 48.9, east: 2.4 }),
      );
      fw.map._triggerMoveEnd();
      const r = await p;
      expect(ok(r)).toBe(true);
      expect(fw.map.fitBounds).toHaveBeenCalled();
    });
  });

  // ─── entities.list_portals ─────────────────────────

  describe("entities.list_portals", () => {
    it("returns portals sorted by GUID, excludes out-of-viewport", async () => {
      fw.portals = {
        "portal-b": makeFakePortal("portal-b"),
        "portal-a": makeFakePortal("portal-a"),
        "portal-out": makeFakePortal("portal-out", { latE6: 40000000, lngE6: -300000 }),
      };
      const r = await adapter.handleCommand(cmd("entities.list_portals", { scope: "viewport" }));
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      const paged = r.result as { items: PortalSummary[]; complete: boolean; reason: string };
      expect(paged.complete).toBe(false);
      expect(paged.reason).toBe("IITC_VIEWPORT_CACHE");
      expect(paged.items.length).toBe(2);
      expect(paged.items[0].guid).toBe("portal-a");
      expect(paged.items[1].guid).toBe("portal-b");
    });

    it("filters by team", async () => {
      fw.portals = {
        "p-r": makeFakePortal("p-r", { team: "R" }),
        "p-e": makeFakePortal("p-e", { team: "E" }),
      };
      const r = await adapter.handleCommand(
        cmd("entities.list_portals", { scope: "viewport", team: "E" }),
      );
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      expect((r.result as { items: PortalSummary[] }).items.length).toBe(1);
      expect((r.result as { items: PortalSummary[] }).items[0].team).toBe("E");
    });

    it("uses detailLevel core for portals without title", async () => {
      fw.portals = {
        "p-core": makeFakePortal("p-core"),
        "p-sum": makeFakePortal("p-sum", { title: "Big Ben" }),
      };
      const r = await adapter.handleCommand(cmd("entities.list_portals", { scope: "viewport" }));
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      const items = (r.result as { items: PortalSummary[] }).items;
      expect(items.find((p) => p.guid === "p-core")?.detailLevel).toBe("core");
      expect(items.find((p) => p.guid === "p-sum")?.detailLevel).toBe("summary");
    });

    it("paginates with cursor", async () => {
      fw.portals = {
        "p-a": makeFakePortal("p-a"),
        "p-b": makeFakePortal("p-b"),
        "p-c": makeFakePortal("p-c"),
      };
      const r1 = await adapter.handleCommand(
        cmd("entities.list_portals", { scope: "viewport", limit: 2 }),
      );
      expect(ok(r1)).toBe(true);
      if (!ok(r1)) return;
      const p1 = r1.result as { items: PortalSummary[]; nextCursor?: string };
      expect(p1.items.length).toBe(2);
      expect(p1.nextCursor).toBeDefined();

      const r2 = await adapter.handleCommand(
        cmd("entities.list_portals", { scope: "viewport", limit: 2, cursor: p1.nextCursor }),
      );
      expect(ok(r2)).toBe(true);
      if (!ok(r2)) return;
      const p2 = r2.result as { items: PortalSummary[]; nextCursor?: string };
      expect(p2.items.length).toBe(1);
      expect(p2.nextCursor).toBeUndefined();
    });

    it("rejects expired cursor", async () => {
      fw.portals = { "p-a": makeFakePortal("p-a"), "p-b": makeFakePortal("p-b") };
      const r1 = await adapter.handleCommand(
        cmd("entities.list_portals", { scope: "viewport", limit: 1 }),
      );
      expect(ok(r1)).toBe(true);
      if (!ok(r1)) return;
      const p1 = r1.result as { nextCursor?: string };
      expect(p1.nextCursor).toBeDefined();

      await vi.advanceTimersByTimeAsync(31_000);

      const r2 = await adapter.handleCommand(
        cmd("entities.list_portals", { scope: "viewport", cursor: p1.nextCursor }),
      );
      expect(fail(r2)).toBe(true);
      if (!fail(r2)) return;
      expect(r2.error.code).toBe("INVALID_ARGUMENT");
    });

    it("returns empty for empty store", async () => {
      const r = await adapter.handleCommand(cmd("entities.list_portals", { scope: "viewport" }));
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      expect((r.result as { items: unknown[] }).items).toEqual([]);
    });
  });

  // ─── entities.list_links ───────────────────────────

  describe("entities.list_links", () => {
    it("returns links with correct DTO", async () => {
      fw.links = { "link-1": makeFakeLink("link-1") };
      const r = await adapter.handleCommand(cmd("entities.list_links", { scope: "viewport" }));
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      const items = (r.result as { items: LinkSummary[] }).items;
      expect(items.length).toBe(1);
      expect(items[0].guid).toBe("link-1");
      expect(items[0].team).toBe("R");
      expect(items[0].origin.guid).toBe("portal-a");
      expect(items[0].origin.lat).toBeCloseTo(51.5074);
    });
  });

  // ─── entities.list_fields ──────────────────────────

  describe("entities.list_fields", () => {
    it("returns fields with correct DTO", async () => {
      fw.fields = { "field-1": makeFakeField("field-1") };
      const r = await adapter.handleCommand(cmd("entities.list_fields", { scope: "viewport" }));
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      const items = (r.result as { items: FieldSummary[] }).items;
      expect(items.length).toBe(1);
      expect(items[0].guid).toBe("field-1");
      expect(items[0].team).toBe("R");
      expect(items[0].points.length).toBe(3);
    });
  });

  // ─── portal.get_details ────────────────────────────

  describe("portal.get_details", () => {
    it("returns detailed info with linkGuids/fieldGuids", async () => {
      fw.portals = {
        "p-1": makeFakePortal("p-1", {
          title: "Test Portal",
          image: "https://example.com/img.png",
          level: 7, health: 85, resCount: 8, owner: "PlayerOne",
          mods: [{ owner: "P1", name: "Force Amp", rarity: "RARE", stats: { XM: "1000" } }],
          resonators: [{ owner: "P1", level: 8, energy: 95 }],
        }),
      };
      fw.portalDetail.isFresh = vi.fn().mockReturnValue(true);
      fw.portalDetail.get = vi.fn().mockReturnValue({
        history: { visited: true, captured: true, scoutControlled: false },
      });

      const r = await adapter.handleCommand(cmd("portal.get_details", { guid: "p-1" }));
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      const d = r.result as PortalDetails;
      expect(d.guid).toBe("p-1");
      expect(d.detailLevel).toBe("detailed");
      expect(d.title).toBe("Test Portal");
      expect(d.level).toBe(7);
      expect(d.owner).toBe("PlayerOne");
      expect(d.mods?.length).toBe(1);
      expect(d.resonators?.length).toBe(1);
      expect(d.history?.visited).toBe(true);
      expect(d.linkGuids.in).toEqual(["link-1"]);
      expect(d.linkGuids.out).toEqual(["link-2"]);
      expect(d.fieldGuids).toEqual(["field-1"]);
    });

    it("requests detail when cache not fresh", async () => {
      fw.portals = { "p-1": makeFakePortal("p-1") };
      fw.portalDetail.isFresh = vi.fn().mockReturnValue(false);
      fw.portalDetail.request = vi.fn().mockResolvedValue({
        history: { visited: false, captured: false, scoutControlled: false },
      });
      const r = await adapter.handleCommand(cmd("portal.get_details", { guid: "p-1" }));
      expect(ok(r)).toBe(true);
      expect(fw.portalDetail.request).toHaveBeenCalledWith("p-1");
    });

    it("returns NOT_FOUND for missing portal", async () => {
      const r = await adapter.handleCommand(cmd("portal.get_details", { guid: "nonexistent" }));
      expect(fail(r)).toBe(true);
      if (!fail(r)) return;
      expect(r.error.code).toBe("NOT_FOUND");
    });

    it("returns UPSTREAM_ERROR when detail request fails", async () => {
      fw.portals = { "p-1": makeFakePortal("p-1") };
      fw.portalDetail.isFresh = vi.fn().mockReturnValue(false);
      fw.portalDetail.request = vi.fn().mockRejectedValue(new Error("network error"));
      const r = await adapter.handleCommand(cmd("portal.get_details", { guid: "p-1" }));
      expect(fail(r)).toBe(true);
      if (!fail(r)) return;
      expect(r.error.code).toBe("UPSTREAM_ERROR");
    });
  });

  // ─── portal.select ─────────────────────────────────

  describe("portal.select", () => {
    it("selects portal and waits for hook", async () => {
      fw.portals = { "p-1": makeFakePortal("p-1") };
      // Fire hook immediately on renderPortalDetails
      fw.renderPortalDetails = vi.fn().mockImplementation(() => {
        for (const [event, handler] of fw.addHook.mock.calls) {
          if (event === "portalSelected") (handler as (...a: unknown[]) => void)("p-1");
        }
      });

      const r = await adapter.handleCommand(cmd("portal.select", { guid: "p-1" }));
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      expect((r.result as { selectedPortalGuid: string }).selectedPortalGuid).toBe("p-1");
    });

    it("returns NOT_FOUND for missing portal", async () => {
      const r = await adapter.handleCommand(cmd("portal.select", { guid: "nonexistent" }));
      expect(fail(r)).toBe(true);
      if (!fail(r)) return;
      expect(r.error.code).toBe("NOT_FOUND");
    });
  });

  // ─── search.query ──────────────────────────────────

  describe("search.query", () => {
    it("returns results after quiet window", async () => {
      fw.IITC = {
        comm: { _channelsData: {}, requestChannel: vi.fn() },
        search: {
          doSearch: vi.fn(),
          lastSearch: { results: [{ title: "Big Ben", lat: 51.5007, lng: -0.1246, description: "London" }] },
        },
      };
      const p = adapter.handleCommand(cmd("search.query", { term: "Big Ben" }));
      await vi.advanceTimersByTimeAsync(700);
      const r = await p;
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      const sr = r.result as { items: SearchResult[]; complete: boolean };
      expect(sr.complete).toBe(true);
      expect(sr.items.length).toBe(1);
      expect(sr.items[0].title).toBe("Big Ben");
      expect(sr.items[0].position).toEqual({ lat: 51.5007, lng: -0.1246 });
    });

    it("skips results without lat/lng", async () => {
      fw.IITC = {
        comm: { _channelsData: {}, requestChannel: vi.fn() },
        search: {
          doSearch: vi.fn(),
          lastSearch: { results: [{ title: "No pos" }, { title: "Has pos", lat: 51.5, lng: -0.1 }] },
        },
      };
      const p = adapter.handleCommand(cmd("search.query", { term: "test" }));
      await vi.advanceTimersByTimeAsync(700);
      const r = await p;
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      const sr = r.result as { items: SearchResult[] };
      expect(sr.items.length).toBe(1);
      expect(sr.items[0].title).toBe("Has pos");
    });
  });

  // ─── comm.list ─────────────────────────────────────

  describe("comm.list", () => {
    it("returns parsed comm messages", async () => {
      fw.IITC = {
        search: { doSearch: vi.fn(), lastSearch: null },
        comm: {
          _channelsData: {
            all: {
              guids: ["msg-1"],
              data: {
                "msg-1": [
                  1720000000000, null, null, null,
                  {
                    time: 1720000000000,
                    msgToPlayer: true,
                    player: { name: "PlayerOne", team: "R" },
                    markup: [
                      { type: "SENDER", plain: "PlayerOne" },
                      { type: "TEXT", text: " Hello!" },
                      { type: "PORTAL", markup: { name: "Big Ben", latE6: 51500700, lngE6: -124600 } },
                    ],
                  },
                ],
              },
            },
          },
          requestChannel: vi.fn(),
        },
      };
      const r = await adapter.handleCommand(cmd("comm.list", { channel: "all" }));
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      const cr = r.result as { items: CommMessage[]; complete: boolean };
      expect(cr.complete).toBe(true);
      expect(cr.items.length).toBe(1);
      expect(cr.items[0].player.name).toBe("PlayerOne");
      expect(cr.items[0].text).toContain("Hello!");
      expect(cr.items[0].portals.length).toBe(1);
      expect(cr.items[0].portals[0].name).toBe("Big Ben");
    });

    it("returns empty for alerts channel with no data", async () => {
      fw.IITC = {
        search: { doSearch: vi.fn(), lastSearch: null },
        comm: { _channelsData: {}, requestChannel: vi.fn() },
      };
      const r = await adapter.handleCommand(cmd("comm.list", { channel: "alerts" }));
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      expect((r.result as { items: CommMessage[] }).items).toEqual([]);
    });

    it("applies limit", async () => {
      const guids: string[] = [];
      const data: Record<string, unknown[]> = {};
      for (let i = 0; i < 10; i++) {
        const g = `msg-${i}`;
        guids.push(g);
        data[g] = [
          1720000000000 + i, null, null, null,
          {
            time: 1720000000000 + i,
            msgToPlayer: true,
            player: { name: `P${i}`, team: "R" },
            markup: [{ type: "TEXT", text: `msg ${i}` }],
          },
        ];
      }
      fw.IITC = {
        search: { doSearch: vi.fn(), lastSearch: null },
        comm: { _channelsData: { all: { guids, data } }, requestChannel: vi.fn() },
      };
      const r = await adapter.handleCommand(cmd("comm.list", { channel: "all", limit: 3 }));
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      expect((r.result as { items: CommMessage[] }).items.length).toBe(3);
    });
  });

  // ─── comm.send ─────────────────────────────────────

  describe("comm.send", () => {
    it("sends message via postAjax", async () => {
      fw.postAjax.mockImplementation(
        (_a: string, _p: unknown, success: (d: unknown) => void) => { success({}); },
      );
      const r = await adapter.handleCommand(
        cmd("comm.send", { channel: "all", message: "Hello!" }),
      );
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      expect((r.result as { accepted: boolean }).accepted).toBe(true);
      expect(fw.postAjax).toHaveBeenCalledWith(
        "sendPlext",
        expect.objectContaining({ message: "Hello!", tab: "all" }),
        expect.any(Function),
        expect.any(Function),
      );
    });

    it("returns UPSTREAM_ERROR on response error", async () => {
      fw.postAjax.mockImplementation(
        (_a: string, _p: unknown, success: (d: unknown) => void) => {
          success({ error: "rate limited" });
        },
      );
      const r = await adapter.handleCommand(
        cmd("comm.send", { channel: "faction", message: "test" }),
      );
      expect(fail(r)).toBe(true);
      if (!fail(r)) return;
      expect(r.error.code).toBe("UPSTREAM_ERROR");
    });

    it("returns UPSTREAM_ERROR on HTTP failure", async () => {
      fw.postAjax.mockImplementation(
        (_a: string, _p: unknown, _s: unknown, error: (e: unknown) => void) => {
          error("500 Internal");
        },
      );
      const r = await adapter.handleCommand(
        cmd("comm.send", { channel: "all", message: "test" }),
      );
      expect(fail(r)).toBe(true);
      if (!fail(r)) return;
      expect(r.error.code).toBe("UPSTREAM_ERROR");
    });
  });

  // ─── redeem.submit ─────────────────────────────────

  describe("redeem.submit", () => {
    it("redeems passcode and returns rewards", async () => {
      fw.postAjax.mockImplementation(
        (_a: string, _p: unknown, success: (d: unknown) => void) => {
          success({ rewards: { xm: 1000, ap: 500 }, playerData: { verified_level: 16 } });
        },
      );
      const r = await adapter.handleCommand(
        cmd("redeem.submit", { passcode: "VALID-CODE-123" }),
      );
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      const rr = r.result as { rewards: { xm?: number; ap?: number }; playerData?: Record<string, unknown> };
      expect(rr.rewards.xm).toBe(1000);
      expect(rr.rewards.ap).toBe(500);
      expect(rr.playerData).toBeDefined();
      expect(fw.PLAYER).toEqual({ verified_level: 16 });
    });

    it("returns UPSTREAM_ERROR on response error", async () => {
      fw.postAjax.mockImplementation(
        (_a: string, _p: unknown, success: (d: unknown) => void) => {
          success({ error: "Invalid passcode" });
        },
      );
      const r = await adapter.handleCommand(cmd("redeem.submit", { passcode: "BAD-CODE" }));
      expect(fail(r)).toBe(true);
      if (!fail(r)) return;
      expect(r.error.code).toBe("UPSTREAM_ERROR");
    });
    it("marks 429 as retryable", async () => {
      // 429 goes through success callback (postAjax gets HTTP response body)
      fw.postAjax.mockImplementation(
        (_a: string, _p: unknown, success: (d: unknown) => void) => {
          success({ error: "rate limited", status: 429 });
        },
      );
      const r = await adapter.handleCommand(cmd("redeem.submit", { passcode: "CODE" }));
      expect(fail(r)).toBe(true);
      if (!fail(r)) return;
      expect(r.error.code).toBe("UPSTREAM_ERROR");
      expect(r.error.retryable).toBe(true);
    });

    it("returns UPSTREAM_ERROR on HTTP failure", async () => {
      fw.postAjax.mockImplementation(
        (_a: string, _p: unknown, _s: unknown, error: (e: unknown) => void) => {
          error("500 Server Error");
        },
      );
      const r = await adapter.handleCommand(cmd("redeem.submit", { passcode: "CODE" }));
      expect(fail(r)).toBe(true);
      if (!fail(r)) return;
      expect(r.error.code).toBe("UPSTREAM_ERROR");
    });
  });

  // ─── Error handling ────────────────────────────────

  describe("error handling", () => {
    it("returns INVALID_ARGUMENT for unknown method", async () => {
      const r = await adapter.handleCommand(cmd("unknown.method" as BridgeCommand["method"]));
      expect(fail(r)).toBe(true);
      if (!fail(r)) return;
      expect(r.error.code).toBe("INVALID_ARGUMENT");
    });

    it("wraps unexpected errors as INTERNAL", async () => {
      fw.map.getCenter = () => { throw new Error("crash"); };
      const r = await adapter.handleCommand(cmd("map.get_state"));
      expect(fail(r)).toBe(true);
      if (!fail(r)) return;
      expect(r.error.code).toBe("INTERNAL");
    });
  });

  // ─── Output safety ─────────────────────────────────

  describe("output safety", () => {
    it("map state is JSON-serializable", async () => {
      const r = await adapter.handleCommand(cmd("map.get_state"));
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      expect(() => JSON.parse(JSON.stringify(r.result))).not.toThrow();
    });

    it("portal list is JSON-serializable", async () => {
      fw.portals = { "p-1": makeFakePortal("p-1", { title: "Test" }) };
      const r = await adapter.handleCommand(cmd("entities.list_portals", { scope: "viewport" }));
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      expect(() => JSON.parse(JSON.stringify(r.result))).not.toThrow();
    });

    it("portal details are JSON-serializable", async () => {
      fw.portals = { "p-1": makeFakePortal("p-1", { title: "Test" }) };
      fw.portalDetail.isFresh = vi.fn().mockReturnValue(true);
      fw.portalDetail.get = vi.fn().mockReturnValue({
        mods: null, resonators: null,
        history: { visited: true, captured: false, scoutControlled: false },
      });
      const r = await adapter.handleCommand(cmd("portal.get_details", { guid: "p-1" }));
      expect(ok(r)).toBe(true);
      if (!ok(r)) return;
      expect(() => JSON.parse(JSON.stringify(r.result))).not.toThrow();
    });
  });
});
