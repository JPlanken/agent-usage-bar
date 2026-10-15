import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { codexHome } from "./codex";
import { CredentialTarget, credentialTarget, profileTarget, readToken } from "./credentials";
import { Account, ProviderId } from "./usage";

export interface ProfileSource {
  home: string;
  env: NodeJS.ProcessEnv;
  directories(parent: string): Promise<string[]>;
  exists(file: string): Promise<boolean>;
  login(target: CredentialTarget): Promise<boolean>;
}
export const source: ProfileSource = {
  home: os.homedir(),
  env: process.env,
  directories: parent => fs.readdir(parent, { withFileTypes: true })
    .then(entries => entries.filter(entry => entry.isDirectory()).map(entry => entry.name), () => []),
  exists: file => fs.access(file).then(() => true, () => false),
  login: target => readToken(target).then(() => true, () => false),
};
export interface Extras { claude: string; codex: string; }
const PREFIX: Record<ProviderId, string> = { claude: ".claude", codex: ".codex" };

export function profileName(provider: ProviderId, directory: string): string {
  const base = path.basename(directory), prefix = PREFIX[provider];
  return base === prefix ? "" : base.startsWith(prefix + "-") ? base.slice(prefix.length + 1) : base;
}
// The name shown for a profile. `names` comes from the agentUsageBar.profileNames setting; a key is a profile
// directory (~ allowed), an account email, or @domain. A directory key wins over the email, the email over the domain;
// without a match the name is the directory suffix ("" for the provider default).
export function displayName(account: Account, email: string | undefined, names: Record<string, unknown>, home = source.home): string {
  const entries = Object.entries(names ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "");
  const dir = (value: string) => path.normalize(value.startsWith("~") ? path.join(home, value.slice(1)) : value).replace(/\/+$/, "");
  const byDir = entries.find(([k]) => !k.includes("@") && dir(k) === dir(account.directory));
  if (byDir) return byDir[1].trim();
  const mail = email?.trim().toLowerCase();
  if (mail) {
    const domain = "@" + mail.split("@").pop();
    const hit = entries.find(([k]) => k.toLowerCase() === mail) ?? entries.find(([k]) => k.toLowerCase() === domain);
    if (hit) return hit[1].trim();
  }
  return account.name;
}
// ~/<prefix>, every ~/<prefix>-* directory, the environment directory, then the configured extra. First seen wins.
async function candidates(provider: ProviderId, extras: string[], s: ProfileSource): Promise<string[]> {
  const prefix = PREFIX[provider];
  const siblings = (await s.directories(s.home)).filter(name => name.startsWith(prefix + "-")).sort().map(name => path.join(s.home, name));
  const all = [path.join(s.home, prefix), ...siblings, ...extras];
  return [...new Set(all.map(directory => directory.normalize("NFC")))];
}
function expand(provider: ProviderId, value: string | undefined, s: ProfileSource): string[] {
  if (!value?.trim()) return [];
  try { return [provider === "claude" ? credentialTarget(value, "", s.home).directory : codexHome(value, "", s.home)]; }
  catch { return []; }
}
export async function discoverAccounts(providers: ProviderId[], extras: Extras, s = source): Promise<Account[]> {
  const accounts: Account[] = [];
  for (const provider of providers) {
    const configured = provider === "claude" ? [s.env.CLAUDE_CONFIG_DIR, extras.claude] : [s.env.CODEX_HOME, extras.codex];
    for (const directory of await candidates(provider, configured.flatMap(value => expand(provider, value, s)), s)) {
      const available = provider === "claude"
        ? await s.login(profileTarget(directory, s.home))
        : await s.exists(path.join(directory, "auth.json"));
      if (available) accounts.push({ provider, directory, name: profileName(provider, directory) });
    }
  }
  return accounts;
}
