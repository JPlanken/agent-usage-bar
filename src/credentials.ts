import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export interface CredentialTarget { directory: string; keychainService: string; }

export function expandHome(value: string, home: string): string {
  return value === "~" ? home : value.startsWith("~/") || value.startsWith("~\\") ? path.join(home, value.slice(2)) : value;
}
export function credentialTarget(configured: string, envDirectory = process.env.CLAUDE_CONFIG_DIR, home = os.homedir()): CredentialTarget {
  const selected = configured.trim() || envDirectory || "";
  const expanded = expandHome(selected, home);
  if (expanded && !path.isAbsolute(expanded)) {
    throw new Error("Claude config directory must be an absolute path or start with ~/.");
  }
  const directory = (expanded || path.join(home, ".claude")).normalize("NFC");
  // Claude scopes explicitly selected config directories by a SHA-256 suffix.
  const suffix = selected ? `-${createHash("sha256").update(directory).digest("hex").slice(0, 8)}` : "";
  return { directory, keychainService: "Claude Code-credentials" + suffix };
}
// Target for a discovered directory: ~/.claude keeps the unsuffixed Keychain entry, every other directory is suffixed.
export function profileTarget(directory: string, home = os.homedir()): CredentialTarget {
  const target = credentialTarget(directory, "", home);
  return target.directory === path.join(home, ".claude").normalize("NFC") ? credentialTarget("", "", home) : target;
}
// Claude stores the default profile's metadata in ~/.claude.json and a custom profile's inside its directory.
export function accountFile(directory: string, home = os.homedir()): string {
  return directory === path.join(home, ".claude").normalize("NFC") ? path.join(home, ".claude.json") : path.join(directory, ".claude.json");
}
const emails = new Map<string, { mtime: number; email?: string }>();
export async function readAccountEmail(directory: string, home = os.homedir()): Promise<string | undefined> {
  const file = accountFile(directory, home);
  try {
    const mtime = (await fs.stat(file)).mtimeMs;
    const cached = emails.get(file);
    if (cached && cached.mtime === mtime) return cached.email;
    const email = JSON.parse(await fs.readFile(file, "utf8"))?.oauthAccount?.emailAddress;
    const entry = { mtime, email: typeof email === "string" && email ? email : undefined };
    emails.set(file, entry);
    return entry.email;
  } catch { return undefined; }
}

interface CredentialReader {
  platform: string;
  keychain(service: string): Promise<string>;
  file(filename: string): Promise<string>;
}
const reader: CredentialReader = {
  platform: process.platform,
  async keychain(service) {
    const { stdout } = await execFileAsync("security", ["find-generic-password", "-s", service, "-w"], { timeout: 15000 });
    return stdout;
  },
  file: (filename) => fs.readFile(filename, "utf8"),
};
function parseToken(raw: string): string {
  const token = JSON.parse(raw)?.claudeAiOauth?.accessToken;
  if (typeof token !== "string" || !token) throw new Error("Missing OAuth access token");
  return token;
}
export async function readToken(target: CredentialTarget, source = reader): Promise<string> {
  if (source.platform === "darwin") {
    try { return parseToken(await source.keychain(target.keychainService)); }
    catch { /* File fallback stays within the selected profile. */ }
  }
  try { return parseToken(await source.file(path.join(target.directory, ".credentials.json"))); }
  catch { throw new Error(`No readable Claude login in ${target.directory}. Sign in to Claude using this config directory.`); }
}
