/**
 * MCP Server — SDK v1.29.0 McpServer + StdioServerTransport
 * Registers 18 tools (16 read-only) and 3 resources, bridging MCP JSON-RPC to the IITC bridge protocol.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { BridgeClient } from "../bridge/broker.js";
import { z } from "zod";
import type { BridgeError, BridgeMethod, MapState } from "@iitc-mcp/protocol";
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
  RegionSummaryInputSchema,
  RegionSummaryOutputSchema,
  ExportGeoJsonInputSchema,
  ExportGeoJsonOutputSchema,
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

/** Resource URIs */
const RESOURCE_URIS = {
  status: "iitc://status",
  events: "iitc://events/recent",
  selection: "iitc://selection",
} as const;

const JSON_MIME = "application/json";
const TOOL_CALL_TIMEOUT_MS = 30_000;

const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
};

const UI_MUTATING_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
};

const DESTRUCTIVE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
};

interface BridgeToolSpec {
  readonly name: string;
  readonly method: BridgeMethod;
  readonly description: string;
  readonly inputSchema?: z.ZodType;
  readonly outputSchema: z.ZodType;
  readonly annotations: ToolAnnotations;
  /** When true, omitted in `--read-only` mode. */
  readonly destructive?: boolean;
}

const TOOL_SPECS: readonly BridgeToolSpec[] = [
  {
    name: "iitc_get_map_state",
    method: "map.get_state",
    description: "Get the current map state: center, zoom, bounds, selected portal, and data status.",
    outputSchema: MapStateSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "iitc_list_portals",
    method: "entities.list_portals",
    description: "List portals currently visible in the IITC viewport. Returns paged results from the IITC cache.",
    inputSchema: ListPortalsInputSchema,
    outputSchema: ListPortalsOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "iitc_list_links",
    method: "entities.list_links",
    description: "List links currently visible in the IITC viewport. Returns paged results from the IITC cache.",
    inputSchema: ListLinksInputSchema,
    outputSchema: ListLinksOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "iitc_list_fields",
    method: "entities.list_fields",
    description: "List fields (control fields) currently visible in the IITC viewport. Returns paged results from the IITC cache.",
    inputSchema: ListFieldsInputSchema,
    outputSchema: ListFieldsOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "iitc_get_region_summary",
    method: "entities.region_summary",
    description: "Summarize entities visible in the current IITC viewport: total portals, counts by faction (E/R/N/M) and level (0-8), links count, fields count, and bounds.",
    inputSchema: RegionSummaryInputSchema,
    outputSchema: RegionSummaryOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "iitc_export_geojson",
    method: "entities.export_geojson",
    description: "Export entities visible in the current IITC viewport as a standard RFC 7946 GeoJSON FeatureCollection (portals as Points, optionally links as LineStrings and fields as Polygons).",
    inputSchema: ExportGeoJsonInputSchema,
    outputSchema: ExportGeoJsonOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "iitc_get_portal_details",
    method: "portal.get_details",
    description: "Get detailed information about a specific portal by its GUID, including mods, resonators, owner, and history.",
    inputSchema: GetPortalDetailsInputSchema,
    outputSchema: GetPortalDetailsOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "iitc_search",
    method: "search.query",
    description: "Search for portals and locations using the IITC search provider. Waits for results with a quiet-window heuristic.",
    inputSchema: SearchQueryInputSchema,
    outputSchema: SearchQueryOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "iitc_list_comm",
    method: "comm.list",
    description: "List COMM (communication) messages from a channel. Optionally refreshes from Intel before reading.",
    inputSchema: CommListInputSchema,
    outputSchema: CommListOutputSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "iitc_set_map_view",
    method: "map.set_view",
    description: "Set the map view to a specific lat/lng and optional zoom level. Returns the resulting map state after the move completes.",
    inputSchema: SetViewInputSchema,
    outputSchema: MapStateSchema,
    annotations: UI_MUTATING_ANNOTATIONS,
  },
  {
    name: "iitc_fit_map_bounds",
    method: "map.fit_bounds",
    description: "Fit the map view to the given bounding box. Returns the resulting map state after the move completes.",
    inputSchema: FitBoundsInputSchema,
    outputSchema: MapStateSchema,
    annotations: UI_MUTATING_ANNOTATIONS,
  },
  {
    name: "iitc_search_region",
    method: "map.search_region",
    description: "Search for a named region (e.g. 'Hyde Park, London') via Nominatim geocoding, fit the map to its bounds, and wait for map data to finish loading. Returns the resulting map state. Follow with iitc_list_portals or iitc_get_region_summary to inspect portals in the region.",
    inputSchema: SearchRegionInputSchema,
    outputSchema: SearchRegionOutputSchema,
    annotations: UI_MUTATING_ANNOTATIONS,
  },
  {
    name: "iitc_select_portal",
    method: "portal.select",
    description: "Select a portal on the map by its GUID. Shows the portal in the sidebar and waits for the selection event.",
    inputSchema: SelectPortalInputSchema,
    outputSchema: SelectPortalOutputSchema,
    annotations: UI_MUTATING_ANNOTATIONS,
  },
  {
    name: "iitc_send_comm",
    method: "comm.send",
    description: "Send a message to an Ingress COMM channel (all or faction). This sends a real message visible to other players.",
    inputSchema: CommSendInputSchema,
    outputSchema: CommSendOutputSchema,
    annotations: DESTRUCTIVE_ANNOTATIONS,
    destructive: true,
  },
  {
    name: "iitc_redeem_code",
    method: "redeem.submit",
    description: "Submit an Ingress passcode for redemption. This is a one-time operation that awards items, AP, or XM.",
    inputSchema: RedeemSubmitInputSchema,
    outputSchema: RedeemSubmitOutputSchema,
    annotations: DESTRUCTIVE_ANNOTATIONS,
    destructive: true,
  },
  {
    name: "iitc_get_self",
    method: "self.get_info",
    description: "Return the signed-in player's own information: nickname, team, level, AP, and current XM.",
    inputSchema: z.object({}),
    outputSchema: SelfInfoSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "iitc_list_players",
    method: "tracker.list_players",
    description: "List players tracked by the Player Tracker plugin with their last known position, team, and action.",
    inputSchema: z.object({}),
    outputSchema: z.array(PlayerSummarySchema),
    annotations: READ_ONLY_ANNOTATIONS,
  },
  {
    name: "iitc_get_player_trail",
    method: "tracker.get_trail",
    description: "Return the trail (time-ordered events with lat/lng/action) for a specific tracked player by name.",
    inputSchema: z.object({ name: z.string().min(1) }),
    outputSchema: PlayerTrailSchema,
    annotations: READ_ONLY_ANNOTATIONS,
  },
];

/** Build a CallToolResult for success. */
function toolSuccess(result: unknown) {
  // Bridge results are JSON DTOs (objects); primitives/arrays get wrapped for structuredContent
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
    const e = err as Record<string, unknown>;
    if (
      typeof e.code === "string" &&
      typeof e.message === "string" &&
      typeof e.retryable === "boolean"
    ) {
      return {
        code: e.code as BridgeError["code"],
        message: e.message,
        retryable: e.retryable,
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
  /** When true, skip registering destructive tools (send_comm, redeem_code). */
  readOnly?: boolean;
}

export class MCPServerBridge {
  readonly mcpServer: McpServer;
  private readonly bridgeClient: BridgeClient;
  private readonly readOnly: boolean;

  constructor(opts: MCPServerBridgeOptions) {
    this.bridgeClient = opts.bridgeClient;
    this.readOnly = opts.readOnly ?? false;
    this.mcpServer = new McpServer({
      name: "iitc-mcp",
      version: "1.2.0",
    });

    this.registerTools();
    this.registerResources();
  }

  // ── Tool Registration ───────────────────────────────────────

  private registerTools(): void {
    for (const spec of TOOL_SPECS) {
      if (this.readOnly && spec.destructive) continue;
      this.registerBridgeTool(spec);
    }
  }

  private registerBridgeTool(spec: BridgeToolSpec): void {
    if (spec.inputSchema) {
      this.mcpServer.registerTool(
        spec.name,
        {
          description: spec.description,
          inputSchema: spec.inputSchema,
          outputSchema: spec.outputSchema,
          annotations: spec.annotations,
        },
        async (args, extra) => this.invokeBridge(spec.method, args, extra.signal),
      );
      return;
    }

    this.mcpServer.registerTool(
      spec.name,
      {
        description: spec.description,
        outputSchema: spec.outputSchema,
        annotations: spec.annotations,
      },
      async (extra) => this.invokeBridge(spec.method, {}, extra.signal),
    );
  }

  private async invokeBridge(method: BridgeMethod, params: unknown, signal?: AbortSignal) {
    try {
      const result = await this.bridgeClient.call(method, params, {
        signal,
        timeoutMs: TOOL_CALL_TIMEOUT_MS,
      });
      return toolSuccess(result);
    } catch (err: unknown) {
      return toolError(normalizeBridgeError(err));
    }
  }

  // ── Resource Registration ───────────────────────────────────

  private registerResources(): void {
    const getStatus = this.bridgeClient.getConnectionStatus.bind(this.bridgeClient);

    // iitc://status — connection status, versions, capabilities, map state (no token)
    this.mcpServer.resource(
      "connection-status",
      RESOURCE_URIS.status,
      async (_uri, _extra) => {
        const status = await getStatus();
        let mapState: MapState | null = null;
        if (status.connected) {
          try {
            const raw = await this.bridgeClient.call("map.get_state", {});
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
        const events = await this.bridgeClient.getRecentEvents(100);
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
        const status = await getStatus();
        if (!status.connected) {
          return {
            contents: [{ uri: RESOURCE_URIS.selection, mimeType: JSON_MIME, text: "null" }],
          };
        }
        try {
          const raw = await this.bridgeClient.call("map.get_state", {});
          const state = MapStateSchema.parse(raw);
          if (!state.selectedPortalGuid) {
            return {
              contents: [{ uri: RESOURCE_URIS.selection, mimeType: JSON_MIME, text: "null" }],
            };
          }
          const details = await this.bridgeClient.call("portal.get_details", { guid: state.selectedPortalGuid });
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
