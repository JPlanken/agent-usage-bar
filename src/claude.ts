import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { profileTarget, readAccountEmail, readToken } from "./credentials";
import { UsageRow, UsageSnapshot, UsageError, validDate } from "./usage";
const execFileAsync = promisify(execFile);
let userAgent = "claude-code/2.1.266";
export async function detectClaudeVersion(): Promise<void> {
  try {
    const { stdout } = await execFileAsync("claude", ["--version"], { timeout: 5000 });
    const version = stdout.trim().split(/\s+/)[0];
    if (/^\d+\.\d+\.\d+/.test(version)) userAgent = `claude-code/${version}`;
  } catch { /* The fallback works when Claude is not on the editor's PATH. */ }
}
export async function fetchClaudeUsage(directory: string, signal: AbortSignal): Promise<UsageSnapshot> {
  const target = profileTarget(directory);
  const token = await readToken(target);
  signal.throwIfAborted();
  const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
    signal,
    headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", "User-Agent": userAgent, Accept: "application/json" },
  });
  if (res.status === 401) throw new UsageError(`Sign in to Claude using ${target.directory}.`);
  if (res.status === 429) throw new UsageError("Rate limited; retrying in 15 minutes.", 15 * 60 * 1000);
  if (!res.ok) throw new UsageError(`Claude usage request failed (HTTP ${res.status}).`);
  return { rows: toClaudeRows(await res.json() as UsageResponse), account: await readAccountEmail(target.directory) };
}

interface Limit {
  kind: "session" | "weekly_all" | "weekly_scoped" | string;
  percent: number;
  resets_at: string | null;
  is_active?: boolean;
  scope?: { model?: { display_name?: string | null } | null } | null;
}

interface UsageResponse {
  limits?: Limit[];
  five_hour?: { utilization: number; resets_at: string | null } | null;
  seven_day?: { utilization: number; resets_at: string | null } | null;
}

export function toClaudeRows(data: UsageResponse): UsageRow[] {
  const rows: UsageRow[] = [];
  const limits = data.limits ?? [];
  const parseDate = validDate;

  if (limits.length > 0) {
    for (const l of limits) {
      let label: string;
      if (l.kind === "session") {
        label = "5h";
      } else if (l.kind === "weekly_all") {
        label = "wk";
      } else if (l.kind === "weekly_scoped") {
        label = l.scope?.model?.display_name ?? "model";
      } else {
        label = l.kind;
      }
      if (!Number.isFinite(l.percent)) continue;
      rows.push({
        label: label === "5h" ? "Session" : label === "wk" ? "All models" : label,
        shortLabel: label,
        percent: Math.round(l.percent),
        resetsAt: parseDate(l.resets_at),
        active: Boolean(l.is_active),
      });
    }
    return rows;
  }

  // Fallback for older response shapes without `limits`.
  if (data.five_hour && Number.isFinite(data.five_hour.utilization)) {
    rows.push({
      label: "Session",
      shortLabel: "5h",
      percent: Math.round(data.five_hour.utilization),
      resetsAt: parseDate(data.five_hour.resets_at),
      active: false,
    });
  }
  if (data.seven_day && Number.isFinite(data.seven_day.utilization)) {
    rows.push({
      label: "All models",
      shortLabel: "wk",
      percent: Math.round(data.seven_day.utilization),
      resetsAt: parseDate(data.seven_day.resets_at),
      active: false,
    });
  }
  return rows;
}

