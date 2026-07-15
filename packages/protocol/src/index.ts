/**
 * IITC-MCP Bridge Protocol — 共享 schema 与类型定义
 * 线协议不是 MCP JSON-RPC：它是适合 GM_xmlhttpRequest 的半双工 pull-RPC
 */
export { protocolVersion } from "./constants.js";
export {
  // 请求/响应 schema
  ConnectRequestSchema,
  ConnectResponseSchema,
  PollRequestSchema,
  PollResponseSchema,
  EventsRequestSchema,
  // 命令/完成/事件
  BridgeCommandSchema,
  BridgeCompletionSchema,
  BridgeEventSchema,
  // 方法与事件类型
  BridgeMethodSchema,
  BridgeEventTypeSchema,
  // 错误
  BridgeErrorSchema,
  // DTO schemas
  MapStateSchema,
  PortalSummarySchema,
  PortalDetailsSchema,
  LinkSummarySchema,
  FieldSummarySchema,
  SearchResultSchema,
  CommMessageSchema,
  RedeemResultSchema,
  // 分页
  ListInputSchema,
  PagedResultSchema,
  // 各方法输入/输出
  GetMapStateInputSchema,
  GetMapStateOutputSchema,
  SetViewInputSchema,
  SetViewOutputSchema,
  FitBoundsInputSchema,
  SearchRegionInputSchema,
  SelfInfoSchema,
  PlayerSummarySchema,
  TrailItemSchema,
  PlayerTrailSchema,
  SearchRegionOutputSchema,
  FitBoundsOutputSchema,
  ListPortalsInputSchema,
  ListPortalsOutputSchema,
  ListLinksInputSchema,
  ListLinksOutputSchema,
  ListFieldsInputSchema,
  ListFieldsOutputSchema,
  GetPortalDetailsInputSchema,
  GetPortalDetailsOutputSchema,
  SelectPortalInputSchema,
  SelectPortalOutputSchema,
  SearchQueryInputSchema,
  SearchQueryOutputSchema,
  CommListInputSchema,
  CommListOutputSchema,
  CommSendInputSchema,
  CommSendOutputSchema,
  RedeemSubmitInputSchema,
  RedeemSubmitOutputSchema,
} from "./schemas.js";
export type {
  // 请求/响应 types
  ConnectRequest,
  ConnectResponse,
  PollRequest,
  PollResponse,
  EventsRequest,
  // 命令/完成/事件
  BridgeCommand,
  BridgeCompletion,
  BridgeEvent,
  // 方法与事件类型
  BridgeMethod,
  BridgeEventType,
  // 错误
  BridgeError,
  // DTO types
  MapState,
  PortalSummary,
  PortalDetails,
  LinkSummary,
  FieldSummary,
  SearchResult,
  CommMessage,
  RedeemResult,
  // 分页
  ListInput,
  PagedResult,
  // 各方法输入/输出
  GetMapStateInput,
  GetMapStateOutput,
  SetViewInput,
  SetViewOutput,
  FitBoundsInput,
  FitBoundsOutput,
  ListPortalsInput,
  ListPortalsOutput,
  ListLinksInput,
  ListLinksOutput,
  ListFieldsInput,
  ListFieldsOutput,
  GetPortalDetailsInput,
  GetPortalDetailsOutput,
  SelectPortalInput,
  SelectPortalOutput,
  SearchQueryInput,
  SearchQueryOutput,
  CommListInput,
  CommListOutput,
  CommSendInput,
  CommSendOutput,
  RedeemSubmitInput,
  RedeemSubmitOutput,
} from "./types.js";
