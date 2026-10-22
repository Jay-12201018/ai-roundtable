# 合并前质量修复：验收记录（2026-10-23）

分支 `codex/r13a-premerge-quality`，基线 `codex/r13a-real-model-enable`（`b3e3324`，含 R10–R12 与 R13A）。所有检查都在本机执行，**没有发出任何真实 DeepSeek 请求**，也没有读取真实用户目录 `~/Library/Application Support/ai-roundtable`、`…/ai-roundtable-trial` 或真实 Key：测试用假 Key，探针把 `https://api.deepseek.com` 的传输重定向到本机回环夹具，其他出站全部拦截并断言为零。决策见 [DECISIONS](../DECISIONS.md) D095–D099，契约见 [CONTRACTS](../CONTRACTS.md) 同名一节，发给模型的消息对比见 [premerge-quality-context-comparison.md](premerge-quality-context-comparison.md)。

## 三层验收

| 层 | 内容 | 结果 |
| --- | --- | --- |
| 自动化测试 | `pnpm run typecheck`；`pnpm test`（Electron 38.8.6 自带 Node，ABI 139）；`pnpm run build` | 通过：typecheck exit 0；126 个文件 / 1885 个测试全部通过（基线 120 / 1820）；build exit 0 |
| 隔离生产探针 | `r10-r11-electron.cjs`；`r12-electron.cjs` 首次 + `--restart`；`r13a-electron.cjs` 首次 + `--restart` | 通过：R10/R11 53 项断言、26 次夹具请求（该探针没有重启模式）；R12 首次 22 项 / 4 次请求，重启 14 项 / **0 次请求**；R13A 首次 13 项 / 4 次请求，重启 12 项 / **0 次请求** |
| 真实界面实操 | `premerge-quality-acceptance.cjs`：真实鼠标/键盘事件（DevTools Input 域），中文经输入法组合输入，11 张截图 | 通过：44 项检查、4 次夹具请求，无控制台错误、无网络外联 |
| 回归实操探针 | `r13a-acceptance.cjs`；`r12-acceptance.cjs`（已改为"停止 → 确认停止"）；`r10-r11-electron.cjs` 内含的 R10/R11 UI 流程 | 最终一轮全部通过（R13A 21 项、R12 22 项）。R12 在本分支共运行 5 次，1 次在输入法组合步骤失败（拼音未被替换为汉字；该步骤固定等待 120ms，插话代码本分支未改），判定为探针时序不稳定，列为遗留问题。重新生成的 R12/R13A 截图已还原，不覆盖原有证据 |
| 旧探针（既有失败） | `r01-electron.cjs`、`r07r08-electron.cjs`、`r09-electron.cjs` | **未通过，且与本分支无关**：把基线 `b3e3324` 导出到临时目录单独构建后运行，三者以相同原因失败——R01、R07/R08 断言 Bridge 只有 room/rooms/run/settings 四组（R12 新增了 host），R09 在停止阶段比对"页面文字 = 快照全部消息"（R12 起页面每个槽只显示有效版本）。本分支只同步了 R09 中发给模型的消息断言（D095）和 R07/R08 中控制按钮的位置（D098） |
| 真实模型实测 | 用户自己的 DeepSeek Key 复测讨论质量与账单 | **未验证，待总控和用户一起做** |

## 实操截图（`premerge-quality-screens/`）

| 截图 | 说明 |
| --- | --- |
| [01-model-id-key-blocked.png](premerge-quality-screens/01-model-id-key-blocked.png) | 在"默认模型 ID"里误填一串 `sk-` 开头的合成假值：输入框立即标红，下方提示"这看起来是 API Key，不是模型 ID。请先删掉它；保存配置后，在下方出现的"API Key"输入框里填写。"；点"保存配置"被拒绝，没有创建 Provider。未输入时下方显示示例"例如 deepseek-flash"。 |
| [02-key-blocked-reason.png](premerge-quality-screens/02-key-blocked-reason.png) | 改填 deepseek-flash 并保存后，"API Key"输入框不可用，紧挨着说明原因"输入框暂不可用：填写 Key 之前，请先核对 Key 将发往的请求目标：https://api.deepseek.com/"，旁边一键操作"目标无误，启用输入框"。 |
| [03-key-saved-last-step.png](premerge-quality-screens/03-key-saved-last-step.png) | 一键后输入框可用并获得焦点（"我已核对请求目标"同时勾选）；键入假 Key 按 Enter 保存，显示"已配置；系统安全存储。"，Key 不回显。Key 下方只有一个下一步："最后一步：确认本次会话的请求目标 …"与"目标无误，确认本次会话"。 |
| [04-session-confirmed.png](premerge-quality-screens/04-session-confirmed.png) | 确认后，编辑页顶部"接入进度"三项完成，写明"已就绪：房间成员可以向此 Provider 发送真实请求（仍受模型审核和运行预算限制）"。 |
| [05-members.png](premerge-quality-screens/05-members.png) | 新建房间"校园跑腿讨论"，添加起草者（Drafter）、审查者（Critic）、综合者（Synthesizer），Provider 均为"DeepSeek 直连"，Model 自动带出 deepseek-flash。 |
| [06-pause-in-place.png](premerge-quality-screens/06-pause-in-place.png) | 点"开始协作"后鼠标不动，第一位成员输出时在同一坐标再点一下：那里已原地变成"暂停"，页头"正在暂停"，当前回合继续说完。控制条依次是 暂停、下一步、停止，停止在末尾、隔开、红色描边；右侧主持人面板不再有第二套运行按钮。输入区固定在窗口底部，输出变长也不会把按钮推走。 |
| [07-stop-confirm.png](premerge-quality-screens/07-stop-confirm.png) | "继续"同样在原位置；审查者输出中点"停止"：控制条上方出现轻量确认（部分文字保留、请求已发出可能已计费、无法确认用量时按预留上限计入），焦点在"不停止"；"暂停"仍在原处可用，运行仍是"运行中"。 |
| [08-stopped.png](premerge-quality-screens/08-stopped.png) | 先"不停止"，再"停止 → 确认停止"：页头"已停止"，审查者的部分文字保留并标"已中止"，费用按未知（预留上限）计入、不记 0；输入区原位置变回"开始协作"；右侧重试/续写下方提示"会重新发送请求，可能再次计费"。 |
| [09-step-option.png](premerge-quality-screens/09-step-option.png) | 开始前在输入区勾选"每个回合结束后暂停，方便插话或点名"（默认不勾选，勾选后记住），任务用输入法改为"讨论跑腿平台的定价"。 |
| [10-step-paused-interject.png](premerge-quality-screens/10-step-paused-interject.png) | 开始后起草者说完即自动暂停（页头"已暂停"），没有和模型抢时间；在右侧"插话"用输入法输入"请重点比较按距离计价和固定价"并发送，插话出现在时间线上；输入区提示下一步可以做什么。 |
| [11-step-next.png](premerge-quality-screens/11-step-next.png) | 点"下一步"：只让审查者发言一次，说完再次自动暂停；脚本核对了它收到的请求体中包含刚才的主持人插话（`【主持人插话】` + 引用）。 |

探针另外核对了真实生产构建发给夹具的请求体：审查者那次请求只有一条 user 消息（没有 assistant），其中包含 `【成员「起草者」· Drafter】\n> DeepSeek 夹具回复 1` 和"现在由你（成员「审查者」· Critic）发言"。下拉框（Provider 类型、成员 Provider）是系统原生菜单，脚本以"聚焦 + change 事件"选择，其余均为真实输入事件。

## 实操中发现并修复的问题

1. Key 保存后同时出现"输入框暂不可用"和"最后一步"两个提示，不知道先做哪个 → 只保留"最后一步"；会话已确认后再要替换 Key，提示改为"已保存的 Key 正在使用。要替换它，请先核对…"。
2. "新增模型 ID"下的示例与占位符重复 → 去掉重复的一行。
3. 停止后紧随其后的"重试当前回合"没有计费提醒（实测中的未知费用正是停止后重试产生的）→ 重试/续写下方提示可能再次计费。
4. （总控更正问题 4 的根因后重做）输入区原本不固定在窗口底部，流式输出变长会把输入区和其中的按钮往下推——即使按钮原地变成"暂停"，鼠标不动也会落空 → 输入区固定在窗口底部，控制条是最后一行，确认和提示都出现在它上方。

## 执行的命令

```bash
git branch -m codex/r13a-premerge-quality
pnpm install --frozen-lockfile --prefer-offline
pnpm test --reporter=dot            # 基线：120 文件 / 1820 测试
pnpm run typecheck
pnpm test --reporter=dot            # 126 文件 / 1885 测试
pnpm run build
./node_modules/.bin/electron tests/probes/r10-r11-electron.cjs
./node_modules/.bin/electron tests/probes/r12-electron.cjs
./node_modules/.bin/electron tests/probes/r12-electron.cjs --restart <临时目录>/r12-manifest.json
./node_modules/.bin/electron tests/probes/r13a-electron.cjs
./node_modules/.bin/electron tests/probes/r13a-electron.cjs --restart <临时目录>/r13a-manifest.json
./node_modules/.bin/electron tests/probes/premerge-quality-acceptance.cjs
./node_modules/.bin/electron tests/probes/r13a-acceptance.cjs
./node_modules/.bin/electron tests/probes/r12-acceptance.cjs
./node_modules/.bin/electron tests/probes/r01-electron.cjs     # 本分支与基线均失败（既有）
./node_modules/.bin/electron tests/probes/r07r08-electron.cjs  # 同上
./node_modules/.bin/electron tests/probes/r09-electron.cjs     # 同上
```

## 未验证

- 真实 DeepSeek 复测：成员是否不再照抄、重新生成是否采用主持人修改后的内容、实际账单（待总控与用户一起做）。
- R01、R07/R08、R09 探针自 R12 起即失败（见上表），本分支未修复。
- 当前没有 lint 和 E2E 命令；跨平台打包未做。
