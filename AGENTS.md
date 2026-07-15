# AGENTS.md

项目: iitc-mcp — IITC ↔ MCP 桥接（Browser userscript ↔ HTTP bridge ↔ MCP stdio server）。
编码规则同时被 CLAUDE.md 和 GEMINI.md 引用。

## 新建工具流程

1. `packages/protocol/src/constants.ts` → `BRIDGE_METHODS` 数组加一项
2. `packages/iitc-plugin/src/page-adapter.ts` → dispatch switch 加 case + 实现 handler
3. `packages/protocol/src/schemas.ts` → Zod schema，`index.ts` → export
4. `packages/mcp-server/src/mcp/server.ts` → `M` 常量 + `registerTool`

## 决策表

| 场景 | ✅ 做法 | ❌ 避免 |
| ------ | -------- | -------- |
| 跨 context 事件 | `document.dispatchEvent` | 不用 `window`（Tampermonkey sandbox 隔离不可靠） |
| 页面初始化 | `window.iitcLoaded` hook | 不轮询 `window.map` |
| 只读查询 | page adapter 直返 JSON DTO | 不走 `GM_xmlhttpRequest` |
| 副作用操作 | MCP tool 带 `annotations: { destructiveHint: true }` | 不可省略 annotation |
| Promise 构造 | `Promise.withResolvers()` | 不用 `new Promise((resolve,reject)=>{...})` |
| 构建产物 | `dist/server/cli.mjs` 需提交到仓库 | 不能依赖本地 build |
| 共振器能量 | 归一化为 0-100 百分比 | 不可透传原始 XM 值 |
| 连接期间事件 | `connectOnce()` 保留 `pendingEvents` | 不可清空会导致 bridge.ready 丢失 |
| 返回数据 | 纯 JSON DTO | 不可返回 DOM/Lefalet 对象/函数 |

## 验证命令

```bash
npm run typecheck && npx vitest run packages/iitc-plugin/test && npm run build
```

全量: `npm test`
启动: `npx github:comicchang/iitc-mcp serve`

## 代码片段

```typescript
// page-adapter.ts — 加 dispatch case
case "map.search_region": return this.searchRegion(w, command.params as { term: string });

// server.ts — 注册 MCP tool
this.mcpServer.registerTool("iitc_xxx", {
  description: "...",
  inputSchema: XxxInputSchema,
  outputSchema: XxxOutputSchema,
}, async (args, extra) => {
  const result = await call(M.xxx, args, { signal: extra.signal, timeoutMs: 30_000 });
  return toolSuccess(result);
});
```
