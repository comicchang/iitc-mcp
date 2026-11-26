/**
 * Page Entry — IITC 插件入口
 * wrapper(plugin_info) / window.plugin.iitcMcp / bootPlugins.push(setup)
 * 通过 CustomEvent 与 sandbox transport 通信
 *
 * Zero idle overhead design:
 * - IITC/Leaflet hooks are registered ONLY while the bridge is connected.
 * - Disconnecting unregisters all hooks, drops queued entity diffs, and clears snapshots.
 * - Heartbeats are answered on demand in response to transport pings (no idle page timer).
 */
import { PageAdapter } from "./page-adapter.js";
import type { BridgeCommand, BridgeEvent } from "@iitc-mcp/protocol";

interface WindowWithPlugin extends Window {
  plugin: Record<string, Record<string, unknown>>;
  bootPlugins?: Array<(info: unknown) => void>;
  iitcLoaded?: boolean;
  map?: {
    on: (event: string, handler: () => void) => void;
    off: (event: string, handler: () => void) => void;
  };
  addHook(event: string, handler: (...args: unknown[]) => void): void;
  removeHook(event: string, handler: (...args: unknown[]) => void): void;
}

declare function wrapper(plugin_info: unknown): void;

// ─── 生命周期与事件管理 ───────────────────────────────

const DEBOUNCE_MS = 250;

let pageAdapter: PageAdapter | null = null;
let channelId: string | null = null;
let entityChangeTimer: ReturnType<typeof setTimeout> | undefined;
let pendingEntityChanges: Array<{ type: string; guid: string }> = [];
let sequence = 0;
let hooksRegistered = false;

// MCP status is displayed as a standard IITC Toolbox entry.
let statusToolboxLink: HTMLAnchorElement | null = null;
let bridgeConnected = false;

// ─── MCP 状态 ─────────────────────────────────────────

/** 创建 IITC Toolbox 中的 MCP 状态入口。 */
function createStatusIndicator(): void {
  if (statusToolboxLink) return;

  const toolbox = document.getElementById("toolbox");
  if (!toolbox) return;

  const link = document.createElement("a");
  link.id = "iitc-mcp-status";
  link.textContent = "MCP: Connecting";
  link.title = "MCP bridge connecting";
  link.style.setProperty("color", "#607D8B", "important");
  link.addEventListener("click", () => {
    if (!bridgeConnected && channelId) {
      document.dispatchEvent(new CustomEvent(`iitc-mcp:${channelId}:reconnect`));
    }
  });

  toolbox.appendChild(link);
  statusToolboxLink = link;
}

/** 更新 Toolbox 中的 MCP bridge 状态。 */
function showStatusIndicator(connected: boolean): void {
  bridgeConnected = connected;
  if (!statusToolboxLink) return;

  if (connected) {
    statusToolboxLink.textContent = "MCP";
    statusToolboxLink.title = "MCP bridge connected";
    statusToolboxLink.style.setProperty("color", "#4CAF50", "important");
  } else {
    statusToolboxLink.textContent = "MCP";
    statusToolboxLink.title = "MCP bridge disconnected; click to reconnect";
    statusToolboxLink.style.setProperty("color", "#F44336", "important");
  }
}

// 保存 handler 引用以便清理时移除
let cmdListener: EventListener | null = null;
let statusListener: EventListener | null = null;
let heartbeatListener: EventListener | null = null;
let beforeUnloadListener: (() => void) | null = null;
let moveEndHandler: (() => void) | null = null;
let mapDataRefreshHandler: ((...args: unknown[]) => void) | null = null;
let portalSelectedHandler: ((...args: unknown[]) => void) | null = null;
let entityHandlers: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];

/** pageMain — 由 sandbox 注入脚本调用 */
function pageMain(channel: string): void {
  // IITC augments the page-global Window outside TypeScript's DOM declarations.
  const w = window as unknown as WindowWithPlugin;
  const initialize = (): void => {
    if (pageAdapter && channelId === channel) return;

    channelId = channel;
    pageAdapter = new PageAdapter();

    // 创建状态指示器
    createStatusIndicator();

    // 监听来自 sandbox 的命令
    cmdListener = ((evt: CustomEvent) => {
      if (!pageAdapter || !channelId) return;
      const command = evt.detail as BridgeCommand;
      pageAdapter.handleCommand(command).then((completion) => {
        if (!channelId) return;
        document.dispatchEvent(
          new CustomEvent(`iitc-mcp:${channelId}:completion`, { detail: completion }),
        );
      });
    }) as EventListener;
    document.addEventListener(`iitc-mcp:${channelId}:command`, cmdListener);

    // 监听连接状态变更，按需启停 IITC/Leaflet hooks（断连时零监听零开销）
    statusListener = ((evt: CustomEvent) => {
      const connected = evt.detail?.connected === true;
      showStatusIndicator(connected);
      if (connected) {
        registerHooks();
      } else {
        unregisterHooks();
        pageAdapter?.clearSnapshots();
      }
    }) as EventListener;
    document.addEventListener(`iitc-mcp:${channelId}:status`, statusListener);

    // 按需回复 sandbox 心跳 ping，避免常驻 page setInterval 定时器
    heartbeatListener = ((evt: CustomEvent) => {
      if (!channelId || evt.detail?.dir !== "ping") return;
      document.dispatchEvent(
        new CustomEvent(`iitc-mcp:${channelId}:heartbeat`, {
          detail: { type: "heartbeat", ts: Date.now() },
        }),
      );
    }) as EventListener;
    document.addEventListener(`iitc-mcp:${channelId}:heartbeat`, heartbeatListener);

    // 页面卸载时完整清理所有 listener 与 hooks
    beforeUnloadListener = () => cleanup();
    window.addEventListener("beforeunload", beforeUnloadListener);

    // 查询当前连接状态（若已连接则立即挂载 hooks）
    document.dispatchEvent(new CustomEvent(`iitc-mcp:${channelId}:status-request`));

    // 立即发送一次初始 heartbeat，满足 transport 首次 watchdog
    document.dispatchEvent(
      new CustomEvent(`iitc-mcp:${channelId}:heartbeat`, {
        detail: { type: "heartbeat", ts: Date.now() },
      }),
    );

    // 通知 sandbox: bridge ready
    dispatchEvent({
      eventId: crypto.randomUUID(),
      sequence: sequence++,
      occurredAt: new Date().toISOString(),
      type: "bridge.ready",
      payload: {},
    });
  };

  if (w.iitcLoaded) {
    initialize();
  } else {
    w.addHook("iitcLoaded", initialize);
  }
}

// ─── IITC Hook 注册与卸载 ────────────────────────────

function registerHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;

  const w = window as unknown as WindowWithPlugin;

  // 地图移动事件
  moveEndHandler = (): void => {
    dispatchEvent({
      eventId: crypto.randomUUID(),
      sequence: sequence++,
      occurredAt: new Date().toISOString(),
      type: "map.changed",
      payload: {},
    });
  };
  w.map?.on("moveend", moveEndHandler);

  // 地图数据刷新完成
  mapDataRefreshHandler = () => {
    dispatchEvent({
      eventId: crypto.randomUUID(),
      sequence: sequence++,
      occurredAt: new Date().toISOString(),
      type: "map.refresh.completed",
      payload: {},
    });
  };
  w.addHook("mapDataRefreshEnd", mapDataRefreshHandler);

  // Portal 选中
  portalSelectedHandler = (...args: unknown[]) => {
    const guid = args[0] as string | undefined;
    dispatchEvent({
      eventId: crypto.randomUUID(),
      sequence: sequence++,
      occurredAt: new Date().toISOString(),
      type: "portal.selected",
      payload: { guid: guid ?? null },
    });
  };
  w.addHook("portalSelected", portalSelectedHandler);

  // 实体变动 — 250ms 合并
  const entityHooks = [
    { event: "portalAdded", type: "portal.added" },
    { event: "portalRemoved", type: "portal.removed" },
    { event: "linkAdded", type: "link.added" },
    { event: "linkRemoved", type: "link.removed" },
    { event: "fieldAdded", type: "field.added" },
    { event: "fieldRemoved", type: "field.removed" },
  ];

  for (const hook of entityHooks) {
    const handler = (...args: unknown[]) => {
      const guid = args[0] as string | undefined;
      if (!guid) return;
      pendingEntityChanges.push({ type: hook.type, guid });
      if (!entityChangeTimer) {
        entityChangeTimer = setTimeout(flushEntityChanges, DEBOUNCE_MS);
      }
    };
    entityHandlers.push({ event: hook.event, handler });
    w.addHook(hook.event, handler);
  }
}

function unregisterHooks(): void {
  clearTimeout(entityChangeTimer);
  entityChangeTimer = undefined;
  pendingEntityChanges = [];

  if (!hooksRegistered) return;

  const w = window as unknown as WindowWithPlugin;

  if (moveEndHandler) {
    w.map?.off("moveend", moveEndHandler);
    moveEndHandler = null;
  }
  if (mapDataRefreshHandler) {
    w.removeHook("mapDataRefreshEnd", mapDataRefreshHandler);
    mapDataRefreshHandler = null;
  }
  if (portalSelectedHandler) {
    w.removeHook("portalSelected", portalSelectedHandler);
    portalSelectedHandler = null;
  }
  for (const { event, handler } of entityHandlers) {
    w.removeHook(event, handler);
  }
  entityHandlers = [];
  hooksRegistered = false;
}

function flushEntityChanges(): void {
  entityChangeTimer = undefined;
  if (pendingEntityChanges.length === 0) return;
  const changes = pendingEntityChanges;
  pendingEntityChanges = [];

  dispatchEvent({
    eventId: crypto.randomUUID(),
    sequence: sequence++,
    occurredAt: new Date().toISOString(),
    type: "entities.changed",
    payload: { changes },
  });
}

function dispatchEvent(event: BridgeEvent): void {
  if (!channelId) return;
  // 限制单个 event detail JSON 大小为 512 KiB
  const json = JSON.stringify(event);
  if (json.length > 512 * 1024) {
    // 丢弃过大的事件
    return;
  }
  document.dispatchEvent(
    new CustomEvent(`iitc-mcp:${channelId}:event`, { detail: event }),
  );
}

function cleanup(): void {
  unregisterHooks();
  pageAdapter?.clearSnapshots();

  // 显示断开状态
  showStatusIndicator(false);

  if (channelId) {
    if (cmdListener) {
      document.removeEventListener(`iitc-mcp:${channelId}:command`, cmdListener);
      cmdListener = null;
    }
    if (statusListener) {
      document.removeEventListener(`iitc-mcp:${channelId}:status`, statusListener);
      statusListener = null;
    }
    if (heartbeatListener) {
      document.removeEventListener(`iitc-mcp:${channelId}:heartbeat`, heartbeatListener);
      heartbeatListener = null;
    }
  }

  if (beforeUnloadListener) {
    window.removeEventListener("beforeunload", beforeUnloadListener);
    beforeUnloadListener = null;
  }

  pageAdapter = null;
  channelId = null;
}

// ─── wrapper 入口 ────────────────────────────────────

function setup(_pluginInfo: unknown): void {
  // 插件加载完成，等待 sandbox 调用 pageMain
  // pageMain 由 sandbox 注入的 <script> 调用
}

// IITC 插件标准入口
if (typeof wrapper === "function") {
  wrapper(function (plugin_info: unknown) {
    const w = window as unknown as WindowWithPlugin;
    w.plugin.iitcMcp = {};

    // 注册到 bootPlugins 或立即 setup
    if (w.bootPlugins) {
      w.bootPlugins.push(setup);
    } else {
      setup(plugin_info);
    }
  });
}

// 导出给 sandbox 注入脚本调用
(window as unknown as Record<string, unknown>).iitcMcpPageMain = pageMain;
(window as unknown as Record<string, unknown>).iitcMcpCleanup = cleanup;
