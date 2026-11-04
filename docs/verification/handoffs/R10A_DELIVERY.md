# R10A Anthropic Provider 独立交付

## 范围与设计

基线 main `b309b88676b751b1175a57a8885dc62f0d0b30ba`；分支 `codex/r10a-anthropic-provider`。只新增 Anthropic 模块和对应测试，不改 Shared、Registry、Main、设置、package/lock、数据库、migration 或总控状态。

沿用已集成 R09 的 ProviderAdapter、Shared Schema、Main requestId、Key resolver 注入、固定脱敏错误及 whole-operation Abort/超时语义。R09 SSE 只接受 message 事件，RequestScope 未导出；在本目录保留相同的有界字节解析及截止时间实现，适配具名事件，不创建第二套对外调用协议。SDK 使用既有 @anthropic-ai/sdk 0.62.0；不添加依赖。

状态：独立候选待总控审查/集成，未合 main，不自行登记 merged/verified。模块和 fixture 已实施；下面区分实际验证与待集成能力。

## 总控接线申请 R10A-WIRING-01

调用方：ProviderRegistry 的 configuration/target/createRealAdapter、ProviderSettingsService、R05 policy resolver、RunService 及设置测试展示。模块出口 `AnthropicProvider` 接受 Main-only configuration/confirmedBaseUrl/resolveKey/timeoutMs/fetch；必须注入既有 createSafeFetch 与目标/Key revision 复核，不能把默认 fetch 当生产网络门禁。

注册 anthropic 与默认 root `https://api.anthropic.com`，允许 GET `/v1/models` 的受限分页和 POST `/v1/messages`；按现有会话确认、DNS/pinning、TLS、连接前复核、结果前复核流程接线。不得扩展 DeepSeek 专属代理范围。列表/鉴权不证明生成成功；generation 保留显式 allowGeneration 和获审模型政策，模型列表不作为生成白名单。模型策略须对实际 Anthropic system/messages 封装和 cache usage 提供计数、上下文、输出上限、费用与有效期证据；本模块不提供虚构计数或价格。

兼容性：继续既有 ProviderKind/ProviderAdapter/NormalizedChunk/ApiError，无 wire shape、事件版本、SQL 或 migration 变化。公开 reasoning summary 未获模型级能力确认，通用请求不设置模型特有 thinking 模式，且不发 reasoning_summary_delta；如后续启用须另审可公开性及能力配置。模型自定义 ID 不依赖列表白名单；未知/下线模型由结构化错误返回。

安全影响与验证：Key 只经 Main resolver 临时取得，SDK 环境 Key/authToken/Base URL/logging 不继承；无自动重试/重定向，错误体在 SDK 前丢弃，不将 SDK 对象返回 IPC。总控集成后须复验同一 Provider 实例、Key 更换/撤销/目标变化竞态、预算拒绝发生于 Key/网络前、取消 partial 持久化、设置分级结果以及 Run/历史身份。模块 fixture 不证明生产接线或真实模型可用。


## 实现行为与使用

- `AnthropicProvider.ts`：实现既有 listModels/testConnection/streamChat。官方 HTTPS root 固定，确认值不匹配先拒绝；自定义 modelId 可显式传入，不猜模型能力、不依赖列表白名单。模型列表按 display_name 投影，最多 100 页/10000 模型，每页 JSON 限 2 MiB。configuration 本地校验，authentication 仅 GET 模型，generation 使用显式模型、固定小提示和 8 Token 上限。
- `messages.ts`：`buildAnthropicMessages` 保留 leading system 文本块及 user/assistant 内容和顺序；中途 system 或缺少初始 user 明确拒绝。assistant 尾部追加固定 user 提示，避免把上一位 Agent 作为当前回复的 prefill。总控计数必须调用同一 helper，覆盖额外提示和实际 system/messages 封装。
- `protocol.ts`：按 content block index 校验具名事件顺序，文本块起始内容及增量均保留；正常终结必须有合法 stop_reason 和 message_stop。end_turn/stop_sequence→stop，max_tokens/model_context_window_exceeded→length，refusal→content_filter；工具/续传原因明确 unsupported，不自动续费。thinking/signature/redacted 数据不进入标准事件。
- usage 使用供应商累计数，不重复相加；总输入包含普通输入、缓存创建和读取。所有后续数值不得低于此前值；null/缺失 delta 保留前值，明确未知 start cache 计数不当零，缺少最终 output 计量不发 usage。不估算或伪造零。providerRequestId 仅使用合法 HTTP request-id，绝不使用 SSE message.id 替换 Main requestId。
- `sse.ts`、`scope.ts`：沿用 R09 的有界 UTF-8 字节解析和整次操作 deadline，适配具名 SSE、CR/LF/CRLF、注释、Unicode 跨字节；每事件限 1 MiB。Abort/超时覆盖 Key 等待、响应头、JSON 和流；迟到响应关闭，消费方提前退出也清理流。标准 error 终结且保留已有 partial。
- SDK 既有 0.62.0 关闭重试与日志，显式设置 Main Key、authToken:null、官方 baseURL；raw SDK post 避开 messages.create 的弃用模型直接 console.warn。HTTP 错误体/敏感头在 SDK 前丢弃，返回固定 ApiError，禁止重定向。`retryable` 仍只是既有用户新尝试提示，绝不自动重发。

总控可导入 `AnthropicProvider` 和 `buildAnthropicMessages`；构造器 options 见源码。这里没有产品接线或已批准生成政策，不能直接实例化后绕过 Registry/网络/预算门禁。普通生产入口当前仍拒绝 Anthropic。

## 文件清单

仅新增以下 13 个文件：

- src/main/providers/anthropic/AnthropicProvider.ts
- src/main/providers/anthropic/messages.ts
- src/main/providers/anthropic/protocol.ts
- src/main/providers/anthropic/scope.ts
- src/main/providers/anthropic/sse.ts
- src/main/providers/anthropic/R10A_DELIVERY.md
- tests/unit/providers/anthropic/fixtures.ts
- tests/unit/providers/anthropic/adapter.test.ts
- tests/unit/providers/anthropic/stream.test.ts
- tests/unit/providers/anthropic/models.test.ts
- tests/unit/providers/anthropic/lifecycle.test.ts
- tests/integration/providers/anthropic/http.test.ts
- tests/integration/providers/anthropic/protocol.test.ts

## 实际验证（北京时间 2026-10-20）

平台 macOS arm64；独立 Worktree `/Users/zhangwenjie/.codex/worktrees/r10a-anthropic-provider/AI交互`。官方缓存 archive SHA 核对后新解压 Node v24.18.1/同版完整 headers（ABI137），pnpm11.25.0；Electron38.8.6/内嵌 Node22.22.0/ABI139；Vitest3.2.7；SDK0.62.0。冻结离线安装646包，独立 store/cache，copy 导入；未复制其他 Worktree node_modules，23033 个依赖文件与 main/旧 Worktree 共享 inode 数为0，package/lock/workspace 字节未变。不是冷缓存联网安装验收。

证据目录 `/private/tmp/r10a-env-lo3y1g6l`，各 `<label>.json` 保存 argv/exit/时间/文件指纹/log SHA，`logs/<label>.log` 保留输出，`run-check.py` 负责固定 PATH、同版 headers、自有缓存/TMPDIR 和有界执行。临时证据路径以后可能清理，本页保留结果与精确关键命令。全部测试仅 fixture/假 Key/自建 loopback，数据库为 :memory: 或原回归自建临时目录；没有真实 Anthropic 请求或真实 Key 读取。

| label | 结果 | 退出码 |
| --- | --- | --- |
| install-authorized-wt | 冻结离线/copy 安装646 reused，供应链策略725项检查通过 | 0 |
| baseline-node-full | 原基线88文件1322/1322；仅排除当时未实现的 Anthropic 新目录 | 0 |
| node-sqlite-smoke | Node24.18.1 ABI137实际内存 SQL/完整性/关闭 | 0 |
| anthropic-final-node | 当时 Anthropic6文件124/124，含实际回环HTTP3和Main/内存SQL4 | 0 |
| final-node-full | Node完整94文件1446/1446，含上述124项；随后只补12个fixture | 0 |
| final-typecheck-fixed | pnpm run typecheck，strict | 0 |
| final-build-complete | 最终全部136项fixture通过编译，tsc + 生产Main/Preload/Renderer构建 | 0 |
| final-electron-rebuild | Node检查结束后串行源码重建本WT SQLite为Electron目标 | 0 |
| final-electron-smoke | Electron38.8.6 ABI139实际内存SQL/完整性/关闭 | 0 |
| final-electron-full | 最终94文件1458/1458，包含全部 Anthropic136项，无排除/skip | 0 |

关键命令原样如下，cwd 均为本 Worktree；electron-node 模式由 runner 显式设置 ELECTRON_RUN_AS_NODE=1，不启动桌面。Node/Electron native 重建未并行：

```sh
python3 /private/tmp/r10a-env-lo3y1g6l/run-check.py anthropic-final-node 60 node /private/tmp/r10a-env-lo3y1g6l/bin/node node_modules/vitest/vitest.mjs run tests/unit/providers/anthropic tests/integration/providers/anthropic --reporter=dot
python3 /private/tmp/r10a-env-lo3y1g6l/run-check.py final-node-full 120 node /private/tmp/r10a-env-lo3y1g6l/bin/pnpm run test --reporter=dot
python3 /private/tmp/r10a-env-lo3y1g6l/run-check.py final-typecheck-fixed 60 node /private/tmp/r10a-env-lo3y1g6l/bin/pnpm run typecheck
python3 /private/tmp/r10a-env-lo3y1g6l/run-check.py final-electron-rebuild 180 electron /private/tmp/r10a-env-lo3y1g6l/bin/pnpm run native:electron
python3 /private/tmp/r10a-env-lo3y1g6l/run-check.py final-electron-smoke 30 electron-node node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /private/tmp/r10a-env-lo3y1g6l/electron-smoke.cjs
python3 /private/tmp/r10a-env-lo3y1g6l/run-check.py final-electron-full 120 electron-node node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run --reporter=dot
python3 /private/tmp/r10a-env-lo3y1g6l/run-check.py final-build-complete 60 node /private/tmp/r10a-env-lo3y1g6l/bin/pnpm run build
```

final-node-full 日志 SHA256 `d0da096a6179f35c32ae8cc2c8dd71c47614bdeb130fe6244065aecd6cd88a0b`；final-electron-full `f18fe8beffa521cdc38c6017fe13e10c705e3f39e6e810099c80a907c339792c`；final-build-complete `a94717e5702d78efe5a54cae66c784a5894f03ffe8c4ff6f6da6413296787b2c`。构建保留既有 Zod 注释 annotation 警告，不改依赖来消除警告。最终 node_modules 留在 Electron ABI139；后续 Node 数据库测试须先按同版 headers 重建。

### 失败、修复与复核

- 初次离线安装缺元数据 exit1；复制只读已缓存元数据到自有 cache 后，受限 WT 写入 EPERM exit255；授权提升后的同一冻结离线安装 exit0。未绕过供应链策略或改 package/lock。
- 一次直接 pnpm exec 未固定子进程 PATH，落到默认 Node24.21.0，Rollup Team ID 加载失败 exit1，未执行任何测试；随后统一使用 runner 和明确 Node24.18.1。辅助裸 Electron --version exit134，未作为版本或桌面证据；后续版本与 ABI 来自上表 ELECTRON_RUN_AS_NODE 实际 SQL。
- anthropic-missing-red exit1：源模块未实现导致缺 import，无测试被执行，作为预期 RED，不当作 PASS。
- anthropic-first：110通过/1失败 exit1；根因为分页 fixture 缺官方必需 display_name，修正 fixture 后111通过。typecheck-first exit2：测试 mock 参数类型缺失，补类型后通过。
- 独立审查实际复现 usage 倒退低报：usage-regression-red 4失败 exit1；保留start及后续累计基线并检查四类计数下降后，usage-regression-green 51/51 exit0。
- 官方当前文档表明 thinking.disabled 不是全部模型通用能力。thinking-mode-red 2失败 exit1；移除通用请求的 thinking 假设后通过，仍屏蔽非文本推理数据。没有添加猜测模型表或新设置入口。
- final-typecheck/final-build 曾因新增集成测试 inputSnapshot 可空类型 exit2；增加显式非空断言和类型收窄，后续 typecheck/build 及最终Electron完整回归通过。未放宽生产校验、未改旧断言或删除测试。
- 独立只读审查确认上述两项实现问题已修复，原低报复现现返回 invalid_response，HTTP request-id 身份映射正确，无剩余阻塞发现；这不替代总控集成验收。

## 官方资料核对

核对日期 2026-10-20。当前在线协议可能新于锁定SDK，运行时仍使用独立Schema校验；不凭模型名推测政策。

- [Messages](https://platform.claude.com/docs/en/api/messages/create)：顶层system、消息角色、assistant尾部prefill与max_tokens。
- [Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)：具名事件、累计usage、未知事件和message_stop终结。
- [Stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)：停止原因语义。
- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)：三类输入计量之和。start cache null 的未知处理是保守决定，不宣称官方定义其为零。
- [Models](https://platform.claude.com/docs/en/api/models/list)：display_name、has_more/last_id/after_id。
- [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking)：模型间thinking参数支持不同，总输出上限包括思考Token；本模块不启用公开摘要投影。
- [SDK0.62.0](https://github.com/anthropics/anthropic-sdk-typescript/tree/sdk-v0.62.0)：并已实际读取安装版本的client、messages、SSE实现；日志/重试/响应头timeout的防护依照实际源码实现。

## 遗留与停止边界

总控须按 R10A-WIRING-01 完成 Registry、受限网络/Key revision守卫、Main/Settings/R05政策接线并复验，之后才更新主线状态。无Shared/数据库/migration变更，无自动重试、真实API、真实Key读取、收费请求或发布。

未验证：真实鉴权/模型可用性/usage账单与Token计数、真实Keychain、生产App/设置UI与多Agent Anthropic联合、桌面E2E、发布包/安装/Windows/Linux。公开推理摘要当前未启用；工具/多模态/自动续传不支持。没有lint命令或正式tests/e2e，本轮不声称通过。生产构建不等于已打包/接线Anthropic。

基线main保持b309b886且干净；本分支仅本模块提交，不合main、不推送或删除Worktree。Commit SHA由最终交付消息及本分支git log定位。
