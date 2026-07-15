/** 协议版本号 */
export const protocolVersion = 1;

/** Bridge lease 时长 */
export const LEASE_MS = 45_000;

/** Heartbeat 间隔 */
export const HEARTBEAT_MS = 15_000;

/** 最大 body 字节数 */
export const MAX_BODY_BYTES = 1_048_576;

/** Long-poll 最大等待时间 */
export const POLL_TIMEOUT_MS = 25_000;

/** 默认分页 limit */
export const DEFAULT_PAGE_LIMIT = 500;

/** 最大分页 limit */
export const MAX_PAGE_LIMIT = 2000;

/** Snapshot 最大数量 */
export const MAX_SNAPSHOTS = 32;

/** Snapshot TTL */
export const SNAPSHOT_TTL_MS = 30_000;

/** Bridge error codes */
export const BRIDGE_ERROR_CODES = [
  "INVALID_ARGUMENT",
  "NOT_READY",
  "NOT_FOUND",
  "UPSTREAM_ERROR",
  "TIMEOUT",
  "CANCELLED",
  "UNAUTHORIZED",
  "UNSUPPORTED",
  "INTERNAL",
] as const;

/** Bridge methods */
export const BRIDGE_METHODS = [
  "map.get_state",
  "map.set_view",
  "map.fit_bounds",
  "entities.list_portals",
  "map.search_region",
  "entities.list_links",
  "entities.list_fields",
  "portal.get_details",
  "portal.select",
  "search.query",
  "comm.list",
  "self.get_info",
  "tracker.list_players",
  "tracker.get_trail",
  "comm.send",
  "redeem.submit",
] as const;

/** Bridge events */
export const BRIDGE_EVENTS = [
  "bridge.ready",
  "map.changed",
  "map.refresh.completed",
  "portal.selected",
  "entities.changed",
  "comm.received",
] as const;

/** Team codes */
export const TEAM_CODES = ["N", "R", "E", "M"] as const;

/** Comm channels */
export const COMM_CHANNELS = ["all", "faction", "alerts"] as const;

/** Detail levels */
export const DETAIL_LEVELS = ["core", "summary", "detailed"] as const;
