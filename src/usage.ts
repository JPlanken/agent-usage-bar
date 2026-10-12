export type ProviderId = "claude" | "codex";
// One signed-in profile directory of a provider. `name` is the directory suffix after the provider default ("" for ~/.claude).
export interface Account { provider: ProviderId; directory: string; name: string; }
export interface UsageRow {
  label: string;
  shortLabel: string;
  percent: number;
  resetsAt: Date | null;
  active?: boolean;
}
export interface UsageSnapshot { rows: UsageRow[]; note?: string; account?: string; }
export class UsageError extends Error {
  constructor(message: string, public readonly retryAfterMs = 0) { super(message); }
}
export function validDate(value: string | number | null | undefined): Date | null {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
