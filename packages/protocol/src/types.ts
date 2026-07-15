/**
 * Bridge protocol 类型定义
 * 所有 optional 字段缺失时省略而非写 null（只有 selectedPortalGuid 可为 null）
 */
import type { z } from "zod";
import type {
  ConnectRequestSchema,
  ConnectResponseSchema,
  PollRequestSchema,
  PollResponseSchema,
  EventsRequestSchema,
  BridgeCommandSchema,
  BridgeCompletionSchema,
  BridgeEventSchema,
  BridgeMethodSchema,
  BridgeEventTypeSchema,
  BridgeErrorSchema,
  MapStateSchema,
  PortalSummarySchema,
  PortalDetailsSchema,
  LinkSummarySchema,
  FieldSummarySchema,
  SearchResultSchema,
  CommMessageSchema,
  RedeemResultSchema,
  ListInputSchema,
  PagedResultSchema,
  GetMapStateInputSchema,
  GetMapStateOutputSchema,
  SetViewInputSchema,
  SetViewOutputSchema,
  FitBoundsInputSchema,
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

// 请求/响应
export type ConnectRequest = z.infer<typeof ConnectRequestSchema>;
export type ConnectResponse = z.infer<typeof ConnectResponseSchema>;
export type PollRequest = z.infer<typeof PollRequestSchema>;
export type PollResponse = z.infer<typeof PollResponseSchema>;
export type EventsRequest = z.infer<typeof EventsRequestSchema>;

// 命令/完成/事件
export type BridgeCommand = z.infer<typeof BridgeCommandSchema>;
export type BridgeCompletion = z.infer<typeof BridgeCompletionSchema>;
export type BridgeEvent = z.infer<typeof BridgeEventSchema>;

// 方法与事件类型
export type BridgeMethod = z.infer<typeof BridgeMethodSchema>;
export type BridgeEventType = z.infer<typeof BridgeEventTypeSchema>;

// 错误
export type BridgeError = z.infer<typeof BridgeErrorSchema>;

// DTO
export type MapState = z.infer<typeof MapStateSchema>;
export type PortalSummary = z.infer<typeof PortalSummarySchema>;
export type PortalDetails = z.infer<typeof PortalDetailsSchema>;
export type LinkSummary = z.infer<typeof LinkSummarySchema>;
export type FieldSummary = z.infer<typeof FieldSummarySchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type CommMessage = z.infer<typeof CommMessageSchema>;
export type RedeemResult = z.infer<typeof RedeemResultSchema>;

// 分页
export type ListInput = z.infer<typeof ListInputSchema>;
export type PagedResult<T> = Omit<z.infer<typeof PagedResultSchema>, "items"> & { items: T[] };

// 各方法输入/输出
export type GetMapStateInput = z.infer<typeof GetMapStateInputSchema>;
export type GetMapStateOutput = z.infer<typeof GetMapStateOutputSchema>;
export type SetViewInput = z.infer<typeof SetViewInputSchema>;
export type SetViewOutput = z.infer<typeof SetViewOutputSchema>;
export type FitBoundsInput = z.infer<typeof FitBoundsInputSchema>;
export type FitBoundsOutput = z.infer<typeof FitBoundsOutputSchema>;
export type ListPortalsInput = z.infer<typeof ListPortalsInputSchema>;
export type ListPortalsOutput = z.infer<typeof ListPortalsOutputSchema>;
export type ListLinksInput = z.infer<typeof ListLinksInputSchema>;
export type ListLinksOutput = z.infer<typeof ListLinksOutputSchema>;
export type ListFieldsInput = z.infer<typeof ListFieldsInputSchema>;
export type ListFieldsOutput = z.infer<typeof ListFieldsOutputSchema>;
export type GetPortalDetailsInput = z.infer<typeof GetPortalDetailsInputSchema>;
export type GetPortalDetailsOutput = z.infer<typeof GetPortalDetailsOutputSchema>;
export type SelectPortalInput = z.infer<typeof SelectPortalInputSchema>;
export type SelectPortalOutput = z.infer<typeof SelectPortalOutputSchema>;
export type SearchQueryInput = z.infer<typeof SearchQueryInputSchema>;
export type SearchQueryOutput = z.infer<typeof SearchQueryOutputSchema>;
export type CommListInput = z.infer<typeof CommListInputSchema>;
export type CommListOutput = z.infer<typeof CommListOutputSchema>;
export type CommSendInput = z.infer<typeof CommSendInputSchema>;
export type CommSendOutput = z.infer<typeof CommSendOutputSchema>;
export type RedeemSubmitInput = z.infer<typeof RedeemSubmitInputSchema>;
export type RedeemSubmitOutput = z.infer<typeof RedeemSubmitOutputSchema>;
