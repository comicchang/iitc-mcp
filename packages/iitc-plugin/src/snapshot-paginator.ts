/**
 * Snapshot Paginator — cursor-based pagination with bounded LRU storage and self-clearing TTL GC.
 * Skips storing snapshots when results fit on a single page so idle memory stays zero.
 */
import {
  DEFAULT_PAGE_LIMIT,
  MAX_SNAPSHOTS,
  SNAPSHOT_TTL_MS,
  type BridgeError,
} from "@iitc-mcp/protocol";

interface Snapshot {
  id: string;
  items: unknown[];
  createdAt: number;
}

export interface SnapshotPaginatorOptions {
  maxSnapshots?: number;
  ttlMs?: number;
  defaultLimit?: number;
}

export interface PaginateInput {
  limit?: number;
  cursor?: string;
}

export interface PaginateResult<T> {
  items: T[];
  nextCursor?: string;
  complete: false;
  reason: "IITC_VIEWPORT_CACHE";
}

function cursorError(message: string): BridgeError {
  return {
    code: "INVALID_ARGUMENT",
    message,
    retryable: false,
    details: { reason: "CURSOR_INVALID_OR_EXPIRED" },
  };
}

export class SnapshotPaginator {
  private readonly snapshots = new Map<string, Snapshot>();
  private readonly maxSnapshots: number;
  private readonly ttlMs: number;
  private readonly defaultLimit: number;
  private counter = 0;
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts?: SnapshotPaginatorOptions) {
    this.maxSnapshots = opts?.maxSnapshots ?? MAX_SNAPSHOTS;
    this.ttlMs = opts?.ttlMs ?? SNAPSHOT_TTL_MS;
    this.defaultLimit = opts?.defaultLimit ?? DEFAULT_PAGE_LIMIT;
  }

  /** Number of snapshots currently retained in memory. */
  get size(): number {
    return this.snapshots.size;
  }

  /** Slice a result list into a page, retaining a bounded TTL snapshot only when more pages exist. */
  paginate<T>(items: T[], input: PaginateInput): PaginateResult<T> {
    const limit = input.limit ?? this.defaultLimit;
    const now = Date.now();
    this.sweepExpired(now);

    if (input.cursor) {
      const decoded = this.decodeCursor(input.cursor);
      const snap = this.snapshots.get(decoded.snapshotId);
      if (!snap) {
        throw cursorError("Cursor expired or invalid");
      }
      if (now - snap.createdAt >= this.ttlMs) {
        this.snapshots.delete(decoded.snapshotId);
        this.scheduleSweep(now);
        throw cursorError("Cursor expired or invalid");
      }

      // Refresh LRU order while preserving original createdAt for TTL expiry
      this.snapshots.delete(decoded.snapshotId);
      this.snapshots.set(decoded.snapshotId, snap);

      const page = snap.items.slice(decoded.offset, decoded.offset + limit) as T[];
      const nextOffset = decoded.offset + limit;
      const nextCursor = nextOffset < snap.items.length
        ? this.encodeCursor(decoded.snapshotId, nextOffset)
        : undefined;

      return { items: page, nextCursor, complete: false, reason: "IITC_VIEWPORT_CACHE" };
    }

    const page = items.slice(0, limit);
    if (items.length <= limit) {
      return { items: page, nextCursor: undefined, complete: false, reason: "IITC_VIEWPORT_CACHE" };
    }

    const snapshotId = `snap-${++this.counter}`;
    this.snapshots.set(snapshotId, {
      id: snapshotId,
      items,
      createdAt: now,
    });
    while (this.snapshots.size > this.maxSnapshots) {
      const oldestKey = this.snapshots.keys().next().value;
      if (oldestKey === undefined) break;
      this.snapshots.delete(oldestKey);
    }
    this.scheduleSweep(now);

    return {
      items: page,
      nextCursor: this.encodeCursor(snapshotId, limit),
      complete: false,
      reason: "IITC_VIEWPORT_CACHE",
    };
  }

  /** Release all retained snapshots and cancel any pending expiry sweep timer. */
  clear(): void {
    this.snapshots.clear();
    if (this.sweepTimer !== null) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private encodeCursor(snapshotId: string, offset: number): string {
    return btoa(JSON.stringify({ snapshotId, offset }));
  }

  private decodeCursor(cursor: string): { snapshotId: string; offset: number } {
    try {
      const parsed = JSON.parse(atob(cursor)) as { snapshotId?: unknown; offset?: unknown };
      if (
        typeof parsed?.snapshotId !== "string" ||
        !parsed.snapshotId ||
        typeof parsed.offset !== "number" ||
        !Number.isInteger(parsed.offset) ||
        parsed.offset < 0
      ) {
        throw cursorError("Invalid cursor format");
      }
      return { snapshotId: parsed.snapshotId, offset: parsed.offset };
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err) throw err;
      throw cursorError("Invalid cursor format");
    }
  }

  private sweepExpired(now: number): void {
    let removed = false;
    for (const [id, snap] of this.snapshots) {
      if (now - snap.createdAt >= this.ttlMs) {
        this.snapshots.delete(id);
        removed = true;
      }
    }
    if (removed) {
      this.scheduleSweep(now);
    }
  }

  private scheduleSweep(now: number): void {
    if (this.sweepTimer !== null) {
      clearTimeout(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (this.snapshots.size === 0) return;

    let earliestExpiry = Infinity;
    for (const snap of this.snapshots.values()) {
      const expiry = snap.createdAt + this.ttlMs;
      if (expiry < earliestExpiry) earliestExpiry = expiry;
    }
    const delayMs = Math.max(0, earliestExpiry - now);
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null;
      const tickNow = Date.now();
      this.sweepExpired(tickNow);
      this.scheduleSweep(tickNow);
    }, delayMs);
  }
}
