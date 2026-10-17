# R00–R18 状态与授权看板

原始基线：main / `135bf82c6462ade6dd5300717d6f0102ce4a660c`。完整范围和归属见[任务索引](../tasks/README.md)，原始产品状态见[V0审查](V0_AUDIT.md)。R00/R01/R02/R03 已验收。用户批准的 R03 候选 `439e3c6cb58437298e94fe2536f26e22eae66f6c` 已以 `e642b96a8dded195be44749dd6f267798de95198` 合入 main，并通过[本次主线复验](verification/2026-10-15-r03-main.md)。用户已批准联合候选d4a0d274，本次fast-forward合main并通过[独立主线验收](verification/2026-10-16-r04-r05-r06-main.md)，R04/R05/R06及联合集成均verified。R07/R08获批候选d3205b2已严格ff-only合main；此前补充桥包装器失败记录保留，本次另获授权修复验证入口，18/18真实桥安全断言及退出审计通过，两模块及联合集成现为merged/verified；见[主线与补充记录](verification/2026-10-17-r07-r08-main.md)。R09已获用户联合接线授权；当前在独立 codex/integrate-r09 完成 fixture 候选验收，状态 review，未合 main，不外推真实 API 验收。共享前置1e1f971先前已按相应授权合main并完成当时的独立主线验收，保持merged/verified，见文末历史专节。ENV-R02-INSTALL-01 保持已解决；Node 24.21.0 上游风险保留，继续采用严格配对的官方 24.18.1。

状态定义：not_started 未开始；ready 依赖满足但仍需实施授权；in_progress 正在执行；review 交付待审核；merged 已由总控集成；verified 验收确认；blocked 前置未满足或存在阻塞。状态与授权分列，不能推断。

| ID | 名称 | 依赖 | 负责人 | 状态 | 授权 | 分支/Worktree | 提交 | 验收证据 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R00 | 基线治理与验证 | 无 | 总控（本聊天） | verified | 已授权；用户文档验收通过 | main；不创建 Worktree | a17c649422c69696da91df081cb21d6d260a54cb；769a9519b969b7897d3af314bc981ac2fb7f64d2 | [R00 实际执行记录](verification/2026-10-13-r00-baseline.md)：类型/52测试/空集/build/ABI通过，独立审查通过；2026-10-13 用户批准文档验收 |
| R01 | 启动、退出、安全边界 | R00 已 verified | 总控（本聊天） | verified | 用户批准最终合并与验收；主线复验通过 | 已合 main；codex/integrate-r01 与原子项目 Worktree/分支保留 | 集成 0ad1701a47222315158e7be00d29afe1c9ef1767；合并 4149590d28296ab3520b70606dcb161ba16a6b39；原子项目 d956279949baa0992be5e0cb093f59ef96a9e205 | [合并后实际验证](verification/2026-10-13-r01-main.md)：类型、12文件/133测试、build、ABI139、隔离生产页面/Preload、退出后SQLite通过；10月13日批准/复验，10月14日验收登记 |
| R02 | 契约与归属 | R01 已合 main 且 verified | 总控（本聊天） | verified | 用户批准最终合并与验收；本次 main 复验通过 | 已合 main；codex/integrate-r02、原 codex/r02-contracts 及 Worktree 均保留 | 原14f07a22b44bcd2459dd44f579230792033d9301；引入bafa84f55b6c77aeaffe26b27caae56fb67cbcf0；安全审核8ec1d2b834ba94a5df60a21e0615d1fcb21fd48f；ENV候选5b8f771bfa0fd1823b7efe6488179e15aea436a5；合并6aff174e6cf397eb49b9b4ceadb3387f207b84a6 | [本次 main 验收](verification/2026-10-14-r02-main.md)：6文件94契约/18文件228全回归、类型/生产构建、Node源码编译/内存/压力5次、Electron源码编译/ABI139、隔离页面/Bridge/退出数据均exit0；ENV保持已解决，历史干净安装见[ENV证据](verification/2026-10-14-r02-environment.md) |
| R03 | 持久化、备份、恢复 | R02 已合 main 且 verified | 总控（本聊天） | verified | 用户批准最终合并/复验/状态更新；本次主线必要检查通过 | 已合 main；原分支和 codex/integrate-r03、两个 Worktree 均保留 | 原212808f780cc87d2827a977743f3fc16a028f5b5；引入f144ace84f7861c4f8cf577d0d0d40aa3aae8110；候选439e3c6cb58437298e94fe2536f26e22eae66f6c；合并e642b96a8dded195be44749dd6f267798de95198 | [本次 main 验收](verification/2026-10-15-r03-main.md)：26文件313全回归，Node/Electron专项各9文件85项，类型/构建、原生压力5次、ABI139、隔离恢复/Bridge/退出数据均exit0；限制分列 |
| R04 | Run/Turn Mock | R03 已合main verified；R02契约 | 原模块交付后由总控唯一联合接线 | verified | 用户已批准最终合并；本次main复验通过 | 已合main；联合/原分支和全部WT保留 | 原63ef56e1cd9d4bb9d0793aa4e97e499b45574ecd；引入3c6ed2ff9f79b08a915d152dccd556c0df219090；接线/fast-forward入站d4a0d2742eb28d2441e4d06e8154b8cdd6955336 | [本次main证据](verification/2026-10-16-r04-r05-r06-main.md)：534完整/265专项/112 Electron、类型/构建、Node压力5次、ABI139、隔离UI/恢复/退出均exit0；正式E2E等未验证 |
| R05 | 公共上下文与基本限制 | R03 已合main verified；R02契约 | 原模块交付后由总控唯一联合接线 | verified | 用户已批准最终合并；本次main复验通过 | 已合main；联合/原分支和全部WT保留 | 原1c5a2183f0c5d4f335b39b99aa27cac8fe7baad7；引入7586f023d373f38cbd08df623dcf0149abcebdcf；接线/fast-forward入站d4a0d2742eb28d2441e4d06e8154b8cdd6955336 | [本次main证据](verification/2026-10-16-r04-r05-r06-main.md)：534完整/265专项/112 Electron、类型/构建、Node压力5次、ABI139、隔离UI/恢复/退出均exit0；正式E2E等未验证 |
| R06 | Renderer 状态与订阅 | R03 已合main verified；R02契约 | 原模块交付后由总控唯一联合接线 | verified | 用户已批准最终合并；本次main复验通过 | 已合main；联合/原分支和全部WT保留 | 原ed6d659734cea4169fb54a66bdb257439d6daa39；引入6fe8805bb96c6c41d9f4671260c64ed13c47a275；接线/fast-forward入站d4a0d2742eb28d2441e4d06e8154b8cdd6955336 | [本次main证据](verification/2026-10-16-r04-r05-r06-main.md)：534完整/265专项/112 Electron、类型/构建、Node压力5次、ABI139、隔离UI/恢复/退出均exit0；正式E2E等未验证 |
| R07 | 房间、成员、历史 | R04/R05/R06及SHARED-R07-R08-01已合main且verified | 原模块交付；总控联合接线 | verified | 最终合并及补充探针修复已授权；全部必要验收完成 | 已合main；集成及原分支/WT全部保留 | 原d991178；引入f718f829；接线64ac8ce5038813cc60374573dc8871da30d1eeb0 ；ff入站d3205b2c3fba2061437150e87a87508d44fbb660 | [主线及补充记录](verification/2026-10-17-r07-r08-main.md)：原846/292/111/393、strict/build及UI/重启/退出证据按同业务版本复用；本次18/18真桥断言、生产探针自然exit0及退出SQLite审计通过 |
| R08 | Key 与 Provider 设置 | R04/R05/R06及SHARED-R07-R08-01已合main且verified | 原模块交付；总控联合接线 | verified | 最终合并及补充探针修复已授权；全部必要验收完成 | 已合main；集成及原分支/WT全部保留 | 原d2aed6c；引入5f01e978；接线64ac8ce5038813cc60374573dc8871da30d1eeb0 ；ff入站d3205b2c3fba2061437150e87a87508d44fbb660 | [主线及补充记录](verification/2026-10-17-r07-r08-main.md)：原846/292/111/393、strict/build及UI/重启/退出证据按同业务版本复用；本次18/18真桥断言、生产探针自然exit0及退出SQLite审计通过 |
| R09 | OpenAI 与兼容端点 | R07/R08已合main verified；Mock联合验收 | 原模块交付；总控独占联合接线 | review | 用户仅授权 fixture 联合集成，未授权合 main/真实付费测试 | codex/integrate-r09；独立集成 WT，原模块 WT 保留 | 原2d97af571debf106aadad708a2c0418f299c6eef；引入f5baaf07e1603a7c356fb0c9cedeb131977307ba；接线da512e7a64a6ec4a596b0f7fda820b3d62b04e42；最终候选含治理提交 | [R09联合候选](verification/2026-10-17-r09-integration.md)及[命令台账](verification/2026-10-17-r09-commands.md)；Node/Electron各1073回归、227 R09专项、strict/build及生产入口fixture，未标main verified |
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

## 发布与授权方向确认（2026-10-16，仅规划）

用户已确认免费、源码公开（Source Available）、非商业授权，未来由个人 GitHub 公开仓库及 Releases 分发，用户自备 API Key/承担厂商费用。优先考虑 PolyForm Noncommercial 1.0.0，正式发布前重新核对并由用户确认；不默认 MIT/Apache-2.0，不称 OSI 标准开源，不增加收费/订阅/激活/支付/反盗版系统。统一门槛与外部贡献权利要求见 [发布政策](RELEASE_POLICY.md)及 [R17](../tasks/R17-e2e-release.md)。

本轮仅由总控调整规划文档，不修改业务/契约/数据库/依赖、不创建 Worktree 或 GitHub 仓库、不公开或发布软件。R00–R18 功能、依赖、负责人及状态不变：R07/R08 仅 ready，R17 仍 blocked/未授权实施；许可证尚未正式采用，权属、历史敏感信息及跨平台发布审查仍待 R17 实际执行。

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

## R03 最终合并与主线验收（2026-10-15）

上述 R02 阶段的 R03 ready/未实施说明为历史。用户审核 R03 集成报告后，本次明确授权最终合并。开始时 main 仍为 `be37fad9d05050a9bad1847e5008bc67752523f6`，候选及原子项目 HEAD 与授权一致，三个工作区干净。仅 non-ff 合并 codex/integrate-r03，合并提交 `e642b96a8dded195be44749dd6f267798de95198` 的两父分别为旧 main 与 `439e3c6cb58437298e94fe2536f26e22eae66f6c`，合并树与候选完全相同，没有冲突，也没有再次合原子项目分支。

main 自己的独立依赖、本次临时缓存/userData/数据库上重新执行全部必要检查，才更新 R03 verified；不是引用历史集成 PASS。migration1 原文不改、migration2 升级/真实失败回滚/历史 NULL/WAL busy/独立恢复/并发游标/重复恢复均在本次专项与全回归中通过。没有访问真实数据库/Key 或调用付费 Provider。完整实际命令与限制见[主线验证报告](verification/2026-10-15-r03-main.md)。状态更新为独立文档提交，不改已批准业务代码、依赖或 migration。

R04/R05/R06 都仅依赖已验收的 R03 数据基础与 R02 契约，因此标 ready。R04 的 RunService/stateMachine、R05 的 context、R06 的 store/subscriptions 各按任务归属分工；Database、Shared、IPC/Preload、Main/App 组装和 migration 仍归总控统一接线。三个新模块的联合验收仍须互相配合，ready 不授权开发或创建 Worktree。本轮未创建 R04/R05/R06 Worktree，其他后续任务状态不推进。

未验证：正式 E2E、开发 HMR、发布包/ASAR/安装升级、Windows/Linux、签名/公证、真实模型/Key、大数据量性能与真实断电持久性。Node24.21.0 上游风险、同步校验阶段边界取消、旧重复 requestId/一 Turn 多消息的回填分支未单独动态覆盖等限制保留；完整调度/显式恢复和累计限制仍属 R04。


## R04/R05/R06 联合集成审核（2026-10-15）

上述R03阶段的ready/未授权说明保留历史。用户已另行完成三个模块独立授权交付，本轮明确批准总控联合Worktree及A类最小适配。原模块不回写，main实际仍为37766666且干净；本轮只在联合分支引入三提交和接线。总控独占RunService/context/Mock、Main、Renderer store/session/App、公共文档/验证探针，协作者只读审查；Shared/Database/migration/IPC/Preload/package/lock不变。

三个任务review，等待用户最终审核/合main授权，不因候选PASS更新verified。R07/R08仍blocked且未授权。完整本次命令、失败修正、共享A/B/C及未验证事项见联合报告/命令台账；后续正式合main须重新执行主线验证。原R04/R05/R06分支和Worktree全部保留。


## R04/R05/R06 正式合并与本次main验收（2026-10-16）

上一节为10月15日历史review阶段。用户外部审核后明确批准完整候选，本次再次核实11个WT干净、main未偏离37766666、三模块各完整引入一次，使用git merge --ff-only将main推进d4a0d2742eb28d2441e4d06e8154b8cdd6955336；没有新merge commit，也未重复合子项目。

随后在main自己的独立依赖和本轮新数据环境完成534全回归、265专项、112 Electron专项、类型/构建、双ABI/压力、真实UI/刷新/IPC及退出后只读校验，全部必要检查通过才更新三模块及联合集成为verified。完整真实命令、输入捕获和限制见[主线验收](verification/2026-10-16-r04-r05-r06-main.md)。治理提交仅文档；最终SHA随交付消息及该报告最新Git提交定位。

R07/R08仅ready，需用户另行实施/Worktree授权及排他负责人登记；总控先统一Room/Agent/History与Provider/Key/endpoint的公共契约和数据/IPC接线，子项目不能自行改Shared/Database/migration/Main/App/store公共文件。本轮不创建新WT、不开发R07/R08，所有原任务/集成分支和WT保留。正式E2E、跨平台/发布、真实模型及已登记C类扩展仍未完成。


## R07/R08 共享前置候选（2026-10-16，历史阶段）

本节保留候选阶段历史；最新状态见下一节主线验收。上文“仅规划/没有创建 Worktree”指先前发布规划轮。用户本次明确授权总控实现共享前置，不授权合 main 或创建两个 feature Worktree。总控从已验收 main `510f58a75c676496f6e4e5960eb89553d04ab8ac` 创建唯一共享 Worktree/分支 `codex/shared-r07-r08-foundation`，main 未改。候选提交由包含本节的 Git 提交定位，完整 SHA 见最终交付。

| 项目 | 负责人 | 状态 | 范围及证据 |
| --- | --- | --- | --- |
| SHARED-R07-R08-01 | 总控唯一写入人 | review（未 merged/verified） | Room/Agent/Provider/Key/History 契约、Database CRUD、migration3、安全引用及回归；[实施与验收报告](verification/2026-10-16-r07-r08-shared.md)、[实际命令](verification/2026-10-16-r07-r08-shared-commands.md) |
| R07 | 未分派 | ready（既有依赖满足；共享 main 基线仍待合入） | 未授权 feature 实施/创建 Worktree；不可把共享测试当 R07 完成 |
| R08 | 未分派 | ready（既有依赖满足；共享 main 基线仍待合入） | 未授权 feature 实施/创建 Worktree；不可把共享测试当 R08 完成 |

本次44文件612测试、typecheck、Main/Preload/Renderer build、Node24.18.1内存SQL及5轮压力、Electron ABI139/190专项、隔离现有UI/Bridge/启动恢复/退出数据验证全部exit0。新增长期公共测试78项；中间失败及修正不隐藏。冻结离线安装646 reused/0 downloaded，从空 node_modules 建独立目录，不声称本轮冷缓存联网验证。

候选接口和排他文件详见[共享调用手册](R07_R08_SHARED.md)。Shared、Database、migration3、公共测试与 Main/IPC/Preload/App 接线归总控；以后 R07 独占 room/rooms，R08 独占 settings/security，不能同时写 KeyService。新的输入/输出表未挂生产 Bridge，不存在假成功 handler。

下一门槛：用户审核候选并明确授权合并 → 总控合 main 并重新验证 → 冻结实际最终 main 完整 SHA → 用户单独授权两个功能 Worktree。当前不能从原 main 消费本候选接口。R09 及后续状态/路线不推进；保留全部原分支和 Worktree。真实模型、真实系统 Key 后端、R07/R08 功能UI、正式E2E/发布/跨平台未验证。


## R07/R08 共享前置正式合并及main验收（2026-10-16）

用户审核三份共享交付文件后，正式授权仅ff-only合并及main独立复验。开始时main仍510f58a、候选仍1e1f971，12个Worktree均干净、候选唯一提交直接父为main。实际执行 `git merge --ff-only codex/shared-r07-r08-foundation`，main推进 `1e1f971562151fd800324a544ff4da19fa71e5ab`；没有新merge commit、冲突、重复引入或其他分支更新。全部原分支/Worktree保留。

| 项目 | 状态 | 本次证据与授权 |
| --- | --- | --- |
| SHARED-R07-R08-01 | merged / verified | main本次44文件612全回归、4文件78共享专项、strict/build、Node原生内存/压力5次、Electron ABI139/18文件190专项、两个新隔离UI/恢复profile及退出只读核验全部exit0；见[主线报告](verification/2026-10-16-r07-r08-shared-main.md)与[命令台账](verification/2026-10-16-r07-r08-shared-main-commands.md) |
| R07 | ready，未启动 | 已满足共享主线前置；未分派、无功能Worktree、未授权功能实施 |
| R08 | ready，未启动 | 已满足共享主线前置；未分派、无功能Worktree、未授权功能实施 |

本轮治理提交只更新状态/接口现状/证据与任务启动门槛，完整最终main SHA由包含本节的提交及最终交付定位；两个模块未来必须从该同一最新main完整SHA开始，启动前重新核验，不从旧510f58a或仅候选WT开发。用户仍须另行授权创建/实施。

文件归属以[共享调用手册](R07_R08_SHARED.md)为准：总控独占Shared/Database/migration3/公共测试/Main/IPC/Preload/App/store及公共工厂；R07独占room/rooms及专属测试；R08独占settings/security及专属测试，后续总控冻结KeyService写入。同文件不并发写。新typed API仍未生产注册，真实组装留联合集成；R09/R17及其他任务未启动。

本次不安装/升级依赖，不复制node_modules，main使用自己的既有独立依赖与本轮私有cache/gyp/TMPDIR/userData，Node24.18.1严格同版headers和Electron38.8.6 headers分别重建，最终main原生模块为ABI139。migration1/2逐字核对不变；升级/回滚/备份/WAL/Key归属及撤销均在本轮实际测试通过。Node24.21.0风险、真实Provider/系统Key后端、R07/R08功能UI/新Bridge、正式E2E和跨平台发布仍未验证。


## R07/R08 联合候选（2026-10-17，历史 review 阶段）

此前 ready/未实施的段落为历史。用户已另行授权两模块开发与本轮联合集成。本轮只在 `codex/integrate-r07-r08` 操作，main 仍 `c1b5beaddfe254ca978f32874e6376b398d09836` 且干净；14 个原 Worktree 的 HEAD、分支与工作区均保留。本次引入 R07 `d991178fb41854da2ad281ec1e14b6e96cd4f38b` → `f718f829f8594b09bfc943f2658533c1f69809b2`，R08 `d2aed6c4528209ab0f84e631cbc0e6e405395c31` → `5f01e978d5c4aee5cd429497f7bd7e81ba9c65fe`，各一次且 patch-id 一致，无冲突。接线代码提交 `64ac8ce5038813cc60374573dc8871da30d1eeb0`；随后独立治理提交记录本次证据，完整最终候选 SHA 见交付消息或该治理提交。

本次实际最终 Node 61文件846测试、23文件292专项、Electron29文件393专项，类型/生产构建、Node五次30万SQL压力、Electron ABI139读写/压力、生产配置UI/三Mock协作/刷新/重启、两次退出只读审计及旧v1恢复回归均 exit0。失败及修正见 [联合报告](verification/2026-10-17-r07-r08-integration.md) 和[逐命令台账](verification/2026-10-17-r07-r08-commands.md)；不将此前模块/共享前置的历史 PASS 算成本轮结果。

联合集成、R07、R08 均 **review**，未合 main、未标 merged/verified；R09/R17 仍 blocked/未授权。无新增 migration、依赖、真实 Provider 调用；系统 Keychain 加密、Windows/Linux、正式 E2E/发布包等未验证。1600×1000请求被本机工作区限制为1600×870/868，实际尺寸分列，不冒称完整1000高度已测。

## R07/R08 正式合并与主线验收停止（2026-10-17，前次授权历史）

用户审核候选后明确授权最终合并。重新核对main仍c1b5beaddfe254ca978f32874e6376b398d09836、候选仍d3205b2c3fba2061437150e87a87508d44fbb660，15WT干净；两个原模块各引入一次且patch-id匹配，main无额外提交。实际 `git merge --ff-only codex/integrate-r07-r08` exit0，main直接推进获批候选，无额外merge commit/冲突/历史重写，原分支与Worktree保留。

本次main实际846完整/292联合/111IPC安全/393Electron专项、strict/build、Node五次30万压力、Electron ABI139、生产功能/刷新/新进程重启/两次退出审计、旧联合控制及v1恢复均exit0。复核发现原生产探针只直接断言跨桥code，未逐字段断言message/retryable/无stack，因此补充真实桥核验。临时包装器将node_modules/electron包路径导出误当内置Electron API，app为undefined，在注册窗口监听时失败；未加载生产探针/Main，未执行新增桥断言。错误进程经PID/UID/进程组核验后SIGTERM，子进程-15、runner外层241；保留日志，不算PASS。

按用户“若发现失败，保留证据并停止验收推进”要求，未修复重跑、未继续主线验收。R07/R08和联合集成只登记**merged，验收停止、未verified**；R09仍blocked/未授权，未启动任何新任务或Worktree。记录见[主线报告](verification/2026-10-17-r07-r08-main.md)与[台账](verification/2026-10-17-r07-r08-main-commands.md)。本次独立提交只记录事实/失败/现态，不改业务、测试、依赖或migration，不进行破坏性回滚。

剩余门槛为用户允许继续后，先修复并在ready前落实补充探针隔离，再完成真实桥DTO字段核验及退出确认；通过后才能独立更新verified/R09 ready。既有通过记录有效，但不能将部分PASS或候选历史PASS替代未完成检查。

## R07/R08 补充探针修复与最终验收（2026-10-17）

用户另行授权最小验证修复及完成验收。完整日志、错误wrapper与electron npm入口源码确认绝对包路径只返回二进制路径；原失败(-15/外层241)保留不删。仅在tests/probes/r07r08-electron.cjs中，将新增错误DTO断言放入既有隔离完成/真实Main加载后、UI和PASS之前直接await；沿用内置require('electron')、失败写FAIL/exit1。两条真实错误路径各9项，精确18/18，不能空集成功。

本次真实Electron38.8.6/ABI139/arm64探针自然exit0，原生产操作及24组布局也通过；随后只读退出SQLite审计exit0。业务src、构建配置/依赖、原回归fixtures及UI输入不变；5个生产构建文件本轮前后SHA/mtime不变、native不变，按用户明确授权复用同业务版本的846完整/292联合/111安全/393Electron、strict/build和重启等既有主线证据，不称本轮重跑。全部必要验收闭环后登记R07/R08及联合集成**merged/verified**，关闭VALID-R78-BRIDGE-01。

本次提交仅一个验证探针与治理文档，原失败提交28cb2f7、分支/15WT及历史保留。R09依赖满足而ready，未授权实施/创建Worktree，未启动；不实施R17、不发布。最终完整main SHA由本节所在提交及交付消息定位。真实Provider、系统Keychain、正式E2E/跨平台/发布等原限制不变。
