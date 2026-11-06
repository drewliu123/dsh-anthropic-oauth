# dsh-anthropic-oauth

## Purpose

Personal-use Claude Pro/Max OAuth integration for DeepSeek Harness. The goal is not to add another generic subscription manager; it is to make the Claude connection feel calm, legible, and native inside DSH.

## Baseline

The implementation is derived from `grloper/dsh-claude-oauth` v1.1.0 (MIT). Its host-side flow already covers:

- PKCE loopback OAuth with IPv4/IPv6 fallback;
- Claude credential refresh and DSH credential synchronization;
- dynamic model discovery;
- quota headers and reset countdowns.

The browser layer is replaced with a new dsh-anthropic-oauth surface.

## UX decisions

- One focused Settings section: hero status, account, quota, model catalog, and quota-placement preference.
- State is explicit: disconnected, browser authorization pending, connected, and needs attention.
- The primary action changes with state; destructive disconnect is visually secondary.
- Account cards never show token material.
- Quota (shape borrowed from dsh-codex, adapted to Claude's two windows): the composer meter shows the *tightest* primary window, coloured in four steps by remaining capacity; the extra per-model buckets (e.g. 7-day Opus) are listed in Settings but never decide that colour. The meter stays hidden until there is something to say (no "checking…" placeholder), and says plainly when numbers were not read automatically.
- Automatic reads never spend quota: the host answers from the free source or from cache; only an explicit refresh may send a minimal request. The UI labels the source.
- The composer surfaces wait for DSH's `modelDirectories` service and fail closed when the active model is not Anthropic; the placement choice (meter / dock / hidden) decides which one renders and polls.
- Models: grouped by family (family order, then the API's newest-first order), one switch per model, never fewer than one enabled; the default goes through DSH's own `agentDefaultModel` service rather than editing YAML.
- Labels follow the page language (`<html lang>`), falling back to the browser's.
- Disconnect is a two-step inline confirmation, not a native dialog.
- CSS uses DSH theme aliases with fallbacks and responsive layout; it does not patch host DOM icons or observe the entire document.

## Security and scope

- OAuth and token exchange stay on the Host side.
- The plugin does not mirror tokens into a third-party subscriptions store.
- OAuth scopes remain `user:profile user:inference` by default.
- The plugin shares the official Claude Code credential file so an existing session can be reused, but only after explicit adoption (`connection.json` under `DSH_HOME`). Nothing is read, refreshed or sent before that.
- The credentials directory and `DSH_HOME` are overridable (`DSH_ANTHROPIC_OAUTH_CLAUDE_DIR`, `CLAUDE_CONFIG_DIR`, `DSH_HOME`) so tests never touch real accounts.
- Disconnect removes only the DSH-side connection and credential refs; the Claude Code CLI file is never deleted.
- Quota is read from a free, read-only usage endpoint when it works (`normalizeUsage` rejects anything that is not the expected shape); otherwise a minimal real request reads rate-limit headers, **only on an explicit refresh**, cached for 5 minutes.
- Discovery failure leaves provider settings untouched; no model IDs are invented. Only schema-known fields are written to DSH settings.
- Model enable/disable lives in `DSH_HOME/dsh-anthropic-oauth/prefs.json`; the offered list is never empty.

## Lessons from verification

- The first isolated run still used the real `~/.claude` login and issued a real quota probe, because paths were hard-coded to `os.homedir()` and a 60-second timer probed quota. Fixed and covered by a path-override test.
- Unit tests and syntax checks passed while the client failed to load in the browser (`exports is not defined`), while the quota colours were transparent outside the Settings page (CSS variables were scoped to the Settings shell), and while the composer meter never appeared (the client never declared the `modelDirectories` service). All three were only found by running the real page and reading computed styles, so those checks stay part of verification.
- A stale client bundle is served after a package change until the DSH process restarts; restart before judging a UI fix.

## Known limits

- A real OAuth login is not part of automated tests.
- The plugin uses the upstream provider's private/consumer OAuth and Claude Code-compatible request headers. Users should confirm that their account and use case are permitted by the provider's current terms.
- The host bridge still writes the shared Claude credential file synchronously; follow-up hardening can add atomic writes and single-flight refresh.
- The current provider model list is refreshed through the baseline host code; pagination and richer capability preservation remain follow-up work.
- The free usage endpoint's response shape is **unverified** (a bogus-token probe cannot tell whether a path exists, since authentication is checked first). If it does not match, the plugin falls back as described above.
- Overlapping refreshes (timer, file watcher, sync) are still not single-flighted on the host.
