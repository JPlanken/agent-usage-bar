import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import * as os from "node:os";
import * as path from "node:path";
import { UsageRow, UsageSnapshot, UsageError, validDate } from "./usage";

interface Window { usedPercent: number; windowDurationMins?: number | null; resetsAt?: number | null; }
interface Bucket {
  limitId?: string | null;
  limitName?: string | null;
  primary?: Window | null;
  secondary?: Window | null;
  credits?: { unlimited?: boolean } | null;
  spendControlReached?: boolean | null;
}
export interface CodexLimits {
  rateLimits?: Bucket;
  rateLimitsByLimitId?: Record<string, Bucket | undefined> | null;
  ordinaryUsageAllowed?: boolean | null;
}
export function codexHome(configured: string, environment = process.env.CODEX_HOME, home = os.homedir()): string {
  const value = configured.trim() || environment || path.join(home, ".codex");
  const directory = value === "~" ? home : value.startsWith("~/") || value.startsWith("~\\") ? path.join(home, value.slice(2)) : value;
  if (!path.isAbsolute(directory)) throw new UsageError("Codex home must be an absolute path or start with ~/.");
  return directory;
}
export function toCodexSnapshot(data: CodexLimits): UsageSnapshot {
  const legacy = data.rateLimits;
  const bucket = data.rateLimitsByLimitId?.codex
    ?? (legacy && (!legacy.limitId || legacy.limitId === "codex") ? legacy : undefined);
  const weekly = [bucket?.primary, bucket?.secondary].find(window =>
    window?.windowDurationMins === 10080 && Number.isFinite(window.usedPercent));
  const rows: UsageRow[] = weekly ? [{
    label: "Weekly", shortLabel: "wk", percent: Math.round(weekly.usedPercent),
    resetsAt: validDate(weekly.resetsAt == null ? null : weekly.resetsAt * 1000),
  }] : [];
  const note = data.ordinaryUsageAllowed === false ? "Included usage is currently unavailable."
    : bucket?.spendControlReached ? "A spending limit has been reached."
    : !weekly ? bucket?.credits?.unlimited ? "Unlimited credits; no weekly limit reported." : "No weekly limit reported for this account." : undefined;
  return { rows, note };
}

export interface CodexOptions { executable: string; home: string; signal: AbortSignal; }
// Use the supported account interface. No threads, turns, or model requests are created.
export function fetchCodexUsage(options: CodexOptions, launch: typeof spawn = spawn): Promise<UsageSnapshot> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) { reject(new UsageError("Codex refresh cancelled.")); return; }
    const child = launch(options.executable || "codex", ["app-server", "--stdio"], {
      cwd: options.home, env: { ...process.env, CODEX_HOME: options.home }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    const lines = createInterface({ input: child.stdout! });
    let finished = false;
    const stop = () => {
      lines.close();
      child.stdin?.end();
      child.kill();
      const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 1000);
      force.unref();
    };
    const finish = (error?: Error, snapshot?: UsageSnapshot) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", abort);
      stop();
      if (error) reject(error); else resolve(snapshot!);
    };
    const abort = () => finish(new UsageError("Codex refresh cancelled."));
    const timeout = setTimeout(() => finish(new UsageError("Codex usage timed out. Check your login and network connection.")), 20000);
    options.signal.addEventListener("abort", abort, { once: true });
    child.stderr?.resume(); // Do not log account or credential diagnostics.
    child.on("error", () => finish(new UsageError("Could not start Codex. Check the CLI path and Codex home in settings.")));
    child.on("exit", () => finish(new UsageError("Codex exited before returning usage. Check your login and CLI version.")));
    child.stdin?.on("error", () => finish(new UsageError("Codex connection closed before usage was returned.")));
    const send = (message: object) => child.stdin?.write(JSON.stringify(message) + "\n");
    let bytes = 0, email: string | undefined;
    child.stdout?.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) finish(new UsageError("Codex returned an unexpectedly large response."));
    });
    lines.on("line", (line) => {
      if (finished) return;
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (![1, 2, 3].includes(message.id)) return;
      if (message.error) {
        finish(new UsageError(message.error.code === -32601
          ? "Update Codex CLI to a version supporting account/rateLimits/read."
          : "Codex could not read account limits. Sign in with ChatGPT in the selected Codex home and retry."));
        return;
      }
      if (message.id === 1) {
        send({ method: "initialized" });
        send({ method: "account/read", id: 2, params: { refreshToken: false } });
      } else if (message.id === 2) {
        const account = message.result?.account;
        if (!account) { finish(new UsageError("Sign in to Codex with ChatGPT using the selected Codex home.")); return; }
        if (account.type === "apiKey" || account.type === "apikey") {
          finish(new UsageError("API-key billing has no Codex plan limits. Sign in to Codex with ChatGPT.")); return;
        }
        if (typeof account.email === "string") email = account.email;
        send({ method: "account/rateLimits/read", id: 3 });
      } else if (message.id === 3) {
        if (!message.result || (!message.result.rateLimits && !message.result.rateLimitsByLimitId)) {
          finish(new UsageError("Codex returned an unsupported usage response.")); return;
        }
        finish(undefined, { ...toCodexSnapshot(message.result), account: email });
      }
    });
    send({ method: "initialize", id: 1, params: { clientInfo: { name: "agent_usage_bar", title: "Agent Usage", version: "0.6.0" } } });
  });
}
