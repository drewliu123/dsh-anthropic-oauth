# Real-account verification — 2026-11-06

**Result: passed.** The public `0.1.2` implementation completed real Claude OAuth login, token refresh, and model inference through DeepSeek Harness. Read-only quota retrieval also passed.

## Environment and scope

- Plugin: `dsh-anthropic-oauth` `0.1.2`, implementation commit `235a5ff`.
- Host: DSH `0.2.1-rc.5`, a separate local Web profile on macOS.
- Isolation: separate `DSH_HOME` and Claude credential directory; the daily desktop profile and normal Claude Code credential file were not used for this test.
- Provider/model: `anthropic` / `claude-haiku-5-5` (Claude Haiku 5.5), selected from the real account's discovered catalog.
- Login was completed in the provider's browser authorization page, including user interaction where required. Automated regression tests remain separate and continue to use mock provider responses.

## What passed

| Check | Observed evidence |
| --- | --- |
| OAuth completion | The browser reached the plugin's successful loopback callback. The real status endpoint returned HTTP 200 with `authenticated: true` and `synced: true`. |
| Credential persistence | Both access and refresh tokens were present in the isolated store, expiry was in the future, and file permissions were owner-only (`0600`). No token values were printed or published. |
| Model discovery | The real models endpoint returned HTTP 200, `ok: true`, and the account's model list. |
| Refresh | Only the isolated credential's expiry was backdated to trigger refresh. The sync endpoint returned HTTP 200 and `ok: true`; both token values changed and expiry was extended into the future. Comparisons were made locally without exposing token values. |
| DSH inference | A new DSH session in Minimal mode selected provider `anthropic` and model `claude-haiku-5-5`. It accepted the prompt, displayed the assistant response `DSH_CLAUDE_OK`, and showed the turn as completed. |
| Read-only quota | The plugin quota endpoint returned HTTP 200, `ok: true`, `source: usage`, and populated `fiveHour` and `sevenDay` windows. |
| DSH-only disconnect | At the end of the test, logout returned HTTP 200 and `ok: true`; the status became disconnected while the selected Claude credential file remained byte-identical and was still available for explicit adoption. |

The inference prompt was:

> Reply with exactly DSH_CLAUDE_OK. Do not use any tools.

The session UI displayed the expected assistant response, a completed turn, the selected Claude Haiku 5.5 model, and token usage. This verifies the DSH session/provider path, beyond a direct request to Anthropic or a prompt-admission acknowledgment.

The quota check used the read-only source, not the manual inference probe. A real model request was sent for the inference check and consumed allowance.

## Limits of the result

This is a real-account integration check for the environment and model above. It does not establish compatibility with every subscription, model, OS, DSH release, or future provider change. It also does not test revocation of upstream tokens, long-running multi-turn behavior, or cross-process credential coordination.

Earlier blocked consent attempts and the fixes they exposed are preserved in the [validation history](validation.md). The current passing result supersedes the earlier pending status for OAuth completion, refresh, DSH inference, and this account's read-only usage response.

Account identity, credential contents, authorization URLs, and unredacted account screenshots are excluded from this public record. Private local verification artifacts remain outside Git and package contents.

## 中文结论

已使用真实账号跑通 `0.1.2` 版本的 OAuth 登录、Token 刷新和 DSH 内推理，并成功读取只读额度接口。推理使用 Claude Haiku 5.5，DSH 会话返回了指定文本 `DSH_CLAUDE_OK` 并显示完成。

测试使用独立 DSH 配置和凭据目录，未操作日常 Claude Code 登录。这个结论适用于上述实测环境；自动化回归测试仍使用模拟响应，不应与本次人工参与的真实验证混为一谈。
