# 探针维护：模拟中文输入法的步骤偶发超时（2026-10-29）

分支 `codex/maint-ime-probes`，基于 main `3351019`。只改 `tests/probes/`，不改业务源码、契约、Schema 或 migration。

## 现象

2026-10-29 `r16-batch2-acceptance` 首次运行在改房间名一步超时（`Timed out: renamed`）；R14 子会话也遇到过 `r16-acceptance` 在输入法步骤偶发失败。重跑都能通过。

那次失败的临时 profile 还在（`$TMPDIR/roundtable-r16-batch2-aRLGAQ`），失败时页面上的房间名是 **“xiaoyuan校园跑腿讨论”**：拼音被当成正文提交了，提交的中文又接在后面。

## 复现

| 条件 | 结果 |
|---|---|
| 原样探针，窗口在前台、没有干扰：`r16-batch2-acceptance` 10 轮（每轮首次 + `--restart` + `--restart2`）、`r16-acceptance` 10 次 | 全部通过（30/30、10/10） |
| 原样探针，运行期间焦点不断被别的窗口拿走（`tests/probes/focus-steal.cjs`，每 300 ms 一次）：`r16-batch2-acceptance` 3 次 | **3/3 失败**：2 次 `Timed out: renamed`，房间名“xiaoyuan校园跑腿讨论”（和 10-29 的现场一样）；1 次 `Timed out: control 调整「老周」的顺序`，成员名“laozhou老周” |
| 同上，原版 `r12-acceptance`（它的 `ime()` 原本就是条件等待）3 次 | **3/3 失败**：`Timed out: composition shown: zhuchiren` |

无干扰时不失败，有焦点切换就稳定失败。10-29 那次是在 R14 的 worktree 里运行的，当时可能有别的探针窗口启动，或者有人在用电脑，都会让探针窗口失去焦点。

## 根因：探针环境的问题，不是应用的问题

用注入页面的普通 `<input>` 做对照（不经过 React），组合输入 `xiaoyuan` 之后、提交“校园”之前做不同操作：

| 组合进行中 | 输入框的值 | 事件 |
|---|---|---|
| 什么也不做 | 校园 | `compositionend:校园` |
| 焦点切到另一个窗口，再切回来 | **xiaoyuan校园** | `blur`、`compositionend:xiaoyuan`、`focus` |
| 焦点切到另一个窗口，不切回来 | **xiaoyuan校园** | 同上 |
| 打开 CDP 焦点模拟（`Emulation.setFocusEmulationEnabled`）后切走 | **xiaoyuan校园** | `compositionend:xiaoyuan`（页面不再收到 `blur`，组合照样被结束） |
| 窗口不可聚焦（`setFocusable(false)`）+ 焦点模拟后切走 | 校园 | `compositionend:校园` |

结论：窗口失去 key 状态时，Chromium 会结束正在进行的输入法组合，并把已显示的拼音保留为正文；之后的 `Input.insertText` 只能接在后面插入。这是浏览器层的处理，与页面代码无关：普通 input 上同样发生。应用里也没有在组合期间改焦点、改选区或改值的代码（`RoomDialog` 是普通受控 input；`Modal` 只在挂载时同步聚焦一次）。所以没有要修的应用缺陷，也没有需要补的单元测试。

探针原来的 `ime()` 用固定停顿（120/140 ms），不检查组合是否还开着，焦点一被拿走，拼音就悄悄上屏，直到后面的断言才超时，报错里也看不出是输入法这一步出了问题。

## 改法

1. **新增 `tests/probes/ime-input.cjs`**，作为唯一的输入法实现，`r16-harness.cjs` 和 4 个自带实现的独立探针（`r12-acceptance`、`r13a-acceptance`、`r13b-acceptance`、`premerge-quality-acceptance`）都改用它：
   - `holdFocus(window)`：窗口设为不可聚焦；如果窗口当时已经是 key，就主动让出（`blur()`，此时没有打开的组合）。实测只设不可聚焦、不让出，第一次被抢焦点时仍会打断组合。
   - `emulateFocus(send)`：CDP 焦点模拟，让页面照常表现为聚焦（focus 事件、`:focus-visible`、`document.hasFocus()`）。
   - `ime(pinyin, committed, { enterWhileComposing })`：每一步按输入框自己报告的状态等待，各有名字和 5 秒期限：
     `composition shown`（组合已开始、值 = 选区前文字 + 拼音 + 选区后文字）→ 可选 `composition still open after the IME Enter`（收到 keyCode 229 的回车，组合仍开着、值没变）→ `composition committed`（组合已结束、值 = 前文 + 提交文字 + 后文）。
   - `selectAll()`：Cmd+A 之后等到整段文字都被选中（`select all`）。
2. **`r16-harness.cjs`**：
   - `field()` 点击后等到光标确实在这个输入框里（`focus in <名字>`）。
   - `holdFocus` 放在设置窗口尺寸之后，`emulateFocus` 放在 debugger 连接之后。
3. **独立探针**：删掉各自的固定停顿版 `ime()`、`selectAll()`，`holdFocus` 和 `emulateFocus` 放在原有的 `window size applied` 等待之后，之前的代码与原版完全相同。r12 的路径 2（手动驱动 `zhuchiren` 组合、检查回车不发送）保留它自己的条件等待。
4. **新增 `tests/probes/focus-steal.cjs`**：复现工具。在探针自己的进程里开一个 80×50 的小窗口，按周期拿走焦点再还回来；不改被包装的探针，结束时打印 `FOCUS_STEALS <次数>`。
   用法：`./node_modules/.bin/electron tests/probes/focus-steal.cjs tests/probes/<探针>.cjs [参数]`。

所有原有断言和检查项都保留，没有放宽或删除；新增的等待只会让探针更严格（例如 IME 回车后组合必须仍然开着）。

### 改的过程中查清的另一个问题：窗口高度

最初把 `holdFocus` 放在窗口创建时，r13a、r13b、premerge 改为在 `window size applied`（`innerHeight === 900`）超时（r13a 4 次里 3 次，r13b、premerge 各 1 次）。查明：

- 这台机器的屏幕是 1512×982 点，Dock 常显，可用区域只有 865 点高；macOS 在窗口显示时会把窗口压进可用区域，内容高度变成 833 或 836，任何设置顺序都到不了 900（独立实验，可聚焦、不可聚焦各两种顺序）。
- 原版探针的这个等待之所以能通过，是因为窗口显示**之前**设置尺寸后，会短暂出现 900；轮询碰上这一刻就过了，窗口随后又被压到 836。已提交的截图本来就是 1666/1672 px 高（833/836 点），可以佐证。
- 创建窗口时就设为不可聚焦，会改变窗口显示的时机，于是更容易错过这个瞬时值。改为尺寸等待之后再调用 `holdFocus`，这段代码与原版一致，问题随之消失。中间有一版只把 `holdFocus` 挪到等待之后、`emulateFocus` 仍在等待之前，焦点干扰下 r12 在这里超时 1 次；两者都挪到等待之后的最终版本，见下面的结果。

这个尺寸等待本身的竞态是原有问题，不在本任务范围，没有修改，见“遗留事项”。

## 修复后的结果

### 10 次连跑（窗口在前台；r16-acceptance 和 batch2 的大部分时间里同时在跑全量 `pnpm test`，CPU 有额外负载）

| 探针 | 结果 | 单次用时 |
|---|---|---|
| `r16-acceptance` | 10/10 | 46–47 秒 |
| `r16-batch2-acceptance` 首次 + `--restart` + `--restart2` | 10/10 + 10/10 + 10/10 | 34–35 / 4–5 / 11 秒 |
| `r16-continuity-acceptance` | 10/10 | 18–19 秒 |
| `r14-acceptance` 首次 + `--restart` | 10/10 + 10/10 | 31–32 / 4 秒 |

### 焦点干扰（`focus-steal.cjs`，修复前 batch2 3/3 失败、r12 3/3 失败）

| 探针 | 结果 |
|---|---|
| `r16-batch2-acceptance` 首次 + 两次重启 | 4/4（其中 3 次用入库版本的包装脚本），重启 8/8；另有 3 次用早期版本（创建窗口时就设为不可聚焦）也全部通过 |
| `r16-acceptance` | 2/2；一次运行中焦点被拿走 150 次 |
| `r16-continuity-acceptance` | 4/4 |
| `r14-acceptance` 首次 + 重启 | 3/3 + 3/3 |
| `r12-acceptance` | 4/4 |
| `r13a-acceptance`、`r13b-acceptance`、`premerge-quality-acceptance` | 各 1/1 |

### 其他探针（正常条件，最终版本）

`r12-acceptance` 5/5，`r13a-acceptance`、`r13b-acceptance`、`premerge-quality-acceptance` 各 2/2，`r16-longhistory`（用 harness，但不用输入法）1/1。

## 标准检查（本次实际执行）

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `pnpm run typecheck` | exit 0 |
| 全量测试 | `pnpm test --reporter=dot` | exit 0，138 个文件、2018 项通过（连续 3 次） |
| 构建 | `pnpm run build` | exit 0（连跑前执行；本分支没有改 `src/`） |

全量测试在探针连跑的高负载下另外跑了 37 次，**2 次失败**：一次的日志被后续运行覆盖、没有保留原文；另一次是 `tests/integration/r07r08/rendererSelection.test.tsx` 的 “refreshes member Provider summaries when a settings mutation settles after leaving settings”，`findByText('高级与删除')` 超过默认 1 秒期限。本分支没有改 vitest 覆盖的文件，这是原有的负载敏感问题，见遗留事项。

探针运行后，`docs/verification/*-screens/` 已用 `git checkout` 还原，没有提交新截图。

## 遗留事项（建议总控登记）

1. **独立探针的窗口尺寸等待是竞态**：`r12/r13a/r13b/premerge-quality-acceptance` 的 `window size applied` 要求 `innerHeight === 900`，在可用高度不足 932 点的屏幕上只能碰上显示之前的瞬时值；r16 系列截图的视口也随机是 833 或 836 点高。改成确定的视口（例如请求一个放得下的尺寸，或改为等待实际尺寸并把它写进结果）会改变断言，需要总控决定。
2. **`rendererSelection.test.tsx` 在高负载下偶发超时**：约 1/20（37 次里 2 次，其中 1 次确认是这一项），`findByText` 默认期限 1 秒。
