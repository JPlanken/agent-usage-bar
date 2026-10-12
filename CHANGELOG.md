# Changelog

## 0.6.0

- Show every signed-in Claude profile (`~/.claude`, `~/.claude-*`) and Codex home (`~/.codex`, `~/.codex-*`) at once, each with its own section and status item
- Header shows the account email and last update time; reset times sit on the limit line, so each section takes about half the height
- `claude.configDirectory` and `codex.home` now add a directory outside the discovered ones

## 0.5.0

- Rename the extension identity to `planken.agent-usage`
- Update settings navigation for the new identity
- Preserve existing provider settings; uninstall the old extension before installing this one

## 0.4.2

- Place Claude and Codex usage together in the status bar
- Use the Codex logo instead of the generic terminal icon

## 0.4.1

- Show only the main Codex weekly limit in the panel and status bar
- Terracotta Claude and mint Codex accents with light, dark, and high-contrast variants

## 0.4.0

- Renamed the extension display and source repository to Agent Usage
- Monitor Claude, Codex, or both with independent refresh, error, and backoff state
- Codex account limits through the local CLI, including multiple quota buckets and actual window durations
- Select Codex home and CLI path; preserve existing Claude profile and display settings
- Separate provider sections and status items, with independent update times
- Existing extension identity and legacy commands/settings remain compatible

## 0.3.1

- Settings button for the profile, status bar visibility, and usage preferences
- Cleaner sidebar percentages, with the profile moved into settings and the tooltip
- Claude logo in the status bar; update time retained when changing display settings

## 0.3.0

- Select the Claude config directory through a machine setting or folder picker
- Read profile-specific Keychain credentials and show the monitored directory
- Clear old usage on profile changes and ignore late responses from the previous profile

## 0.2.1

- README describes the published Marketplace extension and the release procedure

## 0.2.0

- Explorer sidebar section with progress bars per limit, reset times, refresh and open-page buttons
- Setting to hide the status bar item

## 0.1.0

- Status bar item showing 5-hour session, weekly all-models and weekly per-model usage
