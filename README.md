# dsh-anthropic-oauth

**Claude sign-in, model selection, and quota visibility inside DeepSeek Harness.**

[中文说明](README.zh.md) · [Changelog](CHANGELOG.md) · [Preview & testing](docs/validation.md) · [Report an issue](https://github.com/drewliu123/dsh-anthropic-oauth/issues)

[![CI](https://github.com/drewliu123/dsh-anthropic-oauth/actions/workflows/ci.yml/badge.svg)](https://github.com/drewliu123/dsh-anthropic-oauth/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Connect a Claude Pro/Max account from DSH Settings, choose the models that appear in your picker, and see remaining allowance beside your conversation. You can also explicitly adopt an existing local Claude Code login.

![Claude account, quota windows, and model settings](assets/screens/iteration-light-final.png)

*Actual plugin components with simulated account and usage data. Experimental: a complete live OAuth → refresh → inference session and the live usage response format still need end-to-end verification.*

## What you get

- **Account management in Settings.** Browser OAuth with PKCE, a manual sign-in link when popups are blocked, account sync, cancellation, and DSH-only disconnection.
- **A useful model picker.** Models come from your account, grouped by Opus / Sonnet / Haiku. Search, enable or disable models, and choose a default when your DSH build supports it. The current default and last enabled model are protected.
- **Quota where you work.** A small composer meter, a dock above the input, or no composer display. Details show each usage window and reset time; the meter follows the primary window with the lowest remaining percentage.
- **Chinese and English UI.** Light and dark themes, responsive settings, and explicit loading, empty, and error states.

## Quick start

### Requirements

Use **Node.js 24 LTS**, `pnpm` on your `PATH`, and a DSH build with Web UI plugin support. The plugin code supports Node 20+, but the DSH CLI has newer runtime requirements. A Claude Pro/Max account is needed for the subscription login path.

The commands pin DSH to `0.2.1-rc.5`, whose CLI syntax and bundle registration were checked against the installed distribution. They use a separate DSH home **and** Claude credential directory. Run them in the same terminal; they do not require a global DSH installation.

```bash
git clone https://github.com/drewliu123/dsh-anthropic-oauth.git
cd dsh-anthropic-oauth

export DSH_HOME="$PWD/.dsh-dev"
export DSH_ANTHROPIC_OAUTH_CLAUDE_DIR="$DSH_HOME/claude-home"

npx -y -p @deepseek-ai/dsh@0.2.1-rc.5 dsh plugin --profile web add "$PWD"
npx -y -p @deepseek-ai/dsh@0.2.1-rc.5 dsh --profile web --port 3187 --no-open
```

Open the local URL printed by DSH, then go to **Settings → dsh-anthropic-oauth**. The bundle registers itself; no manual YAML patch is needed.

### Connect and choose a model

1. Click **Sign in**, finish authorization on Claude's page, and return to DSH. If a tab did not open, use the fallback link in the waiting banner.
2. Choose which discovered models DSH offers. Use **Make default** if available, or choose an enabled Claude model in the conversation picker.
3. Open a conversation with a Claude model selected to see the quota meter. Change its placement in the plugin's Settings page.

Each sign-in has a fifteen-minute window, shown in the waiting banner. If it expires, close the old consent tab and click **Sign in** again; an old consent page cannot revive a closed callback.

**Use Claude Code login** appears when a local login is detected and the plugin is disconnected. It is used only after you choose it. In the isolated setup above, your usual Claude Code credentials are intentionally outside the selected directory.

### Add to an existing DSH setup

For a CLI-managed Web instance, run the `plugin … add` command with the **same `DSH_HOME` and profile that instance uses**, then restart it. Replace `web` if your profile has another name. The desktop app's `desktop` profile is reserved and cannot be managed by this ordinary npm CLI command; use the desktop app's supported plugin-management path instead. The quick start above creates a separate Web instance.

For an existing Claude Code session, leave `DSH_ANTHROPIC_OAUTH_CLAUDE_DIR` unset, or point it at the intended Claude directory. `CLAUDE_CONFIG_DIR` is the fallback override; otherwise the plugin uses `~/.claude`.

## How quota works

The plugin tries a read-only usage endpoint first. It does not send a model inference request for automatic refreshes. Unexpected or malformed data produces an unavailable/retry state rather than a made-up zero-usage reading.

If the read-only endpoint is unavailable, an **explicit manual probe** can send one `max_tokens: 1` request and read the returned rate-limit headers. That consumes a small amount of allowance. The UI labels the source, and caches probe results for five minutes.

The meter appears only for an active Claude conversation. Other model-specific windows, when returned by the provider, remain visible in Settings but do not determine the primary meter's color.

## Connection and credentials

OAuth exchange and refresh run on the DSH host. Account status contains display information, not token values. Credentials are synchronized to DSH's credential service; this derivative does not copy them into a third-party subscriptions store.

- **Cancel** ends the pending plugin authorization. Start a fresh sign-in to try again.
- **Disconnect** removes the DSH connection and its credential references, and stops pending plugin authorization. It leaves Claude Code's credential file intact.
- Signing in or refreshing may update the selected shared Claude credential file. Set both directory overrides when testing against a separate account.

The bundled `anthropic-oauth-login` CLI honors the same directory overrides and writes secret files with owner-only permissions. The Settings flow is the recommended entry point.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| Plugin missing from Settings | Confirm the home/profile matches the running DSH process, then restart it to rebuild the client bundle. |
| Sign-in tab did not open | Use the waiting banner's sign-in link. The callback must reach the machine running DSH. |
| Sign-in expired / callback refused the connection | Close the old consent tab and start a fresh sign-in in Settings. |
| Claude's Authorize button stays disabled | Complete any human verification on Claude's page. A loaded consent page alone does not mean authorization succeeded. |
| Models are missing | Use **Sync account**. Discovery failure leaves existing provider settings unchanged; the plugin does not invent model IDs. |
| No composer meter | Select a Claude model and check that placement is not **Hidden**. No usage data may have been read yet. |
| No **Make default** button | Your DSH build does not expose the default-model service. Select the model through DSH's picker. |
| Quota needs a manual read | Retry the read-only source, or use the explicitly labelled probe if you accept its small allowance cost. |

For an issue report, include your DSH/Node versions, profile name, what you clicked, and a redacted screenshot or error. Do not include credential files or authorization URLs.

## Develop and verify

There are no root runtime dependencies to install:

```bash
npm run check
npm test
npm pack --dry-run
```

Tests cover the host bridge, credential isolation, OAuth callbacks, model preferences, quota parsing, and client registration using temporary stores and mocked provider responses. They do not log into a real account.

To run the actual UI with synthetic data:

```bash
cd dev/preview
npm ci
npm start
```

Open `http://127.0.0.1:3191`. For example, `?theme=light&lang=en&scenario=error` opens a light English error state. See [validation notes](docs/validation.md) for scenarios and coverage.

To update a local checkout, run `git pull --ff-only`, repeat the add command for the intended home/profile if needed, and restart DSH.

## Scope and attribution

This is an unofficial, experimental integration, derived from [grloper/dsh-claude-oauth](https://github.com/grloper/dsh-claude-oauth) v1.1.0. It uses Claude's consumer OAuth flow and Claude Code-compatible headers; compatibility depends on upstream changes. Use it with an account and use case permitted by the provider. Live account verification remains the main outstanding validation task.

The replacement Settings/composer UI, explicit account adoption, DSH-only disconnect, model controls, and quota presentation build on that bridge. The quota presentation also takes inspiration from [dsh-codex](https://github.com/Yan-Zero/dsh-codex).

[MIT License](LICENSE) · [Attribution](NOTICE.md) · [Design notes](DESIGN.md)
