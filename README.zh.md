# dsh-anthropic-oauth

**在 DeepSeek Harness 里登录 Claude、选择模型，并随时查看订阅额度。**

[English](README.md) · [更新记录](CHANGELOG.md) · [预览与测试](docs/validation.md) · [反馈问题](https://github.com/drewliu123/dsh-anthropic-oauth/issues)

[![CI](https://github.com/drewliu123/dsh-anthropic-oauth/actions/workflows/ci.yml/badge.svg)](https://github.com/drewliu123/dsh-anthropic-oauth/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

从 DSH 设置页连接 Claude Pro/Max 账户，管理模型选择器中的 Claude 模型，在对话输入框旁查看剩余额度。也可以主动选择复用本机已有的 Claude Code 登录。

![账户、额度窗口与模型设置界面](assets/screens/iteration-light-final.png)

*截图使用实际插件组件和模拟账户数据。当前为实验性项目：真实账户的完整登录、刷新、推理链路，以及只读额度接口的真实格式，仍待端到端验证。*

## 能做什么

- **在设置页管理账户。** 浏览器 OAuth 登录、弹窗受阻时的备用链接、同步账户、取消授权与仅针对 DSH 的断开连接。
- **整理模型选择器。** 从账户发现可用模型，按 Opus / Sonnet / Haiku 分组，支持搜索、启停与设为默认。当前默认模型和最后一个已启用模型受到保护。
- **在对话中查看额度。** 可选输入框小条、输入框上方或隐藏。展开查看各窗口用量与重置时间，主显示采用两个主要窗口中剩余比例较少的一档。
- **适应日常界面。** 中英文、深浅色主题与窄屏布局，清楚区分未登录、等待授权、已连接及错误状态。

## 快速开始

### 准备环境

推荐 **Node.js 24 LTS**，并确保 `pnpm` 在 `PATH` 中。需要支持 Web UI 插件的 DSH；订阅登录需要 Claude Pro/Max 账户。插件代码支持 Node 20+，但 DSH CLI 对运行环境的要求更高。

以下固定使用 `0.2.1-rc.5`，命令语法和插件自动注册方式已对照本机发行版核验；同时隔离 DSH 配置和 Claude 凭据目录。请在同一个终端中依次运行，无需全局安装 DSH：

```bash
git clone https://github.com/drewliu123/dsh-anthropic-oauth.git
cd dsh-anthropic-oauth

export DSH_HOME="$PWD/.dsh-dev"
export DSH_ANTHROPIC_OAUTH_CLAUDE_DIR="$DSH_HOME/claude-home"

npx -y -p @deepseek-ai/dsh@0.2.1-rc.5 dsh plugin --profile web add "$PWD"
npx -y -p @deepseek-ai/dsh@0.2.1-rc.5 dsh --profile web --port 3187 --no-open
```

打开 DSH 在终端输出的本地地址，进入 **设置 → dsh-anthropic-oauth**。插件包会自动注册，不需要手动修改 YAML。

### 登录与选择模型

1. 点击 **登录**，在 Claude 页面完成授权，然后回到 DSH。新标签页没有打开时，点击等待提示中的备用登录链接。
2. 选择要提供给 DSH 的模型。如果出现 **设为默认**，可以直接设置；也可以在对话模型选择器中选择已启用的 Claude 模型。
3. 进入使用 Claude 模型的对话，即可查看额度小条。显示位置在插件设置页切换。

检测到本机已有登录且插件尚未连接时，会出现 **使用 Claude Code 登录**，只有点击后才会使用该会话。上面的隔离配置不会自动读取你日常使用的 Claude Code 凭据。

### 安装到日常使用的 DSH

对于通过 CLI 管理的 Web 实例，安装时使用**与该实例相同的 `DSH_HOME` 和 profile**，再重启它。如果 profile 不叫 `web`，请替换命令中的名称。桌面应用的 `desktop` profile 为保留配置，普通 npm CLI 不能直接管理；请使用桌面应用支持的插件管理方式。上面的快速开始会创建独立 Web 实例。

若要复用已有 Claude Code 登录，不要设置 `DSH_ANTHROPIC_OAUTH_CLAUDE_DIR`，或把它指向相应的 Claude 目录。该变量优先于 `CLAUDE_CONFIG_DIR`；均未设置时使用 `~/.claude`。

## 额度如何读取

插件优先读取只读 usage 接口，自动刷新不发送模型推理请求。返回数据不符合预期时会显示读取失败或待重试，不会把错误当成零用量。

只读接口不可用时，可以**主动点击手动探测**，发送一次 `max_tokens: 1` 的真实请求，从返回的限流 Header 读取额度。这会消耗少量用量；界面会注明数据来源，探测结果缓存五分钟。

额度小条只在当前对话选择 Claude 模型时出现。供应商若返回 Opus 等额外窗口，会在设置页显示，但不影响主要额度小条的颜色。

## 连接与凭据

OAuth 交换和 Token 刷新在 DSH Host 侧完成，账户状态只提供显示信息。凭据同步到 DSH 自身的凭据服务；本版本不会额外复制到第三方 subscriptions 存储。

- **取消**会结束当前插件授权流程，再次尝试时会创建新登录。
- **断开**会删除 DSH 连接与对应的凭据引用，并终止待完成的插件授权；保留 Claude Code 自身的凭据文件。
- 登录与刷新可能更新所选的共享 Claude 凭据文件。测试其他账户时，请同时设置两个隔离目录。

附带的 `anthropic-oauth-login` 命令行工具遵守相同的目录配置，凭据文件仅允许当前用户读写。日常使用推荐从设置页登录。

## 常见问题

| 现象 | 处理方式 |
| --- | --- |
| 设置中找不到插件 | 检查安装与运行实例的 home/profile 是否一致，重启 DSH 以重新构建客户端。 |
| 没有弹出登录页 | 点击等待提示中的备用链接；OAuth 回调需要能访问运行 DSH 的那台机器。 |
| 模型列表为空 | 点击 **同步账户**。发现失败时保留原供应商设置，不会写入猜测的模型 ID。 |
| 输入框没有额度小条 | 确认当前选择 Claude 模型，显示位置未设为 **隐藏**；也可能尚未读取到额度。 |
| 没有 **设为默认** 按钮 | 当前 DSH 未提供默认模型服务，可使用 DSH 自带模型选择器。 |
| 提示需要手动读取额度 | 先重试只读接口；接受少量额度消耗时，再使用明确标注的手动探测。 |

反馈时请提供 DSH/Node 版本、profile 名称、操作过程及脱敏截图或错误。不要上传凭据文件或授权链接。

## 开发与验证

根目录没有需要安装的运行时依赖：

```bash
npm run check
npm test
npm pack --dry-run
```

测试使用临时目录与模拟供应商响应，覆盖 Host 桥接、凭据隔离、OAuth 回调、模型偏好、额度解析及客户端注册，不会登录真实账号。

查看使用模拟数据的实际 UI：

```bash
cd dev/preview
npm ci
npm start
```

打开 `http://127.0.0.1:3191`。例如 `?theme=light&lang=en&scenario=error` 可查看浅色英文错误场景。场景参数与验证范围见 [测试说明](docs/validation.md)。

更新本地安装时，在仓库中执行 `git pull --ff-only`，必要时向原 home/profile 重新执行添加命令，再重启 DSH。

## 项目来源与边界

本项目基于 [grloper/dsh-claude-oauth](https://github.com/grloper/dsh-claude-oauth) v1.1.0 派生，是非官方、实验性的个人插件。它使用 Claude 消费者 OAuth 流程和兼容 Claude Code 的请求 Header，兼容性受上游变化影响；请使用供应商允许的账户和用途。当前最主要的验证缺口是真实账号完整链路。

在原有桥接能力上，本项目重做了设置页与对话额度界面，增加明确的账户接管、DSH 独立断开、模型管理和额度展示。额度交互也参考了 [dsh-codex](https://github.com/Yan-Zero/dsh-codex)。

[MIT 许可证](LICENSE) · [来源与署名](NOTICE.md) · [设计说明](DESIGN.md)
