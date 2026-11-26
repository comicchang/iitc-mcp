import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SnapshotPaginator } from "../src/snapshot-paginator.js";

describe("SnapshotPaginator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips storing a snapshot when all items fit on a single page", () => {
    const paginator = new SnapshotPaginator();
    const res = paginator.paginate(["a", "b", "c"], { limit: 10 });

    expect(res.items).toEqual(["a", "b", "c"]);
    expect(res.nextCursor).toBeUndefined();
    expect(res.complete).toBe(false);
    expect(res.reason).toBe("IITC_VIEWPORT_CACHE");
    expect(paginator.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stores snapshot only when more pages exist and paginates to completion", () => {
    const paginator = new SnapshotPaginator();
    const p1 = paginator.paginate(["a", "b", "c", "d", "e"], { limit: 2 });

    expect(p1.items).toEqual(["a", "b"]);
    expect(p1.nextCursor).toBeDefined();
    expect(paginator.size).toBe(1);

    const p2 = paginator.paginate([], { limit: 2, cursor: p1.nextCursor });
    expect(p2.items).toEqual(["c", "d"]);
    expect(p2.nextCursor).toBeDefined();

    const p3 = paginator.paginate([], { limit: 2, cursor: p2.nextCursor });
    expect(p3.items).toEqual(["e"]);
    expect(p3.nextCursor).toBeUndefined();
  });

  it("auto-sweeps expired snapshots after TTL and leaves zero idle timers", async () => {
    const paginator = new SnapshotPaginator({ ttlMs: 30_000 });
    paginator.paginate(["a", "b", "c"], { limit: 1 });

    expect(paginator.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(paginator.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("deletes expired snapshot on access even if accessed right past TTL", () => {
    const paginator = new SnapshotPaginator({ ttlMs: 1_000 });
    const p1 = paginator.paginate(["a", "b"], { limit: 1 });
    expect(paginator.size).toBe(1);

    // Advance system clock without running timers
    vi.setSystemTime(Date.now() + 1_500);

    expect(() => paginator.paginate([], { limit: 1, cursor: p1.nextCursor })).toThrow();
    expect(paginator.size).toBe(0);
  });

  it("enforces bounded LRU capacity", () => {
    const paginator = new SnapshotPaginator({ maxSnapshots: 2 });
    const p1 = paginator.paginate(["1", "2"], { limit: 1 });
    const p2 = paginator.paginate(["3", "4"], { limit: 1 });
    const p3 = paginator.paginate(["5", "6"], { limit: 1 });

    expect(paginator.size).toBe(2);
    expect(() => paginator.paginate([], { limit: 1, cursor: p1.nextCursor })).toThrow();
    expect(paginator.paginate([], { limit: 1, cursor: p2.nextCursor }).items).toEqual(["4"]);
    expect(paginator.paginate([], { limit: 1, cursor: p3.nextCursor }).items).toEqual(["6"]);
  });

  it("clear() releases all snapshots and cancels pending sweep timer", () => {
    const paginator = new SnapshotPaginator();
    paginator.paginate(["a", "b"], { limit: 1 });
    expect(paginator.size).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    paginator.clear();
    expect(paginator.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
