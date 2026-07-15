/**
 * Smoke 测试 — 无浏览器时 MCP server 行为
 * 验证 disconnected 状态和 NOT_READY 错误
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { BridgeBroker } from "../../packages/mcp-server/src/bridge/broker.js";
import { MCPServerBridge } from "../../packages/mcp-server/src/mcp/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

describe("Smoke: MCP server without browser", () => {
  let bridge: MCPServerBridge;
  let client: Client;
  let clientTransport: InMemoryTransport;
  let broker: BridgeBroker;

  beforeAll(async () => {
    broker = new BridgeBroker();
    bridge = new MCPServerBridge({ bridgeClient: broker });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    clientTransport = clientT;
    await bridge.connect(serverT);
    client = new Client({ name: "smoke-test", version: "0.1.0" });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await bridge.close();
  });

  it("iitc://status reports disconnected when no browser connected", async () => {
    const result = await client.readResource({ uri: "iitc://status" });
    expect(result.contents).toHaveLength(1);
    const content = result.contents[0];
    expect(content.mimeType).toBe("application/json");
    const status = JSON.parse(content.text as string);
    expect(status.connected).toBe(false);
    expect(status.sessionId).toBeNull();
  });

  it("iitc_get_map_state returns NOT_READY", async () => {
    const result = await client.callTool({ name: "iitc_get_map_state", arguments: {} });
    expect(result.isError).toBe(true);
  });

  it("iitc_list_portals returns NOT_READY", async () => {
    const result = await client.callTool({ name: "iitc_list_portals", arguments: { scope: "viewport" } });
    expect(result.isError).toBe(true);
  });

  it("iitc_search returns NOT_READY", async () => {
    const result = await client.callTool({ name: "iitc_search", arguments: { term: "test" } });
    expect(result.isError).toBe(true);
  });

  it("iitc_send_comm returns NOT_READY", async () => {
    const result = await client.callTool({ name: "iitc_send_comm", arguments: { channel: "all", message: "test" } });
    expect(result.isError).toBe(true);
  });

  it("iitc_redeem_code returns NOT_READY", async () => {
    const result = await client.callTool({ name: "iitc_redeem_code", arguments: { passcode: "TEST-CODE" } });
    expect(result.isError).toBe(true);
  });

  it("iitc://events/recent returns empty array when no events", async () => {
    const result = await client.readResource({ uri: "iitc://events/recent" });
    const events = JSON.parse(result.contents[0].text as string);
    expect(Array.isArray(events)).toBe(true);
    expect(events).toHaveLength(0);
  });

  it("iitc://selection returns null when not connected", async () => {
    const result = await client.readResource({ uri: "iitc://selection" });
    const selection = JSON.parse(result.contents[0].text as string);
    expect(selection).toBeNull();
  });
});
