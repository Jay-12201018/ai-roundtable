# R09 模块交付报告

2026-10-17，macOS darwin/arm64。状态：独立模块交付，等待审核与总控联合集成；不是生产真实 API 验收。

## 基线、提交和文件

- Worktree：`/Users/zhangwenjie/.codex/worktrees/f9c5/AI交互`。
- 初始 HEAD 与 main 均为 `e9cf24e99d09a460f4d8cd0a3a8b7ec4aacf285a`，初始工作区干净。STATUS/CONTRACTS 的最新登记确认 R07/R08 已 merged/verified；没有额外 main 提交，没有重置历史。
- 分支：`codex/r09-openai-compatible-provider`。本报告与下列代码在同一独立提交；完整 Commit SHA 见最终交付消息，也可在此分支执行 `git log -1 --format=%H` 获取。
- 没有更改 main、共享协议、factory/registry、RunService、Settings、IPC/Preload/Renderer、Database、migration、package/lock 或状态看板；未发布 GitHub，未启动后续任务。

实际新增文件（路径相对仓库）：

| 文件 | 用途 |
| --- | --- |
| `src/main/providers/openai/OpenAIProvider.ts` | 官方 OpenAI Adapter |
| `src/main/providers/openai/ChatCompletionProvider.ts` | 两类 Adapter 共用的 SDK 请求、规范化、超时和安全边界 |
| `src/main/providers/openai/sse.ts` | 有界、严格 UTF-8 SSE 解码 |
| `src/main/providers/openai/R09_DELIVERY.md` | 本报告、用法和总控接线申请 |
| `src/main/providers/openai-compatible/OpenAICompatibleProvider.ts` | 显式能力配置的兼容 Adapter |
| `tests/unit/providers/openai/adapter.test.ts` | 官方协议、参数、错误、Key 和取消测试 |
| `tests/unit/providers/openai/fixtures.ts` | 假 Key、字节分片 Response 等测试工具 |
| `tests/unit/providers/openai/sse.test.ts` | SSE 分帧、Unicode、有界缓冲和取消测试 |
| `tests/unit/providers/openai/deadline.test.ts` | 无内容心跳不能绕过总超时 |
| `tests/unit/providers/openai-compatible/adapter.test.ts` | 多实例、端点、兼容能力及连接分级 |
| `tests/integration/providers/openai/protocol.test.ts` | 既有 RunService/内存 SQLite 消费真实 Adapter 的 HTTP fixture |
| `tests/integration/providers/openai/http.test.ts` | 真实 SDK + 本机 loopback 服务，验证网络关闭与重定向拒绝 |

## 实现与使用

两类 Adapter 满足现有 `ProviderAdapter`，只提供 `listModels`、`testConnection`、`streamChat`。真实网络仅在调用这些网络方法时发生；构造和 configuration 检查不解密 Key、不发请求。没有第二套调度、数据库、Key 管理或 Mock 回退。

使用已锁定并实际安装的 **openai 5.23.2**，没有升级依赖。调用 `chat.completions.create(...).asResponse()`，保留 SDK 的请求构造和鉴权，使用本模块严格 SSE 解码取代 SDK 默认宽松 EOF 行为。SDK/API 依据为本次读取的实际 SDK 类型/源码，以及 [Create chat completion](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) 和 [streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)。

可信 Main 调用方构造 `OpenAIProvider` 时传入：

```ts
{
  configuration,       // R08 ProviderConfiguration；每个实例独立，构造时解析并复制
  confirmedBaseUrl,     // 用户确认且经过目标校验的同一有效 Base URL
  resolveKey,           // Main callback: (providerId, keyReference | null) => Promise<string | undefined>
  timeoutMs: 60000,     // 可省略；整次操作的总上限，包含 Key 等待、响应头及正文
  // fetch 可省略，生产使用原生 fetch；仅可信 Main 可注入受约束 transport
}
```

官方 Adapter 仅接受 `https://api.openai.com/v1`（配置 `baseUrl=null` 时使用该目标），其他服务使用兼容 Adapter。目标经过现有 R08 URL Schema，再与 `confirmedBaseUrl` 规范化比较；尾斜杠等效，不同有效目标拒绝。这个参数是 **Main 已完成用户确认/网络目标校验的声明**，不是 R09 自动获得了用户确认，更不是 Schema 已验证 DNS 的证明。

`OpenAICompatibleProvider` 另须传完整的可信能力配置：

```ts
capabilities: {
  outputTokenParameter: 'max_tokens', // 或 'max_completion_tokens'；未知/不支持用 null
  streamUsage: false,                // 只有确定支持时才发 stream_options.include_usage
  listModels: false,                 // false 时独立 listModels 返回 unsupported
  authentication: 'unsupported',    // 或 'models'，仅用于文档确认 /models 受鉴权保护的目标
}
```

能力由总控依据端点/模型文档与明确配置选择，不按名称猜测；不能把一个兼容目标的能力套给其他目标。两个同类型实例的 providerId、Key 引用、URL 和模型没有全局缓存或相互覆盖。

生成原样传递 modelId、已构建的 system/user/assistant 公共 messages，不把 `agentRole`、`turnIndex` 元数据追加成新的可信提示。成员角色与 system prompt 由现有 R05 构建在 messages 中。真实生成要求显式正整数 `outputTokenLimit`；官方使用 `max_completion_tokens`，兼容目标按声明二选一，不按增量数量限额，也不降级重发。官方该上限包括可见输出及 reasoning tokens；不能解释为纯可见文本预算。

连接级别相互独立：

| 操作 | 证明范围 |
| --- | --- |
| configuration | 本地配置/确认绑定有效；不证明 Key 可用或网络成功 |
| authentication | 明确触发的一次 GET `/models`；兼容目标必须已知该路由受鉴权保护，否则 unsupported；不证明生成 |
| generation | 必须显式 modelId；仅发一次 `Reply OK.`，固定上限 8 token；有非空文本且 stop/length 才成功，过滤/空输出/错误均失败 |
| listModels | 独立一次 GET；只返回安全的 id/name，name 使用 id；404/405 或禁用列表能力为 unsupported，不删除手动模型、不触发生成 |

## 流、差异和不支持能力

- start 一次，所有事件使用 Main requestId；文本、公开 refusal 文本、真实 usage 与 stop/length/content_filter 规范化。正常结束须同时有合法 finish reason 和 SSE `[DONE]`；缺失、断连或畸形数据不能冒充完成。finish 与 error 不共存。
- 分片支持 UTF-8 跨字节、CR/LF/CRLF、空增量、注释、BOM、多行 data；单事件/行缓冲上限 1 MiB。JSON 模型列表正文上限 2 MiB、10000 项；重复/非法 ID 拒绝。
- usage 缺失就不发 usage；不估算或填零。只消费供应商的 prompt_tokens/completion_tokens；细分 reasoning/cache/价格等没有当前共享表达，不伪造。usage 必须在终结 choice 到达时或之后；重复/非法 usage 拒绝。
- Chat Completions 没有本次文档确认的公开推理摘要字段。`reasoning_content`、`reasoning` 及未知私有字段不转发，不合成 reasoning_summary_delta。
- 本轮仅文本 Chat Completions；Responses API、工具/函数调用、音频、图像、多 choice、未知结束原因均不提供支持。明确返回的工具/音频能力为 unsupported，畸形结构为 invalid_response。没有 SDK 升级或模型白名单猜测。
- 不支持模型列表自动翻页（has_more=true 返回 unsupported）；不尝试其他认证/生成路由，不根据返回 URL 跟进分页，不自动替换限制参数。任何能力差异都不会触发第二次可能收费的请求。
- 不依赖供应商请求 ID/header；可选 providerRequestId 当前省略，Main requestId 始终保留。

## Key、安全、取消与计费

每次网络操作通过 Main callback 解析当前实例的 Key 引用；无 Key/空值/含空白控制字符拒绝，不读环境 Key。SDK 的 Base URL、organization、project、webhookSecret 均显式覆盖环境值；SDK `maxRetries=0`、日志关闭。Key 没有进入普通输入 DTO、错误、事件、持久化、日志或导出；没有访问用户真实 Key/系统后端。

只允许准确的 POST `<base>/chat/completions` 和 GET `<base>/models`。原生 fetch `redirect:'error'`，也拒绝可观察的 3xx/redirected Response。非成功 HTTP 正文及 header 在交给 SDK 前丢弃并取消，SDK 无机会缓存/打印原始供应商错误。公开边界只使用现有固定 `ApiError`：401→authentication_failed、403→forbidden、429→rate_limited、5xx→internal_error、网络→network_error、超时→timeout、协议→invalid_response；没有原异常、堆栈或供应商细节。

总超时包括无内容心跳；单调时钟检查避免持续就绪数据饿死 timer。Abort 传到实际 SDK/fetch；reader 取消、消费者提前结束、超时后的迟到响应均释放正文。假 Key 解密迟到时不会启动请求。loopback 真实 socket 关闭已有实际断言。取消/超时仍可能已计费或已有服务端输出；没有自动重试，已产出的 partial 和真实 usage 由既有 Main 保存。

## 本次验证与环境

所有下列最终检查实际执行，均 **exit 0**；日期为 2026-10-17。环境：官方 Node24.18.1/ABI137/darwin-arm64 与同一完整 runtime include/config，pnpm11.25.0，Electron38.8.6/ABI139，SQLite12.11.1，Vitest3.2.7。没有用默认 Node24.21.0 运行测试。

本 Worktree 从空 node_modules 冻结离线安装，646 reused/0 downloaded，不是冷缓存联网安装。官方缓存归档完整性、Node 二进制/2726 headers、pnpm455文件均实核。独立 store/cache/metadata 与 copy imports，23030依赖 inode 与 main/其他 Worktree/store 共享数为0；锁文件及32直接依赖盘点一致。Node/Electron 原生构建串行，不共享可变依赖；最终留在 Electron ABI139。

日志根：`/private/tmp/roundtable-r09-x761agwm`，每次命令有 `<label>.json` 与 `logs/<label>.log`，记录 argv、环境、源文件 hash、上限、退出码；临时路径不是运行依赖。

实际命令公共前缀（MODE/上限见表）：

```sh
/usr/bin/python3 /private/tmp/roundtable-r09-x761agwm/run-check.py LABEL SECONDS MODE COMMAND...
```

| Label / MODE / 上限秒 | COMMAND | 实际结果 |
| --- | --- | --- |
| install-frozen-offline / node / 300 | `/private/tmp/roundtable-r09-x761agwm/bin/pnpm install --frozen-lockfile --offline --package-import-method=copy --side-effects-cache=false --reporter=append-only` | 安装与 Node 原生源码编译通过 |
| node-sqlite-smoke / node / 30 | `/private/tmp/roundtable-r09-x761agwm/bin/node /private/tmp/roundtable-r09-x761agwm/sqlite-probe.cjs` | ABI137 实际内存读写、关闭、自然退出通过 |
| full-regression / node / 300 | `/private/tmp/roundtable-r09-x761agwm/bin/pnpm run test --reporter=dot` | 含受控 pretest 源码重编译；67 文件 **969/969** |
| r09-final / node / 90 | `/private/tmp/roundtable-r09-x761agwm/bin/pnpm exec vitest run tests/unit/providers/openai tests/unit/providers/openai-compatible tests/integration/providers/openai --reporter=dot` | 6 文件 **123/123**；与完整回归重叠，不累加 |
| strict-final / node / 120 | `/private/tmp/roundtable-r09-x761agwm/bin/pnpm run typecheck` | TypeScript strict 通过 |
| production-build / node / 180 | `/private/tmp/roundtable-r09-x761agwm/bin/pnpm run build` | tsc + Main/Preload/Renderer 生产构建通过；既有 Zod PURE 注释警告保留 |
| native-electron / electron / 180 | `/private/tmp/roundtable-r09-x761agwm/bin/pnpm run native:electron` | 对应38.8.6 headers源码重编译通过 |
| electron-sqlite / electron-node / 30 | `./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /private/tmp/roundtable-r09-x761agwm/sqlite-probe.cjs` | ABI139 实际内存读写、关闭、自然退出通过 |
| electron-r09 / electron-node / 90 | `./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/providers/openai tests/unit/providers/openai-compatible tests/integration/providers/openai --reporter=dot` | Electron 的 6 文件 **123/123** |

electron-node 模式仅设 ELECTRON_RUN_AS_NODE=1，不加载应用 Main，不启动 GUI/Keychain。需要监听的三项 HTTP 测试已核对仅连接自身随机端口 loopback，使用假 Key；沙箱监听权限通过工具的授权审查后执行。其他网络测试注入 Response/阻断真实 fetch。

RunService 集成测试直接注入 Adapter，以原有 Demo 的 `model=mock` 作为 **HTTP fixture 的模型名称**验证相同事件的消费、requestId、落库和 Stop/timeout partial；不会调用 MockProvider，不证明真实配置已经穿过生产 resolver。没有移除真实 Provider 的既有启动门禁。生产 build 同样不证明未注册的 Adapter 已进入运行时组装。

失败证据保留，没有删除测试或跳过失败：

- `adapter-red`、`compat-red`：初始 Adapter 文件未存在，import 失败；不是行为测试 PASS。
- `sse-red`：21项行为红测；`sse-abort-red`：缓冲事件在 Abort 后继续 yield 的1项红测；最终修复通过。
- `compat-green-1`：14项失败中有 constructor/固定错误码等测试 API 假设差异；调整为验证同样严格的安全构造拒绝、有效目标等价与现有错误码，没有放松拒绝/脱敏断言。
- `compat-identity-red`：4项实际畸形 identity 事件/原始异常缺陷，修复前失败，修复后58/58。
- `typecheck-initial`：exit2，finish 的 typeof 窄化断言错误；改为明确的三种 reason 分支，strict最终通过。
- `r09-initial-integration`：2项失败，测试把数据库 protocolVersion 记录当 wire event；改为断言既有 `service.subscribe` 的真实公开投影，并保留数据库记录对比。
- `deadline-heartbeat-red-01`、`late-response-red`、`sdk-timeout-red`、`list-identity-red`：分别复现心跳期限、迟到正文释放、SDK连接超时分类及缺失列表输入脱敏问题，均已由最终专项/回归覆盖通过。
- `http-loopback`：3项在 listen 时 EPERM，业务断言未运行；`http-loopback-permitted` 实际3/3通过，之后完整/R09/Electron亦覆盖通过。
- 临时交接文档生成器一次解析期 SyntaxError，无写入，证据 `handoff-write-failure.txt`；已修正，不是业务失败。原生编译器/构建依赖警告未通过升级依赖消除。

## 总控接线申请（R09-INTEGRATION-01）

需求与调用方：在公共 factory/registry 注册两类 Adapter，RunService 与 Settings 复用同一解析器，不开发第二套协议。

1. **factory / Key**：按稳定 providerId 获取已启用 R08 配置，绑定已确认有效目标/显式能力，处理 session Key 的当前引用；通过 KeyService 解析，复核配置/Key 引用撤销与迟到竞态。旧配置对象不能成为新的发送权限。`confirmedBaseUrl` 不能未经用户确认从普通输入自动填写；目标/DNS策略由 Main 审查，禁止不受约束代理或重定向 transport。
2. **RunService / Main**：每个冻结成员用 `(providerId, modelId)` 解析实例，不按 kind 或 modelId 全局缓存。统一替换 Database/RunService 的 Mock 门禁，保留失效/禁用/未配置拒绝与旧 Demo 例外；不能只删拒绝逻辑。将既有 Main requestId、R05 messages、真实 outputTokenLimit、同一个 Stop AbortSignal 传入。检查失败保留 Attempt/partial，不自动重发。
3. **预算**：现有 R05 仅有 Mock 模型可靠 counter/context window。总控必须登记真实模型的可靠上下文/计数与费用预算门禁；不能复用 Mock 词法或绕过未知能力拒绝。此项未获本模块跨目录修改权限。
4. **Settings**：将真实 listModels/testConnection 接到同一 factory，configuration 本地、authentication只读、generation显式付费提示与授权分开。列表缺失保留手动 modelId，模型列表不是生成白名单。兼容 authentication='models' 仅适用于已有文档依据的受保护路由；公开模型列表无法证明鉴权。
5. **现有错误文案兼容**：403 使用既有 distinct `forbidden` code，但固定英文 message 是 `Unauthorized IPC sender`，对 Provider 权限失败不理想。总控可统一审查新增 Provider 权限错误码或通用文案及 Renderer 映射；本模块不擅改 Shared。HTTP 5xx 暂用保守不可自动重试的 internal_error。若需要 HTTP 子分类、供应商 requestId、usage 细分/价格、专用 incomplete 原因或公开推理摘要，另走共享契约变更，不塞进 detail。

兼容性：不变更 Provider v1 wire shape、Shared Schema、调用方法、数据库和 migration。只增加 Main 供应商实现与本模块的构造选项；Mock 与其他供应商不变。未来 factory/预算/错误码接线由总控登记唯一写入者、扩充对应调用方/回归，再联合验收。

建议联合验证：两个真实配置实例的 fake factory/KeyService 绑定与撤销；新 Run/Repeat/恢复路由与模型身份；公共历史及输入快照一致；真实模型可靠预算拒绝；Settings分级和手动模型；Stop/timeout/退出 partial与事件；通过后再申请真实 smoke。当前 **具备进入这一步 fixture 联合集成的模块条件**，尚未具备生产真实调用验收结论。

## 未验证及真实 smoke 的授权条件

真实 OpenAI/兼容 API、系统 Keychain、生产 factory→Settings/RunService→Main/IPC/Renderer 联合运行、桌面正式 E2E、打包签名/安装与 Windows/Linux：**未验证**。没有执行付费请求；没有访问用户真实 Key。无 lint 脚本，不声明 lint 通过。

以后分别为官方与兼容目标确认以下内容，再单独授权执行：

- providerId、完整 Base URL、目标/DNS及重定向策略确认；兼容能力 profile（含限制参数及认证路由依据）。
- 明确 modelId、上下文窗/计数依据、当前单价、单次与本轮人民币或美元预算上限，以及遇到未知费用/usage缺失的停止规则。8 token探针不等于零费用，价格与预算本轮未核查。
- Key 通过已有 Main-only 设置链配置，不在聊天、命令或日志中传明文；系统安全后端另作验证。
- 要执行的具体操作：可先单独 GET模型/鉴权，再明确授权一次8 token生成；如需流中Stop，另列第二次请求及预算；每个目标最多哪些请求必须写清，失败/中断不自动重试。
- 确认采用隔离测试房间/profile，允许保留哪些原始响应/partial与脱敏用量证据；若验收真实协作，须先完成上面的生产路由和预算接线。

本轮在独立提交后停止，等待用户审核及总控集成授权，不启动 R10A/R10B/R11。
