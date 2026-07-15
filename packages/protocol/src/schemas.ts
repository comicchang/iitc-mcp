/**
 * Bridge protocol Zod schemas
 * 线协议：半双工 pull-RPC，固定 protocolVersion: 1
 */
import { z } from "zod";
import {
  BRIDGE_ERROR_CODES,
  BRIDGE_METHODS,
  BRIDGE_EVENTS,
  TEAM_CODES,
  COMM_CHANNELS,
  DETAIL_LEVELS,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  protocolVersion,
} from "./constants.js";

// ─── 基础类型 ────────────────────────────────────────────

const TeamSchema = z.enum(TEAM_CODES);
const DetailLevelSchema = z.enum(DETAIL_LEVELS);
const CommChannelSchema = z.enum(COMM_CHANNELS);

const LatSchema = z.number().min(-90).max(90);
const LngSchema = z.number().min(-180).max(180);
const GuidSchema = z.string().min(1);
const UnixMsSchema = z.number().int().nonnegative();

const PositionSchema = z.object({
  lat: LatSchema,
  lng: LngSchema,
});

const BoundsSchema = z.object({
  south: LatSchema,
  west: LngSchema,
  north: LatSchema,
  east: LngSchema,
});

// ─── Bridge Error ────────────────────────────────────────

export const BridgeErrorSchema = z.object({
  code: z.enum(BRIDGE_ERROR_CODES),
  message: z.string(),
  retryable: z.boolean(),
  details: z.unknown().optional(),
}).strict();

// ─── DTO: MapState ───────────────────────────────────────

export const MapStateSchema = z.object({
  center: PositionSchema,
  zoom: z.number().int().min(0),
  bounds: BoundsSchema,
  selectedPortalGuid: z.string().nullable(),
  dataStatus: z.object({
    short: z.string(),
    long: z.string().optional(),
    progress: z.number().optional(),
  }),
});

// ─── DTO: Search Region ───────────────────────────────────

export const SearchRegionInputSchema = z.object({
  term: z.string().min(1).max(256),
});

export const SearchRegionOutputSchema = MapStateSchema.extend({
  regionName: z.string().optional(),
});


// ─── DTO: Self ────────────────────────────────────────────

export const SelfInfoSchema = z.object({
  nick: z.string(),
  team: z.string(),
  level: z.number().int().nonnegative(),
  ap: z.string(),
  xm: z.number().int().nonnegative(),
  verified: z.number().int().optional(),
});

// ─── DTO: Player Tracker ──────────────────────────────────

export const PlayerSummarySchema = z.object({
  name: z.string(),
  team: z.string(),
  lastTime: UnixMsSchema,
  lastLat: LatSchema,
  lastLng: LngSchema,
  lastAction: z.string().optional(),
  lastPortal: z.string().optional(),
});

export const TrailItemSchema = z.object({
  time: UnixMsSchema,
  lat: LatSchema,
  lng: LngSchema,
  portal: z.string().optional(),
  action: z.string().optional(),
  address: z.string().optional(),
});

export const PlayerTrailSchema = z.object({
  name: z.string(),
  team: z.string(),
  items: z.array(TrailItemSchema),
});
// ─── DTO: Portal ─────────────────────────────────────────

export const PortalSummarySchema = z.object({
  guid: GuidSchema,
  team: TeamSchema,
  lat: LatSchema,
  lng: LngSchema,
  detailLevel: DetailLevelSchema,
  level: z.number().int().min(0).max(8).optional(),
  health: z.number().min(0).max(100).optional(),
  resCount: z.number().int().nonnegative().optional(),
  title: z.string().optional(),
  image: z.string().optional(),
});

const ResonatorSchema = z.object({
  owner: z.string(),
  level: z.number().int().min(0).max(8),
  energy: z.number().min(0).max(100),
}).nullable();

const ModSchema = z.object({
  owner: z.string(),
  name: z.string(),
  rarity: z.string(),
  stats: z.record(z.string(), z.string()),
}).nullable();

export const PortalDetailsSchema = PortalSummarySchema.extend({
  owner: z.string().optional(),
  mods: z.array(ModSchema).optional(),
  resonators: z.array(ResonatorSchema).optional(),
  history: z.object({
    visited: z.boolean(),
    captured: z.boolean(),
    scoutControlled: z.boolean(),
  }).optional(),
  linkGuids: z.object({
    in: z.array(z.string()),
    out: z.array(z.string()),
  }),
  fieldGuids: z.array(z.string()),
});

// ─── DTO: Link ───────────────────────────────────────────

export const LinkSummarySchema = z.object({
  guid: GuidSchema,
  team: TeamSchema,
  origin: z.object({
    guid: GuidSchema,
    lat: LatSchema,
    lng: LngSchema,
  }),
  destination: z.object({
    guid: GuidSchema,
    lat: LatSchema,
    lng: LngSchema,
  }),
});

// ─── DTO: Field ──────────────────────────────────────────

export const FieldSummarySchema = z.object({
  guid: GuidSchema,
  team: TeamSchema,
  points: z.tuple([
    z.object({ guid: GuidSchema, lat: LatSchema, lng: LngSchema }),
    z.object({ guid: GuidSchema, lat: LatSchema, lng: LngSchema }),
    z.object({ guid: GuidSchema, lat: LatSchema, lng: LngSchema }),
  ]),
});

// ─── DTO: Search ─────────────────────────────────────────

export const SearchResultSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  position: PositionSchema.optional(),
  bounds: BoundsSchema.optional(),
});

// ─── DTO: Comm ───────────────────────────────────────────

export const CommMessageSchema = z.object({
  guid: GuidSchema,
  timestampMs: UnixMsSchema,
  channel: CommChannelSchema,
  type: z.string(),
  automated: z.boolean(),
  team: TeamSchema,
  player: z.object({
    name: z.string(),
    team: TeamSchema,
  }),
  text: z.string(),
  portals: z.array(z.object({
    name: z.string(),
    lat: LatSchema,
    lng: LngSchema,
  })),
});

// ─── DTO: Redeem ─────────────────────────────────────────

const RedeemInventorySchema = z.object({
  name: z.string(),
  awards: z.array(z.object({
    count: z.number().int().positive(),
    level: z.number().int().min(0).max(8).optional(),
  })),
});

export const RedeemResultSchema = z.object({
  rewards: z.object({
    xm: z.number().optional(),
    ap: z.number().optional(),
    other: z.array(z.string()).optional(),
    inventory: z.array(RedeemInventorySchema).optional(),
  }),
  playerData: z.record(z.string(), z.unknown()).optional(),
});

// ─── Bridge Method / Event ───────────────────────────────

export const BridgeMethodSchema = z.enum(BRIDGE_METHODS);
export const BridgeEventTypeSchema = z.enum(BRIDGE_EVENTS);

// ─── Bridge Command ──────────────────────────────────────

export const BridgeCommandSchema = z.object({
  id: z.string().min(1),
  method: BridgeMethodSchema,
  params: z.unknown(),
  deadlineMs: UnixMsSchema,
});

// ─── Bridge Completion ───────────────────────────────────

export const BridgeCompletionSuccessSchema = z.object({
  id: z.string().min(1),
  ok: z.literal(true),
  result: z.unknown(),
});

export const BridgeCompletionErrorSchema = z.object({
  id: z.string().min(1),
  ok: z.literal(false),
  error: BridgeErrorSchema,
});

export const BridgeCompletionSchema = z.discriminatedUnion("ok", [
  BridgeCompletionSuccessSchema,
  BridgeCompletionErrorSchema,
]);

// ─── Bridge Event ────────────────────────────────────────

export const BridgeEventSchema = z.object({
  eventId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  occurredAt: z.string().datetime(),
  type: BridgeEventTypeSchema,
  payload: z.unknown(),
});

// ─── Connect ─────────────────────────────────────────────

export const ConnectRequestSchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  pluginVersion: z.string(),
  iitcVersion: z.string(),
  tabId: z.string().min(1),
  capabilities: z.array(z.string()),
}).strict();

export const ConnectResponseSchema = z.object({
  sessionId: z.string().min(1),
  leaseMs: z.number().int().positive(),
  heartbeatMs: z.number().int().positive(),
  maxBodyBytes: z.number().int().positive(),
});

// ─── Poll ────────────────────────────────────────────────

export const PollRequestSchema = z.object({
  sessionId: z.string().min(1),
  completed: z.array(BridgeCompletionSchema),
}).strict();

export const PollResponseSchema = z.object({
  commands: z.array(BridgeCommandSchema),
});

// ─── Events ──────────────────────────────────────────────

export const EventsRequestSchema = z.object({
  sessionId: z.string().min(1),
  events: z.array(BridgeEventSchema),
}).strict();

// ─── 分页 ────────────────────────────────────────────────

export const ListInputSchema = z.object({
  scope: z.literal("viewport"),
  team: TeamSchema.optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().optional(),
});

export const PagedResultSchema = z.object({
  items: z.array(z.unknown()),
  nextCursor: z.string().optional(),
  complete: z.literal(false),
  reason: z.literal("IITC_VIEWPORT_CACHE"),
});

// ─── 方法输入/输出 schema ─────────────────────────────────

// map.get_state
export const GetMapStateInputSchema = z.object({});
export const GetMapStateOutputSchema = MapStateSchema;

// map.set_view
export const SetViewInputSchema = z.object({
  lat: LatSchema,
  lng: LngSchema,
  zoom: z.number().int().min(0).optional(),
});
export const SetViewOutputSchema = MapStateSchema;

// map.fit_bounds
export const FitBoundsInputSchema = BoundsSchema.refine(
  (b) => b.west <= b.east,
  { message: "west must be <= east" }
);
export const FitBoundsOutputSchema = MapStateSchema;

// entities.list_portals
export const ListPortalsInputSchema = ListInputSchema;
export const ListPortalsOutputSchema = PagedResultSchema.extend({
  items: z.array(PortalSummarySchema),
});

// entities.list_links
export const ListLinksInputSchema = ListInputSchema;
export const ListLinksOutputSchema = PagedResultSchema.extend({
  items: z.array(LinkSummarySchema),
});

// entities.list_fields
export const ListFieldsInputSchema = ListInputSchema;
export const ListFieldsOutputSchema = PagedResultSchema.extend({
  items: z.array(FieldSummarySchema),
});

// portal.get_details
export const GetPortalDetailsInputSchema = z.object({
  guid: GuidSchema,
});
export const GetPortalDetailsOutputSchema = PortalDetailsSchema;

// portal.select
export const SelectPortalInputSchema = z.object({
  guid: GuidSchema,
});
export const SelectPortalOutputSchema = z.object({
  selectedPortalGuid: z.string().nullable(),
});

// search.query
export const SearchQueryInputSchema = z.object({
  term: z.string().trim().min(1).max(256),
});
export const SearchQueryOutputSchema = z.object({
  items: z.array(SearchResultSchema),
  complete: z.boolean(),
});

// comm.list
export const CommListInputSchema = z.object({
  channel: CommChannelSchema,
  limit: z.number().int().min(1).max(200).default(50),
  beforeMs: UnixMsSchema.optional(),
  refresh: z.boolean().default(false),
});
export const CommListOutputSchema = z.object({
  items: z.array(CommMessageSchema),
  complete: z.boolean(),
});

// comm.send
export const CommSendInputSchema = z.object({
  channel: z.enum(["all", "faction"]),
  message: z.string().trim().min(1).max(256),
});
export const CommSendOutputSchema = z.object({
  accepted: z.literal(true),
});

// redeem.submit
export const RedeemSubmitInputSchema = z.object({
  passcode: z.string().trim().min(1).max(64).regex(
    /^[\x20-\x7E]+$/,
    "passcode must contain only ASCII printable characters"
  ),
});
export const RedeemSubmitOutputSchema = RedeemResultSchema;
