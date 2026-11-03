# 移除费用、开放模型、去掉多余步骤：验收记录

分支 `codex/remove-cost-open-models`，代码提交 `89c0b92`（之后只增加本记录和截图）。决策见 [DECISIONS](../DECISIONS.md) D133–D142。验证范围按总控 2026-11-04 的缩小要求执行。

## 第 1 层：自动化

全部在 `89c0b92` 上实际执行。

| 命令 | 结果 |
|---|---|
| `pnpm run typecheck` | exit 0 |
| `pnpm test` | exit 0，125 个文件，1975 条通过 |
| `pnpm build` | exit 0 |
| `pnpm e2e`（一次） | exit 0，24 条通过 |
| `pnpm run pack` 后 `pnpm e2e:packaged` | exit 0，3 条通过 |
| `pnpm rehearse:upgrade <临时 v13 副本>` | exit 0，`schema_migrations` 13 → 14，消息保留，输入文件没有变化 |
| 探针 r07r08、r09、r10-r11、premerge | 各自 PASS |
| 探针 r16-batch2（首次、重启、再次重启） | 三个阶段都 PASS |

从 v5、v9、v12、v13 升级由 `tests/integration/persistence/migrationV14.test.ts` 覆盖，讨论、消息、摘要和 token 用量都保留。

其他探针没有在 `89c0b92` 上重跑。r01、r09-native（Electron 模式）、r12、r12-acceptance、r14、r15、r16-acceptance、r16-continuity、r16-longhistory 和 premerge 重启阶段，在通用适配器改动之前的提交上跑过，都通过。按总控安排，合并前由总控跑一次完整检查。

`node tests/probes/r09-native.cjs` 在这台机器上失败：探针写死 Node 24.18.1，现在的 Homebrew Node 是 24.22.0，与本任务无关，断言没有改。

## 第 2 层：实操

真实构建，隔离 profile，全程用通用接口夹具和假 Key，不联网。路径：贴 Key → 选模型 → 开始讨论，再把成员换成三种接口类型混合讨论。由 `tests/e2e/mixed-providers.spec.ts` 操作，截图在 [remove-cost-screens](remove-cost-screens/)。

| 截图 | 说明 |
|---|---|
| 01 | 首次启动：写明支持哪些服务、费用由服务商收取 |
| 02 | 选服务：内置服务只预填地址和建议模型名，另有自定义服务 |
| 03 | 贴 Key：写明 Key 只发往哪里；模型名已预填，可以手改；没有确认地址这一步 |
| 04 | 保存后直接到第一场讨论，房间和三位成员已建好 |
| 05 | 自定义服务：名称、接口类型、地址、Key、模型名 |
| 06 | 四个服务都可以使用，保存时没有发请求 |
| 07 | 四位成员用三种接口类型 |
| 08 | 暂停：这一回合说完才停，发言下面显示 token |
| 09 | 讨论结束：四个服务依次发言，没有金额 |
| 10 | 一键摘要：写完直接生效，可以撤销、修改、换人 |
| 11 | 产物：校验通过就能复制、另存，没有“采用” |
| 12 | 用量页：只有请求数和 token |
| 13–15 | 网络开关：关闭、读到系统代理、SOCKS（如实说明不支持，不悄悄直连） |
| 16–20 | 深色：网络、模型服务、自定义服务表单、讨论页、用量页 |

800 宽没有留截图，spec 里检查了没有横向滚动。

实操发现并已修复的问题：

- 撤销摘要的状态没有传到界面。
- 发给模型的摘要标签还写着“由主持人确认”。
- 演示跑过之后再连接第一个真实服务，打开的是旧房间，不是新建好的房间。
- 演示成员编造的 token 数被算进了用量页。
- 房间页写“共 3 回合”，旁边的标签写 6 回合。
- 欢迎页还把建房间列为一步。
- 测试连接之后点“上一步”换服务，可能带着已保存的 Key。现在保存过就不再显示“上一步”。
- 模型名被拒后 Key 还留在输入框。

## 残留词搜索

在 `src` 里搜索 `¥`、`预算`、`花费`、`费用`（已发布的 migration 1–13 和历史交付文档除外）。`¥` 和 `花费` 没有结果。

| 位置 | 文字 | 为什么留着 |
|---|---|---|
| `Welcome.tsx`、`ConnectWizard.tsx`、`Composer.tsx`、`RunPanel.tsx`、`UsagePage.tsx`、`GenerateDialog.tsx`、`SummaryDialog.tsx` | 费用由服务商收取，这里不估算 | 任务要求的一句说明 |
| `ConnectWizard.tsx`、`ServicesPanel.tsx` | 可能产生极少的费用 | 测试连接可能发一条短消息，要说清楚 |
| `MessageItem.tsx` | 重新生成、续写处关于再次计费的提示 | 这是一次新请求，要说清楚 |
| `settings/model.ts`、`timeline/failure.ts` | 旧版本的预算限制 | 只为读懂升级前的 Run |
| `migrations/v14.ts` | 这场讨论是旧版本按预算限制停下的 | 改写旧 Run 的停止原因，不含金额 |

界面上不再有金额。E2E 每一步都检查页面文字里没有 `¥`、`预算`、`花费`、`金额` 等词。

## 因设计改变而删改的断言

没有因为别的原因放宽断言。

| 文件 | 原因 |
|---|---|
| `tests/integration/deepseek/*`（9 个）、`tests/unit/providers/controlledTrialMenu.test.ts`、`tests/probes/controlled-*`、`deepseek-*`、`r13a-*`、`r13b-*` | 受控试用和费用功能删除（D133）；其中用量部分已由新测试覆盖 |
| `tests/integration/usage/{deepseekPolicy,ledgerR13b,migrationV7,runBudget}.test.ts`、`tests/integration/artifacts/ledger.test.ts`、`tests/unit/usage/pricing.test.ts`、`tests/unit/rendererUsage/r13bViews.test.tsx` | 价格、预留、结算、预算删除（D133） |
| `tests/integration/r09/contracts.test.ts`、`tests/integration/settings/sessionTargetState.test.ts` | 地址确认删除（D136） |
| `tests/unit/providers/loopbackProxy.test.ts`，`proxyTunnelTransport.test.ts` 里“拒绝非固定目标” | 代理不再限固定目标（D137），改为断言任意地址走代理且代理看不到 Key |
| `tests/integration/settings/connectWizard.test.tsx`、`tests/unit/rendererSettings/settingsPage.test.tsx`、`tests/integration/onboarding/firstUse.test.tsx` | 向导去掉步骤、确认地址、试发一条（D136），网络面板改开关（D137），预设改国内（D142） |
| `tests/integration/usage/summary.test.ts` | 摘要不再等确认（D140），增加撤销和恢复的测试 |
| `tests/integration/artifacts/artifacts.test.ts`、`tests/integration/codeExport/codeExport.test.ts`、`tests/unit/rendererArtifacts/artifacts.test.tsx`、`tests/e2e/artifacts.spec.ts`、`tests/e2e/code-export.spec.ts` | 去掉“采用”（D139） |
| `tests/unit/rendererCodeExport/codeExport.test.tsx`、`tests/probes/r15-acceptance.cjs` | 新建文件默认勾选（D141），覆盖仍断言默认不勾 |
| `tests/unit/providers/gemini/adapter.test.ts` | Gemini 接口接受用户填写的安全地址（D142），不安全的地址仍拒绝 |
| `tests/integration/providers/mixedProviders.test.ts`、`tests/probes/premerge-quality-acceptance.cjs` | 不再替用户关思考（D135） |

## 第 3 层：真实模型

**未验证。** 由总控和用户用真实 Key 跑一场，事先取得用户同意。费用以服务商账单为准；下面的流程大约发十几次短请求。

1. 切到这个分支，运行 `pnpm trial`（隔离试用目录，migration 14 只作用于试用库，不碰正式数据库）。
2. 贴一家国内服务的 Key，保存后写目标，开始一场讨论。
3. 到设置里再加一两家，也可以用自定义服务手填地址和模型名；把成员换成不同的服务，再开一场。
4. 讨论中试暂停、点名、插话；结束后一键生成摘要和一份产物，看用量页。

重点看这几处，通用路径可能在这里遇到差异。出问题先记下错误提示，不要预先按厂商处理：

- Kimi、MiniMax 的文档主推 `max_completion_tokens`，通用路径发 `max_tokens`，看是否被接受。
- 智谱的请求结构里没有 `stream_options`，看是否被忽略；不返回 usage 时用量应显示“没拿到”。
- 不再替用户关思考：DeepSeek、豆包、Kimi 默认思考，看 8192 的默认上限够不够，正文会不会被截断。
- MiniMax 没有 `reasoning_split` 时，看 `<think>` 内容会不会混进发言。
- 通义千问用的是文档写明仍可使用的旧地址，Key 要选北京地域。
