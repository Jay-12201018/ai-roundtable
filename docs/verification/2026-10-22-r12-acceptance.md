# R12 实操验收（2026-10-22）

真实构建（`pnpm run build` 产出的 `out/`）在隔离临时 profile（mock keychain、假 safeStorage、Node 与 Chromium 网络全部阻断）中运行，只用 Mock Provider，未调用真实 API。
操作由 `tests/probes/r12-acceptance.cjs` 通过 Chrome DevTools Input 协议发送真实的鼠标点击和键盘事件；中文输入使用输入法组合（`Input.imeSetComposition` 再上屏），组合中的回车按真实输入法的键码 229 发送。
房间只用 `room.createDemo` 准备（房间管理属于 R07）；R12 的所有路径都通过界面操作完成。主进程中的检查读取隔离 profile 内的 SQLite，核对实际请求输入。

复跑命令：`pnpm run build`，然后 `./node_modules/.bin/electron tests/probes/r12-acceptance.cjs`（截图会覆盖写入本目录的 `r12-screens/`）。
本次结果：PASS，22 项检查，14 张截图；网络尝试 0 次，控制台错误 0 条。

## 截图

| 截图 | 展示内容 |
| --- | --- |
| [01-override-queued.png](r12-screens/01-override-queued.png) | 起草者生成过程中点名"综合者"（随后暂停）：起草者的回合正常完成未被打断；右侧"下一位发言"显示"综合者（主持人点名，排在下一回合…）"，页头状态显示"已暂停 · 下一位：综合者（主持人点名）"，"点名 综合者"按钮为选中态，可"取消点名"。 |
| [02-ime-composing.png](r12-screens/02-ime-composing.png) | 主持人插话框处于中文输入法组合状态（拼音 zhuchiren 未上屏）时按下回车：只确认输入、没有发送，时间线没有新增主持人消息。 |
| [03-interjection-sent.png](r12-screens/03-interjection-sent.png) | 回车发送后，插话以"主持人 · 主持人插话"出现在公共时间线（保留两行原文），输入框清空，并提示"插话已加入公共历史，从下一回合起可见"。 |
| [04-instruction-active.png](r12-screens/04-instruction-active.png) | 新增持续指令后显示为"生效中 · 第 1 版 · 仅影响之后开始的请求"，并提供"修改""清除"。 |
| [05-instruction-revised.png](r12-screens/05-instruction-revised.png) | 修改持续指令后，内容更新为新文本，状态变为"第 2 版"（旧版本保留在主持人记录中）。 |
| [06-override-spoke.png](r12-screens/06-override-spoke.png) | 点"下一步"后，被点名的"综合者"发言，消息带"主持人点名"标记；"下一位"恢复为按计划的"审查者"。 |
| [07-instruction-cleared.png](r12-screens/07-instruction-cleared.png) | 清除后显示"没有生效中的持续指令"和"已清除 1 条指令；历史版本保留在主持人记录中"。 |
| [08-edited-affected.png](r12-screens/08-edited-affected.png) | 修改第一条已完成消息：显示新内容、"主持人修改 · 当前有效"和"版本 2/2"；后面两条 Agent 回复出现"受影响"说明（它们基于旧版本生成）。 |
| [09-regenerated.png](r12-screens/09-regenerated.png) | 对"综合者"的回复点"重新生成"：生成新的版本 2/2（重新生成），依据修订后的开场；第一条修改后的版本仍保留"主持人修改"标记。 |
| [10-old-version.png](r12-screens/10-old-version.png) | 点"‹"查看"综合者"的旧版本：标为"原始 · 未生效的历史版本"，原文完整保留，并提供"设为当前版本"。 |
| [11-failed.png](r12-screens/11-failed.png) | 单次输出上限设为 3 后开始：首个回合因输出不完整失败，页头"运行失败"，消息标为"生成失败 · 原始"并保留已输出的部分文字，失败原因"模型未完整完成响应，部分输出已保留。"直接显示在该消息下方；右侧出现"重试当前回合""续写部分回复"。 |
| [12-retry-failed-again.png](r12-screens/12-retry-failed-again.png) | 手动"重试当前回合"：生成第 2 个版本，标为"生成失败 · 重试 · 当前版本（未完成）"，仍因同一输出上限失败；"‹ 版本 2/2"可切换查看两次失败的部分输出，均未被覆盖。 |
| [13-stopped-partial.png](r12-screens/13-stopped-partial.png) | 生成中点"停止"：状态"已停止"，已输出的部分文字保留并标为"已中止"。 |
| [14-retry-succeeded.png](r12-screens/14-retry-succeeded.png) | "重试当前回合"后新请求成功并继续完成运行；第一条显示"重试 · 当前有效 · 版本 2/2"，被停止的部分输出作为版本 1 保留。 |

## 检查项

- Override queued while the first Turn was still streaming
- The streaming Turn finished normally; the named member has not started yet
- The header status names the next speaker and that the host chose them
- Enter during IME composition did not send the interjection
- Shift+Enter kept a line break and the IME text intact: "请先评估成本风险\n再列出三个最关键的问题"
- Clicking 修改 moves keyboard focus into the instruction editor
- Saving an unchanged instruction is not offered
- The named member (综合者) spoke next as a host-directed Turn
- The request after the revision used only the revised instruction
- The interjection reached the next request but not the one already started
- A completed Run explains why interjection is unavailable instead of showing a dead input
- Order: 起草者 → 被点名的综合者 → 按计划的审查者
- The request after clearing carried no standing instruction
- Clicking 修改 moves keyboard focus into the message editor
- Regeneration added a version without changing the completed Run
- Regeneration used the revised opening and the earlier interjection, but not the later 审查者 message
- The first Turn failed (output limit reached)
- No automatic retry happened after the failure
- The failed message keeps its partial text and is labelled as failed
- Retry used a new requestId
- The stopped attempt stays as version 1; the retry is the effective version 2
- Partial text of the stopped attempt kept as aborted

## 实操中发现并已修复的问题

- 点名用的下拉框依赖原生弹层，用起来别扭，改为每位成员一个“点名 某某”按钮，已点名的按钮为选中态。
- 点“修改”后编辑框没有自动获得焦点，键盘输入会落到页面上；现在消息编辑框和持续指令编辑框都会自动获得焦点。
- 内容没有变化也能“保存修改/保存为新版本”，会产生无意义的新修订；现在内容不变时按钮不可用。
- 已完成的运行仍显示一个不可用的插话框；改为说明“运行已完成，不能再插话；仍可修改消息或重新生成某条回复”。
- 失败的当前版本显示“当前有效”，容易误解；改为“当前版本（未完成）”。
- “受影响”只说条数；现在写出具体是哪位成员（或主持人）的发言，并提示可点“重新生成”。
- 暂停时“当前回合结束后发言”的说法不准确；改为“排在下一回合，不打断正在进行的发言”，页头状态也显示“下一位：某某（主持人点名）”。
- 失败、同步等运行提示原先排在输入框下方，离失败的消息较远；现在移到时间线消息之后、输入框之前。

## 未覆盖

- 真实模型实测：未验证（按总控安排，合并前由总控和用户一起完成）。
- 只在 macOS arm64、1440×900 窗口验证；窄窗口布局属于 R16。
