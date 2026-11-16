# AI 圆桌 / AI Roundtable — V1 产品基线

2026-10-13 R00 纳入当前 Git 仓库。原始来源为用户提供工具包的 SPEC.md，读取成功；原文 SHA-256：`8110e1593b9a9a84034c0b489bc2f43661ce28444fffd57257a3c12bbf355824`。除第 8 条按用户最新 UI 指令更新外，原有功能、排除项及最终验收保留。本文是 V1 目标，不是当前功能完成声明。

工程规则见 [AGENTS](AGENTS.md)，现状见 [V0 审查](docs/V0_AUDIT.md)，任务见 [任务清单](tasks/README.md)，界面设计见 [设计规范](docs/DESIGN_GUIDELINES.md)。所有后续工作以本仓库文件为入口。

定位：Windows/macOS/Linux 本地优先的 Electron 多模型协作群聊桌面应用，单用户 BYOK，不使用云端账号。多个 Agent 使用国内主流大模型，按用户可配置的工作流围绕共享公共历史协作。用户是主持人，可以点名、插话、暂停/停止/单步、设置持续指令，最终输出 PRD、会议纪要、行动清单和经确认后写盘的代码候选文件。

## V1 不可缩水的能力

1. Electron + React + TypeScript strict + electron-vite + Tailwind + Zustand（只用于 Renderer）+ SQLite（主进程）+ Zod + 受限 typed IPC。
2. ProviderAdapter 流式统一事件：start/text_delta/reasoning_summary_delta/usage/finish/error；支持真实模型和确定性 Mock Provider；仅显示供应商真正返回的公开推理信息；模型来自内置目录（D143）。
3. 共享公共消息历史与角色标记、房间/成员 CRUD；自由群聊、两模型对话、起草-审查-修订-复审-定稿、深度辩论的声明式模板；有限轮数和超时控制。
4. Main 为 Run/Turn 状态权威：Pause 软暂停（当前回合完成后停）、Stop Abort（保留部分输出）、Step 恰好一回合、Resume 续调度；主持人 @Override 排到下一位，普通模型文本不具备主持人权限。
5. 主持人持续指令、指定消息修改/重生、可追踪的消息版本/分支；持久化和意外退出后将未完成请求标记 interrupted，不自动重试可能重复收费的请求。
6. 上下文摘要，保留历史原文与压缩范围；token 用量统计与硬性调度限制（费用由服务商收取，应用不估算，见 D133）；PRD、会议纪要/行动项和带 diff/路径越界防护/人工确认的代码文件导出，不自动执行生成代码。
7. 本地 SQLite 数据迁移、密钥使用系统保护（safeStorage 仅在可靠后端下使用，否则会话内存）、脱敏日志，contextIsolation + sandbox（可行时）+ nodeIntegration:false + CSP + IPC 校验 + 外部 URL 安全。
8. 多 Agent 群聊桌面 UI；功能决定布局、体验决定交互。宽窗口可组织房间导航、讨论和辅助控制/产物面板，较窄窗口按需折叠，不固定常驻三栏。Markdown 安全渲染、代码高亮、统一亮暗色、中文 i18n、1000+ 消息虚拟列表、Windows/macOS/Linux 可构建安装包、Mock 自动化测试。

## 明确不做

云同步/账户、移动端、多人实时协作、语音、插件市场、自主终端操作、自动执行生成代码、无监督后台运行、多个 Agent 并行生成。

## 最终 V1 验收

三个 Mock Agent 在同一房间完成辩论，实时显示并落 SQLite；任意 Turn 能被 Stop，部分文本保留；主持人可 @ 指定下一个 Agent；Run 能单步/暂停/恢复；重启数据可读、执行中 Run 变为 interrupted；至少支持四类 Provider；能生成经 Zod 验证的结构化成果；代码文件仅在人工预览确认且经过路径校验后写入；真实 Key 不明文存库、不进入日志/导出/普通 IPC；TypeScript/测试/打包流程如实报告。

## V1.1 可选差异化（V1 稳定后）

- 争议与 ADR 决策追踪（来源消息、观点、证据、最终采纳理由）。
- 按任务复杂度动态决定是否启用复审，而不是无脑多轮辩论。
- 与单模型/单模型自评/多模型辩论三组基线对比的评测工具，记录质量、时长、成本与人工介入。

## 发布与授权（2026-11-03 决定，2026-11-17 写入）

许可证是 **MIT**，全文在根目录 `LICENSE`。软件免费，用户自备 API Key 并承担厂商费用。不增加收费、会员订阅、激活码、商业支付或反盗版。不做 Apple Developer ID 签名，不做公证。2026-10-16 的非商业许可方案已作废。公开发布仍须另行授权，规则见 [发布政策](docs/RELEASE_POLICY.md)。费用预算功能已在 2026-11-03 移除，用量只记录 token。


## 多服务商与 Provider Preset Catalog（2026-10-20 用户追加）

支持国内主流大模型，只能使用内置目录里的服务（D143）：DeepSeek、豆包、通义千问、Kimi、智谱 GLM、百度文心、腾讯混元、MiniMax。每家的通用文本和多模态对话模型都列出来由用户选（多模态模型能看主持人附的图片，D147）；服务商新出的本品牌模型从它自己的接口自动发现，不用等发版。Coding 套餐/订阅账号不自动具有 API 权益。

区分服务商/渠道的 Provider 配置实例、具体 Model 和协议 Adapter。沿用 providerId 与 (providerId, modelId) 身份；所有服务共用一个通用 Adapter。内置目录（`src/shared/serviceCatalog.ts`）是服务和地址的唯一来源，模型来自目录和服务商自己的列表，Main 在保存配置和发请求时强制；目录不含凭据，同一服务可创建多个独立实例。

能力、上下文、stream、推理和 usage 支持/不支持/未知须如实标注，不按模型名猜能力，不以连通或列出模型代替生成验收。继续保持 Keychain/Main-only Key、地址校验/TLS/网络防护和显式触发（D136、D143）。多个 Provider/模型应能作为独立成员加入同一房间，保留公共上下文和历史冻结身份。

上文「至少支持四类 Provider」和 2026-10-20 草案里的 OpenAI、Anthropic、Gemini 原生适配、自定义服务，都已不作数。现行验收是：目录中的 8 家服务、一个通用的 OpenAI 兼容协议适配器。这里的「OpenAI 兼容」只指协议，不表示接入 OpenAI。OpenAI、Anthropic、Gemini 适配器已删除，不恢复。目录草案见 [PROVIDER_CATALOG_PLAN](docs/PROVIDER_CATALOG_PLAN.md)，文首已标明作废范围。
