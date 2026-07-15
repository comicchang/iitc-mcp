import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { BridgeClient, SessionStatus } from "../src/bridge/broker.js";
import type { BridgeEvent, BridgeMethod } from "@iitc-mcp/protocol";
import { MCPServerBridge } from "../src/mcp/server.js";

// ── Fixtures ──────────────────────────────────────────────────

const MAP_STATE = {
  center: { lat: 51.5074, lng: -0.1278 },
  zoom: 14,
  bounds: { south: 51.49, west: -0.15, north: 51.52, east: -0.1 },
  selectedPortalGuid: "abc123",
  dataStatus: { short: "ok", long: "Map data loaded" },
};

const PORTAL_SUMMARY = {
  guid: "portal-abc-123",
  team: "R",
  lat: 51.5074,
  lng: -0.1278,
  detailLevel: "summary",
  level: 7,
  health: 85,
  resCount: 8,
  title: "Test Portal",
};

const PORTAL_DETAILS = {
  ...PORTAL_SUMMARY,
  detailLevel: "detailed",
  owner: "SomeAgent",
  mods: [],
  resonators: [],
  linkGuids: { in: [], out: [] },
  fieldGuids: [],
};

const LINK_SUMMARY = {
  guid: "link-abc-123",
  team: "R",
  origin: { guid: "portal-a", lat: 51.5, lng: -0.1 },
  destination: { guid: "portal-b", lat: 51.6, lng: -0.2 },
};

const FIELD_SUMMARY = {
  guid: "field-abc-123",
  team: "E",
  points: [
    { guid: "p1", lat: 51.5, lng: -0.1 },
    { guid: "p2", lat: 51.6, lng: -0.2 },
    { guid: "p3", lat: 51.55, lng: -0.15 },
  ],
};

const SEARCH_RESULT = {
  items: [{ title: "Big Ben", description: "London, UK", position: { lat: 51.5007, lng: -0.1246 } }],
  complete: true,
};

const COMM_MESSAGE = {
  guid: "msg-1",
  timestampMs: 1700000000000,
  channel: "all",
  type: "TEXT",
  automated: false,
  team: "R",
  player: { name: "Agent1", team: "R" },
  text: "Hello",
  portals: [],
};

const REDEEM_RESULT = {
  rewards: { xm: 1000, ap: 500 },
};

const CONNECTED_STATUS: SessionStatus = {
  connected: true,
  sessionId: "sess-1",
  tabId: "tab-1",
  pluginVersion: "0.1.0",
  iitcVersion: "0.40.1",
  capabilities: ["map", "entities", "comm"],
  connectedAt: 1700000000000,
};

const DISCONNECTED_STATUS: SessionStatus = {
  connected: false,
  sessionId: null,
  tabId: null,
  pluginVersion: null,
  iitcVersion: null,
  capabilities: [],
  connectedAt: null,
};

// ── Mock BridgeClient ─────────────────────────────────────────

interface RecordedCall {
  method: BridgeMethod;
  params: unknown;
  opts?: { signal?: AbortSignal; timeoutMs?: number };
}

function createMockBridgeClient(overrides?: {
  status?: SessionStatus;
  events?: BridgeEvent[];
  callResult?: unknown;
  callError?: Error;
}) {
  const calls: RecordedCall[] = [];
  const status = overrides?.status ?? CONNECTED_STATUS;
  const events = overrides?.events ?? [];

  return {
    calls,
    client: {
      call: async (
        method: BridgeMethod,
        params: unknown,
        opts?: { signal?: AbortSignal; timeoutMs?: number },
      ): Promise<unknown> => {
        calls.push({ method, params, opts });
        if (overrides?.callError) throw overrides.callError;
        // Return appropriate result based on method
        if (overrides?.callResult !== undefined) return overrides.callResult;
        switch (method) {
          case "map.get_state": return MAP_STATE;
          case "map.set_view": return MAP_STATE;
          case "map.fit_bounds": return MAP_STATE;
          case "entities.list_portals": return { items: [PORTAL_SUMMARY], nextCursor: undefined, complete: false, reason: "IITC_VIEWPORT_CACHE" };
          case "entities.list_links": return { items: [LINK_SUMMARY], nextCursor: undefined, complete: false, reason: "IITC_VIEWPORT_CACHE" };
          case "entities.list_fields": return { items: [FIELD_SUMMARY], nextCursor: undefined, complete: false, reason: "IITC_VIEWPORT_CACHE" };
          case "portal.get_details": return PORTAL_DETAILS;
          case "portal.select": return { selectedPortalGuid: "abc123" };
          case "search.query": return SEARCH_RESULT;
          case "comm.list": return { items: [COMM_MESSAGE], complete: true };
          case "comm.send": return { accepted: true };
          case "redeem.submit": return REDEEM_RESULT;
          default: return {};
        }
      },
      getConnectionStatus: () => status,
      getRecentEvents: (count?: number) => events.slice(-(count ?? 100)),
    } satisfies BridgeClient,
  };
}

// ── Test Helpers ──────────────────────────────────────────────

const ALL_TOOL_NAMES = [
  "iitc_fit_map_bounds",
  "iitc_get_map_state",
  "iitc_get_player_trail",
  "iitc_get_portal_details",
  "iitc_get_self",
  "iitc_list_comm",
  "iitc_list_fields",
  "iitc_list_links",
  "iitc_list_players",
  "iitc_list_portals",
  "iitc_redeem_code",
  "iitc_search",
  "iitc_search_region",
  "iitc_select_portal",
  "iitc_send_comm",
  "iitc_set_map_view",
];

const READ_ONLY_TOOL_NAMES = ALL_TOOL_NAMES.filter(
  (n) => n !== "iitc_send_comm" && n !== "iitc_redeem_code"
);

const RESOURCE_URIS = [
  "iitc://status",
  "iitc://events/recent",
  "iitc://selection",
];

async function setupServerAndClient(mockOverride?: Parameters<typeof createMockBridgeClient>[0]) {
  const mock = createMockBridgeClient(mockOverride);
  const bridge = new MCPServerBridge({ bridgeClient: mock.client });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await bridge.mcpServer.connect(serverTransport);

  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);

  return { bridge, client, mock, clientTransport, serverTransport };
}

async function cleanup(
  bridge: MCPServerBridge,
  client: Client,
  ...transports: InMemoryTransport[]
) {
  await client.close();
  await bridge.close();
  for (const t of transports) {
    try { await t.close(); } catch { /* already closed */ }
  }
}

// ── Tests ─────────────────────────────────────────────────────

describe("MCPServerBridge", () => {
  describe("tool registration", () => {
    it("registers all 16 tools", async () => {
      const mock = createMockBridgeClient();
      const bridge = new MCPServerBridge({ bridgeClient: mock.client });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await bridge.mcpServer.connect(serverTransport);
      const client = new Client({ name: "test-client", version: "1.0.0" });
      await client.connect(clientTransport);

      const result = await client.listTools();
      const toolNames = result.tools.map((t) => t.name).sort();
      const expected = [...ALL_TOOL_NAMES].sort();

      expect(toolNames).toEqual(expected);

      await cleanup(bridge, client, clientTransport, serverTransport);
    });

    it("includes descriptions for all tools", async () => {
      const { bridge, client, clientTransport, serverTransport } = await setupServerAndClient();

      const result = await client.listTools();
      for (const tool of result.tools) {
        expect(tool.description).toBeTruthy();
        expect(typeof tool.description).toBe("string");
      }

      await cleanup(bridge, client, clientTransport, serverTransport);
    });

    it("registers only 14 tools when readOnly", async () => {
      const mock = createMockBridgeClient();
      const bridge = new MCPServerBridge({ bridgeClient: mock.client, readOnly: true });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await bridge.mcpServer.connect(serverTransport);
      const client = new Client({ name: "test-client", version: "1.0.0" });
      await client.connect(clientTransport);

      const result = await client.listTools();
      const toolNames = result.tools.map((t) => t.name).sort();
      const expected = [...READ_ONLY_TOOL_NAMES].sort();

      expect(toolNames).toEqual(expected);
      expect(toolNames).not.toContain("iitc_send_comm");
      expect(toolNames).not.toContain("iitc_redeem_code");

      await cleanup(bridge, client, clientTransport, serverTransport);
    });
  });

  describe("tool calls via bridge", () => {
    it("calls iitc_get_map_state and returns map state", async () => {
      const { bridge, client, mock, clientTransport, serverTransport } = await setupServerAndClient();

      const result = await client.callTool({ name: "iitc_get_map_state" });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(JSON.parse(result.content[0].text)).toEqual(MAP_STATE);

      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].method).toBe("map.get_state");

      await cleanup(bridge, client, clientTransport, serverTransport);
    });

    it("calls iitc_set_map_view with params", async () => {
      const { bridge, client, mock, clientTransport, serverTransport } = await setupServerAndClient();

      const result = await client.callTool({
        name: "iitc_set_map_view",
        arguments: { lat: 48.8566, lng: 2.3522, zoom: 12 },
      });

      expect(result.isError).toBeFalsy();
      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].method).toBe("map.set_view");
      expect(mock.calls[0].params).toEqual({ lat: 48.8566, lng: 2.3522, zoom: 12 });

      await cleanup(bridge, client, clientTransport, serverTransport);
    });

    it("calls iitc_list_portals with pagination args", async () => {
      const { bridge, client, mock, clientTransport, serverTransport } = await setupServerAndClient();

      const result = await client.callTool({
        name: "iitc_list_portals",
        arguments: { scope: "viewport", limit: 10 },
      });

      expect(result.isError).toBeFalsy();
      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].method).toBe("entities.list_portals");
      expect(mock.calls[0].params).toMatchObject({ scope: "viewport", limit: 10 });

      await cleanup(bridge, client, clientTransport, serverTransport);
    });

    it("calls iitc_redeem_code", async () => {
      const { bridge, client, mock, clientTransport, serverTransport } = await setupServerAndClient();

      const result = await client.callTool({
        name: "iitc_redeem_code",
        arguments: { passcode: "VALID-CODE-123" },
      });

      expect(result.isError).toBeFalsy();
      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].method).toBe("redeem.submit");
      expect(mock.calls[0].params).toEqual({ passcode: "VALID-CODE-123" });

      await cleanup(bridge, client, clientTransport, serverTransport);
    });
  });

  describe("error handling", () => {
    it("returns isError when bridge throws", async () => {
      const { bridge, client, clientTransport, serverTransport } = await setupServerAndClient({
        callError: new Error("No active session"),
      });

      const result = await client.callTool({ name: "iitc_get_map_state" });

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("No active session");

      await cleanup(bridge, client, clientTransport, serverTransport);
    });

    it("returns error content with bridge error message", async () => {
      const bridgeError = Object.assign(new Error("Portal not found"), {
        code: "NOT_FOUND",
        retryable: false,
      });
      const { bridge, client, clientTransport, serverTransport } = await setupServerAndClient({
        callError: bridgeError,
      });

      const result = await client.callTool({
        name: "iitc_get_portal_details",
        arguments: { guid: "nonexistent" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toContain("Portal not found");

      await cleanup(bridge, client, clientTransport, serverTransport);
    });
  });

  describe("resource registration", () => {
    it("registers all 3 resources", async () => {
      const { bridge, client, clientTransport, serverTransport } = await setupServerAndClient();

      const result = await client.listResources();
      const uris = result.resources.map((r) => r.uri).sort();
      const expected = [...RESOURCE_URIS].sort();

      expect(uris).toEqual(expected);

      await cleanup(bridge, client, clientTransport, serverTransport);
    });

    it("reads iitc://status resource with connected state", async () => {
      const { bridge, client, clientTransport, serverTransport } = await setupServerAndClient();

      const result = await client.readResource({ uri: "iitc://status" });

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe("iitc://status");
      expect(result.contents[0].mimeType).toBe("application/json");
      const data = JSON.parse(result.contents[0].text);
      expect(data.connected).toBe(true);
      expect(data.sessionId).toBe("sess-1");

      await cleanup(bridge, client, clientTransport, serverTransport);
    });

    it("reads iitc://selection resource", async () => {
      const { bridge, client, clientTransport, serverTransport } = await setupServerAndClient();

      const result = await client.readResource({ uri: "iitc://selection" });

      expect(result.contents).toHaveLength(1);
      const data = JSON.parse(result.contents[0].text);
      // With selectedPortalGuid in MAP_STATE, it should fetch portal details
      expect(data).toBeDefined();

      await cleanup(bridge, client, clientTransport, serverTransport);
    });

    it("reads iitc://selection as null when disconnected", async () => {
      const { bridge, client, clientTransport, serverTransport } = await setupServerAndClient({
        status: DISCONNECTED_STATUS,
      });

      const result = await client.readResource({ uri: "iitc://selection" });
      const data = JSON.parse(result.contents[0].text);
      expect(data).toBeNull();

      await cleanup(bridge, client, clientTransport, serverTransport);
    });

    it("reads iitc://status with disconnected state", async () => {
      const { bridge, client, clientTransport, serverTransport } = await setupServerAndClient({
        status: DISCONNECTED_STATUS,
      });

      const result = await client.readResource({ uri: "iitc://status" });
      const data = JSON.parse(result.contents[0].text);
      expect(data.connected).toBe(false);
      expect(data.sessionId).toBeNull();

      await cleanup(bridge, client, clientTransport, serverTransport);
    });

    it("reads iitc://events/recent resource", async () => {
      const testEvent: BridgeEvent = {
        eventId: "evt-1",
        sequence: 1,
        occurredAt: "2024-01-01T00:00:00.000Z",
        type: "bridge.ready",
        payload: {},
      };
      const { bridge, client, clientTransport, serverTransport } = await setupServerAndClient({
        events: [testEvent],
      });

      const result = await client.readResource({ uri: "iitc://events/recent" });
      const data = JSON.parse(result.contents[0].text);

      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0].eventId).toBe("evt-1");

      await cleanup(bridge, client, clientTransport, serverTransport);
    });
  });

  describe("signal propagation", () => {
    it("propagates abort signal to bridge client", async () => {
      const { promise: hangPromise, resolve: hangResolve } = Promise.withResolvers<never>();
      // Never-resolving bridge call — lets us abort mid-flight
      const delayedClient: BridgeClient = {
        call: async (_method, _params, opts) => {
          // Verify signal was passed through
          expect(opts?.signal).toBeDefined();
          expect(opts?.signal).toBeInstanceOf(AbortSignal);
          return hangPromise;
        },
        getConnectionStatus: () => CONNECTED_STATUS,
        getRecentEvents: () => [],
      };
      const bridge = new MCPServerBridge({ bridgeClient: delayedClient });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await bridge.mcpServer.connect(serverTransport);
      const client = new Client({ name: "test-client", version: "1.0.0" });
      await client.connect(clientTransport);

      const ac = new AbortController();
      const callPromise = client.callTool(
        { name: "iitc_get_map_state" },
        undefined,
        { signal: ac.signal },
      );

      ac.abort();

      try {
        await callPromise;
      } catch {
        // Expected: client throws on abort
      }

      hangResolve(undefined as never);
      await cleanup(bridge, client, clientTransport, serverTransport);
    });
  });

  describe("resource update notifications", () => {
    it("sendResourceUpdated does not throw", async () => {
      const { bridge, client, clientTransport, serverTransport } = await setupServerAndClient();

      // These should not throw
      expect(() => bridge.notifyStatusChanged()).not.toThrow();
      expect(() => bridge.notifyEventsChanged()).not.toThrow();
      expect(() => bridge.notifySelectionChanged()).not.toThrow();
      expect(() => bridge.notifyMapChanged()).not.toThrow();
      expect(() => bridge.notifyResourceUpdated("iitc://custom")).not.toThrow();

      await cleanup(bridge, client, clientTransport, serverTransport);
    });
  });

  describe("connect/close lifecycle", () => {
    it("creates server and connects via InMemoryTransport", async () => {
      const mock = createMockBridgeClient();
      const bridge = new MCPServerBridge({ bridgeClient: mock.client });

      // Verify McpServer is accessible
      expect(bridge.mcpServer).toBeInstanceOf(McpServer);

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await bridge.mcpServer.connect(serverTransport);

      const client = new Client({ name: "test-client", version: "1.0.0" });
      await client.connect(clientTransport);

      // Should be able to list tools
      const tools = await client.listTools();
      expect(tools.tools.length).toBe(16);

      await cleanup(bridge, client, clientTransport, serverTransport);
    });

    it("close() disconnects the server", async () => {
      const mock = createMockBridgeClient();
      const bridge = new MCPServerBridge({ bridgeClient: mock.client });

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await bridge.mcpServer.connect(serverTransport);
      const client = new Client({ name: "test-client", version: "1.0.0" });
      await client.connect(clientTransport);

      await bridge.close();

      // After close, further operations should fail
      await expect(client.listTools()).rejects.toThrow();

      try { await clientTransport.close(); } catch { /* expected */ }
    });
  });
});
