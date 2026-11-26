# Contributing to IITC-MCP

Thank you for your interest in contributing to **iitc-mcp**!

## Prerequisites

- **Node.js** `>= 20.19`
- **npm** (workspaces enabled)
- Familiarity with [IITC](https://iitc.app/) and the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)

## Repository Structure

This repository is an npm workspaces monorepo with three packages:

| Package | Responsibility |
| --- | --- |
| `packages/protocol` | Shared Zod schemas, TypeScript types, error codes, and protocol constants (SSOT) |
| `packages/iitc-plugin` | Tampermonkey userscript: sandbox transport (`GM_xmlhttpRequest`) + page adapter + viewport entity & pagination helpers |
| `packages/mcp-server` | Node.js MCP server (`stdio`), loopback HTTP bridge, session broker, Bearer token manager, and CLI |

## Local Development

```bash
git clone https://github.com/comicchang/iitc-mcp.git
cd iitc-mcp
npm ci --legacy-peer-deps
npm run typecheck
npm run lint
npm run build
npm test
npm run test:smoke
```

## Adding a New MCP Tool

1. Add the bridge method name to `BRIDGE_METHODS` (and `DESTRUCTIVE_BRIDGE_METHODS` or `MAP_MUTATING_METHODS` if applicable) in `packages/protocol/src/constants.ts`.
2. Define input/output Zod schemas in `packages/protocol/src/schemas.ts`, infer types in `types.ts`, and re-export from `packages/protocol/src/index.ts`.
3. Implement the handler in `packages/iitc-plugin/src/page-adapter.ts` (returning plain JSON DTOs only — never DOM nodes, Leaflet instances, or functions).
4. Add a declarative `BridgeToolSpec` entry in `packages/mcp-server/src/mcp/server.ts` with accurate `ToolAnnotations` (`readOnlyHint`, `destructiveHint`).
5. Add unit tests across `packages/protocol/test`, `packages/iitc-plugin/test`, and `packages/mcp-server/test`.
6. Run `npm run build` so `dist/server/cli.mjs` stays synchronized for `npx` users.

## Coding Standards

- Strict TypeScript (`tsc -b`), zero ESLint errors or warnings.
- Use `Promise.withResolvers()` for deferred promises.
- Keep idle browser overhead at zero: never leave background timers or IITC hooks active while disconnected.
- Never log secrets (Bearer tokens, passcodes) to stdout or stderr.
- Keep `README.md` (English) and `README_zh.md` (Chinese) in sync for user-facing changes.

## License

Contributions are subject to the repository's [LICENSE](LICENSE).
