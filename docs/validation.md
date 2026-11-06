# Preview and validation

This page separates reproducible local checks from live account verification. The project README is the installation guide; older dated QA reports preserve the context of previous iterations.

## Automated checks

Run from the cloned repository root:

```bash
npm run check
npm test
npm pack --dry-run
```

The tests use temporary credential stores, mock DSH services, and fake provider responses. Callback tests use real loopback HTTP listeners. No real Claude credentials, browser login, or billable inference is needed.

The suite covers credential path overrides and file permissions, PKCE and callback validation, host/client registration, model preference writes and rollback, usage normalization, and manual-probe behavior. Authentication lifecycle regression tests additionally exercise cancellation, stale work after disconnection, and concurrent reads sharing one token refresh.

## UI preview

The preview renders the actual client components, with synthetic API responses and a fake model-directory service. It is a separate local component harness, not another DSH instance.

```bash
cd dev/preview
npm ci
npm start
```

Open `http://127.0.0.1:3191/`. The server binds to loopback only. Restart it after editing the preview harness; the entry bundle is compiled at startup. Reload the page after editing the client module.

| Parameter | Values |
| --- | --- |
| `theme` | `light`, `dark` |
| `lang` | `zh-CN`, `en` |
| `scenario` | `ready`, `error`, `manual`, `disconnected`, `login` |

Examples:

- [Light Chinese settings](http://127.0.0.1:3191/?theme=light&lang=zh-CN&scenario=ready)
- [Dark English errors](http://127.0.0.1:3191/?theme=dark&lang=en&scenario=error)
- [Disconnected account](http://127.0.0.1:3191/?scenario=disconnected)
- [Login and cancellation](http://127.0.0.1:3191/?scenario=login)

In `login`, Sign in opens a blank simulated authorization tab. The harness never sends a real OAuth request. The browser-console helper `window.__previewCompleteLogin()` completes only a currently pending mock login; it cannot complete one that has been cancelled. `window.__previewRequests` records paths and methods for checking that UI actions reached the expected mock route. In `error`, `window.__previewRecover()` restores the mock service and emits a focus event so retry behavior can be checked.

A narrow viewport should preserve readable cards with no horizontal page overflow. Check model search, protected default-model switches, failed-save recovery, quota placement, and cancel → fresh sign-in. Browser storage preserves the quota placement by origin; select the desired placement when repeating a test.

## 0.1.1 verification — 2026-11-06

- Local syntax checks and all 38 automated tests passed.
- Browser checks used the actual client module against the synthetic harness: Cancel sent POST to the host route, fresh sign-in after cancellation succeeded, and disconnect sent POST to logout.
- The composer changed from its disconnected reading to current quota immediately after login, and discarded that reading on disconnect.
- English dark UI at 390px viewport width had 390px document width. A failed model save preserved the enabled state; after mock recovery a retry saved successfully. Search returned the two matching previous-generation models, and the current default was protected.

[English narrow-screen recovery screenshot](../assets/screens/iteration-auth-mobile.png). All account and quota values in this evidence are simulated.

## 0.1.2 runtime diagnosis — 2026-11-06

- A real isolated DSH instance reproduced cancel returning HTTP 500 because its credential-reference service exposes `unset()` rather than `delete()`.
- After restarting with the correction, the same real cancel endpoint returned HTTP 200 with `ok: true`.
- The waiting banner now displays the host's sign-in expiration time. The host and client use the same fifteen-minute window.
- Syntax checks and all 45 local automated tests passed, including server deadline and cleanup-failure regressions.
- A new real consent page reached the signed-in account, but its Authorize control stayed disabled while hCaptcha frames were loaded. User interaction on the provider page is still required; no real token exchange or inference has been claimed from this state.

## Evidence and boundaries

[Earlier component QA](qa-iteration-2026-11-01.md) records desktop light, narrow-screen recovery, and English component checks. The [light settings screenshot](../assets/screens/iteration-light-final.png) and [mobile recovery screenshot](../assets/screens/iteration-mobile-recovered.png) use invented accounts, model metadata, and usage data.

DSH `0.2.1-rc.5` was installed into a separate home and Web profile on 2026-11-06, with a separate Claude credential directory. The local package registered automatically, its Settings page rendered in the actual DSH UI, and Sign in reached Claude's real OAuth consent page.

That run exposed a real integration issue hidden by the original mocks: DSH's reference cleanup API is `unset()`, while the plugin called `delete()`. Cancel returned HTTP 500. Also, the old client stopped waiting before the host deadline; the consent page could remain open after its loopback callback listener closed. Version 0.1.2 corrects the API and shares a server-reported sign-in deadline. Merely reaching the consent page does not establish token exchange or inference.

Still to verify with a real permitted account: OAuth completion, refresh against the provider, inference through DSH, and the read-only usage endpoint's actual payload. A component preview cannot establish these. Remote/headless hosts also need a working route for the browser's loopback callback.
