# Agent Usage

Monitor **Claude and Codex plan limits** in a VS Code Explorer panel and the status bar. Every signed-in profile of each provider gets its own section and status item, so a work and a personal Claude account show side by side. Choose either provider or both, and hide the status summaries when you want a quieter editor.

## Display and controls

The **Agent Usage** panel shows one compact section per signed-in profile, headed by the provider name, the account email (or the profile directory until the first refresh), and the last update time:

- **Claude:** session, all-model weekly quota, and model-specific limits when reported.
- **Codex:** only the main account’s **Weekly** limit, with its reset time. Spark/model-specific buckets and shorter windows are omitted from both the panel and status bar.
- Each limit is one line: label, time until reset (hover for the exact moment), percentage, and a progress bar.
- Independent errors: an unavailable or rate-limited provider does not hide the other provider's usage. Previously fetched values keep their timestamp when a refresh fails.

The panel header has **Refresh**, **Open Usage Page**, and a **settings gear**. The gear opens:

1. **Providers to monitor:** Claude, Codex, both, or none.
2. **Show/Hide status bar usage:** toggles the bottom-right summaries.
3. **Claude profiles:** lists the signed-in Claude directories and lets you add one outside `~/.claude*`.
4. **Codex homes:** lists the signed-in Codex homes and lets you add one outside `~/.codex*`.
5. **All usage settings:** refresh interval, warning/error thresholds, and Codex executable path.

Claude uses a warm terracotta accent; Codex uses soft mint, with accessible variants for light and high-contrast themes. The colors apply to headings, progress bars, and status summaries; warning/error thresholds still take precedence. Customize `agentUsage.claude` and `agentUsage.codex` through VS Code's `workbench.colorCustomizations`. Status items sit together and use their respective Claude and Codex logos; a non-default profile shows its directory suffix (`personal` for `~/.claude-personal`) and Codex also retains its name. Hover for profile, account, and reset details. Clicking a status item opens that provider's usage page. The browser's logged-in account can differ from the locally monitored account.

## Install and update

The Marketplace identity is **`planken.agent-usage`**, displayed as **Agent Usage**. This is a new extension identity: uninstall **Claude Plan Usage** (`planken.claude-plan-usage`) before installing it to avoid duplicate polling and conflicting views. Existing `agentUsageBar` settings and legacy `claudeUsageBar` preferences are retained. The old listing will not automatically upgrade to this extension.

From source:

```sh
git clone https://github.com/JPlanken/agent-usage-bar.git
cd agent-usage-bar
npm ci
npm test
npm run install-vscode  # macOS: packages and installs in Visual Studio Code
```

Use `npm run install-local` on systems where `code` is on PATH. Then run **Developer: Reload Window** in VS Code. The package is `agent-usage.vsix`.

## Profiles and login

### Claude

The extension finds `~/.claude` and every `~/.claude-*` directory (plus `CLAUDE_CONFIG_DIR` when set) and monitors each one that holds a readable login. A directory without a login is skipped, not shown as an error. To monitor a profile kept elsewhere, add the directory passed to `CLAUDE_CONFIG_DIR`, not the executable or a project folder:

```json
"agentUsageBar.claude.configDirectory": "/Volumes/work/claude-config"
```

On macOS, `~/.claude` reads the standard Keychain entry and every other directory reads its hashed Keychain service. The fallback credentials file stays inside the same profile. Missing credentials never cause a fallback to a different account. The account email comes from the profile's `.claude.json`.

Sign in or refresh an expired login using the matching profile:

```sh
CLAUDE_CONFIG_DIR="$HOME/.claude-personal" claude
```

### Codex

Install the Codex CLI and sign in with ChatGPT. The extension finds `~/.codex` and every `~/.codex-*` home (plus `CODEX_HOME` when set) that holds an `auth.json`. For each one it starts a short-lived local `codex app-server --stdio`, initializes its protocol, reads account information and rate limits, and closes the process. It never starts a conversation or makes a model request.

```json
"agentUsageBar.codex.home": "~/.codex",
"agentUsageBar.codex.executablePath": "/opt/homebrew/bin/codex"
```

An empty home setting uses `CODEX_HOME`, then `~/.codex`. The executable defaults to `codex` on the editor's PATH. Set its absolute path if VS Code cannot find it. Sign in to a custom home with:

```sh
CODEX_HOME="$HOME/.codex-personal" codex login
```

Codex must support `account/rateLimits/read`; verified with CLI 0.154.0. API-key billing does not expose ChatGPT plan quotas and produces an explanatory message. The weekly percentage and reset time come from the main account bucket. If no weekly window is reported, the extension says so instead of substituting another limit. This is a plan-limit monitor, not an API spending dashboard.

Protocol reference: [Codex App Server](https://learn.chatgpt.com/docs/app-server).

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `agentUsageBar.providers` | `["claude", "codex"]` | Providers to poll and display |
| `agentUsageBar.showStatusBarItem` | `true` | Show one status summary per signed-in profile |
| `agentUsageBar.refreshIntervalMinutes` | `5` | Poll interval; minimum one minute |
| `agentUsageBar.warnAtPercent` | `80` | Warning threshold |
| `agentUsageBar.errorAtPercent` | `95` | Error threshold |
| `agentUsageBar.claude.configDirectory` | empty | Extra Claude profile outside `~/.claude*`; machine-specific |
| `agentUsageBar.codex.home` | empty | Extra Codex home outside `~/.codex*`; machine-specific |
| `agentUsageBar.codex.executablePath` | `codex` | CLI executable; machine-specific |

Existing `claudeUsageBar.*` preferences remain a fallback until the corresponding `agentUsageBar.*` value is explicitly set. Existing command IDs and the panel ID are retained as compatibility aliases, preserving keybindings and panel placement. Profiles are rediscovered on every refresh, so a new login appears and a signed-out profile disappears without a reload. Changing a profile setting or provider clears the previous usage immediately and ignores late responses. Display-only changes retain timestamps and do not fetch usage.

## Implementation

| File | Responsibility |
|---|---|
| `src/extension.ts` | Settings, commands, panel, status items, account reconciliation |
| `src/monitor.ts` | Per-account refresh lifecycle, cancellation, stale-response protection, backoff |
| `src/claude.ts` | Claude usage endpoint and response conversion |
| `src/profiles.ts` | Discovery of signed-in Claude and Codex directories |
| `src/credentials.ts` | Claude Keychain/file credential selection and account email |
| `src/codex.ts` | Codex home, local app-server transport, quota conversion |
| `src/usage.ts` | Shared usage types |
| `resources/` | Claude icon assets |
| `tools/build-icon.py` | Rebuilds the icon font; requires fonttools |
| `tests/` | Credential isolation, discovery, parsers, lifecycle, local protocol, UI behavior |

Claude uses its existing OAuth usage endpoint, which is undocumented and may change. HTTP 429 pauses Claude polling for 15 minutes. Codex uses the documented local account interface. Credentials and raw account responses are not logged. No credentials are bundled in the extension. Endpoint results are not persisted by the extension.

```sh
npm test
npm run package
npx vsce ls --no-dependencies
```

## Publishing

The display name is **Agent Usage**, package name `agent-usage`, and publisher `planken`. Version 0.5.0 is the first release under the new identity. Publish it as a new extension in the publisher portal; do not upload it as an update to the old Claude-only listing.

- Manual: upload `agent-usage.vsix` at the publisher portal.
- Automated: the release workflow publishes `v*` tags using `VSCE_PAT`, with optional Open VSX publishing via `OVSX_PAT`. A main-branch push only builds and tests.
- Credentials remain in the existing Doppler project `claude-usage-bar/prd`; renaming the source repository does not migrate that secret store.

To prepare a release, update the version and changelog, run tests and packaging, then publish through the chosen channel. Local installation does not publish a Marketplace update.
