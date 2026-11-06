# Changelog

## 0.1.1 — 2026-11-06

### Authentication

- Cancel and login timeout now notify the host, abort pending authorization, and close callback listeners.
- Cancel and disconnect reject stale exchange, refresh, adoption, and synchronization results. Credential deletion is queued after any write already executing.
- Cancel and logout endpoints require POST. Disconnect keeps Claude Code's shared credential file intact and does not revoke upstream tokens.
- OAuth callbacks validate state before handling provider errors; credentials record the scopes actually requested.
- Token, model-discovery, and quota failures avoid returning upstream secret-bearing bodies to the browser.
- Concurrent refreshes within the same plugin instance share one provider request. New and updated host credential files enforce owner-only permissions.

### Interface and documentation

- Composer quota discards the previous account reading and refreshes when authentication changes.
- Added a reproducible login/cancel scenario to the component preview and English preview labels.
- Rewrote both READMEs around setup and use; pinned the documented DSH CLI version and clarified Web/desktop profile differences.
- Moved verification detail to a dedicated guide and marked inherited upstream articles as historical.
- Expanded CI checks to Node 20, 22, and 24.

## 0.1.0 — 2026-11-06

Initial public experimental derivative of grloper/dsh-claude-oauth: replacement Settings and composer UI, explicit Claude Code adoption, model controls, quota source labels, and isolated CLI credential handling.
