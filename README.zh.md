# dsh-anthropic-oauth

[English](README.md) · [来源与署名](NOTICE.md)

当前为实验性个人插件；真实账户的完整 OAuth 登录、Token 刷新及推理链路仍待端到端验证。

一个面向个人使用的 Claude Pro/Max OAuth 插件，用于 DeepSeek Harness。它保留参考插件的 Host 侧 OAuth、Token 刷新、模型发现和额度能力，同时将浏览器端改成更克制、更接近 DSH 原生风格的 Studio 界面。

本项目基于 [grloper/dsh-claude-oauth](https://github.com/grloper/dsh-claude-oauth) 的 MIT 代码派生；本目录中的客户端视觉和交互改动为独立实现。

## 本轮测试和迭代（2026-11-01）

详见 [QA 报告](docs/qa-iteration-2026-11-01.md)。本轮补测了浅色桌面、390px 手机宽度、英文搜索和错误恢复（均为实际客户端组件＋模拟数据，不涉及真实账户）。新增独立可重复运行的 UI 预览环境：在 `dev/preview/` 执行 `npm ci`、`npm start`，访问 `http://127.0.0.1:3191`；用 `theme=light`、`lang=en`、`scenario=error` 等 URL 参数切换场景。

模型配置在写入前完整校验，失败会尝试恢复原设置并显示错误；当前默认模型须更换默认后才能停用。额度解析拒绝空值和错误类型，上游失败不会伪装成健康额度。界面错误状态支持不发模型请求的“重试读取”；“最先耗尽”已更正为“剩余最少”。真实 OAuth 登录完成、刷新、推理与只读额度接口格式仍待验证。

## 主要变化

- 独立的 **dsh-anthropic-oauth** 设置页，避免信息堆叠。
- 清晰区分已连接、等待授权、错误和未连接状态。
- 账户、额度、模型卡片支持深色/浅色主题和窄屏布局。
- 根据浏览器语言提供中英文界面。
- 额度可以显示在输入框工具栏、输入框上方，或完全隐藏。
- OAuth 值存储在 Host 侧，正常账户状态不包含凭据；上游错误文本尚未全面脱敏，分享诊断信息前需检查。
- 不再把凭据复制到第三方 subscriptions 存储。

## 在隔离测试 Profile 中安装

```bash
git clone https://github.com/drewliu123/dsh-anthropic-oauth.git
export DSH_HOME="$PWD/.dsh-anthropic-oauth-test"
export DSH_ANTHROPIC_OAUTH_CLAUDE_DIR="$DSH_HOME/claude-home"
npx -p @deepseek-ai/dsh dsh plugin --profile web add ./dsh-anthropic-oauth
npx -p @deepseek-ai/dsh dsh --profile web --port 3187 --no-open
```

以上设置同时隔离 DSH 与 Claude 凭据目录。在新启动的 Web 设置中打开 **dsh-anthropic-oauth**。

## 登录流程

1. 打开 DSH 设置里的 **dsh-anthropic-oauth**。
2. 点击 **登录**。
3. 在浏览器新标签页完成 Claude / Google 授权。
4. 回到 DSH，页面会自动轮询并更新状态。
5. 如果模型列表需要立即刷新，点击 **同步账户**。

插件不会收集密码。OAuth 由 Claude 授权页和 Host 回调处理，Token 不会显示在浏览器界面。

## 额度说明

优先读取只读额度接口 `/api/oauth/usage`，不发送推理请求；接口的真实返回格式仍待验证，不符合预期的数据会被拒绝。若只读接口不可用，只有明确点击手动探测时，才发送一次 `max_tokens: 1` 的真实请求并读取限流 Header，这会消耗少量额度。自动刷新不会触发这类推理探测。

## 检查

```bash
npm run check
npm test
```

测试覆盖插件元数据、PKCE 辅助函数、请求 Header、最小权限 scope 配置和 HTML 转义；自动化测试不会执行真实 OAuth 登录。

## 已知问题

- 当前“取消”只关闭客户端等待状态，不会终止 Host 上的 OAuth 流程；断开连接也不会终止未完成的授权。继续完成已打开标签页中的授权可能重新连接插件。请关闭该授权页，等待流程过期。
- 部分上游错误会原样返回本地浏览器，完整错误脱敏及并发认证、配置写入的串行化仍待完善。

## 许可证

MIT。详见 [LICENSE](LICENSE) 及上游项目说明。
