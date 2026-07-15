#!/usr/bin/env tsx
/**
 * 构建脚本 — esbuild 打包 userscript 和 server
 * Release URL 从 git remote 自动推导，支持 fork
 */
import { build } from "esbuild";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = resolve(ROOT, "dist");

mkdirSync(DIST, { recursive: true });

/** 从 git remote 推导 GitHub release base URL */
function getReleaseBase(): string {
  // CI 环境变量优先
  const ghRepo = process.env.GITHUB_REPOSITORY; // "owner/repo"
  if (ghRepo) {
    return `https://github.com/${ghRepo}/releases/latest/download`;
  }
  // 本地：从 git remote 推导
  try {
    const remote = execSync("git remote get-url origin", { cwd: ROOT, encoding: "utf-8" }).trim();
    // 支持 SSH 和 HTTPS 格式
    const match = remote.match(/github\.com[:/]([^/]+\/[^/.]+)/);
    if (match) {
      return `https://github.com/${match[1]}/releases/latest/download`;
    }
  } catch { /* no remote */ }
  // fallback
  return "https://github.com/your-org/iitc-mcp/releases/latest/download";
}

// ─── Userscript bundle ────────────────────────────────

async function buildUserscript(): Promise<void> {
  // Bundle page-adapter + page-entry into a self-contained IIFE for injection
  const pageBundle = await build({
    entryPoints: [resolve(ROOT, "packages/iitc-plugin/src/page-entry.ts")],
    bundle: true,
    format: "iife",
    globalName: "iitcMcpPage",
    write: false,
    target: "es2022",
    platform: "browser",
    minify: false,
  });
  const pageCode = pageBundle.outputFiles[0].text;

  // Build the userscript (sandbox layer)
  const result = await build({
    entryPoints: [resolve(ROOT, "packages/iitc-plugin/src/userscript-entry.ts")],
    bundle: true,
    format: "iife",
    write: false,
    target: "es2022",
    platform: "browser",
    minify: false,
    define: {
      PAGE_ADAPTER_SOURCE: JSON.stringify(pageCode),
    },
  });

  const userscriptCode = result.outputFiles[0].text;

  // Metadata — 从 package.json 读取版本，动态生成 release URL
  const releaseBase = getReleaseBase();
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8"));
  const version: string = pkg.version;
  const metadata = [
    "// ==UserScript==",
    "// @name         IITC MCP Bridge",
    "// @namespace    iitc-mcp",
    `// @version      ${version}`,
    "// @description  Bridge between IITC and MCP (Model Context Protocol) agents",
    "// @match        https://intel.ingress.com/*",
    "// @grant        GM_xmlhttpRequest",
    "// @connect      127.0.0.1",
    `// @updateURL    ${releaseBase}/iitc-mcp.meta.js`,
    `// @downloadURL  ${releaseBase}/iitc-mcp.user.js`,
    "// ==/UserScript==",
  ].join("\n");

  const metaJs = metadata + "\n";

  writeFileSync(resolve(DIST, "iitc-mcp.user.js"), metadata + "\n\n" + userscriptCode);
  writeFileSync(resolve(DIST, "iitc-mcp.meta.js"), metaJs);

  console.log("Built dist/iitc-mcp.user.js");
  console.log("Built dist/iitc-mcp.meta.js");
}

// ─── Server entry ─────────────────────────────────────

async function buildServer(): Promise<void> {
  await build({
    entryPoints: [resolve(ROOT, "packages/mcp-server/src/cli.ts")],
    bundle: true,
    format: "esm",
    outfile: resolve(DIST, "server/cli.mjs"),
    platform: "node",
    target: "node20",
  });

  // esbuild preserves source shebang; force replace with node.
  const cliPath = resolve(DIST, "server/cli.mjs");
  let cliCode = readFileSync(cliPath, "utf-8");
  cliCode = cliCode.replace(/^#!.*\n/gm, "").replace(/^/, "#!/usr/bin/env node\n");
  writeFileSync(cliPath, cliCode, { mode: 0o755 });
  console.log("Built dist/server/cli.mjs");
}

async function main(): Promise<void> {
  await Promise.all([buildUserscript(), buildServer()]);
  console.log("Build complete.");
}

main().catch((err: unknown) => {
  console.error("Build failed:", err);
  process.exit(1);
});
