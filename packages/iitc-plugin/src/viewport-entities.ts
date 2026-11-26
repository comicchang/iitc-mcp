/**
 * Viewport Entities — single-pass IITC viewport entity queries and normalization.
 * Hoists map.getBounds() once per call and normalizes team codes before filtering.
 */
import type {
  FieldSummary,
  LinkSummary,
  MapState,
  PortalSummary,
} from "@iitc-mcp/protocol";

export interface LeafletBounds {
  getSouth(): number;
  getWest(): number;
  getNorth(): number;
  getEast(): number;
  contains(latlng: { lat: number; lng: number }): boolean;
  intersects(other: unknown): boolean;
}

export interface LeafletMap {
  getCenter(): { lat: number; lng: number };
  getZoom(): number;
  getMinZoom(): number;
  getMaxZoom(): number;
  getBounds(): LeafletBounds;
  setView(center: [number, number], zoom?: number): void;
  fitBounds(bounds: [[number, number], [number, number]]): void;
  on(event: string, handler: () => void): void;
  off(event: string, handler: () => void): void;
}

export interface IITCPortal {
  options: {
    guid: string;
    data: {
      team: string;
      latE6: number;
      lngE6: number;
      level?: number;
      health?: number;
      resCount?: number;
      title?: string;
      image?: string;
      owner?: string;
      mods?: ({ owner: string; name: string; rarity: string; stats: Record<string, string> } | null)[];
      resonators?: ({ owner: string; level: number; energy: number } | null)[];
    };
  };
  getLatLng(): { lat: number; lng: number };
}

export interface IITCLink {
  options: {
    guid: string;
    data: {
      team: string;
      oGuid: string;
      oLatE6: number;
      oLngE6: number;
      dGuid: string;
      dLatE6: number;
      dLngE6: number;
    };
  };
}

export interface IITCField {
  options: {
    guid: string;
    data: {
      team: string;
      points: Array<{ guid: string; latE6: number; lngE6: number }>;
    };
  };
  getBounds(): { intersects(bounds: unknown): boolean };
}

export interface ViewportEntitySource {
  map: LeafletMap;
  portals: Record<string, IITCPortal>;
  links: Record<string, IITCLink>;
  fields: Record<string, IITCField>;
}

/** Normalize IITC faction strings ("RESISTANCE"/"ENLIGHTENED"/"MACHINA"/short codes) to N/R/E/M. */
export function normalizeTeam(team: string): "N" | "R" | "E" | "M" {
  const t = team.toUpperCase();
  if (t === "RESISTANCE" || t === "R") return "R";
  if (t === "ENLIGHTENED" || t === "E") return "E";
  if (t === "MACHINA" || t === "M") return "M";
  return "N";
}

/** Extract plain JSON bounds DTO from a Leaflet LatLngBounds instance. */
export function extractBounds(bounds: LeafletBounds): MapState["bounds"] {
  return {
    south: bounds.getSouth(),
    west: bounds.getWest(),
    north: bounds.getNorth(),
    east: bounds.getEast(),
  };
}

/** Query portals currently inside the viewport, optionally filtered by team, sorted by GUID. */
export function queryViewportPortals(
  source: ViewportEntitySource,
  teamFilter?: string,
  mapBounds?: LeafletBounds,
): PortalSummary[] {
  const bounds = mapBounds ?? source.map.getBounds();
  const targetTeam = teamFilter ? normalizeTeam(teamFilter) : undefined;
  const items: PortalSummary[] = [];

  for (const p of Object.values(source.portals)) {
    const team = normalizeTeam(p.options.data.team);
    if (targetTeam && team !== targetTeam) continue;
    const ll = p.getLatLng();
    if (!bounds.contains({ lat: ll.lat, lng: ll.lng })) continue;
    items.push({
      guid: p.options.guid,
      team,
      lat: ll.lat,
      lng: ll.lng,
      detailLevel: p.options.data.title ? "summary" : "core",
      level: p.options.data.level,
      health: p.options.data.health,
      resCount: p.options.data.resCount,
      title: p.options.data.title,
      image: p.options.data.image,
    });
  }

  items.sort((a, b) => a.guid.localeCompare(b.guid));
  return items;
}

/** Query links with at least one endpoint inside the viewport, optionally filtered by team, sorted by GUID. */
export function queryViewportLinks(
  source: ViewportEntitySource,
  teamFilter?: string,
  mapBounds?: LeafletBounds,
): LinkSummary[] {
  const bounds = mapBounds ?? source.map.getBounds();
  const targetTeam = teamFilter ? normalizeTeam(teamFilter) : undefined;
  const items: LinkSummary[] = [];

  for (const l of Object.values(source.links)) {
    const team = normalizeTeam(l.options.data.team);
    if (targetTeam && team !== targetTeam) continue;
    const oLat = l.options.data.oLatE6 / 1e6;
    const oLng = l.options.data.oLngE6 / 1e6;
    const dLat = l.options.data.dLatE6 / 1e6;
    const dLng = l.options.data.dLngE6 / 1e6;
    if (!bounds.contains({ lat: oLat, lng: oLng }) && !bounds.contains({ lat: dLat, lng: dLng })) {
      continue;
    }
    items.push({
      guid: l.options.guid,
      team,
      origin: { guid: l.options.data.oGuid, lat: oLat, lng: oLng },
      destination: { guid: l.options.data.dGuid, lat: dLat, lng: dLng },
    });
  }

  items.sort((a, b) => a.guid.localeCompare(b.guid));
  return items;
}

/** Query control fields intersecting the viewport, optionally filtered by team, sorted by GUID. */
export function queryViewportFields(
  source: ViewportEntitySource,
  teamFilter?: string,
  mapBounds?: LeafletBounds,
): FieldSummary[] {
  const bounds = mapBounds ?? source.map.getBounds();
  const targetTeam = teamFilter ? normalizeTeam(teamFilter) : undefined;
  const items: FieldSummary[] = [];

  for (const f of Object.values(source.fields)) {
    const team = normalizeTeam(f.options.data.team);
    if (targetTeam && team !== targetTeam) continue;
    try {
      if (!f.getBounds().intersects(bounds)) continue;
    } catch {
      // If getBounds fails, include the field
    }
    items.push({
      guid: f.options.guid,
      team,
      points: f.options.data.points.map((pt) => ({
        guid: pt.guid,
        lat: pt.latE6 / 1e6,
        lng: pt.lngE6 / 1e6,
      })) as FieldSummary["points"],
    });
  }

  items.sort((a, b) => a.guid.localeCompare(b.guid));
  return items;
}
