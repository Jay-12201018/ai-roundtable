# R06 Renderer 状态与一致订阅实施任务计划

> 当前状态见 [STATUS](../docs/STATUS.md)。未来范围定义；本轮未获实施授权，不得自动启动。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 把 Renderer 变为可重同步的统一状态投影，修复草稿、选房和命令竞争，给未来 UI 模块稳定入口。

**Architecture:** Zustand 只用于 Renderer 投影和可信命令状态；Main 保持权威。R06 阶段由总控登记唯一负责人完成 App 状态拆分与 store；初次拆分后 App 公共组装由总控维护，未来 features 以显式接线请求加入。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [src/renderer/App.tsx](../src/renderer/App.tsx) 第 8–21,93–122 行 用分离 React state 投影消息与 snapshot，存在重复逻辑。
- [src/renderer/App.tsx](../src/renderer/App.tsx) 第 26–34,47–88 行 已有先监听/缓冲/游标/缺口重同步，应保留这些性质。
- [src/renderer/App.tsx](../src/renderer/App.tsx) 第 125–159,182 行 createRoom 缺 pending 锁、标题取可变 objective，刷新或编辑草稿影响历史身份。
- [src/renderer/App.tsx](../src/renderer/App.tsx) 第 162–170,194–197 行 控制命令缺统一 pending/竞争策略；package.json 声明 Zustand 但 App 尚未使用。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

统一 Run/消息/游标投影、Zustand store、订阅生命周期、原子快照替换、命令 pending 与过期响应隔离；持久任务身份与输入草稿分离，恢复错误/中断的可操作状态。

明确不做：不调度 Provider、不写 DB、不改 Main/RunService、完整房间 CRUD 或 UI 视觉重构；不新增第二个 store 协议、不把 localStorage runId 当权威数据。

## 前置与必读

R03 一致快照/查询接口已合入，R02 契约可用；R06 获实施授权。联合调度场景另需 R04/R05。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

涉及 UI，先读 [DESIGN_GUIDELINES](../docs/DESIGN_GUIDELINES.md)，功能决定布局、体验决定交互；UI 组件只消费已合入契约。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 现存（135bf82） | src/renderer/App.tsx | R06 状态拆分负责人（总控登记）；后续组装总控 | 仅初次状态拆分；后续 feature 不改 App 组装 |
| 现存（135bf82） | src/renderer/env.d.ts | 总控 | Shared API 消费类型接线 |
| 现存（135bf82） | tests/unit/rendererSync.test.tsx | R06 | 保留现有同步性质，增加竞态行为断言 |
| 拟新增 | src/renderer/store/**；src/renderer/subscriptions/** | R06 | 投影 reducer/store 和同步协调 |
| 拟新增 | tests/unit/rendererStore/**；tests/unit/rendererSubscriptions/** | R06 | 竞态、命令互斥、投影与卸载测试 |
| 现存（135bf82） | src/shared/**；src/preload/index.ts；src/main/ipc/registerIpc.ts | 总控 | 快照/事件与错误契约接线 |

## Worktree 可独立与可并行

可独立 codex/r06-renderer-subscriptions Worktree，与 R04/R05 并行；独占获登记的状态拆分与 store/subscriptions 模块；初次拆分后 App 公共组装归总控。后续 R07/R08/R11–R16 只修改自身 feature 子目录，不能自行改 App/store。

## 共享依赖与接线规则

消费已批准 RunSnapshot/RunSubscription/判别事件；总控接入 R03/R04 的字段与事件。特性模块通过登记 selector/action 和组件 props 接入；初次拆分后 App 组装由总控维护，store 扩展由总控协调 R06 负责人，禁止多分支改 App。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 把现有同步性质和新增竞态写为 store/subscription 行为测试。
- [ ] 迁移 Zustand 投影和命令协调，保留草稿与任务身份边界。
- [ ] 总控连接新快照/事件，完成 R04/R05/R06 联合 Mock。
- [ ] 交付 feature 接口、store 归属与总控 App 组装边界，供后续 UI 接入。

## 详细验收

- [ ] 单一状态投影原子应用 snapshot/messages/cursor；重复/乱序/旧 Run 事件不能重复拼接或覆盖当前选择。
- [ ] 先监听后取快照，缓冲到达事件；缺口/未知不兼容事件重同步，重同步不重新调用 Provider。
- [ ] 切换房间/Run 后迟到响应无效；订阅/定时器卸载后释放，刷新读持久身份且输入草稿独立。
- [ ] Create/Start/Step/Resume 等 pending 与状态权限一致，连点不产生多请求；恢复期间禁用会产生竞态的命令。
- [ ] interrupted/error/无法恢复时提供可理解状态和合法下一步，既有部分文本可读；不让伪 paused 困住 UI。
- [ ] 保留流式批处理并验证与权威最终文本一致；中文状态/错误准确，遵循设计规范，未进行整套视觉改版。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 刷新与历史标题 | 持久任务不是默认 objective，草稿另有内容 | 标题来自权威任务，草稿不会改旧房间 |
| 窗口竞争 | 延迟 create/start、重复点击、切房后返回旧响应 | 只一次合法命令；旧响应不覆盖选择 |
| 订阅竞态 | 取快照期间 delta、重复 delta、缺口、snapshot_required | 缓冲正确，无重字；缺口恢复不调用 start |
| 原子投影 | turn_started→delta→terminal 同批或分批 | 活动回合/状态/消息一致，终态不会残留 streaming |
| 释放 | mount/unmount/重新 mount/切 Run | 监听和 timer 数量正确，不接收旧 Run 文本 |
| 重启中断 | snapshot interrupted 与 partial messages | 显示已中断和合法操作，部分文本仍可读 |

pnpm run test -- tests/unit/rendererSync.test.tsx tests/unit/rendererStore tests/unit/rendererSubscriptions；pnpm run typecheck；pnpm run build。UI 实测须隔离 userData，并另记证据。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。
