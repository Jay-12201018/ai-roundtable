# DeepSeek 首次真实 API 测试准备报告（2026-10-17）

## 结论和停止点

**必要参数、人民币门禁与fixture准备已完成候选验证；指定真实生成仍安全阻塞，未解除。** 完整生产输入Token上界尚无足够证明，不能把字符比例、通用tokenizer或fixture合成计数器升级为DeepSeek计数依据。未注册DeepSeek的ApprovedModelPolicy，默认Main依旧在读Key/发送请求前unsupported。真实API请求数量 **0**。

- 分支：`codex/deepseek-safety-prep`；独立Worktree：`/Users/zhangwenjie/.codex/worktrees/deepseek-safety-prep/AI交互`。
- 精确基线/原main：`dc387146e1535a596508a5b58ea8bfe3903fc658`，开始/收尾均重新核验main干净且HEAD未变；原分支/历史及全部其他Worktree保留。
- 最终候选完整SHA以本报告所在提交及交付消息为准；本轮不合main，不启动R10A/R10B/R11/R17。
- 本报告是实际开发和验收交付，不是准备计划；逐命令/退出码/失败与日志摘要见[台账](2026-10-17-deepseek-preparation-commands.md)。

## 当前官方证据

核验日期2026-10-17，仅阅读公开文档；没有访问api.deepseek.com的鉴权、列表或生成接口。以下是当日快照，不承诺未来型号和价格不变。

| 项目 | 本轮核验事实及依据 |
| --- | --- |
| 精确目标 | openai-compatible，`https://api.deepseek.com`，`deepseek-flash`，POST `/chat/completions`；[官方入口](https://api-docs.deepseek.com/zh-cn/) |
| 当前版本 | DeepSeek-V4.1-Flash-1017；不接受旧别名来继承本配置；[模型/价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) |
| 模型容量 | 官方表为1M上下文、384K最大输出；API明确max_tokens范围1–393216。1M按原文记录，不擅自把其转成已验证精确计数；[API](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/) |
| 思考 | 默认启用；Chat Completions可用`thinking: {type:"disabled"}`关闭。本候选明确发送该字段，不靠reasoning_effort或厂商名猜测；[思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/) |
| 保守人民币价格 | 始终按高峰、缓存未命中输入¥2/百万Token，输出¥8/百万Token；不取空闲/缓存优惠，不做汇率换算；[价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) |
| 输出/推理计量 | API以completion_tokens报告总生成量，reasoning_tokens列为completion_tokens_details子项；因此按总completion计输出，不只统计可见文本，也不再加一次reasoning。这里按官方usage结构处理，公网账单未实测；本次请求明确关思考；[usage定义](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/) |
| 流式usage | 当前API文档把usage附在最后一个具有finish_reason的choice块，非必须另发usage-only块；本地fixture已覆盖；[流式定义](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/) |
| Token说明 | 官方字符比例是近似；实际以usage为准，提供文本离线zip但没有完整API计费封装保证；[Token页](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage/) |

## Token安全阻塞：DEEPSEEK-TOKEN-01

已找到[官方V4.1模型](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash)及[完整编码说明](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash/blob/main/encoding/README.md)，官方[deepseek-recipe工具](https://github.com/deepseek-ai/deepseek-recipe/blob/main/docs/tokenizer.md)也演示deepseek-flash→V4.1消息编码→token IDs，不能声称官方没有tokenizer。

但[bundled v41来源](https://github.com/deepseek-ai/deepseek-recipe/blob/main/static/tokenizers/v41/README.md)注明其与旧Vision-Exp revision `6821d6ad3681a4b137b066b76094fa82ebd0a380`比较、核验日2026-09-10、SHA256 `81f64d1248a68ce3663e07ab3ee48b851e5df0e32d27cb98e4c9a268151e8d99`。尚不能由此证明**当前1017 API**的完整计费模板、隐式插入和该离线版本完全对应。本轮没有下载/执行第三方tokenizer、引入未审新依赖，或自行加任意padding当证明。

仅依靠约1M上下文作通用输入上界，按高峰未命中价输入本身约¥2，已超过¥0.05，不能用它启用短请求。1024输入Token是拟定小上限，尚不能证明实际完整输入满足它；不是1024字符/字节，也没有从fixture反推真实计数。

安全选项：固定当前官方模型/tokenizer/模板revision，进一步审计完整消息序列化及非空byte-BPE/normalization边界，并获得或论证生产API计费对应性与隐式开销；有证据后再注册对应精确端点/模型策略并复验。未经该步骤，继续unsupported；一次真实usage样本或简单安全系数本身也不是所有输入的上界证明。

## 实际代码与请求体

没有改Shared/IPC/Preload/Database/migration/RunService/Mock/UI。总控仅在Main内部沿R09入口补齐：

- `src/main/providers/modelPolicies/deepseekFlash.ts`：公开证据元数据、1024输入/128输出候选限制及CNY价格；capabilities只匹配规范化后精确官方root origin，`/v1`、`/beta`、其他主机不继承。未注册真实counter/model policy，metadata明确generationBlockedReason。
- `ProviderRegistry.ts`：Main-only价格新增显式CNY分支，使用整数micro元（1元=1000000micro元）；审查时间/到期时间、整数费率/安全整数总额及maxInputTokens校验。原USD协议和Mock预算保持不变。已有guard每次重检策略有效性；未确认目标、未知模型/计数、过期/超限在Key与transport前拒绝。
- `ChatCompletionProvider.ts`：仅Main可信capability能为deepseek-flash加入关闭思考的字面字段；没有通用extra_body、Renderer覆盖或新网络权限。现有maxRetries:0、目标确认、DNS/redirect/撤销/Abort全部保留。

本地受控HTTP server捕获并深度断言实际SDK发送体（下面是实际已匹配结构，无真实凭据）：

```json
{"model":"deepseek-flash","messages":[{"role":"user","content":"Reply OK."}],"stream":true,"max_tokens":128,"stream_options":{"include_usage":true},"thinking":{"type":"disabled"}}
```

协议参数被验证，并不代表默认生产计数策略已就绪。其他兼容服务商相同模型显示名称不会自动携带DeepSeek thinking参数；未知模型/未审规则没有Mock回退。列表和鉴权保持unsupported，避免把参数准备扩大成远程发现授权。

## 人民币预算门禁

采用高峰未命中输入每Token2micro元、输出每Token8micro元，单次上限50000micro元（¥0.05）。使用整数算式 `inputUpperBound * 2 + outputTokenLimit * 8 <= 50000`，拒绝小数/负值/NaN/Infinity、整数溢出和过期规则，不靠缓存或汇率放宽。24996输入上界+1输出恰好¥0.05可通过fixture；多1输入Token拒绝，且Adapter级验证读取Key/transport均0。

拟定小测试限制为完整输入≤1024 Token、max_tokens≤128；在这两个界限**确已得到证明的前提下**最高¥0.003072，仍受¥0.05硬上限。当前未证明输入计数，因此该算式未被用来批准真实请求。单Agent/单回合只在本轮fixture验证，没有扩大RunService或谎称已对所有真实房间强制单Agent；未来开放前必须再次核对精确房间和配置。

价格证据固定有效至 **2026-10-18T00:00:00Z（北京时间08:00）**，不自动滚动延期；过期须重新查官方资料并审查。不把“代码存在”当价格永远有效。

## 实际验证和失败

| 检查 | 本轮最终结果 |
| --- | --- |
| 独立环境 | 原锁离线copy安装646 reused/0 downloaded，32直接版本匹配；23051依赖inode与其他WT共享0；不是冷缓存下载 |
| 基线 | 开发前既有75文件1073/1073，exit0 |
| DeepSeek专项 | 1文件32/32，exit0；实际HTTP体、CNY边界/过期/输入输出限额、Key前拒绝、错误不重试、单Agent持久化 |
| 完整回归 | Node76文件1105/1105、Electron76文件1105/1105，均exit0，无skip/exclude |
| strict /生产构建 | 均exit0；Main218.84kB、Preload CJS232.20kB、Renderer964.20kB |
| 原生 | 官方Node24.18.1/严格同版headers/ABI137，Electron38.8.6/对应headers/ABI139，arm64；各100内存DB/10000行关闭后自然exit0 |
| 真实生产入口 | ready前隔离+全fake Key后端；DeepSeek每阶段9个Bridge断言及Main侧拒绝区间零解密；原R09仅本地fixture12请求，exit0 |
| 新进程/退出 | 重启HTTP0、DeepSeek拒绝仍有效；首轮和重启只读SQLite审计exit0 |
| 原Mock生产页面 | 房间/成员/Key/历史/控制与18/18真实Bridge错误断言及退出SQLite审计exit0 |
| 范围审计 | main不变且干净，Shared/DB/security/Mock/迁移/依赖/构建配置未改，原16个native inode/SHA未变 |

fixture模拟成功usage按实际返回prompt_tokens/completion_tokens落usage事件；缺失不造值。400/401/429、超时、断流都只发一次本地请求；Stop保留partial/aborted Attempt及原有状态语义。本轮未访问真实Key、用户DB或系统Keychain，所有公网模型API调用0。表内专项/完整/不同运行时重叠，不累加。

真实失败保留：新增专项初始15fail/13pass（新能力未实现及一个测试updateProvider参数不全）；实现及正确fixture后28/28，扩充最终32/32。生产补充探针初次将setKey状态确认解密误计入拒绝区间，29!=28；定位setKey→getProviderKeyState→resolveKey后只调整测量起点，严格零解密断言保留。拆分脚本时又漏api声明导致第二次exit1；仅补局部声明，新profile重跑及审计通过。没有为探针失败改业务或放宽门禁，失败日志与profile未删。

## 文件清单和候选状态

业务变更：`src/main/providers/ProviderRegistry.ts`、`src/main/providers/openai/ChatCompletionProvider.ts`、新增`src/main/providers/modelPolicies/deepseekFlash.ts`。

验证变更：新增`tests/integration/deepseek/preparation.test.ts`、`tests/probes/deepseek-preparation.cjs`；`tests/probes/r09-electron.cjs`顺序await新增拒绝探针，无跳过/空断言。

治理变更：`docs/CONTRACTS.md`、`docs/DECISIONS.md`、`docs/STATUS.md`和本报告/台账。无新依赖、公开wire字段、migration或真实数据变化。候选为review；真实调用前置DEEPSEEK-TOKEN-01为blocked，R09已验收fixture状态不被外推为真实模型验收。

## Keychain风险与下一次请求授权条件

真实macOS safeStorage/Keychain尚未实测；用户环境可能有权限提示、锁定、不可用或会话内存降级，fake密文测试不能证明OS保护与跨重启可靠性。建议另获授权后，先用隔离userData和无秘密的测试Key验证真实后端保存/重启/撤销；不在本轮自动执行，不在聊天收集真实Key。

**当前即使另给付费额度也不能绕过Token阻塞。** 先完成计数/上界证明、重新核对价格有效期、注册精确策略并获候选合入及复验授权；之后才可另行明确批准：仅`https://api.deepseek.com/chat/completions`、`deepseek-flash`、一个指定Agent/一个新Run/一次POST、短文本、thinking.disabled、max_tokens128、输入上界1024、单请求及本次合计均≤¥0.05、无自动鉴权/列表/重试/恢复/三Agent。Key只由用户在应用内输入，Main会话确认绑定当前providerId/目标/Key修订；任何超限/变化即停止。

本轮没有真实smoke、Keychain实测、正式桌面E2E、打包/ASAR/签名/跨平台、发布或其他模块开发。交候选审核后停止，不自动合main或发请求。
