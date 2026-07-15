/**
 * MCP Server — SDK v1.29.0 McpServer + StdioServerTransport
 * Registers 12 tools and 3 resources, bridging MCP JSON-RPC to the IITC bridge protocol.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { BridgeClient } from "../bridge/broker.js";
import { z } from "zod/v4";
import type { BridgeMethod } from "@iitc-mcp/protocol";
import {
  MapStateSchema,
  SetViewInputSchema,
  SearchRegionInputSchema,
  SearchRegionOutputSchema,
  FitBoundsInputSchema,
  ListPortalsInputSchema,
  ListPortalsOutputSchema,
  ListLinksInputSchema,
  ListLinksOutputSchema,
  ListFieldsInputSchema,
  ListFieldsOutputSchema,
  SelfInfoSchema,
  PlayerSummarySchema,
  PlayerTrailSchema,
  GetPortalDetailsInputSchema,
  GetPortalDetailsOutputSchema,
  SelectPortalInputSchema,
  SelectPortalOutputSchema,
  SearchQueryInputSchema,
  SearchQueryOutputSchema,
  CommListInputSchema,
  CommListOutputSchema,
  CommSendInputSchema,
  CommSendOutputSchema,
  RedeemSubmitInputSchema,
  RedeemSubmitOutputSchema,
  BridgeErrorSchema,
} from "@iitc-mcp/protocol";
import type { BridgeError, MapState } from "@iitc-mcp/protocol";

/** Resource URIs */
const RESOURCE_URIS = {
  status: "iitc://status",
  events: "iitc://events/recent",
  selection: "iitc://selection",
} as const;

const JSON_MIME = "application/json";

/** Typed bridge method constants — avoids repeated `as BridgeMethod` casts. */
const M = {
  getState: "map.get_state",
  getSelf: "self.get_info",
  listPlayers: "tracker.list_players",
  getTrail: "tracker.get_trail",
  setView: "map.set_view",
  fitBounds: "map.fit_bounds",
  searchRegion: "map.search_region",
  listPortals: "entities.list_portals",
  listLinks: "entities.list_links",
  listFields: "entities.list_fields",
  getDetails: "portal.get_details",
  select: "portal.select",
  search: "search.query",
  commList: "comm.list",
  commSend: "comm.send",
  redeem: "redeem.submit",
} as Record<string, BridgeMethod>;



/** Build a CallToolResult for success. */
function toolSuccess(result: unknown) {
  // Bridge results are JSON DTOs (objects); primitives get wrapped for structuredContent
  const structured: Record<string, unknown> =
    result !== null && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : { value: result };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: structured,
  };
}

/** Build a CallToolResult for error. */
function toolError(error: BridgeError) {
  const sc: Record<string, unknown> = { error };
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: error.message }],
    structuredContent: sc,
  };
}

/** Normalize an unknown thrown error to a BridgeError shape. */
function normalizeBridgeError(err: unknown): BridgeError {
  if (err && typeof err === "object") {
    const parsed = BridgeErrorSchema.safeParse(err);
    if (parsed.success) return parsed.data;
    // Check for partially-matching BridgeError-like objects
    const e = err as Record<string, unknown>;
    if (
      typeof e.code === "string" &&
      typeof e.message === "string" &&
      typeof e.retryable === "boolean"
    ) {
      return {
        code: e.code as BridgeError["code"],
        message: e.message as string,
        retryable: e.retryable as boolean,
        details: e.details,
      };
    }
  }
  return {
    code: "INTERNAL",
    message: err instanceof Error ? err.message : String(err),
    retryable: false,
  };
}

export interface MCPServerBridgeOptions {
  bridgeClient: BridgeClient;
}

export class MCPServerBridge {
  readonly mcpServer: McpServer;
  private readonly bridgeClient: BridgeClient;

  constructor(opts: MCPServerBridgeOptions) {
    this.bridgeClient = opts.bridgeClient;
    this.mcpServer = new McpServer({
      name: "iitc-mcp",
      version: "0.1.0",
    });

    this.registerTools();
    this.registerResources();
  }

  // ── Tool Registration ───────────────────────────────────────

  private registerTools(): void {
    const call = this.bridgeClient.call.bind(this.bridgeClient);
    const TIMEOUT = 30_000;

    // --- Read-only tools ---

    // iitc_get_map_state
    this.mcpServer.registerTool(
      "iitc_get_map_state",
      {
        description: "Get the current map state: center, zoom, bounds, selected portal, and data status.",
        outputSchema: MapStateSchema,
      },
      async (extra) => {
        try {
          const result = await call(M.getState, {}, { signal: extra.signal, timeoutMs: TIMEOUT });
          return toolSuccess(result);
        } catch (err: unknown) {
          return toolError(normalizeBridgeError(err));
        }
      },
    );

    // iitc_list_portals
    this.mcpServer.registerTool(
      "iitc_list_portals",
      {
        description: "List portals currently visible in the IITC viewport. Returns paged results from the IITC cache.",
        inputSchema: ListPortalsInputSchema,
        outputSchema: ListPortalsOutputSchema,
      },
      async (args, extra) => {
        try {
          const result = await call(M.listPortals, args, { signal: extra.signal, timeoutMs: TIMEOUT });
          return toolSuccess(result);
        } catch (err: unknown) {
          return toolError(normalizeBridgeError(err));
        }
      },
    );

    // iitc_list_links
    this.mcpServer.registerTool(
      "iitc_list_links",
      {
        description: "List links currently visible in the IITC viewport. Returns paged results from the IITC cache.",
        inputSchema: ListLinksInputSchema,
        outputSchema: ListLinksOutputSchema,
      },
      async (args, extra) => {
        try {
          const result = await call(M.listLinks, args, { signal: extra.signal, timeoutMs: TIMEOUT });
          return toolSuccess(result);
        } catch (err: unknown) {
          return toolError(normalizeBridgeError(err));
        }
      },
    );

    // iitc_list_fields
    this.mcpServer.registerTool(
      "iitc_list_fields",
      {
        description: "List fields (control fields) currently visible in the IITC viewport. Returns paged results from the IITC cache.",
        inputSchema: ListFieldsInputSchema,
        outputSchema: ListFieldsOutputSchema,
      },
      async (args, extra) => {
        try {
          const result = await call(M.listFields, args, { signal: extra.signal, timeoutMs: TIMEOUT });
          return toolSuccess(result);
        } catch (err: unknown) {
          return toolError(normalizeBridgeError(err));
        }
      },
    );

    // iitc_get_portal_details
    this.mcpServer.registerTool(
      "iitc_get_portal_details",
      {
        description: "Get detailed information about a specific portal by its GUID, including mods, resonators, owner, and history.",
        inputSchema: GetPortalDetailsInputSchema,
        outputSchema: GetPortalDetailsOutputSchema,
      },
      async (args, extra) => {
        try {
          const result = await call(M.getDetails, args, { signal: extra.signal, timeoutMs: TIMEOUT });
          return toolSuccess(result);
        } catch (err: unknown) {
          return toolError(normalizeBridgeError(err));
        }
      },
    );

    // iitc_search
    this.mcpServer.registerTool(
      "iitc_search",
      {
        description: "Search for portals and locations using the IITC search provider. Waits for results with a quiet-window heuristic.",
        inputSchema: SearchQueryInputSchema,
        outputSchema: SearchQueryOutputSchema,
      },
      async (args, extra) => {
        try {
          const result = await call(M.search, args, { signal: extra.signal, timeoutMs: TIMEOUT });
          return toolSuccess(result);
        } catch (err: unknown) {
          return toolError(normalizeBridgeError(err));
        }
      },
    );

    // iitc_list_comm
    this.mcpServer.registerTool(
      "iitc_list_comm",
      {
        description: "List COMM (communication) messages from a channel. Optionally refreshes from Intel before reading.",
        inputSchema: CommListInputSchema,
        outputSchema: CommListOutputSchema,
      },
      async (args, extra) => {
        try {
          const result = await call(M.commList, args, { signal: extra.signal, timeoutMs: TIMEOUT });
          return toolSuccess(result);
        } catch (err: unknown) {
          return toolError(normalizeBridgeError(err));
        }
      },
    );

    // --- UI modification tools ---

    // iitc_set_map_view
    this.mcpServer.registerTool(
      "iitc_set_map_view",
      {
        description: "Set the map view to a specific lat/lng and optional zoom level. Returns the resulting map state after the move completes.",
        inputSchema: SetViewInputSchema,
        outputSchema: MapStateSchema,
      },
      async (args, extra) => {
        try {
          const result = await call(M.setView, args, { signal: extra.signal, timeoutMs: TIMEOUT });
          return toolSuccess(result);
        } catch (err: unknown) {
          return toolError(normalizeBridgeError(err));
        }
      },
    );

    // iitc_fit_map_bounds
    this.mcpServer.registerTool(
      "iitc_fit_map_bounds",
      {
        description: "Fit the map view to the given bounding box. Returns the resulting map state after the move completes.",
        inputSchema: FitBoundsInputSchema,
        outputSchema: MapStateSchema,
      },
      async (args, extra) => {
        try {
          const result = await call(M.fitBounds, args, { signal: extra.signal, timeoutMs: TIMEOUT });
          return toolSuccess(result);
        } catch (err: unknown) {
          return toolError(normalizeBridgeError(err));
        }
      },
    );

    // iitc_search_region
    this.mcpServer.registerTool(
      "iitc_search_region",
      {
        description: "Search for a named region (e.g. '青果巷社区') via Nominatim geocoding, fit the map to its bounds, and wait for map data to finish loading. Returns the resulting map state. Follow with iitc_list_portals to count portals in the region.",
        inputSchema: SearchRegionInputSchema,
        outputSchema: SearchRegionOutputSchema,
      },
      async (args, extra) => {
        try {
          const result = await call(M.searchRegion, args, { signal: extra.signal, timeoutMs: TIMEOUT });
          return toolSuccess(result);
        } catch (err: unknown) {
          return toolError(normalizeBridgeError(err));
        }
      },
    );

    // iitc_select_portal
    this.mcpServer.registerTool(
      "iitc_select_portal",
      {
        description: "Select a portal on the map by its GUID. Shows the portal in the sidebar and waits for the selection event.",
        inputSchema: SelectPortalInputSchema,
        outputSchema: SelectPortalOutputSchema,
        annotations: {
          readOnlyHint: false,
        } satisfies ToolAnnotations,
      },
      async (args, extra) => {
        try {
          const result = await call(M.select, args, { signal: extra.signal, timeoutMs: TIMEOUT });
          return toolSuccess(result);
        } catch (err: unknown) {
          return toolError(normalizeBridgeError(err));
        }
      },
    );

    // --- External side-effect tools ---

    // iitc_send_comm
    this.mcpServer.registerTool(
      "iitc_send_comm",
      {
        description: "Send a message to an Ingress COMM channel (all or faction). This sends a real message visible to other players.",
        inputSchema: CommSendInputSchema,
        outputSchema: CommSendOutputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
        } satisfies ToolAnnotations,
      },
      async (args, extra) => {
        try {
          const result = await call(M.commSend, args, { signal: extra.signal, timeoutMs: TIMEOUT });
          return toolSuccess(result);
        } catch (err: unknown) {
          return toolError(normalizeBridgeError(err));
        }
      },
    );

    // iitc_redeem_code
    this.mcpServer.registerTool(
      "iitc_redeem_code",
      {
        description: "Submit an Ingress passcode for redemption. This is a one-time operation that awards items, AP, or XM.",
        inputSchema: RedeemSubmitInputSchema,
        outputSchema: RedeemSubmitOutputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
        } satisfies ToolAnnotations,
      },
      async (args, extra) => {
        try {
          const result = await call(M.redeem, args, { signal: extra.signal, timeoutMs: TIMEOUT });
          return toolSuccess(result);
        } catch (err: unknown) {
          return toolError(normalizeBridgeError(err));
        }
      },
    );

    // iitc_get_self
    this.mcpServer.registerTool(
      "iitc_get_self",
      {
        description: "Return the signed-in player's own information: nickname, team, level, AP, and current XM.",
        inputSchema: z.object({}),
        outputSchema: SelfInfoSchema,
      },
      async (_args, extra) => {
        try {
          const result = await call(M.getSelf, {}, { signal: extra.signal, timeoutMs: TIMEOUT });
          return toolSuccess(result);
        } catch (err: unknown) {
          return toolError(normalizeBridgeError(err));
        }
      },
    );

    // iitc_list_players
    this.mcpServer.registerTool(
      "iitc_list_players",
      {
        description: "List players tracked by the Player Tracker plugin with their last known position, team, and action.",
        inputSchema: z.object({}),
        outputSchema: z.array(PlayerSummarySchema),
      },
      async (_args, extra) => {
        try {
          const result = await call(M.listPlayers, {}, { signal: extra.signal, timeoutMs: TIMEOUT });
          return toolSuccess(result);
        } catch (err: unknown) {
          return toolError(normalizeBridgeError(err));
        }
      },
    );

    // iitc_get_player_trail
    this.mcpServer.registerTool(
      "iitc_get_player_trail",
      {
        description: "Return the trail (time-ordered events with lat/lng/action) for a specific tracked player by name.",
        inputSchema: z.object({ name: z.string().min(1) }),
        outputSchema: PlayerTrailSchema,
      },
      async (args, extra) => {
        try {
          const result = await call(M.getTrail, args, { signal: extra.signal, timeoutMs: TIMEOUT });
          return toolSuccess(result);
        } catch (err: unknown) {
          return toolError(normalizeBridgeError(err));
        }
      },
    );
  }

  // ── Resource Registration ───────────────────────────────────

  private registerResources(): void {
    const getStatus = this.bridgeClient.getConnectionStatus.bind(this.bridgeClient);

    // iitc://status — connection status, versions, capabilities, map state (no token)
    this.mcpServer.resource(
      "connection-status",
      RESOURCE_URIS.status,
      async (_uri, _extra) => {
        const status = getStatus();
        let mapState: MapState | null = null;
        if (status.connected) {
          try {
            const raw = await this.bridgeClient.call(M.getState, {});
            mapState = MapStateSchema.parse(raw);
          } catch {
            // map not ready yet
          }
        }
        const value = { ...status, mapState };
        return {
          contents: [{ uri: RESOURCE_URIS.status, mimeType: JSON_MIME, text: JSON.stringify(value) }],
        };
      },
    );

    // iitc://events/recent — last 100 normalized events
    this.mcpServer.resource(
      "recent-events",
      RESOURCE_URIS.events,
      async (_uri, _extra) => {
        const events = this.bridgeClient.getRecentEvents(100);
        return {
          contents: [{ uri: RESOURCE_URIS.events, mimeType: JSON_MIME, text: JSON.stringify(events) }],
        };
      },
    );

    // iitc://selection — current selected portal details or null
    this.mcpServer.resource(
      "portal-selection",
      RESOURCE_URIS.selection,
      async (_uri, _extra) => {
        const status = getStatus();
        if (!status.connected) {
          return {
            contents: [{ uri: RESOURCE_URIS.selection, mimeType: JSON_MIME, text: "null" }],
          };
        }
        try {
          const raw = await this.bridgeClient.call(M.getState, {});
          const state = MapStateSchema.parse(raw);
          if (!state.selectedPortalGuid) {
            return {
              contents: [{ uri: RESOURCE_URIS.selection, mimeType: JSON_MIME, text: "null" }],
            };
          }
          const details = await this.bridgeClient.call(M.getDetails, { guid: state.selectedPortalGuid });
          return {
            contents: [{ uri: RESOURCE_URIS.selection, mimeType: JSON_MIME, text: JSON.stringify(details) }],
          };
        } catch {
          return {
            contents: [{ uri: RESOURCE_URIS.selection, mimeType: JSON_MIME, text: "null" }],
          };
        }
      },
    );
  }

  // ── Resource Update Notifications ───────────────────────────

  /** Notify MCP clients that a resource has changed. */
  notifyResourceUpdated(uri: string): void {
    void this.mcpServer.server.sendResourceUpdated({ uri });
  }

  /** Notify MCP clients that the status resource has changed. */
  notifyStatusChanged(): void {
    this.notifyResourceUpdated(RESOURCE_URIS.status);
  }

  /** Notify MCP clients that the events resource has changed. */
  notifyEventsChanged(): void {
    this.notifyResourceUpdated(RESOURCE_URIS.events);
  }

  /** Notify MCP clients that the selection resource has changed. */
  notifySelectionChanged(): void {
    this.notifyResourceUpdated(RESOURCE_URIS.selection);
  }

  /** Notify MCP clients that map state resources may have changed. */
  notifyMapChanged(): void {
    this.notifyStatusChanged();
    this.notifySelectionChanged();
  }

  // ── Lifecycle ───────────────────────────────────────────────

  /** Connect the MCP server to a transport. Creates StdioServerTransport if none provided. */
  async connect(transport?: Transport): Promise<void> {
    const t = transport ?? new StdioServerTransport();
    await this.mcpServer.connect(t);
  }

  /** Close the MCP server connection. */
  async close(): Promise<void> {
    await this.mcpServer.close();
  }
}
