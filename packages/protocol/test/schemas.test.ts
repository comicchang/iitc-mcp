/**
 * Protocol schema 测试 — valid fixture round-trip + rejection tests
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ConnectRequestSchema,
  ConnectResponseSchema,
  PollRequestSchema,
  EventsRequestSchema,
  BridgeCommandSchema,
  BridgeCompletionSchema,
  BridgeEventSchema,
  BridgeErrorSchema,
  MapStateSchema,
  PortalSummarySchema,
  PortalDetailsSchema,
  LinkSummarySchema,
  FieldSummarySchema,
  SearchResultSchema,
  CommMessageSchema,
  RedeemResultSchema,
  ListInputSchema,
  PagedResultSchema,
  SetViewInputSchema,
  FitBoundsInputSchema,
  SearchQueryInputSchema,
  CommListInputSchema,
  RedeemSubmitInputSchema,
  RegionSummaryInputSchema,
  RegionSummaryOutputSchema,
  ExportGeoJsonInputSchema,
  ExportGeoJsonOutputSchema,
} from "../src/schemas.js";

const fixtureDir = resolve(import.meta.dirname, "../../../fixtures/protocol");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(fixtureDir, `${name}.json`), "utf-8"));
}

describe("Protocol schemas — fixture round-trip", () => {
  it("ConnectRequest", () => {
    const data = loadFixture("connect-request");
    const parsed = ConnectRequestSchema.parse(data);
    expect(parsed.protocolVersion).toBe(1);
    expect(parsed.tabId).toBe("dGVzdC10YWItMQ");
  });

  it("ConnectResponse", () => {
    const data = loadFixture("connect-response");
    const parsed = ConnectResponseSchema.parse(data);
    expect(parsed.sessionId).toBe("c2Vzc2lvbi0xMjM0");
    expect(parsed.leaseMs).toBe(45000);
  });

  it("MapState", () => {
    const data = loadFixture("map-state");
    const parsed = MapStateSchema.parse(data);
    expect(parsed.center.lat).toBe(51.5074);
    expect(parsed.selectedPortalGuid).toBe("abc123");
  });

  it("PortalSummary", () => {
    const data = loadFixture("portal-summary");
    const parsed = PortalSummarySchema.parse(data);
    expect(parsed.team).toBe("R");
    expect(parsed.detailLevel).toBe("summary");
  });

  it("PortalDetails", () => {
    const data = loadFixture("portal-details");
    const parsed = PortalDetailsSchema.parse(data);
    expect(parsed.mods).toHaveLength(2);
    expect(parsed.mods![0]).not.toBeNull();
    expect(parsed.mods![1]).toBeNull();
    expect(parsed.resonators).toHaveLength(3);
    expect(parsed.linkGuids.in).toHaveLength(1);
    expect(parsed.linkGuids.out).toHaveLength(2);
    expect(parsed.fieldGuids).toHaveLength(1);
  });

  it("LinkSummary", () => {
    const data = loadFixture("link-summary");
    const parsed = LinkSummarySchema.parse(data);
    expect(parsed.team).toBe("E");
    expect(parsed.origin.guid).toBe("portal-abc-123");
  });

  it("FieldSummary", () => {
    const data = loadFixture("field-summary");
    const parsed = FieldSummarySchema.parse(data);
    expect(parsed.points).toHaveLength(3);
    expect(parsed.team).toBe("R");
  });

  it("SearchResult", () => {
    const data = loadFixture("search-result");
    const parsed = SearchResultSchema.parse(data);
    expect(parsed.title).toBe("Big Ben");
    expect(parsed.position!.lat).toBeCloseTo(51.5007);
  });

  it("CommMessage", () => {
    const data = loadFixture("comm-message");
    const parsed = CommMessageSchema.parse(data);
    expect(parsed.channel).toBe("all");
    expect(parsed.portals).toHaveLength(1);
  });

  it("RedeemResult", () => {
    const data = loadFixture("redeem-result");
    const parsed = RedeemResultSchema.parse(data);
    expect(parsed.rewards.xm).toBe(1000);
    expect(parsed.rewards.inventory).toHaveLength(1);
    expect(parsed.playerData).toBeDefined();
  });

  it("Paged portals", () => {
    const data = loadFixture("paged-portals");
    const parsed = PagedResultSchema.extend({ items: PortalSummarySchema.array() }).parse(data);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.complete).toBe(false);
    expect(parsed.reason).toBe("IITC_VIEWPORT_CACHE");
  });
});

describe("Protocol schemas — rejection", () => {
  it("rejects unknown protocolVersion", () => {
    const data = loadFixture("connect-request");
    expect(() => ConnectRequestSchema.parse({ ...data, protocolVersion: 2 })).toThrow();
  });

  it("rejects out-of-bounds lat", () => {
    expect(() => MapStateSchema.parse({
      center: { lat: 91, lng: 0 },
      zoom: 10,
      bounds: { south: -90, west: -180, north: 90, east: 180 },
      selectedPortalGuid: null,
      dataStatus: { short: "ok" },
    })).toThrow();
  });

  it("rejects invalid channel", () => {
    expect(() => CommListInputSchema.parse({ channel: "invalid" })).toThrow();
  });

  it("rejects limit > max", () => {
    expect(() => ListInputSchema.parse({ scope: "viewport", limit: 2001 })).toThrow();
  });

  it("rejects non-exhaustive error code", () => {
    expect(() => BridgeErrorSchema.parse({
      code: "FAKE_ERROR",
      message: "test",
      retryable: false,
    })).toThrow();
  });

  it("rejects west > east in fit_bounds", () => {
    expect(() => FitBoundsInputSchema.parse({
      south: -90, west: 10, north: 90, east: -10,
    })).toThrow();
  });

  it("rejects non-ASCII passcode", () => {
    expect(() => RedeemSubmitInputSchema.parse({ passcode: "中文密码" })).toThrow();
  });

  it("rejects empty search term", () => {
    expect(() => SearchQueryInputSchema.parse({ term: "" })).toThrow();
  });

  it("rejects term > 256 chars", () => {
    expect(() => SearchQueryInputSchema.parse({ term: "x".repeat(257) })).toThrow();
  });

  it("rejects negative zoom", () => {
    expect(() => SetViewInputSchema.parse({ lat: 0, lng: 0, zoom: -1 })).toThrow();
  });

  it("PagedResult requires complete:false", () => {
    expect(() => PagedResultSchema.parse({
      items: [],
      complete: true,
      reason: "IITC_VIEWPORT_CACHE",
    })).toThrow();
  });
});

describe("Protocol schemas — BridgeCommand/Completion/Event", () => {
  it("valid BridgeCommand", () => {
    const cmd = BridgeCommandSchema.parse({
      id: "1",
      method: "map.get_state",
      params: {},
      deadlineMs: Date.now() + 30000,
    });
    expect(cmd.method).toBe("map.get_state");
  });

  it("valid BridgeCompletion success", () => {
    const comp = BridgeCompletionSchema.parse({ id: "1", ok: true, result: {} });
    expect(comp.ok).toBe(true);
  });

  it("valid BridgeCompletion error", () => {
    const comp = BridgeCompletionSchema.parse({
      id: "1",
      ok: false,
      error: { code: "TIMEOUT", message: "timed out", retryable: true },
    });
    expect(comp.ok).toBe(false);
    if (!comp.ok) expect(comp.error.code).toBe("TIMEOUT");
  });

  it("valid BridgeEvent", () => {
    const evt = BridgeEventSchema.parse({
      eventId: "evt-1",
      sequence: 0,
      occurredAt: new Date().toISOString(),
      type: "bridge.ready",
      payload: {},
    });
    expect(evt.type).toBe("bridge.ready");
  });

  it("valid PollRequest with completions", () => {
    const req = PollRequestSchema.parse({
      sessionId: "sess-1",
      completed: [{ id: "1", ok: true, result: null }],
    });
    expect(req.completed).toHaveLength(1);
  });

  it("valid EventsRequest", () => {
    const req = EventsRequestSchema.parse({
      sessionId: "sess-1",
      events: [{
        eventId: "evt-1",
        sequence: 0,
        occurredAt: new Date().toISOString(),
        type: "map.changed",
        payload: {},
      }],
    });
    expect(req.events).toHaveLength(1);
  });

  it("valid RegionSummary schemas", () => {
    const input = RegionSummaryInputSchema.parse({});
    expect(input.scope).toBe("viewport");
    const output = RegionSummaryOutputSchema.parse({
      bounds: { south: 51.49, west: -0.15, north: 51.52, east: -0.1 },
      totalPortals: 4,
      byTeam: { E: 2, R: 1, N: 1, M: 0 },
      byLevel: { "0": 1, "6": 2, "8": 1 },
      linksCount: 3,
      fieldsCount: 1,
      complete: false,
      reason: "IITC_VIEWPORT_CACHE",
    });
    expect(output.totalPortals).toBe(4);
    expect(output.byTeam.E).toBe(2);
  });

  it("valid ExportGeoJson schemas", () => {
    const input = ExportGeoJsonInputSchema.parse({ includeLinks: true, includeFields: true });
    expect(input.scope).toBe("viewport");
    expect(input.includeLinks).toBe(true);
    const output = ExportGeoJsonOutputSchema.parse({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "portal-1",
          geometry: { type: "Point", coordinates: [-0.1278, 51.5074] },
          properties: { entityType: "portal", guid: "portal-1", team: "E", level: 7 },
        },
      ],
      metadata: {
        bounds: { south: 51.49, west: -0.15, north: 51.52, east: -0.1 },
        portalCount: 1,
        linkCount: 0,
        fieldCount: 0,
        complete: false,
        reason: "IITC_VIEWPORT_CACHE",
      },
    });
    expect(output.type).toBe("FeatureCollection");
    expect(output.features).toHaveLength(1);
  });
});
