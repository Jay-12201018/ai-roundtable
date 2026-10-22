# R13A 启用真实模型（DeepSeek）与运行预算：验收记录（2026-10-22）

分支 `codex/r13a-real-model-enable`，基线 R12 `15e2e30`。所有检查均在本机执行，**没有发出任何真实 DeepSeek 请求**：测试和探针使用假 Key `r13a-fake-deepseek-key`，`https://api.deepseek.com` 的传输被重定向到本机回环夹具（模拟 SSE 与 usage），其他出站网络全部拦截并断言为零。决策见 [DECISIONS](../DECISIONS.md) D089–D094，契约见 [CONTRACTS](../CONTRACTS.md) R13A 一节。

## 三层验收

| 层 | 内容 | 结果 |
| --- | --- | --- |
| 自动化测试 | `pnpm run typecheck`；`pnpm test`（Electron 38.8.6 自带 Node，ABI 139）；`pnpm run build` | 通过：typecheck exit 0；120 个文件 / 1820 个测试全部通过（基线 114 / 1765）；build exit 0 |
| 隔离生产探针 | `tests/probes/r13a-electron.cjs` 首次运行 + `--restart`；回归 `tests/probes/r12-electron.cjs` | 通过：首次 13 项检查、4 次夹具请求；重启 12 项检查、**0 次请求**；R12 探针通过 |
| 真实界面实操 | `tests/probes/r13a-acceptance.cjs`：真实鼠标/键盘事件（DevTools Input 域），中文经输入法组合输入，7 张截图 | 通过：21 项检查、3 次夹具请求 |
| 真实模型实测 | 用户自己的 DeepSeek Key 在 `pnpm trial` 中实测 | **未验证，待总控和用户一起做** |

## 隔离生产探针

真实 DeepSeek 策略、报价、预留、结算全部是生产代码；探针只替换 `createTransport` 的目标地址，并对 safeStorage、userData、sessionData、logs 做隔离（临时目录，断言不是 `~/Library/Application Support/ai-roundtable`）。

首次运行检查：

- 仅暴露受限 typed bridge；Key 不出现在公开配置和结果文件中。
- 默认运行预算 ¥1。
- 3 次请求均为 `deepseek-flash`、`max_tokens=1024`、`thinking: {type: disabled}`，携带已保存的 Key。
- 每次请求发送前预留"输入上界×2 + 1024×8" micro-CNY，按服务商 usage（输入 300 / 输出 6）结算为 648 micro-CNY；运行累计 1944，剩余 998056。
- 界面显示每条消息的用量与花费以及运行合计。
- 预算 1000 micro-CNY（¥0.001）的运行：0 次请求、不建 Turn，记录"所需/剩余"，界面显示中文拒绝原因。
- 第三个运行请求进行中时：账本为 reserved，预算栏显示"进行中预留"；随后进程以 `app.exit(0)` 直接退出（模拟崩溃，连接保持打开）。

`--restart` 检查：

- 重启后没有任何请求（不自动重试、恢复或重放），查看中断的运行也不发请求。
- 已结算的用量和花费、预算拦截记录都保留。
- 崩溃的运行为 interrupted，不会继续调度；在途请求记为 unknown，按全额预留计费，不是 0；它计入运行预算（reserved 0，unknown = 原预留）。
- safeStorage 加密的 Key 在重启后仍为"已配置"；预算栏显示"含未知费用按上限计"。

## 实操截图

| 截图 | 说明 |
| --- | --- |
| [01-provider-saved.png](r13a-screens/01-provider-saved.png) | 在"模型设置"新增 Provider：名称"DeepSeek 直连"（中文由输入法组合输入），类型 OpenAI-Compatible，Base URL https://api.deepseek.com，勾选"我已核对请求目标"，默认模型与自定义模型均为 deepseek-flash，点"保存配置"后进入"编辑 Provider"。 |
| [02-key-saved.png](r13a-screens/02-key-saved.png) | 勾选"我已核对请求目标"后 API Key 输入框可用；键入假 Key 并按 Enter 保存（脚本已核对页面显示"已配置；系统安全存储。"且 Key 不回显，该文字位于截图下方）。核对勾选随之复位，请求目标区提示"本次会话尚未确认请求目标……保存或更换 Key 后需重新确认"。 |
| [03-target-confirmed.png](r13a-screens/03-target-confirmed.png) | 再次勾选核对并点"确认本次会话目标"：显示"本次会话请求目标已确认；更换 Key 或目标后需重新确认。"，提醒消失。 |
| [04-members.png](r13a-screens/04-members.png) | 新建房间"校园跑腿讨论"，添加"起草者""审查者"两个成员，Provider 均选"DeepSeek 直连"（选中后 Model 自动带出默认模型 deepseek-flash）。 |
| [05-run-usage.png](r13a-screens/05-run-usage.png) | 输入任务（输入法）并把"本次预算（元）"改为 0.05 后点"开始协作"：三条 DeepSeek 回复下方各显示"输入 300 / 输出 6 tokens · 花费 ¥0.000648"；预算栏显示"预算 ¥0.0500 · 累计花费 ¥0.0019 · 剩余额度 ¥0.0481"。 |
| [06-budget-invalid.png](r13a-screens/06-budget-invalid.png) | 预算框输入"abc"：下方提示"请输入 0.000001 到 1000 之间的金额，最多 6 位小数。"，"开始协作"不可用。 |
| [07-budget-blocked.png](r13a-screens/07-budget-blocked.png) | 预算改为 0.001 元再开始：发送前拒绝（夹具未收到请求、没有新回合），页头"已因预算停止"，提示"运行预算不足：下一次请求最高可能花费 ¥0.0102，剩余额度 ¥0.0010，已拒绝发送。"，预算栏标出"已因预算不足停止发送"。 |

下拉框（Provider 类型、成员 Provider）弹出的是系统原生菜单，页面输入事件无法操作，脚本以"聚焦 + change 事件"选择，其余全部是真实输入事件。

## 实操中发现并修复的体验问题

1. **保存 Key 后会话确认静默失效**：Key 修订会让之前的"确认本次会话目标"作废，但页面只显示"Key 已保存。"，用户直接去开始协作会失败。现在在请求目标区持续提示"本次会话尚未确认请求目标……保存或更换 Key 后需重新确认"，确认后消失。
2. **启动失败原因不明**：原来一律显示"启动协作失败，请检查当前任务状态。"。现在 forbidden 提示去"模型设置"重新确认会话目标，unsupported 提示模型没有已审核的计数与价格。
3. **预算拦截被显示为"运行失败"**：页头改为"已因预算停止"，并去掉了与拒绝原因矛盾的空状态提示"配置成员后，输入目标并开始协作。"。

三项都有单元测试覆盖（`tests/unit/rendererSettings/r09SessionTarget.test.tsx`、`tests/unit/rendererSubscriptions/rendererCommands.test.ts`）并在实操中复验。

## 执行的命令

```bash
pnpm install --frozen-lockfile --prefer-offline
pnpm test --reporter=dot            # 基线：114 文件 / 1765 测试
pnpm run typecheck
pnpm test --reporter=dot            # 120 文件 / 1820 测试
pnpm run build
./node_modules/.bin/electron tests/probes/r13a-electron.cjs
./node_modules/.bin/electron tests/probes/r13a-electron.cjs --restart <临时目录>/r13a-manifest.json
./node_modules/.bin/electron tests/probes/r13a-acceptance.cjs
./node_modules/.bin/electron tests/probes/r12-electron.cjs
./node_modules/.bin/electron scripts/trial/main.cjs --check
```

`--check` 只解析路径：试用目录 `~/Library/Application Support/ai-roundtable-trial`、正式目录 `…/ai-roundtable`，执行前后试用目录都不存在。

## 未验证

- 真实 DeepSeek 请求、实际账单与本地核算的对照（待总控与用户实测）。
- 在真实用户目录和真实钥匙串下首次启动 `pnpm trial`（本轮刻意没有执行）。
- 经真实本机代理访问 DeepSeek/Claude/Gemini；跨平台打包。
- 当前没有 lint 和 E2E 命令。
