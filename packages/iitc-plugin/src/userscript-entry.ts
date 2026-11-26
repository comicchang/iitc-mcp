/**
 * Userscript Entry — Tampermonkey sandbox 入口
 * 直接连接 localhost bridge，无需配对/token
 */

import { BridgeTransport, validateOrigin } from "./transport.js";
import type { GMXmlHttpRequest } from "./transport.js";
// ─── Userscript Metadata (构建时由 build.ts 生成) ────────
// @match、@grant、@connect、@updateURL、@downloadURL 由构建脚本注入
// 版本号从 package.json 读取，不在此硬编码

/** 构建时由 esbuild 注入的 page adapter 源码 */
declare const PAGE_ADAPTER_SOURCE: string;
/** 构建时由 esbuild 注入的插件版本号 */
declare const PLUGIN_VERSION: string | undefined;

// ─── GM 函数声明 (Tampermonkey sandbox 全局) ──────────

declare function GM_getValue(key: string, defaultValue: string): string;

declare function GM_xmlhttpRequest(details: {
  method: string;
  url: string;
  headers: Record<string, string>;
  data?: string;
  redirect?: string;
  onload: (resp: {
    status: number;
    statusText: string;
    responseText: string;
    responseHeaders: string;
    finalUrl: string;
  }) => void;
  onerror: (resp: {
    status: number;
    statusText: string;
    responseText: string;
    responseHeaders: string;
    finalUrl: string;
  }) => void;
  ontimeout: (resp: {
    status: number;
    statusText: string;
    responseText: string;
    responseHeaders: string;
    finalUrl: string;
  }) => void;
}): void;

// ─── 工具函数 ─────────────────────────────────────────

/** 生成 128-bit base64url channelId */
function generateChannelId(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let binary = "";
  for (const byte of buf) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** 注入 page adapter 到页面上下文 */
function injectPageAdapter(channelId: string): void {
  const script = document.createElement("script");
  script.textContent = PAGE_ADAPTER_SOURCE + "\n;iitcMcpPageMain(" + JSON.stringify(channelId) + ");";
  (document.head ?? document.documentElement).appendChild(script);
  script.remove();
}

function dispatchBridgeStatus(channelId: string, connected: boolean): void {
  document.dispatchEvent(
    new CustomEvent(`iitc-mcp:${channelId}:status`, { detail: { connected } }),
  );
}

// ─── 入口 ─────────────────────────────────────────────

function resolveConfiguredOrigin(): string | undefined {
  if (typeof GM_getValue !== "function") return undefined;
  try {
    const raw = GM_getValue("iitc_mcp_origin", "").trim();
    if (raw && validateOrigin(raw)) return raw;
  } catch {
    // ignore storage errors and fall back to default loopback origin
  }
  return undefined;
}

function main(): void {
  const channelId = generateChannelId();
  const pluginVersion = typeof PLUGIN_VERSION === "string" ? PLUGIN_VERSION : undefined;
  const transport = new BridgeTransport({
    channelId,
    origin: resolveConfiguredOrigin(),
    pluginVersion,
    gmXmlHttpRequest: GM_xmlhttpRequest as unknown as GMXmlHttpRequest,
    onConnectionChange: (connected) => {
      console.log(`[iitc-mcp] ${connected ? "Connected" : "Disconnected"} to bridge`);
      dispatchBridgeStatus(channelId, connected);
    },
  });
  document.addEventListener(`iitc-mcp:${channelId}:reconnect`, () => {
    transport.reconnect();
  });

  // start() synchronously registers sandbox listeners before its first await.
  // Inject only afterward so the synchronous bridge.ready event is observed.
  void transport.start();
  injectPageAdapter(channelId);

  // 页面卸载时清理
  window.addEventListener("beforeunload", () => {
    transport.stop();
  });
}

// ─── 启动 ─────────────────────────────────────────────

main();
