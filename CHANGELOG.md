# Changelog

All notable changes to **iitc-mcp** are documented in this file.

## [1.2.0] - 2026-11-26

### Added
- **Region Analytics & GIS Export**:
  - `iitc_get_region_summary` (`entities.region_summary`) — summarizes viewport portals by faction (`E`/`R`/`N`/`M`) and level (`0`–`8`), plus link and field counts.
  - `iitc_export_geojson` (`entities.export_geojson`) — exports viewport entities as RFC 7946 `FeatureCollection` (Point portals, optional LineString links and closed Polygon fields).
- **Control-Plane Security & Multi-Agent Concurrency**:
  - Bearer token authentication on `/mcp/*` endpoints with constant-time comparison, dynamic token rotation support, and `--no-auth` opt-out.
  - Lightweight `/healthz` liveness endpoint.
  - FIFO serialization lock in `BridgeBroker` for viewport/UI-mutating methods (`map.set_view`, `map.fit_bounds`, `map.search_region`, `portal.select`) to prevent multi-agent viewport races.
  - Runtime validation of `/mcp/call` `method` via `BridgeMethodSchema` and client-disconnect cancellation via `AbortController`.
  - Configurable loopback origin (`GM_getValue("iitc_mcp_origin")`) in the userscript.
- **Zero Idle Browser Overhead & Modular Architecture**:
  - Extracted `viewport-entities.ts` (single `map.getBounds()` per query + team normalization before filtering across portals/links/fields/summary/GeoJSON).
  - Extracted `snapshot-paginator.ts` (`SnapshotPaginator` skips snapshot storage for single-page results and auto-sweeps expired snapshots via a single self-clearing TTL timer).
  - Gated all 9 IITC/Leaflet hooks in `page-entry.ts` strictly on active bridge connection state; switched page heartbeats to on-demand ping responses with zero idle timers.
  - Bounded `BridgeTransport.pendingEvents` to 200 items and dropped non-`bridge.ready` page events while disconnected.
  - Refactored `MCPServerBridge` into declarative typed `BridgeToolSpec` entries with accurate `ToolAnnotations` (`readOnlyHint`, `destructiveHint`).
  - Shared protocol constants (`DEFAULT_PORT`, `LEASE_MS`, `HEARTBEAT_MS`, `MAX_BODY_BYTES`, `POLL_TIMEOUT_MS`, pagination & snapshot limits) exported as SSOT from `@iitc-mcp/protocol`.
- **Open-Source Packaging & CI**:
  - Added GitHub Actions CI workflow (`.github/workflows/ci.yml`), issue/PR templates, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, and hero banner.

### Fixed
- Team filtering in `entities.list_portals`, `entities.list_links`, and `entities.list_fields` now normalizes full IITC team strings (`"ENLIGHTENED"`, `"RESISTANCE"`, `"MACHINA"`) before comparing against short codes (`"E"`, `"R"`, `"M"`).
- `BridgeBroker.hasSession()` and `getConnectionStatus()` now prune expired session leases instead of reporting stale sessions as connected.
- `BridgeBroker.destroySession()` clears the event ring buffer; default ring size aligned to `100` to match `iitc://events/recent`.
- `RemoteBridgeClient.call()` removes `abort` listeners in `finally` to prevent leaks on long-lived `AbortSignal`s.
- CLI startup no longer prints raw Bearer tokens to stderr.

## [1.1.0] - 2026-07-01

### Added
- Multi-agent shared broker mode (`iitc-mcp broker` + `iitc-mcp serve --broker-url <url>`).
- Read-only mode (`--read-only`) omitting `iitc_send_comm` and `iitc_redeem_code`.
- Mermaid architecture diagrams and bilingual README updates.

## [1.0.0] - 2026-06-01

### Added
- Initial release of IITC-MCP bridge: Tampermonkey userscript, loopback HTTP pull-RPC broker, and Node.js stdio MCP server.
- Core map, viewport entity, portal detail, search, COMM, passcode redemption, player info, and Player Tracker tools + 3 MCP resources (`iitc://status`, `iitc://events/recent`, `iitc://selection`).
