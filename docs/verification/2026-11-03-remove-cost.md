# 移除费用、只用内置目录：验收记录

分支 `codex/remove-cost-open-models`。下表的全量结果在 `5abd3e9` 上；之后的修改（migration 里不留类型名、子模型补全、自动发现）只跑了受影响的部分，结果见“最后一轮”，全量由总控重跑。决策见 [DECISIONS](../DECISIONS.md) D133–D143。

## 第 1 层：自动化

| 命令 | 结果 |
|---|---|
| `pnpm run typecheck` | exit 0 |
| `node scripts/scan-public-terms.cjs <外部词表>` | exit 0，命中 0 处 |
| `pnpm test` | exit 0，112 个文件，1700 条通过 |
| `pnpm build` | exit 0 |
| `pnpm rehearse:upgrade <临时 v13 副本>` | exit 0，`schema_migrations` 13 → 14，输入文件没有变化 |
| `pnpm e2e` | exit 0，26 条通过 |
| `pnpm run pack` 后 `pnpm e2e:packaged` | exit 0，3 条通过 |
| 全部探针 | 都 PASS，见下 |

全新建库：`pnpm e2e` 和 `pnpm e2e:packaged` 都从空 profile 启动，迁移到 14。从 v5、v9、v12、v13 升级由 `tests/integration/persistence/migrationV14.test.ts` 覆盖。

探针：r01（默认、`--r03-recovery`、`--joint-ui`），r09-electron（首次、重启），r09-native，r12-electron（首次、重启），r12-acceptance，r07r08-electron（首次、重启），r10-r11-electron（首次、重启），r16-batch2（首次、两次重启），r14、r15（首次、重启），r16-acceptance，r16-continuity，r16-longhistory，premerge（首次、重启）。

上一轮（`a4926bd`）`key-safety.spec.ts` 和 premerge 重启阶段失败，两处都是断言还按旧行为写。改完断言后在 `5abd3e9` 上从头重跑了一遍。

### 扫描结果

- src、tests、scripts、package.json、README、SPEC 命中 0 处（总控审查后的修改提交上重跑）。词表从外部文件读取，脚本本身不含词表。
- `pnpm-lock.yaml` 8 处传递依赖：`http-proxy-agent`、`https-proxy-agent`，来自打包工具的依赖链，不进应用。

### 最后一轮（子模型和自动发现）

未提交前的同一份代码上执行：typecheck、全量 `pnpm test`、build、`pnpm e2e`（28 条）、词表扫描（命中 0 处）都通过；探针 r01、r07r08、r09、r10-r11（含重启）、r16-batch2、premerge（含重启）通过。升级演练（新 v11 文本重建的 v13 副本）通过，`provider_model_discovery` 新建，输入文件没有变化。`pnpm e2e:packaged` 和其他探针没有在这一轮跑，由总控重跑。

## 第 2 层：实操

真实构建，隔离 profile，假 Key，本地 fixture，不联网。由 `tests/e2e/mixed-providers.spec.ts` 操作，截图在 [remove-cost-screens](remove-cost-screens/)，每张的说明在 `captions.json`。

| 截图 | 说明 |
|---|---|
| 01–04 | 新用户：欢迎页 → 选服务（8 家，DeepSeek 推荐，另有演示）→ 贴 Key、选模型 → 第一场讨论 |
| 05–06 | 四个服务都可以使用，保存时没有发生成请求；设置只有模型服务、外观、数据与隐私 |
| 07–12 | 四位成员分属四家服务：暂停、讨论结束、摘要、产物、用量 |
| 13–17 | 深色：模型服务、选服务、贴 Key（写明北京地域）、讨论、用量 |
| 18–21 | 旧库：目录外的服务保留原名，显示已停用，只能删除；成员写明不再支持、请换一个（浅色、深色） |
| 22–28 | 选子模型：连接通义千问时改成 Qwen3.8 Flash → 讨论页和成员都显示它 → 一位成员单独换成 Qwen3.7 Max → 改默认模型不影响成员 → 服务收到的 model 和所选一致 |
| 29–33 | 自动发现：列表多了本品牌新模型，只有它进下拉框 → 成员用它开讨论 → 卡片写明来源、可以刷新 → 从列表消失后不替换，写明可能已下线（浅色、深色） |
| 34–36 | 思考期间的提示、额度用完的提示、调高上限后重新生成 |

spec 里断言：向导里唯一的文本框是 API Key，模型是下拉列表；服务卡片没有文本框，“高级与删除”里只有服务名称；没有“手动添加模型”“从服务商获取列表”；设置里没有“网络”。旧库路径：开始讨论被拒且没有发请求，换模型后讨论正常完成，服务可以删除。

实操发现并已修复：

- 开始讨论时目录外成员的提示放错了映射表，界面显示笼统的“启动协作失败”。
- 长模型名那一行“设为默认”会折行，模型名和 ID 改成上下两行。
- 已停用的服务排在最前并默认展开，改为启用的在前、默认展开第一个启用的。
- 没展开的卡片图标和模型数不对，改为从 readiness 取。
- 目录外的服务没有 Key 时仍显示“删除 Key”，已隐藏。
- 目录外的判断改用 Main 返回的 `supported`，Renderer 不再自己判断。

修这一轮时发现并已修复：

- 开始讨论的页面看不出成员用什么模型，现在写明。
- 上下文只有 32k 的 `qwen-max` 按默认 128k 算会发不出去，目录里给它写了上限。

## 第 3 层：真实模型

**未验证。** 留给总控和用户，用真实 Key 跑一场，事先取得用户同意。费用以服务商账单为准；下面的流程大约发十几次短请求。

1. 切到这个分支，运行 `pnpm trial`（隔离试用目录，migration 14 只作用于试用库）。
2. 选一家服务，贴 Key，保存后写目标，开始讨论。
3. 到设置里再加一两家，把成员换成不同的服务，再开一场。
4. 讨论中试暂停、点名、插话；结束后一键生成摘要和一份产物，看用量页。

重点看这几处，出问题先记下错误提示，不要预先按厂商处理：

- Kimi、MiniMax 文档主推 `max_completion_tokens`，这里发 `max_tokens`，看是否被接受。
- 智谱的请求结构里没有 `stream_options`，看是否被忽略；不返回 usage 时用量应显示“没拿到”。
- 不再替用户关思考：DeepSeek、豆包、Kimi 默认思考，看 8192 的默认上限够不够。
- MiniMax 没有 `reasoning_split` 时，看 `<think>` 内容会不会混进发言（开头的已剥离）。
- 通义千问用文档写明仍可使用的旧地址，Key 要选北京地域；豆包同样。
- 百度文心、腾讯混元、MiniMax 只凭文档，一次都没有实测。
- 每家的 `GET /models` 是否可用、返回格式是否为 `{ data: [{ id }] }`，以及列得全不全。列不全时内置模型会被标“可能已下线”，这时看提示是否让人困惑。

## 目录来源

2026-11-04 用内置浏览器逐家核对官方原文，来源写在 `src/shared/serviceCatalog.ts`。

| 服务 | 目录里的模型 | 没有放进去的（原因） |
|---|---|---|
| DeepSeek | `deepseek-flash`、`deepseek-v4-pro` | 旧名 `deepseek-v4-flash`（已下线，转到 Flash） |
| 豆包 | `doubao-seed-2-1-pro-260915`、`-2-1-lite-260915`、`doubao-seed-evolving`、`-2-1-turbo-260628`、`-2-1-pro-260628`、`-2-0-lite-260428`、`-2-0-mini-260428` | `-2-0-*-260215`（即将下线）；`character`、`translation`（专项）；页面上其他品牌的模型 |
| 通义千问 | `qwen3.7-plus`（官方默认）、`qwen3.8-max`、`qwen3.8-flash`、`qwen3.7-max`、`qwen3.7-flash`、`qwen3.6-plus`、`qwen3.6-flash`、`qwen3.5-plus`、`qwen3.5-flash`、`qwen-plus`、`qwen-max`、`qwen-flash` | MT、Long、Character、Doc、Deep-Research、OCR、VL、omni、Coder（专项）；带 `-35b-a3b` 等后缀的开放权重规格 |
| Kimi | `kimi-k3.1-pro`、`kimi-k3.1-pro-highspeed`、`kimi-k3` | K2 系列（2026-10-31 起停止向新用户开放，12 月底下线）；`moonshot-v1` 等（已下线） |
| 智谱 GLM | `glm-5.3`、`glm-5.3-flash`、`glm-5.3-flashx`、`glm-5.2`、`glm-5.1`、`glm-5-turbo`、`glm-5`、`glm-4.7`、`glm-4.7-flashx`、`glm-4.7-flash`、`glm-4.6`、`glm-4.5-air`、`glm-4.5-airx`、`glm-4-flashx-250414`、`glm-4-flash-250414` | `glm-4.5-flash`（模型页写明已下线，对话接口的枚举还留着）；`glm-4.5`、`glm-4.5-x`（即将下线）；`-legal`、`glm-4-long`（专项）；`glm-4-plus` 等（不在对话接口枚举里）；视觉和语音模型 |
| 百度文心 | `ernie-5.1` | 模型列表里 ERNIE 只有这一个。“可用于对话接口”是按页面规则推断，没有原文逐字写明 |
| 腾讯混元 | `hy4`、`hy4-preview`、`hy3` | `hy-mt2-*`（翻译）、`hunyuan-role-latest`（角色扮演）、视觉模型 |
| MiniMax | `MiniMax-M3.1-Flash`、`MiniMax-M3` | 语音、图片、视频、音乐模型 |

本品牌规则按总控的方案，有两处按官方命名收紧：MiniMax 用 `^minimax-m`（`MiniMax-H3` 是视频模型，ID 里没有可排除的词）；混元用 `^(hy[0-9-]|hunyuan-)`（避免匹配其他以 hy 开头的名字）。排除词除总控列出的，还加了 `voice`、`speech`、`music`、`realtime`、`vl`、`omni`、`3d`、`long`、`doc`、`legal`、`research`，以及 `4.6v` 这种视觉版本号和 `-2026-01-25` 这种带日期的快照（不然一个模型会占很多行）。

## 因设计改变而删改的断言

没有因为别的原因放宽断言。

| 文件 | 原因 |
|---|---|
| `tests/integration/deepseek/*`（9 个）、`tests/unit/providers/controlledTrialMenu.test.ts`、`tests/probes/controlled-*`、`deepseek-*`、`r13a-*`、`r13b-*` | 受控试用和费用功能删除（D133） |
| `tests/integration/usage/{deepseekPolicy,ledgerR13b,migrationV7,runBudget}.test.ts`、`tests/integration/artifacts/ledger.test.ts`、`tests/unit/usage/pricing.test.ts`、`tests/unit/rendererUsage/r13bViews.test.tsx` | 价格、预留、结算、预算删除（D133） |
| `tests/integration/usage/summary.test.ts` | 摘要不再等确认（D140） |
| `tests/integration/artifacts/artifacts.test.ts`、`tests/integration/codeExport/codeExport.test.ts`、`tests/unit/rendererArtifacts/artifacts.test.tsx`、`tests/e2e/artifacts.spec.ts`、`tests/e2e/code-export.spec.ts` | 去掉“采用”（D139） |
| `tests/unit/rendererCodeExport/codeExport.test.tsx`、`tests/probes/r15-acceptance.cjs` | 新建文件默认勾选（D141），覆盖仍默认不勾 |
| `tests/unit/providers/compatible/{adapter,stream}.test.ts`、`tests/unit/contracts/*`、`tests/integration/r09/*`、`tests/integration/r07r08/ipcConfiguration.test.ts` | 模型列表、鉴权级别和能力配置删除（D143）；并发撤销的用例改用生成级别的连接测试，断言不变 |
| `tests/integration/settings/{providerSettings,connectWizard,targetApproval}.test.*`、`tests/unit/rendererSettings/*`、`tests/integration/onboarding/firstUse.test.tsx`、`tests/e2e/mixed-providers.spec.ts`、`tests/e2e/key-safety.spec.ts` | 自定义服务、手填模型和地址删除（D143） |
| `tests/unit/providers/network.test.ts` | 198.18.0.0/15 只对目录内域名放行（D143）；其余用例不查主机，新增目录外主机的拒绝用例 |
| `tests/probes/r07r08-*`、`r09-*`、`r10-r11-*`、`r16-batch2-acceptance`、`premerge-quality-acceptance` | 改走目录服务，测试目录由探针入口注入。premerge 里“把 Key 填进模型名”这一步没有入口了，删除；启动时清除旧值的检查保留 |

新增覆盖在 `tests/integration/providers/catalogEnforcement.test.ts`、`network.test.ts`、`migrationV14.test.ts`。

## 残留词

`¥`、`花费` 在 `src` 里没有结果。其余“费用”“计费”都是说明费用由服务商收取、测试连接和续写可能产生费用；`settings/model.ts`、`timeline/failure.ts`、`migrations/v14.ts` 里的“预算”只为读懂升级前的记录。E2E 每一步都检查页面文字里没有 `¥`、`预算`、`花费`、`金额` 等词。
