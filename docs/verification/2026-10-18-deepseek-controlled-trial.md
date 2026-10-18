# DeepSeek 单次受控测试候选交付（2026-10-18）

本候选实现“请求前估算、完整费用预留、响应 usage 核算”的独立 Main 入口，并通过本轮本地自动化与有限生产入口验证。**状态为 review，未合 main、未标 merged/verified；本轮真实公网模型 API 请求为 0。** 普通真实 Run 继续要求获审计数器，`DEEPSEEK-TOKEN-01` 在严格模式下仍 blocked。

## 授权、Git 与文件范围

- 基线与未改变的 main：`ae5c24c6dd1410aedba6ef31894470b7cb668c8a`。
- 候选分支：`codex/deepseek-controlled-trial`；工作目录：`/Users/zhangwenjie/.codex/worktrees/deepseek-controlled-trial/AI交互`。候选 Commit 为包含本文的 Git 提交，完整 SHA 见交付消息及本文件 Git 历史，不预填自引用 SHA。
- 本次仅获开发与本地模拟授权，不包含合 main、付费调用、发布、实施 R10/R11/R13/R17 或继续其他任务。原 main、分支、Worktree 和原离线预览保留。
- 总控独占共享接线与治理；协作代理按明确文件集合写测试或本文，其余审查只读。

| 文件集合 | 变化与用途 |
| --- | --- |
| `src/main/providers/controlledTrial/{estimate,record,ControlledTrialService,menu}.ts` | 估算标签、私有持久记录、一次性执行及原生菜单确认 |
| `src/main/providers/ProviderRegistry.ts` | Main-only 固定形状受控入口；复用既有 Adapter、Key 与安全 transport |
| `src/main/database/migrations/v4.ts`、`Database.ts`、`recovery/validateDatabase.ts` | 唯一持久预留、部分证据、结算/恢复及 v4 完整性校验 |
| `src/main/index.ts`、`src/main/services/RunService.ts` | 双向生成互斥、关窗确认与统一退出等待 |
| `tests/integration/deepseek/{estimate,controlledTrial,controlledService,migrationV4,mutualExclusion}.test.ts` | 估算/授权/发送/账务/取消/迁移/恢复/并发回归 |
| `tests/probes/deepseek-trial-electron.cjs` | 隔离生产 Main、CJS Preload、App 的有限 fixture 探针及新进程重启 |
| `tests/unit/appLifecycle.test.ts` | 新服务组装、退出失败等待、纯受控请求关窗取消及确认退出 |
| 原 `database.test.ts`、`persistence/integrity.test.ts`、`legacyMigration.test.ts`、`migrationV2.test.ts`、`configuration/migrationV3.test.ts`、`tests/probes/r09-sqlite.cjs`、`tests/probes/r07r08-sqlite.cjs` | 将现行账本版本断言更新为 4，保留旧版本迁移/备份及拒绝未来版本的原检查；R07/R08 旧审计探针收尾补验见下文 |
| `docs/CONTRACTS.md`、`docs/DECISIONS.md`、`docs/STATUS.md` 与本轮报告/命令台账 | 总控登记候选范围、事实及授权停止边界 |

未改变 Shared DTO、IPC/Preload/Renderer、事件版本、Mock 计数/预算、R04 状态机、KeyService、package/lock 或构建配置；未引入依赖。`final-audit.json` 确认 migration1 嵌入 SQL、migration2/3、package/lock/workspace/build 配置逐字不变。

## 估算、严格模式与官方证据

`estimateDeepSeekInput` 仅接受一条 user 消息，内容为 1–256 个可打印 ASCII 字符；不支持的消息形状、字符或长度返回 `unknown`。估算为 `ceil(字符数 × 0.3) + 64`，其中 64 是未校准的封装余量。结果明确带 `kind:'estimated'`、`calibration:'uncalibrated'`、`strictUsable:false`，不能称为精确 Token 数、本地 Tokenizer 或可证明上界；服务商返回的输入/输出 usage 单独保留。

实际入口进一步固定为 `Reply OK.`，因此本地估算是 67 input tokens，连同 128 输出预算计算出 1158 micro-CNY（¥0.001158）。这两个值是预览估计，不是实际使用量或服务商账单上限。本地 fixture 回报 71 输入、8 输出，核算为 206 micro-CNY；输入差值为 +4 tokens，仅证明应用正确区分估算与回报，不能用这个样本声称模型已校准。

总控在本轮会话实际重新浏览了下列官方来源；未保存独立 HTML，不虚构本地抓取文件。这里记录 **2026-10-18 固定审查快照**，不承诺未来价格不变：

| 官方来源 | 本候选采用的证据与限制 |
| --- | --- |
| [模型及价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) | 精确 `deepseek-flash` / `DeepSeek-V4.1-Flash-1017`；官方1M上下文、384K最大输出与本次固定短输入/128输出分开，不作为计数证明。按高峰、缓存未命中输入 ¥2/百万 Token、总输出 ¥8/百万 Token，不取缓存/时段折扣，不做汇率换算 |
| [Token 用量说明](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage/) | 字符比例只是近似；实际计量依赖 usage。比例不能升级为严格计数器 |
| [Chat Completion API](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/) | 使用 `max_tokens`、流式 usage 及总 `completion_tokens`；不把 reasoning 子项再重复加一次 |
| [思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/) | 固定 `thinking:{type:'disabled'}`，不依靠默认值或厂商名称猜测 |
| [官方 tokenizer 工具说明](https://github.com/deepseek-ai/deepseek-recipe/blob/main/docs/tokenizer.md)、[bundled v41 来源](https://github.com/deepseek-ai/deepseek-recipe/blob/main/static/tokenizers/v41/README.md)、[V4.1 编码说明](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/blob/main/encoding/README.md) | 官方工具与编码资料确实存在；本轮未证明它们与当前 1017 生产 API 的完整计费模板、隐式插入和版本完全对应，未安装/执行 Tokenizer，未注册真实计数策略 |

本候选价格窗口为 `2026-10-17T16:00:00.000Z` 至 `2026-10-18T16:00:00.000Z`，即北京时间 **2026-10-18 00:00 至 2026-10-19 00:00**；上界为开区间，过期拒绝，不自动续期。它与此前安全准备中的已过期价格记录分开。普通生成仍通过 `assertSelection/checkGeneration` 要求匹配模型的 `exact/upper_bound` counter 和有效价格；生产没有真实 `policyResolver`。受控模式成功、一次真实 usage 样本或付费额度均不解除严格模式的证明要求。

## 可观察行为及安全边界

未来另获真实调用授权后，用户在设置中保存精确官方兼容 Provider、模型及 Key，并确认请求目标，再使用原生“受控测试 → DeepSeek 单次测试…”菜单。选择 Provider 不发送请求；随后原生警告默认“取消”，显示固定提示、目标、估算性质、128 输出、关闭思考、预计费用、¥0.05 预留、非账单硬上限及未知费用规则。只有明确点击“授权并发送这一次请求”才继续；每次新测试都需重新确认。查看最近记录不会发请求。

- 精确目标为 `https://api.deepseek.com/chat/completions`，精确模型为 `deepseek-flash`；仅一条 user `Reply OK.`，单 Agent、单请求，`max_tokens:128`、`thinking:{type:'disabled'}`。无任意消息、参数扩展或普通 Renderer 受控测试权限。
- 报价绑定稳定 providerId、精确 root/model、Key revision、请求身份与费率快照；最长 2 分钟，且不得越过价格到期时间。目标、Key 替换/撤销/删除重建、过期或失效配置在 Key/transport 前拒绝。报价本身不读 Key、不写预留、不发请求。
- 报价在任何 await 前消费，执行忙碌状态也在 await 前设置；取消、Stop、退出或报价超时后的迟到批准不能复活或重放请求。请求阶段最多 20 秒；取消/超时可能已经产生服务商费用，不能当作未发送或零费用。
- 复用 R09 的 Key 归属校验、脱敏错误、DNS/连接后复核、公共 HTTPS 地址限制、TLS 校验、禁止重定向及 SDK `maxRetries:0`；没有鉴权/列表探测、降级、续写、自动重试或自动恢复请求。
- Main 注入双向门禁：普通 Run 活动时，受控报价/执行拒绝；受控确认或请求进行中，普通 Run 新建及所有调度入口拒绝。暂停后的 resume/step 被拒绝时，持久状态及原输出不变。关窗提示包含纯受控活动；取消保持窗口/请求，确认退出走原 R01 屏障，等待 Run、受控服务及已接受 IPC 写入收尾后才关闭一次 DB。
- 普通 Bridge 不增加 `resolveKey`、通用 invoke/send、策略注入或试验执行接口。明文 Key 不进入预览、记录、普通 DTO 或 Renderer 持久状态。

## 预留、usage 核算与 migration4

确认与全部守卫通过后，Main 在读取 Key、DNS 或发送前，用 SQLite 事务持久预留 **50000 micro-CNY（¥0.05）**。`request_id` 唯一；全局部分唯一索引只允许一个 `reserved/unknown` 记录，因此未知费用跨重启继续阻止下一次受控测试。该表是现有权威 Database 的组成部分，不建立第二套状态来源。

只有完整终结流和合法 usage、且无错误时，才将状态结算为 `settled`，按安全整数 `inputTokens × 2 + outputTokens × 8` 核算。流的完整性仍由既有 Adapter 要求合法 finish 与 `[DONE]`。账务按总输出计量，不重复叠加 reasoning；记录估算、观察 usage、实际输入/输出和核算费用，不能用估算覆盖实际。服务商报告超出预留时如实记录，不截断账务来伪装硬上限。

缺 usage、流中断、错误、Stop 或超时保留 `unknown`、完整 ¥0.05 预留、已有部分文本及已观察 usage；实际输入/输出和核算费用保持 `NULL`，不填零。已有观察 usage 但缺完整终结也不能结算。启动仅幂等执行 `reserved → unknown/interrupted`，不发请求。没有自动释放未知预留、清零、重试或恢复入口；后续核销规则需另行设计与授权。

新增 migration4 仅创建 `controlled_trials` 及未结预留索引，原 migration1–3 不改。恢复校验检查 v4 表、未结唯一索引的实际定义、请求唯一索引、最多一份未结记录、严格 JSON 及列/JSON 身份一致；异常证据拒绝加载而不覆盖。测试覆盖真实 v3 升级一次、升级前 v3 备份、失败逐字回滚、旧历史/未知元数据保留、v4 备份恢复和损坏索引/记录拒绝。历史记录保留 Provider ID/Key revision，不因当前 Provider 删除而外键级联删除证据。

## 本轮最终实际验证

证据根目录为 `/private/tmp/roundtable-deepseek-trial-20261018`。各 `<label>.json` 包含实际 argv、cwd、受控环境、UTC、退出码、超时状态、执行前后源码指纹及日志 SHA256；日志在 `logs/<label>.log`。精确命令另见[命令台账](2026-10-18-deepseek-controlled-trial-commands.md)。下表引用最终重跑，**不使用中间 1160 成绩代替最终 1168**；专项与全量有重叠，不累加。

| 最终 receipt label | 实际结果 | exit |
| --- | --- | --- |
| `node-final-2` | Node 24.18.1，81 文件 **1168/1168** | 0 |
| `type-final-3` | strict TypeScript 类型检查 | 0 |
| `build-final-2` | 生产构建：Main 241.00 kB、CJS Preload 232.20 kB、Renderer JS 964.20 kB | 0 |
| `node-native-final-2` | Node 24.18.1 / ABI137 / arm64，100 个内存 DB、10000 行，自然退出 | 0 |
| `electron-rebuild-final-2` | Electron 38.8.6 匹配 headers 的候选独立原生重建 | 0 |
| `electron-native-final-2` | Electron 38.8.6 / Node 22.22.0 / ABI139 / arm64，100 DB、10000 行，自然退出 | 0 |
| `electron-final-2` | 真实 Electron-node，81 文件 **1168/1168** | 0 |
| `mutual-green` | 两文件 **39/39**；包含新建、paused resume/step、报价竞态及关窗/退出等待 | 0 |
| `controlled-production-final-3` | built Main/Preload/App，**42 条具名断言、2 次自有本地 HTTP** | 0 |
| `controlled-restart-final-2` | 新进程 **24 条具名断言、HTTP 0** | 0 |
| `controlled-exit-final-2` | 退出后只读 ABI139 SQLite：v4/完整性/外键、settled 206 micro、unknown 保留 50000、无隐式 Run、无明文 fake Key | 0 |
| `r09-production-final-2` | 原 R09 生产回归 **57 条断言、12 次自有本地 HTTP** | 0 |
| `r09-exit-final-2` | R09 退出后只读审计 **15 检查** | 0 |
| `r09-restart-final-2` | R09 新进程 **5 条断言、HTTP 0** | 0 |
| `r09-restart-audit-final-2` | R09 重启退出后只读审计 **9 检查** | 0 |
| `r78-production-regression` | 原 R07/R08 built 生产流程、真桥错误 **18 条断言**及页面/布局操作，新隔离 profile | 0 |
| `r78-exit-version-green` | 仅修旧探针最新账本期望后，同 profile 只读审计通过，ABI139 | 0 |
| `r78-restart-final` | 原 R07/R08 新进程恢复、真桥错误 **18 条断言**；无网络尝试 | 0 |
| `r78-restart-exit-final` | 重启后只读 ABI139 SQLite 审计：3 原 Attempt、3 显式 Repeat、公共上下文/历史及 fake 后端归属保留 | 0 |

以上最终 receipt 均 `timedOut:false`。构建有既有 Zod/Rollup 注解警告，已保留日志，不将带警告写成零警告。Node/Electron 原生重建串行使用候选自己的 node_modules；离线冻结安装使用既有受控缓存，不冒称冷缓存在线安装验证。

受控生产 profile 为 `/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-deepseek-trial-8JesoJ`。探针在 ready/加载 Main 前隔离 userData/sessionData/logs，启用 mock-keychain，核对 safeStorage 全部方法为 fake；首轮及重启真实 Keychain 调用均 0。只把精确 DeepSeek route 映射到自有 loopback HTTP，不注入 model policy/counter；Node 越界网络尝试与 Chromium 网络尝试均为空。生产页验证取消时不解密/不预留、单次批准单次 SDK 请求、普通生成仍在 Key 前 unsupported、并行普通 Run 通过真实 IPC 被拒绝、纯试验关窗取消保持窗口、Stop 中断实际 socket并保留 partial/unknown。新进程恢复 settled 与 unknown，未结预留在最终授权/Key 读取前阻止下一次测试。

R09 最终 profile 为 `/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r09-production-0pGUwo`。同样仅 fake Key/后端与自有 HTTP；12 次请求属于本地 fixture，不是 DeepSeek 公网调用。有限生产探针不是 R17 正式 E2E、人工点击所有原生对话框的验收或安装包验收。

R07/R08 补验 profile 为 `/private/tmp/roundtable-deepseek-trial-20261018/test-tmp/roundtable-r78-production-fnxKyU`。原生产探针在本候选 built 应用内重新执行房间/成员/设置、刷新、三 Mock 公共历史及新进程恢复；首轮/重启均核对 fake safeStorage、mock-keychain 和网络隔离，Node/Chromium 网络尝试为空。首次退出审计实际发现旧 probe 只期待 `[1,2,3]`，不接受实际 `[1,2,3,4]`；仅更新该最新账本断言，原审计输入、其他断言及业务/单元集成测试不变，同 profile 重跑只读审计 exit0。新进程及其退出后只读审计也自然 exit0，确认 3 个原 Attempt、3 个显式 Repeat、公共上下文/历史及 fake 后端归属保留。未因这项探针修复机械重跑此前同版本 1168。

`final-audit.json` 最后复核于 UTC `2026-10-18T04:24:28.986083+00:00`：main 干净且未改变；实际登记 17 个 Worktree，除本候选外均干净；本任务未删除原分支/Worktree；10 份最终 receipt 的业务源码及单元/集成输入 SHA 与当前一致。核对集合为 182 个 src/tests 文件，其中随后变化的唯一例外是 `tests/probes/r07r08-sqlite.cjs` 的最新账本断言，已有本轮真实 RED exit1 / GREEN exit0 和重启审计证明，不宣称所有 tests 字节不变。main 与候选 better-sqlite3 的 inode 不同。本文及治理/命令台账属于文档收尾，不将文档新增误当业务重跑。

## 保留的失败及修复证据

所有失败记录保留；文件名中的 `green/red/final` 不是成绩，退出码与实际输出才是依据。

| receipt / 记录 | 真实失败与处理 |
| --- | --- |
| `controlled-red` | exit1，2 项新边界失败、1105 通过；证明初始缺少受控入口与持久接口 |
| `trial-typecheck-1` | exit2，Provider summary 无 `baseUrl`；修为按 Provider ID 读取配置，未扩展公开 DTO |
| `pending-authorization-red` | exit1，2 项确认挂起/清理等待超时；补取消/退出对确认 Promise 的终结，迟到批准不发送。17 个 filtered skipped 是该专项筛选，不作全量成功 |
| `migration-v4-red` / `-confirmed` / `-schema` | exit1；早期 fixture 字段/API 不匹配与 v4 关键索引缺失未拒绝分开定位，后续补真实 schema/索引校验及当前 fixture。`migration-v4-red-index-shape` 名称含 red 但实际 exit0，11/11；最终全量仍另行重跑 |
| `controlled-service-green-1` | 名称含 green 但实际 exit1，spy 递归导致栈溢出/未发 fixture 请求；只修测试调用原方法的方式，不当作业务通过 |
| `controlled-production-1` | exit1，探针末尾“全部 safeStorage 方法保持 fake”检查写法错误；修正确比较后新 profile 重跑，旧失败不删除 |
| `mutual-red` → `mutual-green` | 实际 Electron RED 为 9 failed/30 passed，exit1；发现受控/普通 Run 单向门禁与 trial-only 关闭提示遗漏。补 Main 双向闭包、统一 schedule 门禁和原关窗条件后，39/39 exit0，并用最终生产探针及 Node/Electron 全量复验 |
| `r78-exit-version-red` → `r78-exit-version-green` | 收尾原生产流程通过后，旧只读探针因最新账本期望遗漏4而 exit1；仅将该断言更新为 `[1,2,3,4]`，同库审计 exit0。原失败保留，不删除/放宽其他检查，不修改已发布 migration |

协作只读最终复核确认两项 P2 已闭合，未发现新增阻塞；不以先前通过次数替代本轮最终源码验证。更多早期直接命令的补充元数据在 `agent-commands.json`，它明确说明记录是事后补录、未为补录重跑，也不补造未记录的时间或源码指纹。

## 真实 OS Keychain：独立有限证据

另获授权的真实后端报告为 `/private/tmp/roundtable-owned-oskeychain-jr1foei1/KEYCHAIN-RESULT.md`。它使用当前 Mac 的 Electron 38.8.6 / Node 22.22.0 / ABI139、随机自有服务名及严格原生转发白名单，没有 use-mock-keychain；正常加解密实际经过 native safeStorage/OS Keychain。**它复用了此前 main 的原 KeyService、Database、electronSafeStorage / DBv3 临时 bundle，不覆盖本候选 migration4 或整个 App 的真实 Keychain 集成。**

| 阶段 | 实际断言/检查 | exit |
| --- | ---: | --- |
| dry 隔离证明 | 3，真实秘密转发 0 | 0 |
| save | 8 | 0 |
| restart | 13 | 0 |
| revoked-restart | 7 | 0 |

真实后端断言共 **28**（8+13+7），dry 3 项单列。覆盖密文 SQLite、native v10 envelope、同进程/新进程解密、跨 Provider 拒绝、坏密文拒绝、加密失败时保留旧 Key（该项为受控失败注入）、替换引用撤销、删除假 API Key 引用/密文及新进程确认撤销。未读用户原有 app Keychain 项、真实 API Key 或个人 DB；无网络请求或系统权限对话框，默认 Keychain/search list 和原离线预览未变。

早期 guard 的 SIGABRT、递归转发 SIGSEGV、自有 legacy 项删除被拒，以及第一次 cleanup 的 `errSecAuthFailed` 均保留。自动批准审查曾因缺少人类对原生凭据删除的明确授权而拒绝同 Electron 清理，拒绝发生在执行前，无进程退出码、无绕过；随后用户明确批准“允许仅清理这些自建测试项”，才执行精确白名单清理。最终两次独立 Electron 进程自然 exit0，**只删除 3 个自建项，并完成 4 次精确缺失复核**；未删除无关项。28 条后端断言与后续清理检查不混算。具体 argv/UTC/hash/日志见该目录 `*-command.json`、`cleanup-final.json` 及原报告。

这份有限证据不证明签名/发布包的 ACL 连续性、锁定登录 Keychain、用户真实允许/拒绝对话框、其他 macOS 用户、Windows/Linux、真实 Provider 凭据，或候选 v4 整 App 的真实后端行为。

## 总控集成建议与停止边界

交付停在候选 review，候选 Commit 由本文所在提交及交付消息定位。当前没有已知阻止该受限候选进入合并审核的工程问题，建议用户审核后另行授权合 main；合并前重核 main/migration 编号与候选范围，合后另做必要主线复验，再按实际证据决定 merged/verified，不能把本候选 PASS 当 main 验收。严格模式仍 blocked，不扩大候选为普通真实生成权限。

未来真实单次请求仍需单独明确授权，并在发送时重新检查价格窗口、精确目标、Provider/Key revision、单次原生确认及未结预留；过期先重新核价，未知费用不清零。候选实现了受控模式，不等于严格 Token 证明已完成，也不是 R13 全量费用账本。

本轮未验证：真实 DeepSeek Token 使用量/实际账单、严格完整 API 计数对应性、候选 v4 整 App 的真实 OS Keychain 集成、正式 E2E、打包/签名/公证/安装、Windows/Linux、真实系统锁定/权限交互及公开发布。未新增 lint 或 E2E 测试集，不声称其通过。没有继续下一任务、真实请求或合并 main。
