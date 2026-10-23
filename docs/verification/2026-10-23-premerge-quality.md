# 合并前质量修复：验收记录（2026-10-23）

分支 `codex/r13a-premerge-quality`，基线 `codex/r13a-real-model-enable`（`b3e3324`，含 R10–R12 与 R13A）。所有检查都在本机执行，**没有发出任何真实 DeepSeek 请求**，也没有读取真实用户目录 `~/Library/Application Support/ai-roundtable`、`…/ai-roundtable-trial` 或真实 Key：测试用假 Key，探针把 `https://api.deepseek.com` 的传输重定向到本机回环夹具，其他出站全部拦截并断言为零。决策见 [DECISIONS](../DECISIONS.md) D095–D103，契约见 [CONTRACTS](../CONTRACTS.md) 同名一节，发给模型的消息对比见 [premerge-quality-context-comparison.md](premerge-quality-context-comparison.md)。

## 三层验收

| 层 | 内容 | 结果 |
| --- | --- | --- |
| 自动化测试 | `pnpm run typecheck`；`pnpm test`（Electron 38.8.6 自带 Node，ABI 139）；`pnpm run build` | 通过：typecheck exit 0；126 个文件 / 1903 个测试全部通过（基线 120 / 1820）；build exit 0 |
| 隔离生产探针 | `r01-electron.cjs`（默认、`--joint-ui`、`--r03-recovery`）；`r07r08-electron.cjs`、`r09-electron.cjs`、`r12-electron.cjs`、`r13a-electron.cjs` 各自首次 + `--restart`；`r10-r11-electron.cjs`（无重启模式） | 全部通过（D102/D103 之后的最终构建）。R01 三种模式 PASS；R07/R08 首次与重启各 18 项 Bridge 断言 + UI 流程；R09 首次 64 项 / 12 次夹具请求、重启 5 项 / **0 次请求**；R10/R11 53 项 / 26 次请求；R12 首次 22 项 / 4 次请求、重启 14 项 / **0 次请求**；R13A 首次 13 项 / 4 次请求（`max_tokens` 4096、预留 = 输入上界×2 + 4096×8）、重启 12 项 / **0 次请求** |
| 真实界面实操 | `premerge-quality-acceptance.cjs` 首次 + `--restart`：真实鼠标/键盘事件（DevTools Input 域），中文经输入法组合输入，18 张截图 | 通过：首次 56 项检查、9 次夹具请求；重启阶段 11 项检查、0 次请求；无控制台错误、无网络外联 |
| 回归实操探针 | `r13a-acceptance.cjs`；`r12-acceptance.cjs` | 最终构建上 R13A 连续 2 次通过（21 项、3 次夹具请求，`max_tokens` 4096）；R12 连续 3 次通过（25 项；原"上限 3 演示失败"路径改为演示截断与续写）。此前 R12 的输入法与停止两步改为等待明确状态后已连续 5 次通过。最终轮里曾有 R12/R13A 因整体超时失败：原因是探针窗口在后台被 Chromium 节流（单次耗时从约 20 秒拉长到 8 分钟以上），三个实操探针都加了 `setBackgroundThrottling(false)` 后恢复到每次约 20 秒。重新生成的 R12/R13A 截图已还原 |
| 旧探针（已修复） | `r01-electron.cjs`、`r07r08-electron.cjs`、`r09-electron.cjs` | 修复前在基线 `b3e3324` 上同样失败（R01/R07R08 卡在 Bridge 只认四组接口；R09 卡在停止阶段"页面文字 = 全部消息"；R01 `--joint-ui` 同 R09；R01 `--r03-recovery` 在基线上也先卡在 Bridge）。现已按 R12/R13A 行为更新，结果见"隔离生产探针"一行 |
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
| [12-output-limit.png](premerge-quality-screens/12-output-limit.png) | 开始前点输入区的"更多设置"：在控制行上方展开"单次输出上限（token）"（默认 4096，这里改为 2048）并说明它决定每次请求的预留费用、实际按用量结算、写到上限会保留并可续写、不能超过模型允许的最大值（DeepSeek Flash 为 32768）；脚本核对展开前后"开始协作"位置不变。平时收起。 |
| [13-truncated.png](premerge-quality-screens/13-truncated.png) | DeepSeek 夹具让起草者的回复以 `finish_reason=length` 结束：这条回复保留并标注"已达单次输出上限，内容可能不完整。"，下方有"续写"；运行没有失败，审查者和综合者照常发言，页头"已完成"。脚本核对：三次请求都是 `max_tokens` 2048，都按用量结算；审查者收到的上下文里这条发言带"（此发言因单次输出上限被截断，后面的内容没有写完，可能不完整。）"。 |
| [14-continued.png](premerge-quality-screens/14-continued.png) | 运行结束后点"续写"：发出新请求（重放原输入，加上原回复和继续写的请求，单独预留和结算），生成"续写 · 当前有效 · 版本 2/2"，内容从原文字接着写；原版本保留为版本 1，后面的发言标为"受影响"。 |
| [15-purged-member.png](premerge-quality-screens/15-purged-member.png) | 重启阶段：先把一串合成的 `sk-` 假值直接写进数据库三处模型 ID（Provider 默认模型、自定义模型、审查者的 Model），模拟旧版本留下的数据，再启动。启动时三处全部清除，日志只有"已清除 3 处疑似 API Key 的模型 ID"；数据库文件（含 WAL/SHM）里再也找不到这串明文（启动前能找到）。"房间与成员"里审查者显示"Model 未配置：请编辑成员，填写模型 ID 后才能参与运行"，右侧"未选择模型"，其他成员不受影响。 |
| [16-purged-member-fixed.png](premerge-quality-screens/16-purged-member-fixed.png) | 点"编辑 审查者"，在 Model 栏重新填 deepseek-flash 并保存：提示消失，审查者恢复正常。 |
| [17-purged-provider.png](premerge-quality-screens/17-purged-provider.png) | "模型设置"里 DeepSeek 直连的默认模型 ID 已清空（只显示示例），自定义模型只剩 deepseek-flash，疑似 Key 的条目已删除；页面上没有任何密钥文本，也不再需要"已隐藏"的提示。 |
| [18-provider-name.png](premerge-quality-screens/18-provider-name.png) | 重启后打开上一次运行（成员快照冻结的是 Provider ID）：身份行显示"Drafter · Provider：DeepSeek 直连 · Model：deepseek-flash"，不再显示 UUID；脚本核对讨论页没有任何 UUID。找不到 Provider 时显示"Provider 已删除"等文字（单元测试覆盖）。 |

探针另外核对了真实生产构建发给夹具的请求体：审查者那次请求只有一条 user 消息（没有 assistant），其中包含 `【成员「起草者」· Drafter】\n> DeepSeek 夹具回复 1` 和"现在由你（成员「审查者」· Critic）发言"。下拉框（Provider 类型、成员 Provider）是系统原生菜单，脚本以"聚焦 + change 事件"选择，其余均为真实输入事件。

## 实操中发现并修复的问题

1. Key 保存后同时出现"输入框暂不可用"和"最后一步"两个提示，不知道先做哪个 → 只保留"最后一步"；会话已确认后再要替换 Key，提示改为"已保存的 Key 正在使用。要替换它，请先核对…"。
2. "新增模型 ID"下的示例与占位符重复 → 去掉重复的一行。
3. 停止后紧随其后的"重试当前回合"没有计费提醒（实测中的未知费用正是停止后重试产生的）→ 重试/续写下方提示可能再次计费。
4. （总控更正问题 4 的根因后重做）输入区原本不固定在窗口底部，流式输出变长会把输入区和其中的按钮往下推——即使按钮原地变成"暂停"，鼠标不动也会落空 → 输入区固定在窗口底部，控制条是最后一行，确认和提示都出现在它上方。
5. （总控审查后补齐）设置页"分级检查与测试"里旧的"请先勾选'我已核对请求目标'"与 Key 输入框旁的说明重复 → 删除旧句，核对目标只在一处说明。
6. （总控审查后补齐）成员身份行显示 Provider 的 UUID → 显示名称（D101）。
7. （真实复测后修复 D102/D103）"更多设置"最初做成控制行里的折叠项，展开后整行换行，"开始协作"被挤到别处，运行后"暂停"就不在原位了 → 面板改为在控制行上方展开，控制行始终一行，脚本核对展开前后开始按钮位置不变。

## 执行的命令

```bash
git branch -m codex/r13a-premerge-quality
pnpm install --frozen-lockfile --prefer-offline
pnpm test --reporter=dot            # 基线：120 文件 / 1820 测试
pnpm run typecheck
pnpm test --reporter=dot            # 126 文件 / 1903 测试
pnpm run build
./node_modules/.bin/electron tests/probes/r01-electron.cjs
./node_modules/.bin/electron tests/probes/r01-electron.cjs --joint-ui
./node_modules/.bin/electron tests/probes/r01-electron.cjs --r03-recovery
./node_modules/.bin/electron tests/probes/r07r08-electron.cjs        # 及 --restart <临时目录>/r78-manifest.json
./node_modules/.bin/electron tests/probes/r09-electron.cjs           # 及 --restart <临时目录>/r09-manifest.json
./node_modules/.bin/electron tests/probes/r10-r11-electron.cjs
./node_modules/.bin/electron tests/probes/r12-electron.cjs           # 及 --restart <临时目录>/r12-manifest.json
./node_modules/.bin/electron tests/probes/r13a-electron.cjs          # 及 --restart <临时目录>/r13a-manifest.json
./node_modules/.bin/electron tests/probes/premerge-quality-acceptance.cjs   # 及 --restart <临时目录>/premerge-manifest.json
./node_modules/.bin/electron tests/probes/r13a-acceptance.cjs
./node_modules/.bin/electron tests/probes/r12-acceptance.cjs         # 连续多次（见上表）
```

## 未验证

- 真实 DeepSeek 复测：讨论质量已由总控复测确认改善；D102/D103（截断后继续、续写、默认 4096）的真实复测待总控与用户一起做。
- 启动清除不处理迁移备份（`backups/backup-*.sqlite3`，只在升级 migration 时生成）；若某个备份生成时已含疑似 Key 的模型 ID，它仍留在备份里，是否删除需用户决定（D100）。
- 当前没有 lint 和 E2E 命令；跨平台打包未做。
