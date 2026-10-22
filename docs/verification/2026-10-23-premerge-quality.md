# 合并前质量修复：验收记录（2026-10-23）

分支 `codex/r13a-premerge-quality`，基线 `codex/r13a-real-model-enable`（`b3e3324`，含 R10–R12 与 R13A）。所有检查都在本机执行，**没有发出任何真实 DeepSeek 请求**，也没有读取真实用户目录 `~/Library/Application Support/ai-roundtable`、`…/ai-roundtable-trial` 或真实 Key：测试用假 Key，探针把 `https://api.deepseek.com` 的传输重定向到本机回环夹具，其他出站全部拦截并断言为零。决策见 [DECISIONS](../DECISIONS.md) D095–D098，契约见 [CONTRACTS](../CONTRACTS.md) 同名一节，发给模型的消息对比见 [premerge-quality-context-comparison.md](premerge-quality-context-comparison.md)。

## 三层验收

| 层 | 内容 | 结果 |
| --- | --- | --- |
| 自动化测试 | `pnpm run typecheck`；`pnpm test`（Electron 38.8.6 自带 Node，ABI 139）；`pnpm run build` | 通过：typecheck exit 0；126 个文件 / 1883 个测试全部通过（基线 120 / 1820）；build exit 0 |
| 隔离生产探针 | `r10-r11-electron.cjs`；`r12-electron.cjs` 首次 + `--restart`；`r13a-electron.cjs` 首次 + `--restart` | 通过：R10/R11 53 项断言、26 次夹具请求（该探针没有重启模式）；R12 首次 22 项 / 4 次请求，重启 14 项 / **0 次请求**；R13A 首次 13 项 / 4 次请求，重启 12 项 / **0 次请求** |
| 真实界面实操 | `premerge-quality-acceptance.cjs`：真实鼠标/键盘事件（DevTools Input 域），中文经输入法组合输入，8 张截图 | 通过：35 项检查、2 次夹具请求，无控制台错误、无网络外联 |
| 回归实操探针 | `r13a-acceptance.cjs`；`r12-acceptance.cjs`（已改为"停止 → 确认停止"） | R13A 通过（21 项）。R12：本分支共运行 4 次，3 次通过（22 项）、1 次在输入法组合步骤失败（拼音未被替换为汉字；该步骤固定等待 120ms，插话输入框代码本分支未改），判定为探针时序不稳定，列为遗留问题。两者重新生成的截图已还原，不覆盖原有证据 |
| 真实模型实测 | 用户自己的 DeepSeek Key 复测讨论质量与账单 | **未验证，待总控和用户一起做** |

## 实操截图（`premerge-quality-screens/`）

| 截图 | 说明 |
| --- | --- |
| [01-model-id-key-blocked.png](premerge-quality-screens/01-model-id-key-blocked.png) | 在"默认模型 ID"里误填一串 `sk-` 开头的合成假值：输入框立即标红，下方提示"这看起来是 API Key，不是模型 ID。请先删掉它；保存配置后，在下方出现的"API Key"输入框里填写。"；点"保存配置"被拒绝，没有创建 Provider。未输入时下方显示示例"例如 deepseek-flash"。 |
| [02-key-blocked-reason.png](premerge-quality-screens/02-key-blocked-reason.png) | 改填 deepseek-flash 并保存后，"API Key"输入框不可用，紧挨着说明原因"输入框暂不可用：填写 Key 之前，请先核对 Key 将发往的请求目标：https://api.deepseek.com/"，旁边一键操作"目标无误，启用输入框"。 |
| [03-key-saved-last-step.png](premerge-quality-screens/03-key-saved-last-step.png) | 一键后输入框可用并获得焦点（"我已核对请求目标"同时勾选）；键入假 Key 按 Enter 保存，显示"已配置；系统安全存储。"，Key 不回显。Key 下方只有一个下一步："最后一步：确认本次会话的请求目标 …"与"目标无误，确认本次会话"。 |
| [04-session-confirmed.png](premerge-quality-screens/04-session-confirmed.png) | 确认后，编辑页顶部"接入进度"三项完成，写明"已就绪：房间成员可以向此 Provider 发送真实请求（仍受模型审核和运行预算限制）"。 |
| [05-members.png](premerge-quality-screens/05-members.png) | 新建房间"校园跑腿讨论"，添加起草者（Drafter）、审查者（Critic）、综合者（Synthesizer），Provider 均为"DeepSeek 直连"，Model 自动带出 deepseek-flash。 |
| [06-pause-pressed.png](premerge-quality-screens/06-pause-pressed.png) | 第一位成员还在输出时点"暂停"：页头"正在暂停"。暂停 / 下一步 / 继续为一组；"停止"在分隔线下单独一行、红色描边，下附"暂停：等当前回合说完再停下，可以继续。停止：立即结束本次运行。" |
| [07-stop-confirm.png](premerge-quality-screens/07-stop-confirm.png) | 继续后审查者输出中点"停止"：就地出现确认，说明部分文字会保留、请求已发出可能已计费、无法确认用量时按预留上限计入；运行仍是"运行中"。 |
| [08-stopped.png](premerge-quality-screens/08-stopped.png) | 先点"不停止"运行继续；再"停止 → 确认停止"：页头"已停止"，审查者的部分文字保留并标"已中止"，费用按未知（预留上限）计入、不记 0；"重试当前回合""续写部分回复"下方提示"重试和续写会重新发送请求，可能再次计费。" |

探针另外核对了真实生产构建发给夹具的请求体：审查者那次请求只有一条 user 消息（没有 assistant），其中包含 `【成员「起草者」· Drafter】\n> DeepSeek 夹具回复 1` 和"现在由你（成员「审查者」· Critic）发言"。下拉框（Provider 类型、成员 Provider）是系统原生菜单，脚本以"聚焦 + change 事件"选择，其余均为真实输入事件。

## 实操中发现并修复的问题

1. Key 保存后同时出现"输入框暂不可用"和"最后一步"两个提示，不知道先做哪个 → 只保留"最后一步"；会话已确认后再要替换 Key，提示改为"已保存的 Key 正在使用。要替换它，请先核对…"。
2. "新增模型 ID"下的示例与占位符重复 → 去掉重复的一行。
3. 停止后"暂停/停止"说明仍挂在不可用的按钮下；紧随其后的"重试当前回合"没有计费提醒（实测中的未知费用正是停止后重试产生的）→ 说明只在停止可用时显示；重试/续写下方提示可能再次计费。

## 执行的命令

```bash
git branch -m codex/r13a-premerge-quality
pnpm install --frozen-lockfile --prefer-offline
pnpm test --reporter=dot            # 基线：120 文件 / 1820 测试
pnpm run typecheck
pnpm test --reporter=dot            # 126 文件 / 1883 测试
pnpm run build
./node_modules/.bin/electron tests/probes/r10-r11-electron.cjs
./node_modules/.bin/electron tests/probes/r12-electron.cjs
./node_modules/.bin/electron tests/probes/r12-electron.cjs --restart <临时目录>/r12-manifest.json
./node_modules/.bin/electron tests/probes/r13a-electron.cjs
./node_modules/.bin/electron tests/probes/r13a-electron.cjs --restart <临时目录>/r13a-manifest.json
./node_modules/.bin/electron tests/probes/premerge-quality-acceptance.cjs
./node_modules/.bin/electron tests/probes/r13a-acceptance.cjs
./node_modules/.bin/electron tests/probes/r12-acceptance.cjs
```

## 未验证

- 真实 DeepSeek 复测：成员是否不再照抄、重新生成是否采用主持人修改后的内容、实际账单（待总控与用户一起做）。
- R07/R08、R09、联合 UI 探针（`r07r08-ui.cjs`、`r09-ui.cjs`、`joint-ui.cjs`）只同步改了"停止 → 确认停止"，本轮没有运行。
- 当前没有 lint 和 E2E 命令；跨平台打包未做。
