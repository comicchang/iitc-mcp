#!/usr/bin/env npx tsx
/**
 * CLI 入口 — iitc-mcp serve | token show | token rotate
 */
import { BridgeBroker } from "./bridge/broker.js";
import { startServer } from "./bridge/http-server.js";
import { MCPServerBridge } from "./mcp/server.js";
import { getOrCreateToken, rotateToken, getToken } from "./token.js";

const DEFAULT_PORT = 27342;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "serve") {
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

async function serve(args: string[]): Promise<void> {
  let port = DEFAULT_PORT;
  const portIdx = args.indexOf("--bridge-port");
  if (portIdx !== -1 && args[portIdx + 1]) {
    port = parseInt(args[portIdx + 1], 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.error("Error: --bridge-port must be 1-65535");
      process.exit(1);
    }
  }

  const broker = new BridgeBroker();
  const httpServer = await startServer(broker, { port });
  const tokenInfo = getOrCreateToken();

  console.error(`Bridge origin: http://127.0.0.1:${httpServer.port}`);
  console.error(`Token: ${tokenInfo.token}`);
  console.error(`iitc-mcp server ready on port ${httpServer.port}`);

  const mcpBridge = new MCPServerBridge({ bridgeClient: broker });
  await mcpBridge.connect();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      process.exit(0);
    }
    shuttingDown = true;
    console.error("Shutting down...");
    broker.revokeSession();
    await mcpBridge.close();
    await httpServer.close();
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
  console.error("  serve [--bridge-port <port>]  Start MCP server (default port 27342)");
  console.error("  token show                    Show current bridge token");
  console.error("  token rotate                  Rotate bridge token");
}

main().catch((err: unknown) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
