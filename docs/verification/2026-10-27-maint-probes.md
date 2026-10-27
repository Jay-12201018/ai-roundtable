# 探针维护：R07/R08 生产探针偶发失败、三个过时的只读核对（2026-10-27）

分支 `codex/maint-probes`，基于 main `cf83829`。只改 `tests/probes/`，不改业务源码、契约、Schema 或 migration。

## 1. R07/R08 生产探针偶发失败

### 复现

构建后在本机桌面连续运行 `./node_modules/.bin/electron tests/probes/r07r08-electron.cjs`，首次通过后再跑 `--restart <manifest>`。

| 轮次 | 结果 |
|---|---|
| 基线 1 次 + 10 次（原样探针） | 11 次首次运行里 **4 次失败**：`Run/DOM did not settle: paused`（2 次，Main 显示 Run 已 `completed`、3 个回合，说明“暂停”点得太晚）、`Explicit repeat output absent`（2 次）。另有 1 次通过，但首次用了 101 秒、重启用了 129 秒（正常是 17 秒 / 11 秒） |
| 加诊断后 10 次 | 1 次失败：布局检查第 1 项（800×600 浅色“讨论”），`Layout control unavailable: 设置`；其余 9 次每项布局检查约 1.2 秒 |
| 对照：探针窗口最小化，3 次 | 3/3 失败，`document.visibilityState` 为 `hidden`，走到“暂停”这一步就用了约 117 秒，此时 Mock 已经跑完，“暂停”按钮不存在 |
| 对照：用一个全屏不透明窗口盖住探针窗口（模拟用户在用别的应用），原样探针 3 次 | 3/3 失败，页面 `hidden`，每次约 92 秒，错误与基线相同：`Run/DOM did not settle: paused`（Run 已 `completed`、3 个回合） |

总控描述的“布局第 5 项卡到 240 秒”这次没有原样出现，但它和上面的慢速、失败是同一机制，见下文。

### 根因：探针的问题，不是界面的问题

1. **窗口被遮挡或隐藏时，Chromium 节流渲染进程的定时器**（每步至少 1 秒，时间长了更慢），而 Main 里的 Mock 仍按每个 token 60 ms 输出。探针在页面里用 `setTimeout` 轮询和停顿：
   - 运行阶段，“暂停”“重试当前回合”的点击落在 Run 已经跑完之后，断言失败；
   - 布局阶段，每项检查有十几处固定停顿，被节流后一项要几十秒；渐进的强节流下会一直拖到 240 秒总超时。这就是“卡在第 5 项”的来源：卡住的不是对话框本身，而是那一刻窗口正好被盖住。
   - 原探针没有调用 `setBackgroundThrottling(false)`；后来写的探针（r12/r13a/r13b 验收、r16-harness、premerge 验收）都调用了。
2. **布局检查用固定停顿代替条件等待**：`setSize` 之后马上开始，抽屉打开后只停 80 ms、对话框打开后只停 80 ms、关闭后只停 40 ms。窗口尺寸变化异步到达渲染进程、抽屉有 180 ms 滑入动画，停顿不够时就会报“控件不可用”或“控件在视口外”（诊断轮的第 1 项失败）。
3. 页面脚本整体由一次 `executeJavaScript` 执行，没有单项超时；卡住时只有 240 秒总超时，报错里看不出停在哪一步。

界面本身没有发现问题：窗口在前台时，同样的步骤在 20 次（下面的 10 次首次 + 10 次重启）里全部按时完成；被遮挡时的失败也只是计时问题，用户不可能在被遮挡的窗口里点击。

### 改法（`tests/probes/r07r08-electron.cjs`、`tests/probes/r07r08-ui.cjs`）

- 拿到窗口后立即 `contents.setBackgroundThrottling(false)`，和其他新探针一致。探针检查的是界面，不是 Chromium 的后台调度。
- 每段页面脚本有自己的期限：UI 首次 / 恢复 / 重启阶段各 90 秒，24 项布局检查各 20 秒。超时报错写明是哪一段，并读出页面最后记录的步骤，例如：`Layout 1 (800×600 light 讨论) exceeded 200 ms; last step: Layout 1 (800×600 light 讨论): navigation drawer settled`（把期限临时改成 200 ms 实测得到的报错）。UI 阶段的每个 `wait` 也记录自己的步骤名；它们原本就各有 15 秒期限。
- 布局检查里所有固定停顿改为带名字、带期限（默认 3 秒）的条件等待：
  - 开始前等渲染进程的 `innerWidth` 等于请求宽度，且侧栏形态跟上（≥1024 内嵌、<1024 收进抽屉）；
  - 进入页面后等对应页面出现、抽屉已关；切主题后等 `data-theme` 生效；
  - 抽屉等滑入动画结束再检查可达；关闭后等抽屉消失；
  - 对话框等打开；点“取消”后**新增**断言对话框确实关闭（`Modal did not close on 取消`）；
  - 模型设置等编辑器显示的确实是 “Smoke Real A”（原来只等 100 ms 后取任意一个 Key 输入框）。
- 所有原有断言和检查项保留，报错文字沿用原来的（如 `Layout control unavailable`、`Real modal not opened`、`Control outside viewport`），只是在等待期限后才报。

### 修复后的结果

| 轮次 | 结果 |
|---|---|
| 连续 10 次首次运行，每次通过后接 `--restart` | **10/10 首次通过、10/10 重启通过**；首次约 10 秒、重启约 4 秒。这 10 轮期间同时在跑 `pnpm test` 全量测试，CPU 有额外负载 |
| 全屏窗口遮挡，3 次 | **3/3 通过**，页面保持 `visible` |
| 窗口最小化，3 次 | UI 阶段全部通过（修复前在这里失败）；布局阶段 2 次在 `Layout 1 (800×600 light 讨论): Navigation drawer did not open (3000 ms)` 处明确失败、1 次通过。最小化的窗口不出帧，CSS 动画不推进，检查“抽屉滑入后控件在视口内”没有意义；这里只要求报错立刻、清楚地指出步骤，而不是挂到总超时 |

## 2. 三个过时的只读核对脚本

### 改法

- 新增 `tests/probes/public-context.cjs`：按 `src/main/context/transcript.ts`（D095）重建“其他成员发言”在请求里的确切形态：应用标签行 `【成员「名字」· 角色】`，下一行起是逐行加 `> ` 的原文。成员名和角色取自数据库里该 Run 冻结的 `members_snapshot`，按消息所属 Turn 的 `agent_id` 对应。
- `r01-sqlite.cjs --joint-ui`、`r07r08-sqlite.cjs`、`r09-sqlite.cjs`：
  - 原断言“前一位成员的原文以 `assistant` 角色出现在下一次请求里”改为“前一位成员的原文以带标签的引用块出现在下一次请求的 user 一侧”，第三位成员处仍断言两段引用的先后顺序（按消息序号和位置比较，因为连续的 user 部分会合并成一条）。
  - 另外断言这些原文**没有**以 `assistant` 出现（D095 要防的旧格式），比原断言更严。
  - `r07r08-sqlite.cjs`、`r09-sqlite.cjs` 的迁移版本改为 `[1,…,10]`，与集成测试（如 `migrationV2.test.ts`）一致。
  - 重试 / 续写那一段（续写请求 = 原请求 + 部分回复 `assistant` + 续写提示 `user`）仍符合现行契约，未改。
- R09 首次核对的计数仍是 15 项（3 项 system + 3 项顺序 + 9 项明文 Key），与旧脚本相同。

### 结果

数据库由本分支的 electron 探针现场生成（`$TMPDIR` 为 `/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T`）：

| 命令 | 新脚本 | 旧脚本（`git show HEAD:` 取出，在同一数据库上） |
|---|---|---|
| `electron tests/probes/r01-electron.cjs --joint-ui` → `ELECTRON_RUN_AS_NODE=1 electron tests/probes/r01-sqlite.cjs $TMPDIR/roundtable-r01-electron-frXzmQ/probe-result.json` | exit 0（shutdown 与 joint 两段都 PASS） | exit 1，`assert.ok(b.some(m=>m.role==='assistant'…))` |
| `electron tests/probes/r07r08-electron.cjs`（+ `--restart`）→ `r07r08-sqlite.cjs $TMPDIR/roundtable-r78-production-Z5Swkq/r78-first.json`、`…/r78-restart.json` | 首次、重启都 exit 0，`publicContext:true` | exit 1，迁移版本 deepEqual 失败 |
| `electron tests/probes/r09-electron.cjs`（+ `--restart`）→ `r09-sqlite.cjs $TMPDIR/roundtable-r09-production-crJUxl/r09-first.json`、`…/r09-restart.json` | 首次 exit 0（checks 15）、重启 exit 0（checks 9） | exit 1，迁移版本 deepEqual 失败 |

## 3. 标准检查（本次实际执行）

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm run typecheck` | exit 0 |
| 全量测试 | `pnpm test` | exit 0，136 个文件、2007 项通过 |
| 构建 | `pnpm run build` | exit 0 |
| 受影响探针 | 见上面两节 | R07/R08 10/10 + 10/10；R01 `--joint-ui`、R09 首次/重启通过 |

没有覆盖：没有改界面，所以没有做实操截图；没有真实 Provider；只验证了 macOS arm64。`r01-electron.cjs`、`r09-electron.cjs`、`r10-r11-electron.cjs`、`r12-electron.cjs`、`r13a-electron.cjs` 也没有调用 `setBackgroundThrottling(false)`，窗口被遮挡时可能出现同类慢速或失败，本任务没有改它们（这次各跑 1–2 次都通过）。
