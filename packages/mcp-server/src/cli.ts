#!/usr/bin/env npx tsx
/**
 * CLI 入口 — iitc-mcp broker | serve [--broker-url URL] | token show | token rotate
 */
import { BridgeBroker } from "./bridge/broker.js";
import { RemoteBridgeClient } from "./bridge/remote-client.js";
import { startServer } from "./bridge/http-server.js";
import { MCPServerBridge } from "./mcp/server.js";
import { getOrCreateToken, rotateToken, getToken } from "./token.js";

const DEFAULT_PORT = 27342;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === "broker") {
    await brokerCmd(args);
  } else if (command === "serve") {
    await serve(args);
  } else if (command === "token" && args[1] === "show") {
    tokenShow();
  } else if (command === "token" && args[1] === "rotate") {
    tokenRotate();
  } else {
    printUsage();
    process.exit(1);
  }
}

async function brokerCmd(args: string[]): Promise<void> {
  let port = DEFAULT_PORT;
  const portIdx = args.indexOf("--port");
  if (portIdx !== -1 && args[portIdx + 1]) {
    port = parseInt(args[portIdx + 1], 10);
  }
  const broker = new BridgeBroker();
  const httpServer = await startServer(broker, { port });
  const tokenInfo = getOrCreateToken();
  console.error(`Bridge broker listening on http://127.0.0.1:${httpServer.port}`);
  console.error(`Token: ${tokenInfo.token}`);
  const shutdown = async () => {
    console.error("Shutting down broker...");
    broker.revokeSession();
    await httpServer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function serve(args: string[]): Promise<void> {
  const brokerUrlIdx = args.indexOf("--broker-url");
  const brokerUrl = brokerUrlIdx !== -1 ? args[brokerUrlIdx + 1] : undefined;

  let port = DEFAULT_PORT;
  const portIdx = args.indexOf("--bridge-port");
  if (portIdx !== -1 && args[portIdx + 1]) {
    port = parseInt(args[portIdx + 1], 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error("Error: --bridge-port must be 1-65535");
      process.exit(1);
    }
  }

  const readOnly = args.includes("--read-only");

  let bridgeClient: InstanceType<typeof BridgeBroker> | InstanceType<typeof RemoteBridgeClient>;

  let httpServer: { port: number; close: () => Promise<void> } | undefined;

  if (brokerUrl) {
    // 连接已有 broker
    bridgeClient = new RemoteBridgeClient({ brokerUrl });
    console.error(`Connecting to remote broker: ${brokerUrl}`);
  } else {
    // 启动内嵌 broker
    const broker = new BridgeBroker();
    httpServer = await startServer(broker, { port });
    bridgeClient = broker;
    console.error(`Bridge origin: http://127.0.0.1:${httpServer.port}`);
  }
  const tokenInfo = getOrCreateToken();
  console.error(`Token: ${tokenInfo.token}`);
  console.error(`iitc-mcp server ready${readOnly ? " (read-only mode)" : ""}`);

  const mcpBridge = new MCPServerBridge({ bridgeClient, readOnly });
  await mcpBridge.connect();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) process.exit(0);
    shuttingDown = true;
    console.error("Shutting down...");
    if ("revokeSession" in bridgeClient) bridgeClient.revokeSession();
    await mcpBridge.close();
    if (httpServer) await httpServer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function tokenShow(): void {
  const info = getToken();
  if (!info.token) {
    console.error("No token found. Run 'iitc-mcp serve' to generate one.");
    process.exit(1);
  }
  process.stdout.write(info.token + "\n");
}

function tokenRotate(): void {
  const newToken = rotateToken();
  process.stdout.write(`Token: ${newToken}\n`);
  console.error("Token rotated. Re-pair your IITC plugin.");
  console.error("The running server will reject the old token on next request.");
}

function printUsage(): void {
  console.error("Usage: iitc-mcp <command> [options]");
  console.error("");
  console.error("Commands:");
  console.error("  broker [--port <port>]                           Start standalone broker daemon");
  console.error("  serve [--bridge-port <port>] [--broker-url URL] [--read-only]  Start MCP server");
  console.error("  token show                                       Show current bridge token");
  console.error("  token rotate                                     Rotate bridge token");
}

main().catch((err: unknown) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
