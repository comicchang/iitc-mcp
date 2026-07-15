# IITC MCP

**[English](README.md)** | **[中文](README_zh.md)**

将 [IITC（Ingress Intel Total Conversion）](https://github.com/IITC-CE/ingress-intel-total-conversion) 浏览器标签页暴露为 [MCP（Model Context Protocol）](https://modelcontextprotocol.io/) 服务器的双模块桥接工具。AI 代理和 MCP 兼容客户端可以读取地图状态、导航视口、搜索 Portal、收发 COMM、兑换 passcode——全部通过本地回环桥接完成。

## 架构

项目由三个包组成，职责清晰分离：浏览器 userscript 通过 `127.0.0.1` HTTP 与本地 Node.js MCP 服务器通信，服务器通过标准 stdio MCP 接口暴露给 AI 代理。

```mermaid
flowchart TB
    subgraph Browser["浏览器（Intel 标签页）"]
        IITC["IITC 页面上下文"]
        PA["页面适配器<br/>读取地图/Portal/Link<br/>调用 IITC API"]
        US["Userscript 沙箱<br/>GM_xmlhttpRequest<br/>轮询传输<br/>心跳"]
    end

    subgraph Local["本地机器"]
        BR["桥接 Broker<br/>HTTP: 127.0.0.1:27342<br/>会话与命令分发"]
        MCPS["MCP 服务器<br/>stdio 传输<br/>12 工具 + 3 资源"]
    end

    AGENT["AI 代理 / MCP 客户端<br/>Claude Desktop 等"]

    IITC --> PA
    PA <-->|CustomEvent 桥接| US
    US <-->|"POST /bridge/v1/*"| BR
    BR <--> MCPS
    MCPS <-->|"stdio MCP JSON-RPC"| AGENT
```

### 包结构

- **`packages/protocol`** — 桥接线协议的共享 Zod schema 和 TypeScript 类型，包括 DTO 和错误码
- **`packages/iitc-plugin`** — Tampermonkey userscript：页面适配器（IITC 页面上下文）+ 沙箱传输层
- **`packages/mcp-server`** — Node.js MCP 服务器：桥接 Broker、HTTP 服务器和 MCP 工具/资源注册

桥接协议是基于 `POST` 到 `127.0.0.1` 的半双工拉取式 RPC，专为 `GM_xmlhttpRequest` 约束设计。所有响应携带 `Content-Type: application/json; charset=utf-8` 和 `Cache-Control: no-store`。

## 环境要求

- **Node.js** >= 20.19
- **Tampermonkey**（或兼容的 userscript 管理器），Chrome 或 Firefox
- 可访问 `https://intel.ingress.com` 的浏览器

## 安装

### 1. 克隆并安装依赖

```bash
git clone https://github.com/comicchang/iitc-mcp.git
cd iitc-mcp
npm ci
```

### 2. 构建

```bash
npm run build
```

产出：
- `dist/iitc-mcp.user.js` — Tampermonkey userscript（安装此文件）
- `dist/iitc-mcp.meta.js` — `@updateURL`/`@downloadURL` 元数据文件
- `dist/server/cli.mjs` — 打包后的 Node.js 服务器入口

### 3. 安装 userscript

**快速安装（推荐）：** 在浏览器中打开以下 URL，Tampermonkey 会提示安装：

```
https://github.com/comicchang/iitc-mcp/releases/latest/download/iitc-mcp.user.js
```

**手动安装：**
1. 打开 Tampermonkey 控制面板（点击 Tampermonkey 图标 → **控制面板**）
2. 点击 **+** 标签页创建新脚本
3. 用文本编辑器打开 `dist/iitc-mcp.user.js`，复制全部内容
4. 粘贴到新脚本编辑器中，替换默认模板
5. 按 **Ctrl+S**（或 **Cmd+S**）保存

### 4. 启动 MCP 服务器

```bash
node dist/server/cli.mjs serve
```

或不构建直接运行（使用 tsx）：

```bash
npx tsx packages/mcp-server/src/cli.ts serve
```

服务器输出（stderr）：

```
Bridge origin: http://127.0.0.1:27342
iitc-mcp server ready on port 27342
```

自定义端口：`node dist/server/cli.mjs serve --bridge-port 12345`


## 使用

### 启动会话
1. 启动 MCP 服务器：`node dist/server/cli.mjs serve`
2. 打开 `https://intel.ingress.com` 并登录
3. IITC MCP 插件自动连接本地服务器——无需配对
4. Intel 页面右下角显示状态指示器，桥接活跃时显示 **🔗 MCP Connected**（连接时保持绿色）

### MCP 客户端配置

配置 MCP 客户端使用 stdio 传输。以 Claude Desktop 为例，在 `claude_desktop_config.json` 中添加：

```json
{
  "mcpServers": {
    "iitc": {
      "command": "node",
      "args": ["dist/server/cli.mjs", "serve"]
    }
  }
}
```

或使用 npx/tsx（无需构建）：

```json
{
  "mcpServers": {
    "iitc": {
      "command": "npx",
      "args": ["tsx", "packages/mcp-server/src/cli.ts", "serve"]
    }
  }
}
```

服务器通过 stdio 通信——stdin/stdout 承载 MCP JSON-RPC，所有日志输出到 stderr。

## 工具

| 工具 | 类别 | 说明 |
|------|------|------|
| `iitc_get_map_state` | 只读 | 获取当前地图中心、缩放、边界、选中 Portal 和数据状态 |
| `iitc_set_map_view` | UI | 设置地图视图到指定经纬度和缩放；等待 `moveend` |
| `iitc_fit_map_bounds` | UI | 将地图适配到指定边界框（南/西/北/东）；等待 `moveend` |
| `iitc_list_portals` | 只读 | 列出当前视口中的 Portal（分页，仅 IITC 缓存） |
| `iitc_list_links` | 只读 | 列出当前视口中的 Link（分页，仅 IITC 缓存） |
| `iitc_list_fields` | 只读 | 列出当前视口中的控制场（分页，仅 IITC 缓存） |
| `iitc_get_portal_details` | 只读 | 按 GUID 获取 Portal 详情：mod、共振器、所有者、历史、关联实体 |
| `iitc_select_portal` | UI | 在地图上选择 Portal；显示侧边栏详情 |
| `iitc_search` | 只读 | 通过 IITC 搜索功能搜索 Portal/地点（带静默窗口启发式） |
| `iitc_list_comm` | 只读 | 列出指定频道的 COMM 消息（`all`、`faction`、`alerts`）；可选刷新 |
| `iitc_send_comm` | **副作用** | 向 `all` 或 `faction` COMM 频道发送消息 |
| `iitc_redeem_code` | **副作用** | 提交 Ingress passcode 进行兑换（一次性，奖励物品/AP/XM） |

副作用工具（`iitc_send_comm`、`iitc_redeem_code`）标注了 `destructiveHint: true`、`idempotentHint: false`，**必须在用户明确批准后才能执行**。

列表工具使用基于游标的分页，带服务端快照（最多 32 个，TTL 30 秒）。结果仅限于 IITC 已在视口中加载的数据——桥接不会执行后台地图平移。

## 资源

| URI | 说明 |
|-----|------|
| `iitc://status` | 连接状态、IITC/插件版本、能力、当前地图状态 |
| `iitc://events/recent` | 最近 100 个规范化桥接事件（地图变化、实体更新、COMM） |
| `iitc://selection` | 当前选中 Portal 的详情，或 `null` |

当连接、地图、选择或事件状态变化时，资源通过 `notifications/resources/updated` 自动更新。


## 故障排除

### Intel 页面显示"MCP Disconnected"

- 检查 MCP 服务器是否正在运行（终端中 `node dist/server/cli.mjs serve` 是否活跃）
- 确认防火墙未阻止 `127.0.0.1:27342`
- 检查浏览器控制台（F12）中的 `[iitc-mcp]` 日志消息

### 工具返回 `NOT_READY` 错误

- 等待 IITC 在 Intel 页面上完全加载（所有地图瓦片、Portal 数据）
- 确认 IITC MCP Bridge userscript 已安装并在 Tampermonkey 中启用
- 检查浏览器控制台（F12）中的 `[iitc-mcp]` 日志消息

### "SESSION_CONFLICT" 错误

- 只有一个 Intel 标签页可以持有活跃的桥接会话
- 关闭另一个 Intel 标签页，或等待 45 秒让旧会话租约过期
- 租约清除后第二个标签页会自动连接


### 连接超时或网络错误
- 确认服务器绑定到 `127.0.0.1`（不是 `localhost`——某些系统将 `localhost` 解析为 `::1`，服务器不在该地址监听）
- 检查是否有其他进程占用端口 27342：`lsof -i :27342`
- 尝试自定义端口：`node dist/server/cli.mjs serve --bridge-port 12345`
- 检查防火墙或安全软件是否阻止 localhost 连接

### 插件未出现在 Tampermonkey 菜单中

- 确认 userscript 匹配 `https://intel.ingress.com/*`——在 Tampermonkey 编辑器中检查 `@match` 指令
- 确保 Tampermonkey 已启用（图标不应为灰色）
- 尝试在 Tampermonkey 控制面板中禁用并重新启用脚本

## 安全模型

- **仅回环**：HTTP 桥接仅绑定 `127.0.0.1`，无外部网络访问，无需 token 认证
- **CSP 合规**：页面适配器使用兼容 Intel `script-src` CSP 的内联 `<script>` 标签注入模式，不使用 `eval`、`onclick` 或 `unsafeWindow` 绕过
- **单标签页**：只有一个 Intel 标签页可以持有活跃会话，第二个标签页收到 HTTP 409
- **无数据泄露**：所有通信保留在本地机器上，不向外部服务器发送数据
- **COMM 和 passcode**：passcode 和 COMM 文本仅保留在浏览器内存中——它们由 IITC 发送到 Niantic 服务器，但从不本地存储或发送给 MCP 客户端（除非工具明确返回）

## 构建

```bash
npm ci              # 安装依赖
npm run typecheck   # TypeScript 严格模式编译检查 (tsc -b)
npm run build       # typecheck + esbuild 打包
npm run lint        # ESLint 检查所有包、测试和脚本
```

构建脚本使用 esbuild 产出三个制品：
1. **Userscript 包** (`dist/iitc-mcp.user.js`) — 页面适配器 + page-entry 打包为 IIFE，由沙箱层注入，沙箱层本身也被打包到最终 userscript 中
2. **元数据文件** (`dist/iitc-mcp.meta.js`) — 独立的 `@updateURL`/`@downloadURL` 元数据
3. **服务器入口** (`dist/server/cli.mjs`) — 打包后的 Node.js ESM 入口

## 测试

```bash
npm test             # 单元测试 (Vitest) — 所有包共 161 个测试
npm run test:modules # 集成测试 (Playwright) — 浏览器 + 真实 CLI 子进程
npm run test:smoke   # 冒烟测试 — 无浏览器断开状态、NOT_READY 错误
```

### 测试架构

- **单元测试** (`packages/*/test/`) — 使用 Vitest，配合伪 IITC 全局变量、伪 `GM_*` API、伪计时器和临时端口，零真实网络访问
- **模块测试** (`npm run test:modules`) — Playwright Chromium + Firefox，通过 GM shim 加载真实 userscript 包、临时桥接服务器和 MCP `StdioClientTransport` 驱动真实 CLI 子进程
- **冒烟测试** (`test/smoke/`) — 快速断言：无浏览器 → `iitc://status` 显示断开，所有 IITC 工具返回 `NOT_READY`

所有测试均不需要真实 Intel 凭据或到 Niantic 服务器的网络访问。

## 许可证

[MIT](https://opensource.org/licenses/MIT)
