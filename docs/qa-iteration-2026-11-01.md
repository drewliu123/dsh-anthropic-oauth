# 2026-11-01 QA iteration

## Boundary

This iteration used synthetic credentials, temporary storage and mocked network calls. Browser QA loaded the actual client module and React components through `dev/preview/`, a standalone visual harness. This is component-level browser coverage, not a second full DSH integration run or proof that Anthropic's live usage payload matches our assumed schema. No real account credentials or provider requests were used.

## Fixes

- Usage normalization accepts only finite numeric percentages. `null`, booleans, strings, arrays and objects no longer become healthy zero usage.
- Model changes validate the complete request before writing. Unknown IDs and disabling the current default without an enabled replacement are rejected. Provider/settings/default write failures are reported; previous preferences, provider settings and default selection are restored when possible. Restoration failure is explicitly reported. This is compensating rollback, not a cross-process database transaction.
- The current default model's switch is disabled in the UI, with an explanation to choose a different default first.
- Quota probes no longer cache HTTP errors as success. Invalid numbers, resets and non-quota 429 replies are rejected, while valid cached quota is retained.
- Model and quota fetches now respect HTTP failure status even when JSON omits `ok:false`.
- Quota reading errors show a read/retry state, not a false claim that the account cannot support automatic reads. The Settings retry action does not force an inference probe. Manual probes are explicitly labelled as consuming allowance.
- “Runs out first” became “Lowest remaining”: remaining percentage alone does not predict exhaustion time.
- Light-theme numeric text blends with foreground for better contrast. Cards, long model labels, account rows and action headers wrap on narrow viewports.

## Verification

`npm run check` passed. `npm test` passed 17 top-level tests with zero failures; regression cases inside the host integration test additionally cover invalid combined updates, refresh/settings/default failures, rollback and silent default no-op, malformed usage, nonquota HTTP errors, genuine quota 429, network failure, and valid-cache retention.

Browser checks (Ego Lite task space 20):

- Light desktop layout rendered; screenshot `assets/screens/iteration-light-final.png`.
- 390px mobile light layout: no document horizontal overflow. Failed model save retained its original enabled state; retry after mock recovery saved and removed the error.
- Quota recovered after mock service recovery; screenshot `assets/screens/iteration-mobile-recovered.png`.
- Default model switch is locked.
- Dark mobile English: model search returned the two matching older models, and an unmatched query displayed the correct empty state; no horizontal overflow.

The harness can be run from `dev/preview/` with `npm ci` then `npm start`; it binds only to 127.0.0.1:3191. URL parameters: `theme=light|dark`, `lang=zh-CN|en`, `scenario=ready|error|manual|disconnected`. All displayed identities, model metadata and usage are invented. `window.__previewRecover()` clears the simulated failures and triggers the same focus-retry path as a real page.

## Remaining limits

Live OAuth completion, refresh and inference remain unverified. The private usage endpoint's schema remains an assumption. DSH's settings APIs are not transactional across processes; compensation may itself fail, and that failure is surfaced. A theme-token harness cannot guarantee every DSH skin matches these colors. Multiple concurrent client writes and host refresh concurrency still need stronger serialization. The English preview checks component labels, not a live DSH locale-switch workflow.
