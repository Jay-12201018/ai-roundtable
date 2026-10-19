# R10B Gemini Provider 独立交付

基线：`b309b88676b751b1175a57a8885dc62f0d0b30ba`（2026-10-20 本机最新 main，无 remote），分支 `codex/r10b-gemini-provider`。只实施本目录及独立 Gemini 测试；不接线、不合并、不更新公共状态。

## 实施计划

- [x] 核对任务书、Shared、R09、SDK 和官方原生协议。
- [x] 先用 fixture 测试观察缺失实现，再实现 `GeminiProvider` 与本地请求作用域。
- [x] 覆盖 leading system、user/model、parts/candidates、thought 丢弃、最终累计 usage、finish/过滤、空候选、错误脱敏、Abort/超时与模型分页。
- [x] 使用真实 RunService + 内存数据库验证公共协议、partial 与单次尝试；不接生产 Registry。
- [x] 本轮模块/类型/适用回归验证与独立审查。提交身份由本文件所在 Git commit 确定，最终交付消息另列完整 SHA。

## 技术选择与官方依据

锁定 `@google/genai 1.52.0` 的 `HttpOptions` 没有实例级 fetch 注入口，内部调用全局 fetch 并把错误体写入异常；不能复用安全 transport。保持依赖不变，使用原生 REST、SDK 类型、已有 `createSafeFetch`、R09 `readSse` 和 Shared 协议。没有全局 fetch 修改、SDK 环境凭据、Vertex 路由或重试路径。

- [原生生成请求、candidate、parts 和安全终止](https://ai.google.dev/api/generate-content)
- [usageMetadata 定义](https://ai.google.dev/api/generate-content#UsageMetadata)
- [模型列表与分页](https://ai.google.dev/api/models)
- [SDK HttpOptions](https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpOptions.html)（在线新版与已安装版本不同，以锁定版本源码为准）

仅固定 `https://generativelanguage.googleapis.com/v1beta`，假 Key 在测试内通过 Main 回调注入；真实 Key、模型请求和付费调用禁止。本模块不提供自动发送入口。

## 文件清单、实现与使用

| 文件 | 职责 |
| --- | --- |
| `src/main/providers/gemini/GeminiProvider.ts` | `ProviderAdapter` 实现、配置与输入校验、原生请求、模型分页、分级连接测试和事件映射 |
| `src/main/providers/gemini/response.ts` | 供应商响应边界校验、parts/过滤/终止与累计 Token 一致性检查 |
| `src/main/providers/gemini/requestScope.ts` | 全流程超时、父 signal 取消、迟到结果拒绝和清理；R09 scope 私有，因此沿用其语义在本模块实现，无新调度协议 |
| `src/main/providers/gemini/R10B_DELIVERY.md` | 实施选择、验证证据、总控申请与未验证能力 |
| `tests/unit/providers/gemini/fixtures.ts` | 假配置、假 Key、原生 JSON/SSE 和逐字节 UTF-8 fixture |
| `tests/unit/providers/gemini/adapter.test.ts` | 79 项 Adapter 边界测试 |
| `tests/integration/providers/gemini/protocol.test.ts` | 7 项真实 RunService + 内存 SQLite 的公共协议、usage 和 partial 落库测试 |
| `tests/integration/providers/gemini/http.test.ts` | 3 项实际 Node 回环 HTTP + R09 安全 transport 测试 |

总控在 Main 内通过 `new GeminiProvider({ configuration, confirmedBaseUrl, resolveKey, fetch, timeoutMs? })` 构造；`resolveKey(providerId, keyReference)` 来自现有 KeyService，`fetch` 注入带目标/Key revision 守卫的现有安全 transport。未注入 fetch 时使用 `createSafeFetch()`。`confirmedBaseUrl` 必须是上述准确官方地址（允许规范化尾斜线），自定义主机/Vertex/代理不在本模块支持范围。

模型列表执行带分页上限的原生 GET，筛选支持 generateContent 的模型；去掉响应 ID 的 `models/` 前缀。生成接受单段自定义 ID 或 `models/<id>`，不依赖列表白名单；拒绝路径/query/编码绕过。列表最多100页、10000个唯一 ID，每页 JSON 最多2 MiB；分页属于列举操作，不是重试。

leading system 转为 `systemInstruction.parts`，user 保持 user，assistant 转 model，相邻同角色合并 parts，保留文字和顺序。迟到 system、空 contents、缺失输出限制在 Key 解析前拒绝。原生请求仅设一个 candidate 和明确 `maxOutputTokens`；不设置工具、多模态或降低安全阈值。

只输出公开文本；thought parts 和 thoughtSignature 不进入公开事件、摘要或数据库。STOP、MAX_TOKENS、安全过滤分别映射 stop、length、content_filter；过滤帧自身文本不发出，先前 partial 保留。空/畸形候选、未知终止、工具/媒体/code parts 明确拒绝。合法 finish 后仍需完整 SSE EOF 才发布终态；没有 `[DONE]` 协议。首个有效响应可提供 `start.providerRequestId=responseId`，Main requestId 始终不变。

usage 仅在合法终止和 EOF 后发送一次。输入采用 promptTokenCount（已含缓存），输出采用 candidatesTokenCount + 显式 thoughtsTokenCount；不加 totalTokenCount，不从文本估算。中途只观察计数，检查非负安全整数/单调/总数下界与缓存一致性；最终字段缺失、仅中途计数、已知 thoughts 最终缺计数时不发 usage，不补零或沿用旧数。非零 tool prompt 用量因不支持工具而拒绝。Shared 不表达暂定计数；中断时中途 usage 不作为最终用量，费用状态应由总控保持未知。

HTTP 和流内 error envelope 仅映射受控 code；不传递原始 message、headers 或异常。所有请求只发一次，不重试、不回退。超时覆盖 Key 等待、headers、全部流/列表页和消费检查；取消/早停关闭 reader 并 abort signal，忽略迟到 Key，取消迟到 response。客户端断开不能证明服务端已停止或不再计费。

## 本轮实际验证（2026-10-20，Asia/Shanghai）

平台 darwin/arm64；受控官方 Node24.18.1、ABI137、pnpm11.25.0、Vitest3.2.7、@google/genai1.52.0。本 Worktree 从无 node_modules 开始，以独立 store/cache/copy 冻结离线安装646包（0 downloaded），安装脚本实际源码编译 SQLite；`:memory:` 读写通过。native inode 与 main 不同，package/lock/workspace 字节未变。这是独立缓存安装，不是冷缓存联网验证。

命令记录根：`/private/tmp/roundtable-r10b-fqkdy6m5`。每次命令用 `python3 <根>/run-check.py <label> <秒上限> node <根>/bin/pnpm ...` 执行，JSON 记录实际 argv、时间、退出码、环境和锁文件哈希，`logs/<label>.log` 保存原始输出。该临时目录只作本次证据定位，不承诺长期保留；可复验 pnpm 参数如下。

| label / pnpm 参数 | 实际结果 |
| --- | --- |
| `baseline-typecheck` / `run typecheck` | exit0；修改前类型检查通过 |
| `baseline-r09-unit` / `exec vitest run tests/unit/providers/openai tests/unit/providers/openai-compatible --reporter=dot` | exit0，4 files / 113 tests |
| `r10b-specialist-final` / `exec vitest run tests/unit/providers/gemini tests/integration/providers/gemini --reporter=dot` | exit0，3 files / 89 tests；含实际回环 HTTP3项 |
| `r10b-final-module` / `run test -- tests/unit/providers/gemini tests/integration/providers/gemini --reporter=dot` | exit0；pretest 实际重编译本 Worktree 的 Node SQLite，随后91 files / 1411 tests。当前 pnpm 转发 `--` 导致 Vitest 实际执行完整测试集，不能称其为仅专项。专项另见上行 |
| `r10b-final-typecheck` / `run typecheck` | exit0，strict 无类型错误 |
| `r10b-build` / `run build` | exit0，tsc 与 Main/Preload/Renderer 生产构建完成；有依赖 Zod 的 Rollup 注释警告，无构建错误。Gemini 未生产接线，build 不证明接线 |

各组测试有重叠，数量不能相加。自动化不加载生产 Main 入口，不接触真实 userData 或 Keychain。协议集成只用 `Database(':memory:')`；HTTP 测试只把精确官方 fixture path 改写到自身随机127.0.0.1端口，阻断全局 fetch，使用现有 createSafeFetch，不把测试改写能力加入产品。

首次失败和修正均保留：

- 环境引导旧临时 archive 路径不存在；换用经 SHA256 核对的现存官方 archive 后独立安装完成，不改全局 runtime 或锁文件。
- `r10b-red` exit1：两测试套件缺少 GeminiProvider，未执行用例；这是入口缺失证据，不算通过。
- `r10b-first-module` exit1：74/75，通过真实落库断言发现供应商 responseId 未投影；已从首帧映射到 start.providerRequestId。`r10b-first-typecheck` exit2：测试 mock 参数推断过窄，补完整 fetch 类型后通过。
- `r10b-usage-error-red` exit1（5失败）：最终 thoughts 缺失误补零、沿用中途计数和流内错误吞掉；修复后80/80。
- `r10b-native-envelope-red` exit1（2失败）、`r10b-usage-tail-red` exit1（3失败）：非零工具用量、模型列表错误 envelope 与跨帧矛盾总数；修复后84/84，再补列表取消/超时与实际HTTP，最终89/89。
- `gemini-http-fixture-initial` exit1：沙箱 listen EPERM；获得回环执行权限后 `gemini-http-fixture-loopback-permitted` exit0，3/3。最终专项及完整回归亦在允许自有回环 fixture 的环境运行，无公网模型请求。

独立只读审查发现的 usage、错误帧和跨帧总数问题均已有回归 fixture；修复后审查无剩余必须修复项，另有5项无联网 assert 自检通过。测试、审查不代表生产集成验收。

## R10B-WIRING-01 总控接线申请（未实施）

需求与调用方：现有 Shared 已含 gemini kind 和 Adapter 三方法，本模块可直接消费，无新 wire shape。ProviderSettingsService、ProviderRegistry、RunService/Main 组装需要总控接线；本任务没有修改它们。

1. Registry 增加 Gemini kind、默认目标 `https://generativelanguage.googleapis.com/v1beta`、会话目标确认和 GeminiProvider factory；使用现有稳定 providerId/modelId、KeyService 归属与修订检查，继续在 Key 返回后、连接发送前、列表/流结果返回前复核。注入同一安全 transport，不复用仅授权 DeepSeek 的显式代理。
2. `ApprovedModelPolicy.outputTokenParameter` 当前只含 OpenAI 两值。总控需审查原生 `maxOutputTokens` 能力表达与 resolver/guard 兼容，不能伪标成 max_tokens。现有 OpenAI profiles/callers保持原语义；新增受控分支后验证全部调用方。
3. 在生成前仍需获审的模型上下文/输出上限、exact/upper_bound counter、价格与费用上界政策；列表和自定义 ID 都不是生成许可。未知能力先拒绝，不拿此模块fixture或SDK名录批准真实生成。
4. 设置页通过既有入口展示列表/自定义模型及分级结果；configuration 只证明本地校验，authentication 只发 models，generation 继续要求可信 UI 的显式 allowGeneration。不得因接线自动发送、读 Key 或发付费请求。
5. 总控集成测试需覆盖会话目标/Key撤销/迟到响应、冻结成员身份、同一 Main requestId 的 usage/partial 落库、length/filter 非成功、Stop/超时单 Attempt、不自动重试与真实 production Bridge。模块已有协议 fixture 不能代替这些生产路径。

兼容性：公共 DTO/Schema、事件版本、IPC、SQLite/migration 均无变化。未来 ModelPolicy 的 Main 内部类型扩展由总控一次性处理，不拆第二套协议；若总控需要保留原生细分 usage/安全原因，应单独申请 Shared 版本和所有 strict reader 兼容测试，本模块不会私加字段。迁移：本次无需 SQL 或 migration。安全：沿用 Key Main-only、固定目标、DNS公共地址/TLS、禁重定向、守卫与用户逐次真实调用授权；不降低原门禁。

## 未验证与交付边界

未验证：真实 Gemini Key/API/全部模型可用性、真实 Token/费用/上下文能力、服务端取消与停止计费、系统 Keychain、生产 Registry/设置/Main/UI 接线、Electron ABI139/桌面启动/E2E、Windows/Linux、打包/安装/发布。当前 native 保持 Node ABI137；开发启动前按仓库环境规则独立重建 Electron，不能拿本轮 Node SQL 当 Electron 证据。无 lint 脚本或正式 E2E，不声明通过。

本模块可提交给总控审查和后续集成，未自行合入 main，未标 merged/verified。用户授权到本 Worktree 提交后停止；不启动 R10A/R11 或目录增强。
