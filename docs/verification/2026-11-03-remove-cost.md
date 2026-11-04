# 移除费用、只用内置目录：验收记录

**D145、D146（第 3 层实测反馈）这两轮只跑了受影响的检查，结果在交付说明里；全量检查由总控跑。** 下面的第 1 层是上一轮的结果。截图是这一轮重新生成的。

分支 `codex/remove-cost-open-models`。下表全部在 `f184a85` 上执行；之后只把“几位成员”的样式类改了名（和全局已有的类撞名，导致这一行对不齐），重跑了 typecheck、受影响的单元测试、`tests/e2e/mixed-providers.spec.ts`、r12-acceptance 和扫描，并增加本记录和截图。决策见 [DECISIONS](../DECISIONS.md) D133–D144。

## 第 1 层：自动化

| 命令 | 结果 |
|---|---|
| `pnpm run typecheck` | exit 0 |
| `node scripts/scan-public-terms.cjs <外部词表>` | exit 0，命中 0 处 |
| `pnpm test` | exit 0，114 个文件，1846 条通过 |
| `pnpm build` | exit 0 |
| `pnpm rehearse:upgrade <临时 v13 副本>`（旧 v11 文本和新 v11 文本各建一份） | 都 exit 0，`schema_migrations` 13 → 14，输入文件没有变化 |
| `pnpm e2e` | exit 0，30 条通过 |
| `pnpm run pack` 后 `pnpm e2e:packaged` | exit 0，3 条通过 |
| 全部探针 | 都 PASS，见下 |

全新建库：`pnpm e2e` 和 `pnpm e2e:packaged` 都从空 profile 启动，迁移到 14。从 v5、v9、v12、v13 升级由 `tests/integration/persistence/migrationV14.test.ts` 覆盖。

探针：r01（默认、`--r03-recovery`、`--joint-ui`），r09-electron（首次、重启），r09-native，r12-electron（首次、重启），r12-acceptance，r07r08-electron（首次、重启），r10-r11-electron（首次、重启），r16-batch2（首次、两次重启），r14、r15（首次、重启），r16-acceptance，r16-continuity，r16-longhistory，premerge（首次、重启）。

上一轮（`4106d7e`）r01 联合界面、r12-electron、r12-acceptance、r16-acceptance 失败：前三个是内置演示成员被算成“没选模型”，是真 bug，已修；最后一个是文案断言。

### 扫描结果

- src、tests、scripts、package.json、README、SPEC 命中 0 处（总控审查后的修改提交上重跑）。词表从外部文件读取，脚本本身不含词表。
- `pnpm-lock.yaml` 8 处传递依赖：`http-proxy-agent`、`https-proxy-agent`，来自打包工具的依赖链，不进应用。

## 第 2 层：实操

真实构建，隔离 profile，假 Key，本地 fixture，不联网。由 `tests/e2e/mixed-providers.spec.ts` 操作，截图在 [remove-cost-screens](remove-cost-screens/)，每张的说明在 `captions.json`。

| 截图 | 说明 |
|---|---|
| 01–04 | 新用户：欢迎页 → 选服务（8 家，DeepSeek 推荐，另有演示）→ 贴 Key、选模型 → 第一场讨论 |
| 05–06 | 四个服务都可以使用，保存时没有发生成请求；设置只有模型服务、外观、数据与隐私 |
| 07–12 | 四位成员分属四家服务：暂停、讨论结束、摘要、产物、用量 |
| 13–17 | 深色：模型服务、选服务、贴 Key（写明北京地域）、讨论、用量 |
| 18–21 | 旧库：目录外的服务保留原名，显示已停用，只能删除；成员写明不再支持、请换一个（浅色、深色） |
| 22 | 开始按钮不可用：输入框上方写明是哪几位，原因写在各自那一行，下拉框就地可改 |
| 23–29 | 选子模型：连接通义千问时改成 Qwen3.8 Flash → 成员都显示它 → 一位成员单独换成 Qwen3.7 Max → 改默认模型不影响成员 → 服务收到的 model 和所选一致 |
| 30 | 新讨论页：讨论方式、几位成员、成员和模型从上到下，默认自由讨论、3 人 |
| 31–33 | 双人对话：固定 2 人，只有两行，分别选不同服务（浅色、深色）；开始后控件收起 |
| 34 | 自由讨论改成 5 人：多出来的两位按角色模板新建，模型各选各的 |
| 35 | 减回 3 人：只显示前三位，另两位暂不参与，配置保留 |
| 36 | 审查修订链：固定 2 人，写明谁写、谁挑错 |
| 37 | 自定义流程：阶段、轮数、上限一个都没少 |
| 38–39 | 800 宽：没有横向滚动，输入框在屏幕内（浅色、深色） |
| 40–41 | 8 位成员：成员列表自己滚动，三步和输入框都在屏幕内（浅色、深色） |
| 42 | 模型在思考、一个字没出：写明还在等、等了多久，“停止”就在手边 |
| 43–44 | 到达时长上限（自定义流程设 1 分钟）：如实说明，不提超时和网络；只有一个“继续讨论”（浅色、深色） |
| 45 | 运行详情写明停止原因 |
| 46–47 | 继续后没说完的成员重新回复，讨论完成，没有再被掐断 |
| 48–49 | 测试连接失败：卡片不再是绿色，写明原因和服务商错误码（浅色、深色） |
| 50–51 | 讨论失败：提示和运行详情都写“服务商返回：<错误码>（HTTP <状态>）”，没有英文原文；没有文字时不说“已保留部分文字” |
| 52 | 测试成功后恢复绿色 |
| 53 | 模型列表接口拒绝：卡片写“Key 可能有问题”，“测试连接”通过后恢复 |
| 54 | 更换 Key 窗口：测试的是这家服务自己的默认模型（Kimi 发 `kimi-k3.1-pro`） |
| 55–56 | 多模态：选 GLM-5V Turbo，向导和成员对话框都写明目前只用文字讨论；服务收到的内容是字符串 |
| 57–61 | 自动发现：列表多了本品牌新模型，只有它进下拉框 → 成员用它开讨论 → 卡片写明来源、可以刷新 → 从列表消失后不替换，写明可能已下线（浅色、深色） |
| 62–64 | 思考期间的提示、额度用完的提示、调高上限后重新生成 |

spec 里断言：向导里唯一的文本框是 API Key，模型是下拉列表；服务卡片没有文本框，“高级与删除”里只有服务名称；没有“手动添加模型”“从服务商获取列表”；设置里没有“网络”。旧库路径：开始讨论被拒且没有发请求，换模型后讨论正常完成，服务可以删除。

实操发现并已修复：

- 开始讨论时目录外成员的提示放错了映射表，界面显示笼统的“启动协作失败”。
- 长模型名那一行“设为默认”会折行，模型名和 ID 改成上下两行。
- 已停用的服务排在最前并默认展开，改为启用的在前、默认展开第一个启用的。
- 没展开的卡片图标和模型数不对，改为从 readiness 取。
- 目录外的服务没有 Key 时仍显示“删除 Key”，已隐藏。
- 目录外的判断改用 Main 返回的 `supported`，Renderer 不再自己判断。

第 3 层实测反馈的修复（D146）：

- 累计 300 秒撞上旧默认的 5 分钟，第三位成员一个字没出就被掐断，界面却说请求超时。默认放宽到 2 小时，到限如实说明，可以原地继续。
- 实现时发现：单次请求自己的超时也被记成“运行时长到限”，两种情况分不清；房间记住的流程会一直带着旧默认；时长用完后摘要、重新生成也发不出去；实操发现历史列表仍写“运行失败”。都已修复。

第 3 层实测反馈的修复（D145）：

- 测试连接成功、讨论却两次 `not_found`，界面和记录都拿不到原因。现在保留服务商的错误码和 HTTP 状态，文字仍不保存、不显示。
- 404 在设置页写成“服务已不存在”，统一成“服务商找不到这个模型，或者它还没在服务商那里开通”。
- 更换 Key 窗口测的是第一家服务的模型，必然报不支持，改用这家服务的默认模型。
- 绿色“可以使用”只看 Key 是否保存，现在跟着最近一次测试和模型列表的结果走。
- 实现时单元测试发现：错误响应一直不结束时，失败要等到总超时才报出来。读错误体改为最多 2 秒、64KB，超过就只留状态。
- 看截图发现：气泡在没有任何文字时仍写“已保留部分文字”；展开的卡片把同一个原因写两遍。都已修复。

修这一轮时发现并已修复：

- 用户实测：新讨论页找不到给成员选模型的地方，要回房间页才能配。现在是讨论方式、几位成员、成员和模型三步（D144）。
- 全量探针发现：内置演示成员没有模型是合法的，第一版把他们算成“没选模型”，禁用了开始按钮。现在单独标记。
- 默认深度辩论 5 人要 20 回合，超过默认上限 12，一开始就过不了核对；回合和时长上限改为随人数增长。
- 主动切回自由讨论后，页面误报“没有找到这个房间的讨论方式”。
- 新发现的模型在下拉框里显示成 `deepseek-v9（deepseek-v9）`，改为只显示 ID。
- 下拉框太窄把说明截断，给模型列让出宽度。
- 开始讨论的页面看不出成员用什么模型，现在写明。
- 上下文只有 32k 的 `qwen-max` 按默认 128k 算会发不出去，目录里给它写了上限。

## 第 3 层：真实模型

**未验证。** 留给总控和用户，用真实 Key 跑一场，事先取得用户同意。费用以服务商账单为准；下面的流程大约发十几次短请求。

1. 切到这个分支，运行 `pnpm trial`（隔离试用目录，migration 14 只作用于试用库）。
2. 选一家服务，贴 Key，保存后写目标，开始讨论。
3. 到设置里再加一两家，把成员换成不同的服务，再开一场。
4. 讨论中试暂停、点名、插话；结束后一键生成摘要和一份产物，看用量页。

重点看这几处，出问题先记下错误提示，不要预先按厂商处理：

- 多模态模型只发文字时能否正常回复：`hy-vision-2.0-instruct`、`hunyuan-t1-vision-20250916`、`qwen3-vl-plus`、`qwen3.8-omni-flash`。

- Kimi、MiniMax 文档主推 `max_completion_tokens`，这里发 `max_tokens`，看是否被接受。
- 智谱的请求结构里没有 `stream_options`，看是否被忽略；不返回 usage 时用量应显示“没拿到”。
- 不再替用户关思考：DeepSeek、豆包、Kimi 默认思考，看 8192 的默认上限够不够。
- MiniMax 没有 `reasoning_split` 时，看 `<think>` 内容会不会混进发言（开头的已剥离）。
- 通义千问用文档写明仍可使用的旧地址，Key 要选北京地域；豆包同样。
- 百度文心、腾讯混元、MiniMax 只凭文档，一次都没有实测。
- 慢模型（比如豆包 Evolving）：思考几分钟时，等待提示和“停止”是否正常；讨论能否跑完。
- 豆包 Evolving：测试连接通过、讨论 `not_found` 的原因还不知道。再跑一次，记下“服务商返回：”后面的错误码和状态。
- 豆包的模型发现在实测里是 `authentication_failed`，还没拿到真实响应，不知道是 401 还是别的。现在 401 的提示不下结论，403 按没有列表处理；卡片会显示“Key 可能有问题”，“测试连接”通过后恢复。
- 每家的 `GET /models` 是否可用、返回格式是否为 `{ data: [{ id }] }`，以及列得全不全。列不全时内置模型会被标“可能已下线”，这时看提示是否让人困惑。

## 目录来源

2026-11-04 用内置浏览器逐家核对官方原文，来源写在 `src/shared/serviceCatalog.ts`。

| 服务 | 目录里的模型 | 没有放进去的（原因） |
|---|---|---|
| DeepSeek | `deepseek-flash`、`deepseek-v4-pro` | 旧名 `deepseek-v4-flash`（已下线，转到 Flash） |
| 豆包 | `doubao-seed-2-1-pro-260915`、`-2-1-lite-260915`、`doubao-seed-evolving`、`-2-1-turbo-260628`、`-2-1-pro-260628`、`-2-0-lite-260428`、`-2-0-mini-260428` | `-2-0-*-260215`（即将下线）；`character`、`translation`（专项）；页面上其他品牌的模型 |
| 通义千问 | `qwen3.7-plus`（官方默认）、`qwen3.8-max`、`qwen3.8-flash`、`qwen3.8-omni-flash`、`qwen3.7-max`、`qwen3.7-flash`、`qwen3.6-plus`、`qwen3.6-flash`、`qwen3.5-plus`、`qwen3.5-flash`、`qwen3-vl-plus`、`qwen-plus`、`qwen-max`、`qwen-flash` | MT、Long、Character、Doc、Deep-Research、OCR、Coder（专项）；`qwen3.5-omni-*`、`qwen3-omni-flash`（官方定位是语音输出和较旧的全模态）；`-realtime`（走实时接口）；带 `-35b-a3b` 等后缀的开放权重规格 |
| Kimi | `kimi-k3.1-pro`、`kimi-k3.1-pro-highspeed`、`kimi-k3` | K2 系列（2026-10-31 起停止向新用户开放，12 月底下线）；`moonshot-v1` 等（已下线） |
| 智谱 GLM | `glm-5.3`、`glm-5.3-flash`、`glm-5.3-flashx`、`glm-5.2`、`glm-5.1`、`glm-5-turbo`、`glm-5`、`glm-4.7`、`glm-4.7-flashx`、`glm-4.7-flash`、`glm-4.6`、`glm-5v-turbo`、`glm-4.6v`、`glm-4.6v-flashx`、`glm-4.6v-flash`、`glm-4.5-air`、`glm-4.5-airx`、`glm-4-flashx-250414`、`glm-4-flash-250414`、`glm-4.1v-thinking-flashx`、`glm-4.1v-thinking-flash` | `glm-4.5-flash`（模型页写明已下线，对话接口的枚举还留着）；`glm-4.5`、`glm-4.5-x`（即将下线）；`-legal`、`glm-4-long`、`autoglm-phone`（专项）；`glm-4v-flash`（页面没写上下文）；`glm-4-plus` 等（不在对话接口枚举里）；语音模型 |
| 百度文心 | `ernie-5.1` | 模型列表里 ERNIE 只有这一个。“可用于对话接口”是按页面规则推断，没有原文逐字写明 |
| 腾讯混元 | `hy4`、`hy4-preview`、`hy3`、`hy-vision-2.0-instruct`、`hunyuan-t1-vision-20250916` | `hy-mt2-*`（翻译）、`hunyuan-role-latest`（角色扮演）、`hunyuan-turbos-vision-video-*`（只做视频理解）、`youtu-vita`（其他品牌） |
| MiniMax | `MiniMax-M3.1-Flash`、`MiniMax-M3` | 语音、图片、视频、音乐模型 |

标 `multimodal` 的按官方原文：DeepSeek Flash（`deepseek-v4-pro` 官方写不支持图像）；豆包全部 7 个；通义除 `qwen3.7-max`、`qwen-plus`、`qwen-max`、`qwen-flash` 外（这几个官方没列进视觉理解）；Kimi 全部 3 个；智谱 `glm-5.3-flash`、`glm-5.3-flashx` 和带 V 的；混元 `hy4` 和两个 vision（`hy4-preview`、`hy3` 官方没写图片理解）；MiniMax 全部 2 个。`ernie-5.1` 官方没写多模态，不标。智谱对话接口写明视觉模型支持纯文本；混元两个 vision 模型的页面只有带图示例，没写能否只发文字，按“没写必须带图”放进目录，第 3 层要看。

上下文按官方最大输入收紧：`hy-vision-2.0-instruct`（最大输入 24k）写 32000，`hunyuan-t1-vision-20250916`（最大输入 16k）写 24000，`glm-4.1v-thinking-*` 写 64000。

本品牌规则按总控的方案，有两处按官方命名收紧：MiniMax 用 `^minimax-m`（`MiniMax-H3` 是视频模型，ID 里没有可排除的词）；混元用 `^(hy[0-9-]|hunyuan-)`（避免匹配其他以 hy 开头的名字）。排除词除总控列出的，还加了 `voice`、`speech`、`music`、`realtime`、`vl`、`omni`、`3d`、`long`、`doc`、`legal`、`research`，以及 `-2026-01-25` 这种带日期的快照（不然一个模型会占很多行）。多模态对话模型不排除：`vision`、`vl`、`omni` 和 `4.6v` 这类版本号都留下；`qwen3.8-omni-flash-realtime` 靠 `realtime`、`qwen3-vl-embedding` 靠 `embedding`、`hunyuan-turbos-vision-video-*` 靠 `video` 排除。发现列表可能带进 `qwen3.5-omni-*`、`glm-4v-flash` 这类目录没放的模型，只显示 ID，上限用默认值。

## 因设计改变而删改的断言

没有因为别的原因放宽断言。

| 文件 | 原因 |
|---|---|
| `tests/integration/workflows/productionRun.test.ts` | D146：时长用完后重试不再被拒，改为验证继续后完成 |
| `tests/integration/joint/recovery.test.tsx` | D146：时长用完不再禁止恢复；到限的提示从“请求已超时”改为时长上限 |
| `tests/integration/artifacts/artifacts.test.ts`、`tests/integration/providers/compatible/protocol.test.ts` | D146：请求自身超时从 `aborted` 改为 `failed` |
| `tests/unit/rendererWorkflows/*` | D146：默认时长 2 小时；房间记住的格式升到版本 2 |
| `tests/unit/providers/compatible/stream.test.ts` | D145：错误响应体现在要读错误码，“一个字节都不读”改为“不结束时很快放弃、取消、不留文字” |
| `tests/integration/providers/compatible/protocol.test.ts` | D145：重定向的错误多了 `upstream.status`；响应体仍然不读 |
| `tests/integration/deepseek/*`（9 个）、`tests/unit/providers/controlledTrialMenu.test.ts`、`tests/probes/controlled-*`、`deepseek-*`、`r13a-*`、`r13b-*` | 受控试用和费用功能删除（D133） |
| `tests/integration/usage/{deepseekPolicy,ledgerR13b,migrationV7,runBudget}.test.ts`、`tests/integration/artifacts/ledger.test.ts`、`tests/unit/usage/pricing.test.ts`、`tests/unit/rendererUsage/r13bViews.test.tsx` | 价格、预留、结算、预算删除（D133） |
| `tests/integration/usage/summary.test.ts` | 摘要不再等确认（D140） |
| `tests/integration/artifacts/artifacts.test.ts`、`tests/integration/codeExport/codeExport.test.ts`、`tests/unit/rendererArtifacts/artifacts.test.tsx`、`tests/e2e/artifacts.spec.ts`、`tests/e2e/code-export.spec.ts` | 去掉“采用”（D139） |
| `tests/unit/rendererCodeExport/codeExport.test.tsx`、`tests/probes/r15-acceptance.cjs` | 新建文件默认勾选（D141），覆盖仍默认不勾 |
| `tests/unit/providers/compatible/{adapter,stream}.test.ts`、`tests/unit/contracts/*`、`tests/integration/r09/*`、`tests/integration/r07r08/ipcConfiguration.test.ts` | 模型列表、鉴权级别和能力配置删除（D143）；并发撤销的用例改用生成级别的连接测试，断言不变 |
| `tests/integration/settings/{providerSettings,connectWizard,targetApproval}.test.*`、`tests/unit/rendererSettings/*`、`tests/integration/onboarding/firstUse.test.tsx`、`tests/e2e/mixed-providers.spec.ts`、`tests/e2e/key-safety.spec.ts` | 自定义服务、手填模型和地址删除（D143） |
| `tests/unit/rendererWorkflows/{productionApp,workflowDialog}.test.tsx`、`tests/probes/r10-r11-ui.cjs`、`r12-acceptance`、`r16-acceptance`、`r16-batch2-acceptance` | 讨论方式入口从输入框旁改到新讨论页（D144）；默认时长随回合数增长 |
| `tests/unit/providers/network.test.ts` | 198.18.0.0/15 只对目录内域名放行（D143）；其余用例不查主机，新增目录外主机的拒绝用例 |
| `tests/probes/r07r08-*`、`r09-*`、`r10-r11-*`、`r16-batch2-acceptance`、`premerge-quality-acceptance` | 改走目录服务，测试目录由探针入口注入。premerge 里“把 Key 填进模型名”这一步没有入口了，删除；启动时清除旧值的检查保留 |

新增覆盖在 `tests/integration/providers/catalogEnforcement.test.ts`、`network.test.ts`、`migrationV14.test.ts`。

## 残留词

`¥`、`花费` 在 `src` 里没有结果。其余“费用”“计费”都是说明费用由服务商收取、测试连接和续写可能产生费用；`settings/model.ts`、`timeline/failure.ts`、`migrations/v14.ts` 里的“预算”只为读懂升级前的记录。E2E 每一步都检查页面文字里没有 `¥`、`预算`、`花费`、`金额` 等词。
