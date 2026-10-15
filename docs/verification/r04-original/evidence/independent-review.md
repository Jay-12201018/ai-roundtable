# R04 独立只读审查

日期：2026-10-15。受检目录：`/Users/zhangwenjie/.codex/worktrees/5419/AI交互`。

审查范围为当前 R04 diff 与其实际调用链：RunService、stateMachine、MockProvider、R04 新增测试，以及只读核对 Shared Provider/Run/Persistence Schema、Database 事务/afterCommit/Attempt/恢复接口、现有 IPC 调用方。采用本地单用户、Main 单 RunService、串行 Provider 请求的实际负载假设。审查者未修改仓库、依赖、公共接口或数据库。

What this change does: 将调度和控制集中到可持久化的 Run/Turn/Attempt 生命周期；显式 retry/continue 创建新的请求与消息，同时保留原 Attempt。软暂停保留全局锁；Stop 和累计超时能结束逻辑 worker，忽略旧请求晚到输出。

## 发现及复查结果

本次最终源码复查未发现剩余阻断问题。审查期间发现的以下问题已由开发负责人修复，并有新增回归：

1. **历史失败 Attempt 阻断成功重试后的 Resume（P1，已修复）**。原 assertSettled 要求所有历史 Attempt 都 completed；step Run 重试成功后仍保留原 failed Attempt，导致后续 Resume 永久拒绝。当前 `RunService.ts:276` 只检查每个逻辑 Turn 及其最新 Attempt；`engine.test.ts` 覆盖失败、重试、paused、Resume 完成全流程。

2. **Provider 自行返回 cancelled 导致非法终态转换（P1，已修复）**。原 running Run 直接转 cancelled，使 promise 拒绝且活动锁遗留。当前 `RunService.ts:469` 在必要时先转换到 cancelling；`engine.test.ts` 覆盖 Provider 在 start 前返回合法 cancelled error 并释放锁。独立 /tmp 诊断由失败转为通过。

3. **最终状态写入失败后 Stop 无法再次收尾（P1，已修复）**。原 final transaction 失败后保留 executing=true 和已拒绝 promise，后续 Stop 只重复等待旧失败。当前 `RunService.ts:318` 冻结执行时间、清 timer、标记 worker 不再执行并保留锁；`RunService.ts:170` / `:182` 允许显式 Stop 再次持久化终态，原失败仍向首次调用方返回。`events.test.ts` 覆盖写入持续失败后恢复、再次 Stop 成功。

4. **父 Run 终态与活动子证据不一致（P1，已修复）**。原 turn_failed 落库短暂失败后，父 Run 可成功成为 error，但 Turn/Attempt 仍 running、Message 仍 streaming；原请求无法重试，启动恢复也不会处理终态父 Run。当前 `RunService.ts:475` 在同一事务中补齐仍 running 子项的终态及事件，再提交父终态；失败则保留可再次 Stop 的上下文。`events.test.ts` 与独立 /tmp 诊断均覆盖；断言只追加一次 turn_failed。

## 独立执行证据

全部诊断只使用 `Database(':memory:')` 与 Mock/fixture Provider。

- `/private/tmp/roundtable-r04-validation-voe8o8pd/env.sh node pnpm exec vitest run --config /private/tmp/r04-independent-review.9SoX7P/review.config.ts --reporter=dot`：第一次单项执行 exit 1，复现 `Invalid run transition: running -> cancelled`；修复后同命令 exit 0，1 文件 / 2 测试通过。
- `/private/tmp/roundtable-r04-validation-voe8o8pd/env.sh node pnpm exec vitest run --config /private/tmp/r04-independent-review.9SoX7P/review.config.ts -t 'active child' --reporter=dot`：修复前 exit 1，父 Run 为 error、Turn 仍 running；最终完整诊断包含同例并通过。
- 开发负责人报告 R04 目标集 7 文件 / 86 测试 exit 0；此数量由负责人执行，独立审查者没有将其冒称为自行重跑结果。

诊断源码与配置仅保存在 `/private/tmp/r04-independent-review.9SoX7P/`。最终通过发生于本次源码修复后，无真实用户数据库、Key、网络 Provider 或付费调用。

## 验收边界与待集成项

- 异常退出后累计时间以最后已提交 checkpoint 为准。没有 delta 的长时间等待若进程直接崩溃，最后 checkpoint 之后的执行间隔无法精确恢复；现有逻辑和测试不构成跨崩溃精确计时保证。
- R05 消息构建注入以及 R06 同 Turn 新 Attempt 的 turn_started 更新、消息呈现，需要总控联合接线与验收。本次不修改这些模块，也不据此宣布 R04 verified。
- Provider 的 length/content_filter 已保留部分输出与固定私有原因；正式公开完成原因仍依赖总控 Shared 语义扩展。当前已明确 shortcut 边界，未将此处理冒称为完整真实 Provider 支持。
- 未由独立审查者执行全量回归、typecheck、build、原生 ABI、桌面 E2E、打包或跨平台检查；这些证据由开发负责人另行提供。未启动应用或真实 Provider。

Verdict: 当前 R04 源码具备交付总控审查与联合集成条件；是否 merged/verified 由总控执行集成验证后判断。

## 最终截止时间增量复查

本段复查覆盖后续新增的 `deadlineReached(context)`、同步 builder 后及 iterator 返回后的检查、`withAbort` 重命名、删除未使用的 context.task 和 not_found 规范化。前文行号指首次审查修订，不保证与最终提交行号相同。

新增单调时间检查能够在连续微任务延迟 timer 回调时及时终止逻辑执行；原四项修复未发现回归。增量审查曾发现同范围的 **P2，现已解决**：`executeTurn` 在 builder 后检查截止时间，随后同步提交 Turn/Attempt 并执行 turn_started 通知，若提交或通知期间耗尽预算，原先会在首个 iterator 结果返回时才拒绝。当前 `RunService.ts:413` 已在 `try` 内、`provider.streamChat` 前补齐 deadline/aborted 守卫。

独立复查看到，预算耗尽或信号已取消均会在 Provider 调用前抛出受控异常；刚提交的 pending Attempt 按既有 catch 路径成为 aborted，部分证据和父状态保持一致。新增 `engine.test.ts:155` 使用 mocked performance clock 在 turn_started listener 中推进到预算上限，断言 Provider 收到零次调用、Run 最终 error、Attempt aborted。

审查者只读核对 `/private/tmp/roundtable-r04-validation-voe8o8pd/pre-provider-deadline-red.json`（该 regression exit 1）、`pre-provider-deadline-green.json` 与同名 green log（完整 engine 1 文件 / 16 测试，exit 0）；执行者为开发负责人，审查者未另跑原生测试。最终 Node 全量、typecheck/build 及 Electron 专项仍由环境负责人针对最终源码另行验证，不能由本报告代替。

最终 Verdict：当前 R04 授权源码未发现剩余阻断问题，原交付总控审查与联合集成建议保持有效。未扩大到其他模块或修改仓库；R04 verified 仍以总控联合验收为准。
