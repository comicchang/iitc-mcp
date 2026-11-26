/**
 * Page Adapter — IITC 页面 API 适配层
 * 将 BridgeCommand 映射到 IITC page-level 调用
 * 只返回 JSON DTO，不返回 Leaflet 对象、DOM、HTML 或函数
 */
import type {
  BridgeCommand,
  BridgeCompletion,
  BridgeError,
  MapState,
  PortalDetails,
  SearchResult,
  CommMessage,
  RedeemResult,
  ListInput,
  RegionSummaryOutput,
  ExportGeoJsonInput,
  ExportGeoJsonOutput,
  GeoJsonFeature,
  SelfInfo,
  PlayerSummary,
  PlayerTrail,
  SearchRegionOutput,
} from "@iitc-mcp/protocol";
import {
  extractBounds,
  normalizeTeam,
  queryViewportFields,
  queryViewportLinks,
  queryViewportPortals,
  type IITCField,
  type IITCLink,
  type IITCPortal,
  type LeafletMap,
} from "./viewport-entities.js";
import { SnapshotPaginator } from "./snapshot-paginator.js";

// ─── IITC 全局类型声明 ─────────────────────────────────

interface PortalDetailStore {
  get(guid: string): Record<string, unknown> | undefined;
  isFresh(guid: string): boolean;
  request(guid: string): Promise<Record<string, unknown>>;
}

interface IITCSearch {
  doSearch(term: string, teamFilter: boolean): void;
  lastSearch: { results: Array<Record<string, unknown>> } | null;
}

interface IITCComm {
  _channelsData: Record<string, {
    guids: string[];
    data: Record<string, unknown[]>;
  }>;
  requestChannel(channel: string, isPublic: boolean): void;
}

interface PlayerTrackerEntry {
  team?: string;
  events?: Array<{
    latlngs?: [number, number][];
    time?: number;
    actions?: string[];
    name?: string;
    address?: string;
  }>;
}

interface WindowWithIITC extends Window {
  map: LeafletMap;
  portals: Record<string, IITCPortal>;
  links: Record<string, IITCLink>;
  fields: Record<string, IITCField>;
  portalDetail: PortalDetailStore;
  getPortalLinks(guid: string): { in: string[]; out: string[] };
  getPortalFields(guid: string): string[];
  selectedPortal: string | null;
  addHook(event: string, handler: (...args: unknown[]) => void): void;
  removeHook(event: string, handler: (...args: unknown[]) => void): void;
  runHooks(event: string, data?: unknown): void;
  postAjax(action: string, params: Record<string, unknown>, success: (data: unknown) => void, error: (err: unknown) => void): void;
  PLAYER?: Record<string, unknown>;
  setupPlayerStat?(): void;
  script_info?: { script?: { version?: string } };
  IITC?: {
    comm: IITCComm;
    search: IITCSearch;
  };
  mapDataRequest?: { activeRequestCount?: number; status?: string };
  plugin?: {
    playerTracker?: {
      stored?: Record<string, PlayerTrackerEntry>;
    };
  };
  renderPortalDetails?(guid: string): void;
}

/** Max XM capacity by resonator level (L1–L8). */
const MAX_XM: Record<number, number> = {
  1: 1000,
  2: 1500,
  3: 2000,
  4: 2500,
  5: 3000,
  6: 4000,
  7: 5000,
  8: 6000,
};

// ─── Page Adapter ──────────────────────────────────────

export class PageAdapter {
  private readonly paginator = new SnapshotPaginator();

  /** Release any cached pagination snapshots and expiry timers. */
  clearSnapshots(): void {
    this.paginator.clear();
  }

  /** Number of pagination snapshots currently retained in memory. */
  get snapshotCount(): number {
    return this.paginator.size;
  }

  /** 处理一条 BridgeCommand，返回 BridgeCompletion */
  async handleCommand(command: BridgeCommand): Promise<BridgeCompletion> {
    try {
      const result = await this.dispatch(command);
      return { id: command.id, ok: true, result };
    } catch (err: unknown) {
      return { id: command.id, ok: false, error: toBridgeError(err) };
    }
  }

  private async dispatch(command: BridgeCommand): Promise<unknown> {
    const w = window as unknown as WindowWithIITC;
    switch (command.method) {
      case "map.get_state": return this.getMapState(w);
      case "map.set_view": return this.setMapView(w, command.params as { lat: number; lng: number; zoom?: number });
      case "map.fit_bounds": return this.fitMapBounds(w, command.params as { south: number; west: number; north: number; east: number });
      case "map.search_region": return this.searchRegion(w, command.params as { term: string });
      case "self.get_info": return this.getSelfInfo(w);
      case "tracker.list_players": return this.listPlayers(w);
      case "tracker.get_trail": return this.getPlayerTrail(w, command.params as { name: string });
      case "entities.list_portals": return this.listPortals(w, command.params as ListInput);
      case "entities.list_links": return this.listLinks(w, command.params as ListInput);
      case "entities.list_fields": return this.listFields(w, command.params as ListInput);
      case "entities.region_summary": return this.getRegionSummary(w);
      case "entities.export_geojson": return this.exportGeoJson(w, (command.params ?? {}) as Partial<ExportGeoJsonInput>);
      case "portal.get_details": return this.getPortalDetails(w, command.params as { guid: string });
      case "portal.select": return this.selectPortal(w, command.params as { guid: string });
      case "search.query": return this.searchQuery(w, command.params as { term: string });
      case "comm.list": return this.commList(w, command.params as { channel: string; limit?: number; beforeMs?: number; refresh?: boolean });
      case "comm.send": return this.commSend(w, command.params as { channel: string; message: string });
      case "redeem.submit": return this.redeemSubmit(w, command.params as { passcode: string });
      default: throw makeError("INVALID_ARGUMENT", `Unknown method: ${command.method}`);
    }
  }

  // ─── map.get_state ─────────────────────────────────────

  private getMapState(w: WindowWithIITC): MapState {
    const map = w.map;
    const center = map.getCenter();
    const zoom = map.getZoom();
    return {
      center: { lat: center.lat, lng: center.lng },
      zoom,
      bounds: extractBounds(map.getBounds()),
      selectedPortalGuid: w.selectedPortal ?? null,
      dataStatus: { short: "ok" },
    };
  }

  // ─── map.set_view ──────────────────────────────────────

  private setMapView(w: WindowWithIITC, input: { lat: number; lng: number; zoom?: number }): Promise<MapState> {
    const map = w.map;
    const targetZoom = input.zoom ?? map.getZoom();
    if (targetZoom < map.getMinZoom() || targetZoom > map.getMaxZoom()) {
      throw makeError("INVALID_ARGUMENT", `Zoom ${targetZoom} out of range [${map.getMinZoom()}, ${map.getMaxZoom()}]`);
    }
    const current = map.getCenter();
    const currentZoom = map.getZoom();
    if (current.lat === input.lat && current.lng === input.lng && currentZoom === targetZoom) {
      return Promise.resolve(this.getMapState(w));
    }
    return this.waitForMoveEnd(w, () => {
      map.setView([input.lat, input.lng], targetZoom);
    }).catch((err: unknown) => {
      if (isBridgeError(err) && err.code === "TIMEOUT") {
        throw makeError("TIMEOUT", `map.setView timed out after 5s — target: lat=${input.lat}, lng=${input.lng}, zoom=${targetZoom}`);
      }
      throw err;
    });
  }

  // ─── map.fit_bounds ────────────────────────────────────

  private fitMapBounds(w: WindowWithIITC, input: { south: number; west: number; north: number; east: number }): Promise<MapState> {
    const map = w.map;
    if (input.west > input.east) {
      throw makeError("INVALID_ARGUMENT", "west must be <= east");
    }
    return this.waitForMoveEnd(w, () => {
      map.fitBounds([[input.south, input.west], [input.north, input.east]]);
    }).catch((err: unknown) => {
      if (isBridgeError(err) && err.code === "TIMEOUT") {
        throw makeError("TIMEOUT", `map.fitBounds timed out after 5s — target: south=${input.south}, west=${input.west}, north=${input.north}, east=${input.east}`);
      }
      throw err;
    });
  }

  // ─── map.search_region ────────────────────────────────

  private async searchRegion(w: WindowWithIITC, input: { term: string }): Promise<SearchRegionOutput> {
    const term = input.term.trim();
    if (!term || term.length > 256) throw makeError("INVALID_ARGUMENT", "Search term must be 1-256 characters");

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(term)}&format=json&limit=1`;
    let data: Array<{ display_name?: string; boundingbox?: string[] }> = [];
    try {
      const response = await fetch(url, { headers: { "User-Agent": "iitc-mcp/1.2" } });
      data = await response.json() as Array<{ display_name?: string; boundingbox?: string[] }>;
    } catch {
      throw makeError("UPSTREAM_ERROR", "Nominatim geocoding unreachable");
    }

    if (!data.length || !data[0].boundingbox || data[0].boundingbox.length < 4) {
      throw makeError("NOT_FOUND", `No region found for "${term}"`);
    }

    const box = data[0].boundingbox.map(Number);
    const south = box[0];
    const north = box[1];
    const west = box[2];
    const east = box[3];
    const regionName = data[0].display_name?.split(",")[0]?.trim();

    const map = w.map;
    await this.waitForMoveEnd(w, () => {
      map.fitBounds([[south, west], [north, east]]);
    }).catch((err: unknown) => {
      if (isBridgeError(err) && err.code === "TIMEOUT") {
        throw makeError("TIMEOUT", `map.fitBounds timed out for "${term}"`);
      }
      throw err;
    });

    const waitResult = await this.waitForMapData(w);
    return { ...waitResult, regionName };
  }

  /** 轮询等待地图数据加载完成，返回当前 MapState */
  private waitForMapData(w: WindowWithIITC): Promise<MapState> {
    const { promise, resolve } = Promise.withResolvers<MapState>();
    const started = Date.now();
    const MAX_WAIT = 15_000;
    const POLL_MS = 200;
    const check = (): void => {
      const active = w.mapDataRequest?.activeRequestCount ?? 0;
      if (active === 0 || Date.now() - started >= MAX_WAIT) {
        resolve(this.getMapState(w));
        return;
      }
      setTimeout(check, POLL_MS);
    };
    check();
    return promise;
  }

  // ─── self.get_info ────────────────────────────────────

  private getSelfInfo(w: WindowWithIITC): SelfInfo {
    const p = w.PLAYER;
    if (!p) throw makeError("NOT_FOUND", "Player info not available");
    return {
      nick: String(p.nickname ?? ""),
      team: String(p.team ?? ""),
      level: typeof p.level === "number" ? p.level : 0,
      ap: String(p.ap ?? "0"),
      xm: typeof p.energy === "number" ? p.energy : 0,
      verified: typeof p.verifiedLevel === "number" ? p.verifiedLevel : undefined,
    };
  }

  // ─── tracker.list_players ──────────────────────────────

  private listPlayers(w: WindowWithIITC): PlayerSummary[] {
    const stored = w.plugin?.playerTracker?.stored;
    if (!stored) throw makeError("NOT_FOUND", "Player Tracker plugin not active");

    const items: PlayerSummary[] = [];
    for (const [name, data] of Object.entries(stored)) {
      const events = data.events ?? [];
      const last = events[events.length - 1];
      const lastLatlngs = last?.latlngs;
      items.push({
        name,
        team: String(data.team ?? ""),
        lastTime: last?.time ?? 0,
        lastLat: lastLatlngs?.[0]?.[0] ?? 0,
        lastLng: lastLatlngs?.[0]?.[1] ?? 0,
        lastAction: last?.actions?.[0],
        lastPortal: last?.name,
      });
    }
    return items;
  }

  // ─── tracker.get_trail ──────────────────────────────────

  private getPlayerTrail(w: WindowWithIITC, input: { name: string }): PlayerTrail {
    const stored = w.plugin?.playerTracker?.stored;
    if (!stored) throw makeError("NOT_FOUND", "Player Tracker plugin not active");

    const data = stored[input.name];
    if (!data) throw makeError("NOT_FOUND", `Player "${input.name}" not tracked`);

    const events = data.events ?? [];
    const items: PlayerTrail["items"] = [];
    for (const ev of events) {
      const latlngs = ev.latlngs;
      if (!latlngs?.length) continue;
      items.push({
        time: ev.time ?? 0,
        lat: latlngs[0][0],
        lng: latlngs[0][1],
        portal: ev.name,
        action: ev.actions?.[0],
        address: ev.address,
      });
    }
    return {
      name: input.name,
      team: String(data.team ?? ""),
      items,
    };
  }

  // ─── entities.list_portals / list_links / list_fields ──

  private listPortals(w: WindowWithIITC, input: ListInput): unknown {
    const items = input.cursor ? [] : queryViewportPortals(w, input.team);
    return this.paginator.paginate(items, input);
  }

  private listLinks(w: WindowWithIITC, input: ListInput): unknown {
    const items = input.cursor ? [] : queryViewportLinks(w, input.team);
    return this.paginator.paginate(items, input);
  }

  private listFields(w: WindowWithIITC, input: ListInput): unknown {
    const items = input.cursor ? [] : queryViewportFields(w, input.team);
    return this.paginator.paginate(items, input);
  }

  // ─── entities.region_summary ───────────────────────────

  private getRegionSummary(w: WindowWithIITC): RegionSummaryOutput {
    const mapBounds = w.map.getBounds();
    const portals = queryViewportPortals(w, undefined, mapBounds);
    const links = queryViewportLinks(w, undefined, mapBounds);
    const fields = queryViewportFields(w, undefined, mapBounds);

    const byTeam = { E: 0, R: 0, N: 0, M: 0 };
    const byLevel: Record<string, number> = {};

    for (const portal of portals) {
      byTeam[portal.team]++;
      const levelKey = String(typeof portal.level === "number" ? portal.level : 0);
      byLevel[levelKey] = (byLevel[levelKey] ?? 0) + 1;
    }

    return {
      bounds: extractBounds(mapBounds),
      totalPortals: portals.length,
      byTeam,
      byLevel,
      linksCount: links.length,
      fieldsCount: fields.length,
      complete: false,
      reason: "IITC_VIEWPORT_CACHE",
    };
  }

  // ─── entities.export_geojson ───────────────────────────

  private exportGeoJson(w: WindowWithIITC, input: Partial<ExportGeoJsonInput>): ExportGeoJsonOutput {
    const mapBounds = w.map.getBounds();
    const teamFilter = input.team;
    const includeLinks = input.includeLinks === true;
    const includeFields = input.includeFields === true;

    const portals = queryViewportPortals(w, teamFilter, mapBounds);
    const portalFeatures: GeoJsonFeature[] = portals.map((portal) => {
      const props: Record<string, unknown> = {
        entityType: "portal",
        guid: portal.guid,
        team: portal.team,
        detailLevel: portal.detailLevel,
      };
      if (portal.level !== undefined) props.level = portal.level;
      if (portal.health !== undefined) props.health = portal.health;
      if (portal.resCount !== undefined) props.resCount = portal.resCount;
      if (portal.title !== undefined) props.title = portal.title;
      if (portal.image !== undefined) props.image = portal.image;
      return {
        type: "Feature",
        id: portal.guid,
        geometry: {
          type: "Point",
          coordinates: [portal.lng, portal.lat],
        },
        properties: props,
      };
    });

    const linkFeatures: GeoJsonFeature[] = includeLinks
      ? queryViewportLinks(w, teamFilter, mapBounds).map((link) => ({
          type: "Feature",
          id: link.guid,
          geometry: {
            type: "LineString",
            coordinates: [
              [link.origin.lng, link.origin.lat],
              [link.destination.lng, link.destination.lat],
            ],
          },
          properties: {
            entityType: "link",
            guid: link.guid,
            team: link.team,
            originGuid: link.origin.guid,
            destinationGuid: link.destination.guid,
          },
        }))
      : [];

    const fieldFeatures: GeoJsonFeature[] = [];
    if (includeFields) {
      for (const field of queryViewportFields(w, teamFilter, mapBounds)) {
        if (!field.points || field.points.length < 3) continue;
        const ring: Array<[number, number]> = field.points.map((pt) => [pt.lng, pt.lat]);
        ring.push(ring[0]);
        fieldFeatures.push({
          type: "Feature",
          id: field.guid,
          geometry: {
            type: "Polygon",
            coordinates: [ring],
          },
          properties: {
            entityType: "field",
            guid: field.guid,
            team: field.team,
            vertexGuids: field.points.map((pt) => pt.guid),
          },
        });
      }
    }

    return {
      type: "FeatureCollection",
      features: [...portalFeatures, ...linkFeatures, ...fieldFeatures],
      metadata: {
        bounds: extractBounds(mapBounds),
        portalCount: portalFeatures.length,
        linkCount: linkFeatures.length,
        fieldCount: fieldFeatures.length,
        complete: false,
        reason: "IITC_VIEWPORT_CACHE",
      },
    };
  }

  // ─── portal.get_details ────────────────────────────────

  /** 将 IITC 原始 XM 能量值归一化为 0–100 百分比。 */
  private normalizeResonators(resonators: unknown): PortalDetails["resonators"] {
    if (!Array.isArray(resonators)) return undefined;
    return resonators.map((res: unknown) => {
      if (!res || typeof res !== "object") return null;
      const r = res as { owner?: unknown; level?: unknown; energy?: unknown };
      const rawEnergy = typeof r.energy === "number" ? r.energy : 0;
      const rawLevel = typeof r.level === "number" ? r.level : 1;
      const maxXm = MAX_XM[rawLevel] ?? 1000;
      return { owner: String(r.owner ?? ""), level: rawLevel, energy: Math.round((rawEnergy / maxXm) * 100) };
    });
  }

  private async getPortalDetails(w: WindowWithIITC, input: { guid: string }): Promise<PortalDetails> {
    if (!(input.guid in w.portals)) {
      throw makeError("NOT_FOUND", `Portal with GUID "${input.guid}" not found in current map store`);
    }
    const portal = w.portals[input.guid];

    let detail: Record<string, unknown>;
    if (w.portalDetail.isFresh(input.guid)) {
      detail = w.portalDetail.get(input.guid) ?? {};
    } else {
      try {
        detail = await w.portalDetail.request(input.guid);
      } catch {
        throw makeError("UPSTREAM_ERROR", `Failed to fetch portal details for GUID "${input.guid}"`);
      }
    }

    const ll = portal.getLatLng();
    const linkGuids = w.getPortalLinks(input.guid);
    const fieldGuids = w.getPortalFields(input.guid);

    return {
      guid: input.guid,
      team: normalizeTeam(portal.options.data.team),
      lat: ll.lat,
      lng: ll.lng,
      detailLevel: "detailed",
      level: portal.options.data.level,
      health: portal.options.data.health,
      resCount: portal.options.data.resCount,
      title: portal.options.data.title,
      image: portal.options.data.image,
      owner: portal.options.data.owner,
      mods: portal.options.data.mods,
      resonators: this.normalizeResonators(portal.options.data.resonators),
      history: detail.history as PortalDetails["history"],
      linkGuids,
      fieldGuids,
    };
  }

  // ─── portal.select ─────────────────────────────────────

  private selectPortal(w: WindowWithIITC, input: { guid: string }): Promise<{ selectedPortalGuid: string | null }> {
    if (!(input.guid in w.portals)) {
      throw makeError("NOT_FOUND", `Portal with GUID "${input.guid}" not found in current map store`);
    }

    const { promise, resolve, reject } = Promise.withResolvers<{ selectedPortalGuid: string | null }>();

    const handler = (...args: unknown[]): void => {
      const guid = args[0] as string | undefined;
      if (guid === input.guid) {
        w.removeHook("portalSelected", handler);
        clearTimeout(timer);
        resolve({ selectedPortalGuid: input.guid });
      }
    };

    w.addHook("portalSelected", handler);
    const timer = setTimeout(() => {
      w.removeHook("portalSelected", handler);
      reject(makeError("TIMEOUT", `portal.select timed out after 5s for GUID "${input.guid}"`));
    }, 5000);

    w.renderPortalDetails?.(input.guid);
    return promise;
  }

  // ─── search.query ──────────────────────────────────────

  private searchQuery(w: WindowWithIITC, input: { term: string }): Promise<{ items: SearchResult[]; complete: boolean }> {
    const term = input.term.trim();
    if (term.length < 1 || term.length > 256) {
      throw makeError("INVALID_ARGUMENT", "Search term must be 1-256 characters");
    }

    const search = w.IITC?.search;
    if (!search) {
      throw makeError("UPSTREAM_ERROR", "IITC search is not available — ensure IITC has fully loaded on the Intel page");
    }

    const searchObj = search.lastSearch;
    search.doSearch(term, true);

    const { promise, resolve } = Promise.withResolvers<{ items: SearchResult[]; complete: boolean }>();
    let lastLen = -1;
    let stableMs = 0;
    const checkInterval = 100;
    const maxWait = 5000;
    let elapsed = 0;

    const interval = setInterval(() => {
      if (search.lastSearch !== searchObj) {
        clearInterval(interval);
        resolve({ items: [], complete: false });
        return;
      }

      const results = search.lastSearch?.results ?? [];
      const currentLen = results.length;

      if (currentLen === lastLen) {
        stableMs += checkInterval;
        if (stableMs >= 500) {
          clearInterval(interval);
          resolve({ items: normalizeSearchResults(results), complete: true });
          return;
        }
      } else {
        stableMs = 0;
        lastLen = currentLen;
      }

      elapsed += checkInterval;
      if (elapsed >= maxWait) {
        clearInterval(interval);
        resolve({ items: normalizeSearchResults(results), complete: false });
      }
    }, checkInterval);

    return promise;
  }

  // ─── comm.list ─────────────────────────────────────────

  private async commList(
    w: WindowWithIITC,
    input: { channel: string; limit?: number; beforeMs?: number; refresh?: boolean },
  ): Promise<{ items: CommMessage[]; complete: boolean }> {
    const comm = w.IITC?.comm;
    if (!comm) {
      throw makeError("UPSTREAM_ERROR", "IITC comm is not available — ensure the Intel page has fully loaded");
    }

    if (input.refresh) {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const handler = (_data: unknown): void => {
        w.removeHook("commDataAvailable", handler);
        clearTimeout(timer);
        resolve();
      };
      w.addHook("commDataAvailable", handler);
      const timer = setTimeout(() => {
        w.removeHook("commDataAvailable", handler);
        reject(makeError("TIMEOUT", "COMM refresh timed out after 10s — the Intel server may be slow or unresponsive"));
      }, 10000);
      comm.requestChannel(input.channel, false);
      await promise;
    }

    const channelData = comm._channelsData[input.channel];
    if (!channelData) return { items: [], complete: true };

    const guids = channelData.guids ?? [];
    const limit = Math.min(input.limit ?? 50, 200);
    const items: CommMessage[] = [];

    for (let i = guids.length - 1; i >= 0 && items.length < limit; i--) {
      const guid = guids[i];
      const raw = channelData.data[guid];
      if (!raw) continue;
      const msg = raw[4] as Record<string, unknown> | undefined;
      if (!msg) continue;

      const ts = msg.time as number | undefined;
      if (input.beforeMs !== undefined && ts !== undefined && ts >= input.beforeMs) continue;

      const parsed = parseCommMessage(guid, msg, input.channel);
      if (parsed) items.push(parsed);
    }

    return { items, complete: true };
  }

  // ─── comm.send ─────────────────────────────────────────

  private commSend(w: WindowWithIITC, input: { channel: string; message: string }): Promise<{ accepted: true }> {
    if (input.channel !== "all" && input.channel !== "faction") {
      throw makeError("INVALID_ARGUMENT", "channel must be 'all' or 'faction'");
    }
    const msg = input.message.trim();
    if (msg.length < 1 || msg.length > 256) {
      throw makeError("INVALID_ARGUMENT", "message must be 1-256 characters");
    }

    const center = w.map.getCenter();
    const { promise, resolve, reject } = Promise.withResolvers<{ accepted: true }>();

    w.postAjax("sendPlext", {
      message: msg,
      latE6: Math.round(center.lat * 1e6),
      lngE6: Math.round(center.lng * 1e6),
      tab: input.channel,
    }, (data: unknown) => {
      if (isErrorResponse(data)) {
        reject(makeError("UPSTREAM_ERROR", `COMM send failed: ${String(data.error)}`));
      } else {
        resolve({ accepted: true });
      }
    }, (err: unknown) => {
      reject(makeError("UPSTREAM_ERROR", `COMM send network error: ${String(err)}`));
    });

    return promise;
  }

  // ─── redeem.submit ─────────────────────────────────────

  private redeemSubmit(w: WindowWithIITC, input: { passcode: string }): Promise<RedeemResult> {
    const passcode = input.passcode.replace(/[^\x20-\x7E]/g, "").trim();
    if (passcode.length < 1 || passcode.length > 64) {
      throw makeError("INVALID_ARGUMENT", "passcode must be 1-64 ASCII printable characters");
    }

    const { promise, resolve, reject } = Promise.withResolvers<RedeemResult>();

    w.postAjax("redeemReward", { passcode }, (data: unknown) => {
      if (!data || typeof data !== "object") {
        reject(makeError("UPSTREAM_ERROR", "Empty response from redeem"));
        return;
      }
      const resp = data as Record<string, unknown>;
      if ("error" in resp) {
        const isRateLimit = resp.status === 429;
        reject(makeError("UPSTREAM_ERROR", String(resp.error), isRateLimit));
        return;
      }
      if (!("rewards" in resp)) {
        reject(makeError("UPSTREAM_ERROR", "Missing rewards in response"));
        return;
      }

      if ("playerData" in resp && resp.playerData) {
        w.PLAYER = resp.playerData as Record<string, unknown>;
        w.setupPlayerStat?.();
      }

      resolve({
        rewards: resp.rewards as RedeemResult["rewards"],
        playerData: resp.playerData as Record<string, unknown> | undefined,
      });
    }, (err: unknown) => {
      reject(makeError("UPSTREAM_ERROR", `Redeem network error: ${String(err)}`));
    });

    return promise;
  }

  // ─── helpers ───────────────────────────────────────────

  private waitForMoveEnd(w: WindowWithIITC, action: () => void): Promise<MapState> {
    const { promise, resolve, reject } = Promise.withResolvers<MapState>();
    const map = w.map;

    const onMoveEnd = (): void => {
      map.off("moveend", onMoveEnd);
      clearTimeout(timer);
      resolve(this.getMapState(w));
    };

    const timer = setTimeout(() => {
      map.off("moveend", onMoveEnd);
      reject(makeError("TIMEOUT", "map moveend timed out after 5s"));
    }, 5000);

    map.on("moveend", onMoveEnd);
    action();
    return promise;
  }
}

// ─── 工具函数 ─────────────────────────────────────────

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "textContent" in value) {
    return String((value as Record<string, unknown>).textContent ?? "");
  }
  return "";
}

function normalizeSearchResults(results: Record<string, unknown>[]): SearchResult[] {
  const items: SearchResult[] = [];
  for (const r of results) {
    const title = extractText(r.title);
    const description = extractText(r.description);
    const lat = typeof r.lat === "number" ? r.lat : undefined;
    const lng = typeof r.lng === "number" ? r.lng : undefined;
    if (lat === undefined || lng === undefined) continue;
    const item: SearchResult = { title };
    if (description) item.description = description;
    item.position = { lat, lng };
    items.push(item);
  }
  return items;
}

function parseCommMessage(guid: string, raw: Record<string, unknown>, channel: string): CommMessage | null {
  try {
    const time = raw.time as number | undefined;
    const msgToPlayer = raw.msgToPlayer as boolean | undefined;
    const player = raw.player as Record<string, unknown> | undefined;
    const markup = raw.markup as Array<Record<string, unknown>> | undefined;
    if (!player || !markup) return null;

    const team = normalizeTeam(String(player.team ?? "N"));
    let text = "";
    const portals: CommMessage["portals"] = [];

    for (const chunk of markup) {
      switch (chunk.type) {
        case "TEXT":
          text += String(chunk.text ?? "");
          break;
        case "PLAYER":
        case "SENDER":
        case "AT_PLAYER":
          text += String((chunk.plain as string) ?? (chunk.markup as Record<string, unknown>)?.plain ?? "");
          break;
        case "PORTAL": {
          const pm = chunk.markup as Record<string, unknown> | undefined;
          text += String(pm?.name ?? "?");
          portals.push({
            name: String(pm?.name ?? ""),
            lat: Number(pm?.latE6 ?? 0) / 1e6,
            lng: Number(pm?.lngE6 ?? 0) / 1e6,
          });
          break;
        }
        case "FACTION":
          text += String((chunk.plain as string) ?? "");
          break;
        default:
          text += String(chunk.plain ?? "");
      }
    }

    return {
      guid,
      timestampMs: time ?? 0,
      channel: channel as CommMessage["channel"],
      type: msgToPlayer ? "PLAYER_GENERATED" : "SYSTEM",
      automated: false,
      team,
      player: { name: String(player.name ?? "unknown"), team },
      text,
      portals,
    };
  } catch {
    return null;
  }
}

function isBridgeError(err: unknown): err is BridgeError {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    "message" in err &&
    "retryable" in err
  );
}

function toBridgeError(err: unknown): BridgeError {
  if (isBridgeError(err)) return err;
  return {
    code: "INTERNAL",
    message: err instanceof Error ? err.message : String(err),
    retryable: false,
  };
}

function isErrorResponse(data: unknown): data is { error: string } {
  return data !== null && typeof data === "object" && "error" in data;
}

function makeError(code: BridgeError["code"], message: string, retryable = false, details?: string): BridgeError {
  const err: BridgeError = { code, message, retryable };
  if (details) err.details = { reason: details };
  return err;
}
