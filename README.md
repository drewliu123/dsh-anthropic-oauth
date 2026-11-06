# dsh-anthropic-oauth

[中文说明](README.zh.md) · [Upstream attribution](NOTICE.md)

Experimental personal plugin. Live OAuth completion, token refresh, and inference still need end-to-end verification; see the validation notes below.

A personal Claude Pro/Max OAuth plugin for DeepSeek Harness. It keeps the reference plugin's host-side OAuth, token refresh, model discovery, and quota integration, while replacing the browser surface with a calmer, more native-feeling Studio UI.

This project is derived from [grloper/dsh-claude-oauth](https://github.com/grloper/dsh-claude-oauth) under its MIT license. The client presentation layer and local UX changes in this directory are original.

![Settings preview using synthetic account and quota data](assets/screens/iteration-light-final.png)

*UI preview with simulated data; this image does not demonstrate a live account connection.*

## Latest QA iteration

See [the 2026-11-01 QA report](docs/qa-iteration-2026-11-01.md) for failure regressions, narrow/light/English browser checks, screenshots and reproducible synthetic UI preview instructions. Current-default models cannot be disabled until a replacement is selected. Model write failures roll back where supported and are surfaced instead of appearing successful. Quota failures no longer become healthy or zero-usage readings.

## What is different

- A focused **dsh-anthropic-oauth** settings page instead of a dense settings dashboard.
- Clear connected, waiting, error, and disconnected states.
- **Quota** (structure borrowed from [dsh-codex](https://github.com/Yan-Zero/dsh-codex)): a compact meter in the composer showing the primary window with the lowest remaining percentage, coloured in four steps by remaining capacity (≥60% green, ≥40% yellow, ≥20% orange, below red); hover for both windows and their reset countdowns, click for details and refresh. The Settings card shows each window with its exact reset time, marks the primary window with the lowest remaining percentage, and says where the numbers came from. Quota can also sit in a slim dock above the composer, or be hidden.
- **Model selection**: models grouped by Opus / Sonnet / Haiku, searchable, with a switch per model to choose which ones DSH offers in its model picker (at least one always stays on), and *Make default* through DSH's own default-model service.
- Responsive cards with dark/light theme tokens; labels follow the page language (Chinese/English).
- OAuth values are stored on the Host side; normal account status omits credentials. Upstream error text is not comprehensively sanitized yet, so review it before sharing diagnostics.
- The plugin no longer mirrors credentials into a third-party subscriptions store.
- **Opt-in**: an existing Claude Code login on the machine is detected but never used until you choose **Use Claude Code login** (or sign in through the plugin).
- **Disconnect only affects DSH.** It does not delete or change the Claude Code CLI's own credential file (the upstream plugin logged the CLI out too).
- If model discovery fails, provider settings are left unchanged instead of being filled with invented models.

## Install locally

Use an isolated DSH profile while evaluating the plugin. The plugin reads and writes under `DSH_HOME` and the Claude credentials directory, so set **both** to keep a test away from your real accounts:

```bash
git clone https://github.com/drewliu123/dsh-anthropic-oauth.git
export DSH_HOME="$PWD/.dsh-anthropic-oauth-test"
export DSH_ANTHROPIC_OAUTH_CLAUDE_DIR="$DSH_HOME/claude-home"   # CLAUDE_CONFIG_DIR is also honored
npx -p @deepseek-ai/dsh dsh plugin --profile web add ./dsh-anthropic-oauth
npx -p @deepseek-ai/dsh dsh --profile web --port 3187 --no-open
```

Always set `DSH_HOME` before any `dsh` command, including `--help`; without it `dsh` targets `~/.dsh`.

## Login flow

1. Open **dsh-anthropic-oauth** in DSH Settings.
2. Either click **Sign in** (Claude/Google authorization in a browser tab), or **Use Claude Code login** if one was detected.
3. Return to DSH; the page polls the Host and updates automatically.
4. Click **Sync account** if the model list needs a manual refresh.

No password is collected by this plugin. OAuth is handled by Claude's authorization page and the Host callback. The token is not rendered in the browser UI.

## Quota: where the numbers come from

Two sources, tried in this order; the UI always says which one it used:

1. **Read-only usage endpoint** (`/api/oauth/usage`): costs no quota, so it refreshes automatically (every 60 s while a Claude model is active). **Its response shape is an assumption** — the plugin expects `five_hour` / `seven_day` windows with `utilization` as a percentage and an ISO `resets_at`. I could not verify it without a real login; anything that does not match is rejected, never displayed, and the endpoint is not asked again for 30 minutes.
2. **One minimal real request** (`max_tokens: 1`) reading rate-limit response headers — the method inherited from the upstream plugin. This **spends a little quota**, so it runs **only when you press refresh**, never automatically. Until then the meter shows an empty bar ("not read yet").

If you see a source label of "from one minimal request" in Settings, source 1 did not work on your account; please check the numbers against Claude's own usage page.

## Models

*Enable* a model to offer it in DSH's picker; the choice is stored in `prefs.json` under `DSH_HOME/dsh-anthropic-oauth/` and applied by rewriting `providers.anthropic.models` in the profile (the only fields written are the ones DSH's provider schema knows). *Make default* calls DSH's `agentDefaultModel` service; if your DSH build does not have it, the button is hidden.

## Verified so far

- Plugin loads in an isolated `web` profile; the client bundle is served to the page.
- Status/quota/adopt/disconnect endpoints behave as described, including: no request is made while disconnected, adopt is `POST`-only, and disconnect leaves the Claude credentials file byte-identical.
- The Settings page renders in a real browser (screenshots in `assets/screens/`).
- **Clicking Sign in opens Claude's authorization page**: verified in a real browser — a new tab opens at `claude.ai/oauth/authorize` (PKCE `S256`, loopback `redirect_uri`), Claude shows its own sign-in page, and the plugin page switches to "waiting for browser" with a manual fallback link and a Cancel button that restores the idle state. A host test covers the login endpoint and the callback server.
- Both token endpoints (`claude.ai` and `platform.claude.com`) answer a bogus code with a normal OAuth `invalid_grant`, so the post-authorization exchange path is reachable.
- **Quota and model UI, in a real browser** (screenshots in `assets/screens/`, **using mock API data**): composer meter with colour step, hover tooltip and popover; dock in an active conversation; "hidden"; the "not read yet" state; Settings quota cards; model grid with per-model switches, the last-enabled lock, *Enable all* and *Make default*.
- Host behaviour, against a fake network and fake DSH services: models are listed and enabled/disabled, persisted and applied; invalid choices are refused; default goes through the service; the free quota source makes no inference request; with it unavailable, automatic reads spend nothing and only an explicit refresh probes.
- **Not verified:** completing a real sign-in (no account credentials were entered), real token refresh, model requests through the DSH inference path, **the usage endpoint's real response shape**, the error banner in the composer popover, and a live DSH locale-switch workflow. Light/narrow layouts and English component labels were subsequently checked with mocked data; see the QA report.

## Checks

```bash
npm run check
npm test
```

Tests cover metadata, PKCE helpers, request headers, scopes, HTML escaping, the login endpoint and callback server, the browser module and its slots, the pure quota/model logic, and the host's model/quota routes. A real OAuth login is intentionally not performed in automated tests.

## Known leftovers

- Cancel currently dismisses the client waiting state without aborting the Host OAuth flow. Disconnect also does not abort pending authorization; completing an already opened authorization tab can reconnect the plugin. Close that tab and let the pending flow expire before relying on disconnection.
- Some upstream errors are returned verbatim to the local browser. Comprehensive error redaction and concurrent authentication/write serialization remain follow-up work.

- A test profile that ran an *older* build can still contain invented models (`claude-opus-5`, …) in its `cordis.patch.yml`; current code never writes them but does not remove old ones.
- The composer quota UI only appears while a Claude model is selected in that conversation.

## License

MIT. See [LICENSE](LICENSE) and the upstream attribution above.
