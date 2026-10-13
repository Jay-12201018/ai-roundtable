# R00–R18 状态与授权看板

原始基线：main / `135bf82c6462ade6dd5300717d6f0102ce4a660c`。完整范围和归属见 [任务索引](../tasks/README.md)，当前产品状态见 [V0 审查](V0_AUDIT.md)。R00 已验收；R01 子项目已交付，本轮仅授权独立集成接线、回归修复与验证，未授权最终合入 main；R02 未启动。

状态定义：not_started 未开始；ready 依赖满足但仍需实施授权；in_progress 正在执行；review 交付待审核；merged 已由总控集成；verified 验收确认；blocked 前置未满足或存在阻塞。状态与授权分列，不能推断。

| ID | 名称 | 依赖 | 负责人 | 状态 | 授权 | 分支/Worktree | 提交 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R00 | 基线治理与验证 | 无 | 总控（本聊天） | verified | 已授权；用户文档验收通过 | main；不创建 Worktree | a17c649422c69696da91df081cb21d6d260a54cb；769a9519b969b7897d3af314bc981ac2fb7f64d2 | [R00 实际执行记录](verification/2026-10-13-r00-baseline.md)：类型/52测试/空集/build/ABI通过，独立审查通过；2026-10-13 用户批准文档验收 |
| R01 | 启动、退出、安全边界 | R00 已 verified | 子项目已交付；集成由总控（本聊天）负责 | review | 独立集成/共享接线/回归验证已授权；未授权合 main | codex/integrate-r01；独立集成 Worktree | 子项目 d956279949baa0992be5e0cb093f59ef96a9e205；引入 79b6666d52e3459077de818c10b42a1dd17b3154；共享接线提交见交付报告 | [本轮集成验证](verification/2026-10-13-r01-integration.md)：133/133、类型/build/ABI、生产/开发隔离探针、未签名目录包路径通过；待最终集成审核 |
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

验收依据为上述固定提交、[R00 验证证据](verification/2026-10-13-r00-baseline.md)及用户 2026-10-13 的文档验收批准。R00 验收状态更新轮仅更新状态与准备规则，没有重新运行业务测试；R01 本轮另有独立执行证据，不把既有 R00 记录当作 R01 验收，也不表示正式桌面 E2E、真实 Provider 或跨平台发布已经验证。

## 并行与集成门槛

1. R00 → R01 → R02 → R03 串行，先完成稳定与公共边界。
2. R04/R05/R06 可分模块并行，联合验收三 Agent 公共历史、控制、投影与持久化后进入配置阶段。
3. R07/R08 可并行；R09 先建立真实接口闭环，之后 R10A/R10B/R11 可并行。
4. R12/R13/R14 可并行；R15/R16 可并行；R17 汇总最终验收，之后才考虑 R18。

共享 Schema、migration、公共文件接线先由总控完成；模块分支只消费已合入接口。同文件不并发修改，不共享依赖目录/测试数据。未来所有 merged/verified 均由总控依据新鲜证据更新。

## R01 准备历史与当前集成边界

R00 文档验收后，状态更新提交 `462a43a5cd0d341d91c64e28cfc2a903479ecd77` 将 R01 标 ready；当时仅允许准备。用户随后授权独立子项目开发，本次另行授权总控集成，开始时重新确认 main 仍为该 SHA 且工作区干净。

集成 Worktree 为 `/Users/zhangwenjie/.codex/worktrees/integrate-r01/AI交互`，分支 `codex/integrate-r01`。原子项目 `/Users/zhangwenjie/.codex/worktrees/f063/AI交互` 和分支保持不变；不删除、不重写历史。本轮 review 表示共享接线候选已交付待审核，不是 merged/verified；main 保持原样，R02 仍 blocked/未授权。

### R01 文件归属与冲突防范

沿用 [R01 任务文件](../tasks/R01-startup-lifecycle-security.md) 的范围。子项目开发阶段采用下列模块/公共文件边界；本次共享申请 R01-SHARED-01 由总控接管集成 Worktree 中的这些文件，并补充窗口的 CJS/sandbox 联动与生产来源回归，不同时写原子项目 Worktree。总控内部分派 Main/测试、Preload/窗口构建和 IPC/RunService 的不重叠文件集合；集成验证统一执行。

| 文件范围 | 唯一写入负责人 | 协作方式 |
| --- | --- | --- |
| `src/main/windows/createMainWindow.ts`；`tests/unit/appLifecycle.test.ts`；`tests/unit/lifecycle/windowSecurity.test.ts`、`tests/unit/lifecycle/ipcSource.test.ts` | 子项目交付后，本次由总控接管集成候选 | 子项目原提交保留；构建格式、退出竞态与来源回归仅在集成 Worktree 修复 |
| `src/main/index.ts`；`src/main/ipc/registerIpc.ts`；`src/preload/index.ts`；`electron.vite.config.ts`；`src/renderer/index.html` | 总控（本聊天） | 统一生命周期组装、IPC 来源、Preload 构建和 CSP 接线；R01 只提交变更申请 |
| `src/main/services/RunService.ts` | 总控（本聊天） | 仅协调正常退出 paused 终结所需最小修改，登记给 R04；R01 不直接修改状态机 |
| Shared 契约/Schema、migration 编号、package/lock、验证规则及状态看板 | 总控（本聊天） | 维持统一管理；本次不改 DTO/Schema/migration/package/lock，仅登记接线和验证证据 |

1. R01 启动时登记执行者、基线 SHA 和排他文件集合；总控与 R01 不同时写同一文件。需要扩大归属时先更新登记。
2. R01 对共享修改提交需求、调用方、兼容性、迁移、测试和安全影响；总控独立提交并先集成共享变更，R01 在自身工作区干净时同步该提交再消费，不自行向 main 合并。
3. 共享接线完成后，R01 更新并运行其生命周期/安全测试；总控审查模块提交、合入 main 并执行集成验证。未取得本次证据不能宣布 R01 verified。
4. R01 与 R02 串行；在 R01 接线和验收完成前不启动 R02 对 IPC/Preload 等公共文件的修改。各 Worktree 使用独立依赖目录、临时 userData 和数据库，不共享可变运行数据。

本次采用用户指定的独立集成候选流程，尚不执行上述第 2/3 条的最终 main 合入步骤。新测试 `tests/integration/shutdown.test.ts`、`tests/unit/lifecycle/preloadBuild.test.ts`、有限探针 `tests/probes/r01-electron.cjs` / `r01-sqlite.cjs` 及治理记录均由总控负责。无新增运行依赖，无真实 Provider/Key 操作。

R00/R01 不表示 V1 功能已完成。异常退出恢复、完整调度竞态、契约漂移、真正公共上下文、真实 Provider、Key 链路、产物与导出、正式 E2E 和跨平台等仍按任务记录未解决。
