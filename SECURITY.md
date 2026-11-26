# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in **iitc-mcp**, please **do not** open a public GitHub issue.
Instead, report it privately via [GitHub Security Advisories](https://github.com/comicchang/iitc-mcp/security/advisories/new) with reproduction steps and impact assessment.

## Security Model & Threat Boundaries

`iitc-mcp` bridges a local browser tab running IITC on `https://intel.ingress.com` to local MCP clients over loopback HTTP and stdio.

### 1. Loopback-Only Binding

- The HTTP bridge server binds strictly to `127.0.0.1` (default port `27342`, configurable via `--port` / `--bridge-port`).
- Incoming requests must present a loopback `Host` header (`127.0.0.1:<port>` or `localhost:<port>`); DNS-rebinding attempts with other hostnames are rejected with `400 INVALID_ARGUMENT`.
- All JSON responses set `Cache-Control: no-store`.
- Request bodies are hard-capped at `1 MiB` (`413` on overflow).
- Userscript `GM_xmlhttpRequest` calls enforce `redirect: "error"` and verify `finalUrl` stays on the configured `http://127.0.0.1:<port>` origin.

### 2. Bearer Authentication on `/mcp/*` Control Plane

- The `/mcp/*` control-plane endpoints (`/mcp/status`, `/mcp/events`, `/mcp/call`) used in shared-broker mode enforce `Authorization: Bearer <token>` using constant-time comparison (`crypto.timingSafeEqual`).
- Tokens are stored at `~/.config/iitc-mcp/token` with `0600` permissions (or supplied via `IITC_MCP_TOKEN`) and can be rotated via `iitc-mcp token rotate`.
- Startup logs never print the raw Bearer token to stderr.
- `--no-auth` disables `/mcp/*` Bearer verification for trusted single-user setups and should **never** be used on shared machines.
- `/healthz` is an unauthenticated liveness probe exposing only `{ ok, connected, readOnly }`.
- `/bridge/v1/*` endpoints are called by the local userscript over `127.0.0.1` without a pairing token and enforce single-tab session ownership (a second tab receives `409 SESSION_CONFLICT`).

### 3. Read-Only Mode (`--read-only`)

- Starting `iitc-mcp serve --read-only` or `iitc-mcp broker --read-only` provides two layers of protection:
  1. **MCP surface**: Destructive tools (`iitc_send_comm`, `iitc_redeem_code`) are not registered.
  2. **Broker enforcement**: Even if a remote client calls `/mcp/call` directly with `"comm.send"` or `"redeem.submit"`, the broker rejects it with `UNSUPPORTED`.
- Destructive tools are annotated with `destructiveHint: true` and `idempotentHint: false` so MCP hosts can prompt for user confirmation.

### 4. Browser Sandbox & CSP Compliance

- Page-context injection uses an inline `<script>` element compatible with Intel's `script-src` CSP, without `eval`, `new Function`, or `unsafeWindow` bypasses.
- Sandbox ↔ page communication uses per-session 128-bit random `CustomEvent` channel IDs on `document`.
- Passcodes and COMM messages are sent directly by IITC to Ingress servers from browser memory and are never written to disk by `iitc-mcp`.

### 5. External Network Calls Transparency

- Almost all operations stay strictly on `127.0.0.1` and reuse data already loaded by IITC in your browser.
- **Exception — `iitc_search_region`**: When an agent explicitly invokes `iitc_search_region(term)`, the page adapter queries the public OpenStreetMap Nominatim API (`https://nominatim.openstreetmap.org/search`) with the search term to resolve a geographic bounding box before fitting the map viewport. No Ingress account credentials, portal data, or tokens are included in this request.
