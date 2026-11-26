# AGENTS.md

Project: `iitc-mcp` — IITC ↔ MCP bridge (Browser userscript ↔ loopback HTTP pull-RPC broker ↔ MCP stdio server).

## Adding a New Tool

1. `packages/protocol/src/constants.ts` — add the method to `BRIDGE_METHODS` (and `DESTRUCTIVE_BRIDGE_METHODS` / `MAP_MUTATING_METHODS` if applicable).
2. `packages/protocol/src/schemas.ts`, `types.ts`, `index.ts` — define Zod schemas, infer types, and re-export from `index.ts`.
3. `packages/iitc-plugin/src/page-adapter.ts` — add a `dispatch` case and handler (delegate viewport entity scans to `viewport-entities.ts` and pagination to `SnapshotPaginator`).
4. `packages/mcp-server/src/mcp/server.ts` — add a declarative `BridgeToolSpec` entry in `TOOL_SPECS` with accurate `ToolAnnotations`.

## Design Rules

| Scenario | Do | Avoid |
| --- | --- | --- |
| Cross-context events | `document.dispatchEvent` | `window` events (unreliable across Tampermonkey sandbox) |
| Page initialization | `window.iitcLoaded` hook | Polling `window.map` |
| Idle browser overhead | Gate IITC/Leaflet hooks on `status.connected === true`; answer heartbeat pings on demand | Leaving IITC hooks or background `setInterval` active while disconnected |
| Viewport entity queries | Reuse `viewport-entities.ts` (hoist `map.getBounds()` once, `normalizeTeam` before filter) | Calling `getBounds()` per entity or comparing raw team strings |
| Pagination snapshots | Use `SnapshotPaginator` (skip storage for single-page results, self-clearing TTL sweep) | Retaining snapshots forever or storing single-page queries |
| Destructive tools | Set `destructive: true` + `DESTRUCTIVE_ANNOTATIONS` and block in broker `--read-only` | Registering mutating game actions without `destructiveHint: true` |
| Deferred promises | `Promise.withResolvers()` | Manual `new Promise((resolve, reject) => ...)` |
| Build artifact | Keep `dist/server/cli.mjs` rebuilt and committed (`git add -f dist/server/cli.mjs`) | Shipping stale CLI bundle for `npx` users |
| Resonator energy | Normalize raw XM to 0–100% | Returning raw XM integers |
| Connecting-phase events | Preserve `bridge.ready` while connecting; drop noisy non-ready events while disconnected | Clearing `bridge.ready` or unboundedly queueing events |
| Return values | Plain JSON DTOs only | Returning DOM nodes, Leaflet objects, or functions |

## Verification

```bash
npm run typecheck && npm run lint && npm run build && npm test && npm run test:smoke
```
