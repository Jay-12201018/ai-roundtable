# R00–R18 状态与授权看板

原始基线：main / `135bf82c6462ade6dd5300717d6f0102ce4a660c`。完整范围和归属见 [任务索引](../tasks/README.md)，当前产品状态见 [V0 审查](V0_AUDIT.md)。只有 R00 获实施授权；总体路线批准不表示后续任务已启动。

状态定义：not_started 未开始；ready 依赖满足但仍需实施授权；in_progress 正在执行；review 交付待审核；merged 已由总控集成；verified 验收确认；blocked 前置未满足或存在阻塞。状态与授权分列，不能推断。

| ID | 名称 | 依赖 | 负责人 | 状态 | 授权 | 分支/Worktree | 提交 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R00 | 基线治理与验证 | 无 | 总控（本聊天） | verified | 已授权；用户文档验收通过 | main；不创建 Worktree | a17c649422c69696da91df081cb21d6d260a54cb；769a9519b969b7897d3af314bc981ac2fb7f64d2 | [R00 实际执行记录](verification/2026-10-13-r00-baseline.md)：类型/52测试/空集/build/ABI通过，独立审查通过；2026-10-13 用户批准文档验收 |
| R01 | 启动、退出、安全边界 | R00 已 verified | 执行者待分派；共享文件由总控负责 | ready | 仅授权准备；未授权创建 Worktree 或业务实施 | 未创建 | 无 | 未运行；文件归属见下文 |
| R02 | 契约与归属 | R01 | 总控，实施未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |
| R03 | 持久化、备份、恢复 | R02 | 数据负责人未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |
| R04 | Run/Turn Mock | R03 | 未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |
| R05 | 公共上下文与基本限制 | R03 | 未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |
| R06 | Renderer 状态与订阅 | R03 | 未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |
| R07 | 房间、成员、历史 | R04/R05/R06 | 未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |
| R08 | Key 与 Provider 设置 | R04/R05/R06 | 未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |
| R09 | OpenAI 与兼容端点 | R07/R08；Mock 联合验收 | 未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |
| R10A | Anthropic | R09 | 未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |
| R10B | Gemini | R09 | 未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |
| R11 | 声明式工作流 | R07；真实验收另需 R09 | 未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |
| R12 | 主持人与消息版本 | R11 | 未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |
| R13 | 摘要、usage、费用预算 | R05/R09/R11 | 未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |
| R14 | 结构化产物 | R11 | 未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |
| R15 | 安全代码导出 | R14 | 未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |
| R16 | 聊天 UI 与可用性 | R06；主要交互稳定 | 未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |
| R17 | Electron E2E 与发布 | 骨架 R02；最终 R07–R16，含 R10A/R10B | 未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |
| R18 | V1.1 评测与 ADR | R17 V1 验收 | 未分派 | blocked | 未授权启动 | 未创建 | 无 | 未运行 |

## R00 提交引用

治理主提交为 `a17c649422c69696da91df081cb21d6d260a54cb`，主题 `chore: establish R00 governance baseline`，直接父提交为原始 `135bf82c6462ade6dd5300717d6f0102ce4a660c`。文档引用修正提交为 `769a9519b969b7897d3af314bc981ac2fb7f64d2`，主题 `docs: correct R00 commit references`，直接父提交为治理主提交。两次提交及原始历史均保留。

验收依据为上述固定提交、[R00 验证证据](verification/2026-10-13-r00-baseline.md)及用户 2026-10-13 的文档验收批准。本次仅更新状态与准备规则，没有重新运行 R00 业务测试；既有证据不表示 R01 验收，也不表示桌面 E2E、真实 Provider 或跨平台发布已经验证。

## 并行与集成门槛

1. R00 → R01 → R02 → R03 串行，先完成稳定与公共边界。
2. R04/R05/R06 可分模块并行，联合验收三 Agent 公共历史、控制、投影与持久化后进入配置阶段。
3. R07/R08 可并行；R09 先建立真实接口闭环，之后 R10A/R10B/R11 可并行。
4. R12/R13/R14 可并行；R15/R16 可并行；R17 汇总最终验收，之后才考虑 R18。

共享 Schema、migration、公共文件接线先由总控完成；模块分支只消费已合入接口。同文件不并发修改，不共享依赖目录/测试数据。未来所有 merged/verified 均由总控依据新鲜证据更新。

## R01 前置与当前限制

R00 文档验收已通过，提交和验证证据可在仓库内读取；本次状态更新前 main 位于 `769a9519b969b7897d3af314bc981ac2fb7f64d2`，工作区干净。状态提交完成并确认 main 干净后，最新 main 可作为未来 R01 独立 Worktree 的创建基线。

ready 仅表示依赖已满足、可以准备；创建 Worktree 和实施 R01 仍需用户明确授权。本轮不分派实施、不创建 Worktree、不修改业务代码。R01 只接收启动、退出、安全边界问题，不自动开展完整恢复或其他模块。

### R01 文件归属与冲突防范

沿用 [R01 任务文件](../tasks/R01-startup-lifecycle-security.md) 的范围；以下为未来获授权后的写入规则，不代表已开始修改。

| 文件范围 | 唯一写入负责人 | 协作方式 |
| --- | --- | --- |
| `src/main/windows/createMainWindow.ts`；`tests/unit/appLifecycle.test.ts`；拟新增 `tests/unit/lifecycle/windowSecurity.test.ts`、`tests/unit/lifecycle/ipcSource.test.ts` | R01 执行者（实施授权后分派） | 仅在 R01 Worktree 修改本模块和测试；总控不同时编辑这些文件 |
| `src/main/index.ts`；`src/main/ipc/registerIpc.ts`；`src/preload/index.ts`；`electron.vite.config.ts`；`src/renderer/index.html` | 总控（本聊天） | 统一生命周期组装、IPC 来源、Preload 构建和 CSP 接线；R01 只提交变更申请 |
| `src/main/services/RunService.ts` | 总控（本聊天） | 仅协调正常退出 paused 终结所需最小修改，登记给 R04；R01 不直接修改状态机 |
| Shared 契约/Schema、migration 编号、package/lock、验证规则及状态看板 | 总控（本聊天） | 维持统一管理；本任务准备状态不授予这些文件的功能修改权限 |

1. R01 启动时登记执行者、基线 SHA 和排他文件集合；总控与 R01 不同时写同一文件。需要扩大归属时先更新登记。
2. R01 对共享修改提交需求、调用方、兼容性、迁移、测试和安全影响；总控独立提交并先集成共享变更，R01 在自身工作区干净时同步该提交再消费，不自行向 main 合并。
3. 共享接线完成后，R01 更新并运行其生命周期/安全测试；总控审查模块提交、合入 main 并执行集成验证。未取得本次证据不能宣布 R01 verified。
4. R01 与 R02 串行；在 R01 接线和验收完成前不启动 R02 对 IPC/Preload 等公共文件的修改。各 Worktree 使用独立依赖目录、临时 userData 和数据库，不共享可变运行数据。

R00 不表示 V1 功能已完成。暂停重启、退出竞态、契约漂移、真正公共上下文、真实 Provider、Key 链路、产物与导出、E2E 和跨平台等仍按任务记录未解决。
