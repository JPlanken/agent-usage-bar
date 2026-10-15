import * as os from "node:os";
import * as vscode from "vscode";
import { detectClaudeVersion, fetchClaudeUsage } from "./claude";
import { codexHome, fetchCodexUsage } from "./codex";
import { UsageMonitor } from "./monitor";
import { discoverAccounts, displayName } from "./profiles";
import { Account, ProviderId } from "./usage";

const IDS: ProviderId[] = ["claude", "codex"];
const NAMES = { claude: "Claude", codex: "Codex" };
const ICONS = { claude: "claude-usage-logo", codex: "codex-usage-logo" };
const PAGES = { claude: "https://claude.ai/settings/usage", codex: "https://chatgpt.com/codex/settings/usage" };
const LEGACY: Record<string, string> = {
  "claude.configDirectory": "configDirectory", refreshIntervalMinutes: "refreshIntervalMinutes",
  warnAtPercent: "warnAtPercent", errorAtPercent: "errorAtPercent", showStatusBarItem: "showStatusBarItem",
};
// Discovered accounts in display order; monitors and status items are keyed by `key(account)`.
let accounts: Account[] = [];
const monitors = new Map<string, UsageMonitor>();
const items = new Map<string, vscode.StatusBarItem>();
let discovering: Promise<void> | undefined;
let discoveryError: string | undefined;
let timer: NodeJS.Timeout | undefined;
let provider: UsageViewProvider | undefined;

export function setting<T>(key: string, fallback: T): T {
  const cfg = vscode.workspace.getConfiguration("agentUsageBar");
  const entry = cfg.inspect<T>(key);
  if (entry?.globalValue !== undefined || entry?.workspaceValue !== undefined || entry?.workspaceFolderValue !== undefined) {
    return cfg.get<T>(key, fallback);
  }
  const old = LEGACY[key];
  return old ? vscode.workspace.getConfiguration("claudeUsageBar").get<T>(old, cfg.get<T>(key, fallback)) : cfg.get<T>(key, fallback);
}
function enabled(): ProviderId[] {
  const selected = setting<string[]>("providers", IDS);
  return IDS.filter(id => selected.includes(id));
}
const key = (account: Account) => `${account.provider}:${account.directory}`;
const nameOf = (account: Account) =>
  displayName(account, monitors.get(key(account))?.state.snapshot?.account, setting<Record<string, unknown>>("profileNames", {}));
const shortPath = (directory: string) => directory.startsWith(os.homedir()) ? "~" + directory.slice(os.homedir().length) : directory;
function profiles(id: ProviderId): string {
  const found = accounts.filter(account => account.provider === id).map(account => shortPath(account.directory));
  return found.join(", ") || "None signed in";
}
async function selectDirectory(id: ProviderId): Promise<void> {
  const folders = await vscode.window.showOpenDialog({
    canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
    openLabel: "Monitor this profile", title: id === "claude" ? "Add a Claude config directory" : "Add a Codex home directory",
  });
  if (folders?.[0]) await vscode.workspace.getConfiguration("agentUsageBar").update(
    id === "claude" ? "claude.configDirectory" : "codex.home", folders[0].fsPath, vscode.ConfigurationTarget.Global,
  );
}
// Store a name for one discovered profile under its directory key (~ form) in agentUsageBar.profileNames.
async function nameProfile(): Promise<void> {
  const pick = await vscode.window.showQuickPick(accounts.map(account => ({
    label: `${NAMES[account.provider]} ${shortPath(account.directory)}`,
    description: [nameOf(account), monitors.get(key(account))?.state.snapshot?.account].filter(Boolean).join(" · "), account,
  })), { title: "Name a profile", placeHolder: "Choose the profile to name" });
  if (!pick) return;
  const value = await vscode.window.showInputBox({
    title: `Name for ${shortPath(pick.account.directory)}`, value: nameOf(pick.account),
    prompt: "Shown in the status bar and sidebar. Leave empty to remove the name.",
  });
  if (value === undefined) return;
  const names = { ...setting<Record<string, unknown>>("profileNames", {}) };
  const dirKey = shortPath(pick.account.directory);
  if (value.trim()) names[dirKey] = value.trim(); else delete names[dirKey];
  await vscode.workspace.getConfiguration("agentUsageBar").update("profileNames", names, vscode.ConfigurationTarget.Global);
}
async function selectProviders(): Promise<void> {
  const selected = enabled();
  const result = await vscode.window.showQuickPick(IDS.map(id => ({ label: NAMES[id], id, picked: selected.includes(id) })), {
    title: "Providers to monitor", canPickMany: true, placeHolder: "Select Claude, Codex, or both",
  });
  if (result) await vscode.workspace.getConfiguration("agentUsageBar").update("providers", result.map(item => item.id), vscode.ConfigurationTarget.Global);
}
async function openSettings(): Promise<void> {
  const visible = setting("showStatusBarItem", true);
  const choice = await vscode.window.showQuickPick([
    { label: "$(list-selection) Providers to monitor", description: enabled().map(id => NAMES[id]).join(" + ") || "None", action: "providers" },
    { label: `$(eye${visible ? "-closed" : ""}) ${visible ? "Hide" : "Show"} status bar usage`, description: "Bottom-right summaries", action: "toggle" },
    { label: "$(folder-opened) Claude profiles", description: profiles("claude"), detail: "Signed-in ~/.claude* directories are found automatically. Pick a folder to add one elsewhere.", action: "claude" },
    { label: "$(tag) Profile names", description: accounts.map(nameOf).filter(Boolean).join(", ") || "None set", detail: "Name each profile, such as a client or company, for the status bar and sidebar.", action: "names" },
    { label: "$(folder-opened) Codex homes", description: profiles("codex"), detail: "Signed-in ~/.codex* directories are found automatically. Pick a folder to add one elsewhere.", action: "codex" },
    { label: "$(settings-gear) All usage settings", description: "Refresh interval, thresholds, and CLI path", action: "settings" },
  ], { title: "Agent Usage Settings", placeHolder: "Configure usage monitoring" });
  switch (choice?.action) {
    case "providers": await selectProviders(); break;
    case "toggle": await vscode.workspace.getConfiguration("agentUsageBar").update("showStatusBarItem", !visible, vscode.ConfigurationTarget.Global); break;
    case "claude": case "codex": await selectDirectory(choice.action); break;
    case "names": await nameProfile(); break;
    case "settings": await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:planken.agent-usage"); break;
  }
}
async function openPage(id?: ProviderId): Promise<void> {
  const selected = enabled();
  if (!id) {
    if (selected.length === 1) id = selected[0];
    else id = (await vscode.window.showQuickPick(IDS.map(value => ({ label: NAMES[value], id: value })), { title: "Open usage page" }))?.id;
  }
  if (id) await vscode.env.openExternal(vscode.Uri.parse(PAGES[id]));
}
function relative(date: Date | null): string {
  if (!date) return "n/a";
  const minutes = Math.round((date.getTime() - Date.now()) / 60000);
  if (minutes <= 0) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
const clock = (date: Date) => date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
function render(): void {
  for (const account of accounts) {
    const item = items.get(key(account)), state = monitors.get(key(account))?.state, id = account.provider;
    if (!item || !state) continue;
    if (setting("showStatusBarItem", true)) item.show(); else item.hide();
    const rows = state.snapshot?.rows ?? [];
    const summary = rows.map(row => `${row.shortLabel} ${row.percent}%`).join(" · ");
    const prefix = state.error ? "warning" : !state.snapshot && state.loading ? "sync~spin" : ICONS[id];
    const tag = [id === "codex" ? "Codex" : "", nameOf(account)].filter(Boolean).join(" ");
    item.text = `$(${prefix}) ${tag && summary ? `${tag}: ${summary}` : tag || summary || NAMES[id]}`;
    item.name = `${NAMES[id]} Usage${nameOf(account) ? ` (${nameOf(account)})` : ""}`;
    const max = Math.max(0, ...rows.map(row => row.percent));
    item.backgroundColor = state.error ? undefined : max >= setting("errorAtPercent", 95)
      ? new vscode.ThemeColor("statusBarItem.errorBackground") : max >= setting("warnAtPercent", 80)
        ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
    item.color = state.error || item.backgroundColor ? undefined : new vscode.ThemeColor(`agentUsage.${id}`);
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${NAMES[id]} usage**\n\n`);
    if (nameOf(account)) md.appendText(`Name: ${nameOf(account)}\n`);
    md.appendText(`Profile: ${shortPath(account.directory)}\n`);
    if (state.snapshot?.account) md.appendText(`Account: ${state.snapshot.account}\n`);
    md.appendText("\n");
    for (const row of rows) md.appendText(`${row.label}: ${row.percent}% · resets in ${relative(row.resetsAt)}\n`);
    if (state.snapshot?.note) md.appendText(`\n${state.snapshot.note}\n`);
    if (state.error) md.appendText(`\nRefresh failed: ${state.error}\n`);
    if (state.updated) md.appendText(`\nUpdated ${state.updated.toLocaleTimeString()}.\n`);
    md.appendText("Click to open the usage page. Your browser account may differ.");
    item.tooltip = md;
  }
  provider?.update();
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
class UsageViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: false };
    view.onDidChangeVisibility(() => { if (view.visible) void refresh(); });
    this.update();
  }
  update(): void {
    if (!this.view) return;
    let body = "";
    for (const account of accounts) {
      const id = account.provider, state = monitors.get(key(account))!.state;
      const who = state.snapshot?.account ?? shortPath(account.directory), name = nameOf(account);
      body += `<section><div class="title"><h2 class="${id}-title">${NAMES[id]}</h2>`
        + (name ? `<span class="name">${escapeHtml(name)}</span>` : "") + `<span class="who" title="${escapeHtml(shortPath(account.directory))}">${escapeHtml(who)}</span>`
        + (state.updated ? `<span class="time" title="Updated ${escapeHtml(state.updated.toLocaleTimeString())}">${escapeHtml(clock(state.updated))}</span>` : "") + "</div>";
      if (!state.snapshot && !state.error) body += '<p class="meta">Loading…</p>';
      for (const row of state.snapshot?.rows ?? []) {
        const color = row.percent >= setting("errorAtPercent", 95) ? "error" : row.percent >= setting("warnAtPercent", 80) ? "warning" : id;
        const at = row.resetsAt ? row.resetsAt.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
        const width = Math.min(100, Math.max(0, row.percent));
        body += `<div class="row"><div class="head"><span class="label">${escapeHtml(row.label)}${row.active ? '<span class="binding">binding</span>' : ""}</span>`
          + (row.resetsAt ? `<span class="meta" title="Resets ${escapeHtml(at)}">${escapeHtml(relative(row.resetsAt))}</span>` : "")
          + `<span class="pct">${row.percent}%</span></div>
          <div class="track" role="progressbar" aria-label="${escapeHtml(row.label)}" aria-valuenow="${width}" aria-valuemin="0" aria-valuemax="100"><div class="fill ${color}" style="width:${width}%"></div></div></div>`;
      }
      if (state.snapshot?.note) body += `<p class="meta">${escapeHtml(state.snapshot.note)}</p>`;
      else if (state.snapshot && state.snapshot.rows.length === 0) body += '<p class="meta">No usage limits reported.</p>';
      if (state.error) body += `<p class="error-text">${state.snapshot ? "Refresh failed" : "Usage unavailable"}: ${escapeHtml(state.error)}</p>`;
      body += "</section>";
    }
    if (discoveryError) body += `<p class="error-text">${escapeHtml(discoveryError)}</p>`;
    else if (!enabled().length) body = '<p class="meta">Choose providers from the settings gear to start monitoring.</p>';
    else if (!accounts.length) body = discovering ? '<p class="meta">Looking for signed-in profiles…</p>'
      : `<p class="meta">No signed-in ${enabled().map(id => NAMES[id]).join(" or ")} profile found. Sign in with the CLI, or add a directory from the settings gear.</p>`;
    this.view.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>
      body{padding:2px 10px 4px;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground)}
      section+section{margin-top:8px;padding-top:6px;border-top:1px solid var(--vscode-widget-border,#444)}
      .title{display:flex;align-items:baseline;gap:6px;margin:0 0 4px}h2{font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin:0;white-space:nowrap}
      .name{font-weight:600;white-space:nowrap}.who{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.6;font-size:.85em}.time{opacity:.5;font-size:.85em;font-variant-numeric:tabular-nums;white-space:nowrap}
      .row{margin-bottom:5px}.head{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}.label{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pct{font-variant-numeric:tabular-nums;white-space:nowrap}.binding{opacity:.7;font-weight:400;font-size:.9em;margin-left:5px}
      .track{height:4px;border-radius:2px;background:var(--vscode-editor-inactiveSelectionBackground,#333);overflow:hidden}.fill{height:100%;border-radius:2px}.claude{background:var(--vscode-agentUsage-claude,#d97757)}.codex{background:var(--vscode-agentUsage-codex,#a8d5ba)}.claude-title{color:var(--vscode-agentUsage-claude,#d97757)}.codex-title{color:var(--vscode-agentUsage-codex,#a8d5ba)}.warning{background:var(--vscode-charts-yellow,#cca700)}.error{background:var(--vscode-charts-red,#f14c4c)}
      .meta{opacity:.6;font-size:.85em;white-space:nowrap}p.meta{margin:2px 0;white-space:normal}.error-text{color:var(--vscode-errorForeground);overflow-wrap:anywhere;margin:2px 0}
      </style></head><body>${body}</body></html>`;
  }
}
function fetchFor(account: Account, signal: AbortSignal) {
  return account.provider === "claude"
    ? fetchClaudeUsage(account.directory, signal)
    : fetchCodexUsage({ executable: setting("codex.executablePath", "codex"), home: account.directory, signal });
}
// Rebuild monitors and status items for the discovered list; monitors survive when their account stays.
function reconcile(found: Account[]): void {
  const keys = new Set(found.map(key));
  for (const [id, monitor] of monitors) if (!keys.has(id)) { monitor.reset(); monitors.delete(id); }
  for (const account of found) if (!monitors.has(key(account))) monitors.set(key(account), new UsageMonitor(render));
  if (found.map(key).join("\n") !== accounts.map(key).join("\n")) {
    for (const item of items.values()) item.dispose();
    items.clear();
    found.forEach((account, index) => {
      const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10000 + found.length - index);
      item.name = `${NAMES[account.provider]} Usage${account.name ? ` (${account.name})` : ""}`;
      item.command = `agentUsageBar.open${account.provider === "claude" ? "Claude" : "Codex"}UsagePage`;
      items.set(key(account), item);
    });
  }
  accounts = found;
  render();
}
async function discover(): Promise<void> {
  try {
    reconcile(await discoverAccounts(enabled(), { claude: setting("claude.configDirectory", ""), codex: setting("codex.home", "") }));
    discoveryError = undefined;
  } catch (error) {
    discoveryError = `Profile discovery failed: ${error instanceof Error ? error.message : String(error)}`;
    render();
  }
}
async function refresh(): Promise<void> {
  discovering ??= discover().finally(() => { discovering = undefined; });
  await discovering;
  await Promise.all(accounts.map(account => monitors.get(key(account))!.refresh(signal => fetchFor(account, signal))));
}
function clear(): void {
  for (const monitor of monitors.values()) monitor.reset();
  monitors.clear();
  for (const item of items.values()) item.dispose();
  items.clear();
  accounts = [];
}
function schedule(): void {
  if (timer) clearInterval(timer);
  timer = setInterval(() => void refresh(), Math.max(1, setting("refreshIntervalMinutes", 5)) * 60000);
}
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  provider = new UsageViewProvider();
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("claudeUsageBar.view", provider));
  const actions: Record<string, () => unknown> = {
    refresh, openSettings, selectProviders, openUsagePage: () => openPage(),
    selectClaudeProfile: () => selectDirectory("claude"), selectCodexHome: () => selectDirectory("codex"),
    openClaudeUsagePage: () => openPage("claude"), openCodexUsagePage: () => openPage("codex"),
  };
  for (const [name, callback] of Object.entries(actions)) context.subscriptions.push(vscode.commands.registerCommand(`agentUsageBar.${name}`, callback));
  for (const [old, current] of Object.entries({ refresh: "refresh", openSettings: "openSettings", openUsagePage: "openClaudeUsagePage", selectConfigDirectory: "selectClaudeProfile" })) {
    context.subscriptions.push(vscode.commands.registerCommand(`claudeUsageBar.${old}`, actions[current]));
  }
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration("agentUsageBar") && !event.affectsConfiguration("claudeUsageBar")) return;
      const rediscover = ["agentUsageBar.providers", "agentUsageBar.claude", "agentUsageBar.codex", "claudeUsageBar.configDirectory"]
        .some(section => event.affectsConfiguration(section));
      if (rediscover) clear();
      render(); schedule();
      if (rediscover) void refresh();
    }),
    vscode.window.onDidChangeWindowState(state => { if (state.focused) void refresh(); }),
    { dispose: deactivate },
  );
  render();
  // Version detection must not delay Codex's initial refresh.
  void detectClaudeVersion();
  await refresh();
  schedule();
}
export function deactivate(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  clear();
}
