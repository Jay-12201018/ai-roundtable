# R00–R18 状态与授权看板

原始基线：main / `135bf82c6462ade6dd5300717d6f0102ce4a660c`。完整范围和归属见[任务索引](../tasks/README.md)，原始产品状态见[V0审查](V0_AUDIT.md)。R00/R01/R02 已验收。用户批准后，R02 以 `6aff174e6cf397eb49b9b4ceadb3387f207b84a6` 合入 main，并通过[本次主线复验](verification/2026-10-14-r02-main.md)。ENV-R02-INSTALL-01 保持已解决；Node 24.21.0 上游风险仍保留，采用严格配对的官方 24.18.1。R03 为 ready，但未获实施或创建 Worktree 授权。

状态定义：not_started 未开始；ready 依赖满足但仍需实施授权；in_progress 正在执行；review 交付待审核；merged 已由总控集成；verified 验收确认；blocked 前置未满足或存在阻塞。状态与授权分列，不能推断。

| ID | 名称 | 依赖 | 负责人 | 状态 | 授权 | 分支/Worktree | 提交 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R00 | 基线治理与验证 | 无 | 总控（本聊天） | verified | 已授权；用户文档验收通过 | main；不创建 Worktree | a17c649422c69696da91df081cb21d6d260a54cb；769a9519b969b7897d3af314bc981ac2fb7f64d2 | [R00 实际执行记录](verification/2026-10-13-r00-baseline.md)：类型/52测试/空集/build/ABI通过，独立审查通过；2026-10-13 用户批准文档验收 |
| R01 | 启动、退出、安全边界 | R00 已 verified | 总控（本聊天） | verified | 用户批准最终合并与验收；主线复验通过 | 已合 main；codex/integrate-r01 与原子项目 Worktree/分支保留 | 集成 0ad1701a47222315158e7be00d29afe1c9ef1767；合并 4149590d28296ab3520b70606dcb161ba16a6b39；原子项目 d956279949baa0992be5e0cb093f59ef96a9e205 | [合并后实际验证](verification/2026-10-13-r01-main.md)：类型、12文件/133测试、build、ABI139、隔离生产页面/Preload、退出后SQLite通过；10月13日批准/复验，10月14日验收登记 |
| R02 | 契约与归属 | R01 已合 main 且 verified | 总控（本聊天） | verified | 用户批准最终合并与验收；本次 main 复验通过 | 已合 main；codex/integrate-r02、原 codex/r02-contracts 及 Worktree 均保留 | 原14f07a22b44bcd2459dd44f579230792033d9301；引入bafa84f55b6c77aeaffe26b27caae56fb67cbcf0；安全审核8ec1d2b834ba94a5df60a21e0615d1fcb21fd48f；ENV候选5b8f771bfa0fd1823b7efe6488179e15aea436a5；合并6aff174e6cf397eb49b9b4ceadb3387f207b84a6 | [本次 main 验收](verification/2026-10-14-r02-main.md)：6文件94契约/18文件228全回归、类型/生产构建、Node源码编译/内存/压力5次、Electron源码编译/ABI139、隔离页面/Bridge/退出数据均exit0；ENV保持已解决，历史干净安装见[ENV证据](verification/2026-10-14-r02-environment.md) |
| R03 | 持久化、备份、恢复 | R02 已合 main 且 verified | 数据负责人未分派 | ready | 仅前置满足；未授权实施/创建 Worktree | 未创建 | 无 | 未运行 |
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

## R01 准备、集成与主线验收

R00 文档验收后，状态更新提交 `462a43a5cd0d341d91c64e28cfc2a903479ecd77` 将 R01 标 ready；当时仅允许准备。用户随后授权独立子项目开发，本次另行授权总控集成，开始时重新确认 main 仍为该 SHA 且工作区干净。

集成 Worktree 为 `/Users/zhangwenjie/.codex/worktrees/integrate-r01/AI交互`，分支 `codex/integrate-r01`。原子项目 `/Users/zhangwenjie/.codex/worktrees/f063/AI交互` 和分支均保留，不删除、不重写历史。用户审核集成候选 `0ad1701a47222315158e7be00d29afe1c9ef1767` 后于 2026-10-13 批准正式合并。本轮再次确认三个工作区干净，原提交 d956279 与引入提交 79b6666 的文件树完全一致；仅将集成分支合入 main，没有单独合并原子项目分支。

实际合并提交为 `4149590d28296ab3520b70606dcb161ba16a6b39`，第一父提交 `462a43a5cd0d341d91c64e28cfc2a903479ecd77`、第二父提交为集成候选；合并文件树与获批候选一致，无冲突。main 上本轮重新执行类型、全部测试、生产构建、Electron ABI 及隔离生产页面/Preload/退出后数据验证，均通过，才更新 R01 verified。原 [集成阶段记录](verification/2026-10-13-r01-integration.md)保留，不能替代 [本轮主线证据](verification/2026-10-13-r01-main.md)。

遗留限制：正式桌面 E2E、打包应用完整启动/安装/升级、Windows/Linux、签名/公证、真实 Provider/Key 仍未验证；Provider 永不响应 abort 的退出等待策略留 R04，异常恢复留 R03。本轮不重复发布/打包或实际开发 HMR 验证，集成阶段证据按历史标识保留。

### R01 文件归属与冲突防范

沿用 [R01 任务文件](../tasks/R01-startup-lifecycle-security.md) 的范围。子项目及集成阶段采用下列边界；共享申请 R01-SHARED-01 由总控接管集成 Worktree 文件并补充窗口 CJS/sandbox 联动与生产来源回归，不同时写原子项目 Worktree。总控内部分派不重叠文件集合、统一验证。本轮仅合并获批内容及更新验收文档，没有继续修改业务代码。

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

上述 R01 最终 main 合入与集成验证步骤已完成。新测试 `tests/integration/shutdown.test.ts`、`tests/unit/lifecycle/preloadBuild.test.ts`、有限探针 `tests/probes/r01-electron.cjs` / `r01-sqlite.cjs` 及治理记录由总控维护。无新增运行依赖，无真实 Provider/Key 操作。

### R02 启动边界

原子项目、独立集成审核及 ENV 专项均已完成。冻结安装问题由总控临时 raw fetch-timeout 参数造成，历史修正及两次全新安装见[ENVIRONMENT](ENVIRONMENT.md)和[环境证据](verification/2026-10-14-r02-environment.md)。用户随后明确批准 R02 最终合并、主线复验与状态更新，本轮只合入集成候选，不重复合并原子项目。

实际合并提交 `6aff174e6cf397eb49b9b4ceadb3387f207b84a6` 的父提交为 main `b690a1e2cefb485e81b35292bfb875bd19b88a2b` 与候选 `5b8f771bfa0fd1823b7efe6488179e15aea436a5`；合并树与候选相同，没有冲突。本次在 main 自身独立 node_modules 上实际重新编译/测试，未复用历史 PASS。全部必要检查通过后才登记 R02 verified；额外 pnpm list 的 store 写打开失败及只读依赖核对单独记录，未把失败清单当 PASS。

R03 的 R02 前置现已满足，标 ready；实施授权、数据负责人和排他文件范围仍须在启动时确认。Database、migration 编号、Main/IPC/Preload 组装及共享契约仍由总控统一管理。本轮不创建 R03 Worktree、不开发 R03；R04–R18 状态不推进。原 R02 与集成 Worktree/任务分支均保留。

R00–R02 验收不表示 V1 已完成。异常退出恢复、完整调度竞态、真正公共上下文、真实 Provider、Key 链路、产物与导出、正式 E2E 和跨平台等仍按任务记录未解决。正式 E2E、打包主入口完整 GUI/安装升级、Windows/Linux、发布签名/公证和真实 Provider/Key 未验证；本轮不重复干净安装/目录包，历史证据与主线复验分列。
