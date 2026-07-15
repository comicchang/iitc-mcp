/**
 * Token management — 读取、生成、轮换 bridge auth token
 * 优先级: IITC_MCP_TOKEN env → ~/.config/iitc-mcp/token → 随机生成
 */
import { randomBytes } from "node:crypto";
import { readFileSync, mkdirSync, unlinkSync, renameSync, openSync, closeSync, writeSync, fsyncSync, constants } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "iitc-mcp");
let configDir = DEFAULT_CONFIG_DIR;

export function setConfigDir(dir: string): void {
  configDir = dir;
}

function tokenFile(): string { return join(configDir, "token"); }
function lockFile(): string { return join(configDir, "token.lock"); }

export interface TokenInfo {
  token: string;
  source: "env" | "file" | "generated";
  path: string;
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function ensureDir(): void {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
}

function acquireLock(): void {
  try {
    const fd = openSync(lockFile(), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
    closeSync(fd);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("Token lock held by another process");
    }
    throw err;
  }
}

function releaseLock(): void {
  try {
    unlinkSync(lockFile());
  } catch {
    // best-effort cleanup
  }
}

/** 读取现有 token（不创建） */
export function getToken(): TokenInfo {
  const envToken = process.env.IITC_MCP_TOKEN;
  if (envToken) {
    return { token: envToken, source: "env", path: "(env)" };
  }

  try {
    const token = readFileSync(tokenFile(), "utf-8").trim();
    if (token) {
      return { token, source: "file", path: tokenFile() };
    }
  } catch {
    // file doesn't exist
  }

  return { token: "", source: "generated", path: tokenFile() };
}

/** 获取或生成 token；首次运行自动生成并保存 */
export function getOrCreateToken(): TokenInfo {
  const info = getToken();
  if (info.token) return info;

  const token = generateToken();
  writeTokenFile(token);
  return { token, source: "generated", path: tokenFile() };
}

/** 轮换 token：原子替换文件，撤销当前 session */
export function rotateToken(): string {
  const newToken = generateToken();
  writeTokenFile(newToken);
  return newToken;
}

function writeTokenFile(token: string): void {
  ensureDir();
  acquireLock();
  let fd: number | undefined;
  let tmpPath: string | undefined;
  try {
    const ts = Date.now();
    const random = randomBytes(4).toString("hex");
    tmpPath = `${tokenFile()}.tmp.${ts}.${random}`;
    fd = openSync(tmpPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    const buf = Buffer.from(token, "utf-8");
    writeSync(fd, buf);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmpPath, tokenFile());
    tmpPath = undefined;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* best-effort */ }
    }
    if (tmpPath !== undefined) {
      try { unlinkSync(tmpPath); } catch { /* best-effort */ }
    }
    releaseLock();
  }
}

export const _paths = {
  get CONFIG_DIR() { return configDir; },
  get TOKEN_FILE() { return tokenFile(); },
  get LOCK_FILE() { return lockFile(); },
};
