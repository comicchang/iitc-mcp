# IITC-MCP

Bridge between [IITC](https://iitc.app/) (Ingress Intel Total Conversion) and MCP (Model Context Protocol) agents.
Let your AI assistant see the map, count portals, track players, and talk to COMM — without touching a mouse.

## Quick Start

```bash
git clone https://github.com/comicchang/iitc-mcp.git
cd iitc-mcp
npm ci --legacy-peer-deps
npm run build && npm test        # 61 tests, typecheck, 3 build artifacts
```

### Userscript

Install in Tampermonkey:

```
https://github.com/comicchang/iitc-mcp/releases/latest/download/iitc-mcp.user.js
```

Open [https://intel.ingress.com](https://intel.ingress.com). The bridge auto-connects — look for `MCP` in the IITC Toolbox (green = connected).
### Start MCP Server

```bash
npx github:comicchang/iitc-mcp serve
```

## MCP Tools (16 total)

| Tool | Description |
| ------ | ------------- |
| `iitc_get_map_state` | Map center, zoom, bounds, selected portal |
| `iitc_set_map_view` | Set map center and zoom |
| `iitc_fit_map_bounds` | Fit map to bounding box |
| `iitc_search_region` | Search named region via Nominatim → fit bounds → wait for data |
| `iitc_list_portals` | List portals in viewport (paginated) |
| `iitc_list_links` | List links in viewport (paginated) |
| `iitc_list_fields` | List control fields in viewport (paginated) |
| `iitc_get_portal_details` | Portal detail: mods, resonators, link/field GUIDs |
| `iitc_select_portal` | Select a portal on the map |
| `iitc_search` | Search portals by name |
| `iitc_list_comm` | Read COMM messages |
| `iitc_send_comm` | Send COMM message |
| `iitc_redeem_code` | Redeem a passcode |
| `iitc_get_self` | Your own faction, level, AP, XM |
| `iitc_list_players` | Tracked players with last position (Player Tracker) |
| `iitc_get_player_trail` | Single player's trail with timestamps |

## Usage Examples

Ask your AI assistant in natural language:

### Search a region and count portals

> 搜索静安雕塑公园，统计 portal 状态

```
iitc_search_region("静安雕塑公园")   → 围框 + 等数据加载
iitc_list_portals                   → 按阵营统绿/蓝/红/白数量
```

### Check a specific portal

> 青果巷赵宅现在什么颜色，连满 link 了吗

```
iitc_search("青果巷")               → 找到候选 Portal
iitc_get_portal_details(guid)       → 阵营/等级/血量/linkGuids
```

### See who's been active nearby

> 附近最近有谁在动

```
iitc_list_players                   → 玩家名/阵营/最近位置/动作
iitc_get_player_trail("playerName") → 完整轨迹
```

### Find high-value targets

> 区域内有哪些 L7+ Portal，哪些阵营占领的

```
iitc_search_region("目标区域")       → 围框
iitc_list_portals                   → 按 level 筛选 L7+
```

### Monitor COMM

> 看看 COMM 最近在聊什么

```
iitc_list_comm(channel="all")       → 最近消息
```

## Architecture

```
Browser (Intel Tab)              Local machine
┌──────────────────┐    ┌─────────────────────┐
│ IITC Page Context│    │ MCP Server (stdio)  │
│   ↕ CustomEvent  │    │   ↕ BridgeClient    │
│ Userscript       │◄──►│ Bridge Broker       │
│ (GM_xmlhttpRequest)│  │ (127.0.0.1:27342)  │
└──────────────────┘    └─────────────────────┘
                                  ▲
                                  │ stdio JSON-RPC
                            ┌─────┴─────┐
                            │ AI Agent   │
                            └───────────┘
```

Three packages:

- `packages/protocol` — shared Zod schemas
- `packages/iitc-plugin` — userscript (page adapter + transport)
- `packages/mcp-server` — Node.js MCP server (broker + HTTP + CLI)

## Development

```bash
npm run typecheck    # strict TypeScript
npm run build        # userscript + server
npm run lint         # ESLint
npm test             # unit tests (61)
npm run test:smoke   # no-browser smoke tests

# Start MCP server
npx tsx packages/mcp-server/src/cli.ts serve
```

## Oh My Pi Config

```json
"iitc-mcp": {
  "type": "stdio",
  "command": "/path/to/node_modules/.bin/tsx",
  "args": ["/path/to/packages/mcp-server/src/cli.ts", "serve"]
}
```

## License

See [LICENSE](LICENSE). Fork must preserve the same license. Only Enlightened players may use this software. Resistance and Machina are not welcome. Attempting to bypass these restrictions is prohibited.

**Enlightened** 💚
