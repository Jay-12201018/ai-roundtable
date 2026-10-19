# R11 独立实现与总控接线申请

基线 `b309b88676b751b1175a57a8885dc62f0d0b30ba`，分支 `codex/r11-declarative-workflows`，用户于 2026-10-20 正式授权本 Worktree 实施。最终模块 Commit SHA 见本交付提交及交付消息；不自称 merged/verified。

## 设计与实施计划

这是 Main 内部编译器，不是新的公开 wire 协议。先写四模板/非法配置测试，再实现严格解析、有限展开和冻结快照；之后测试纯 next-step 推导、持久证据恢复与限制，最后由独立 Renderer feature 呈现配置和 Main 提供的进度。使用现有 Zod/Shared 基础 Schema，无新增依赖、网络调用或第二个运行状态机。

- [x] 四模板严格配置、有限展开、版本化不可变快照及测试。
- [x] 从既有分配游标与 Turn 证据推导下一步，禁止跳过未结请求。
- [x] Mock/fixture 的五阶段上下文、暂停后游标、数据库重开与硬限制验证（不代表生产 R04 接线）。
- [x] 独立配置与进度 UI；全部公开接线先交总控审批。
- [x] 必要测试、typecheck、build、Node/Electron专项与独立审查；提交范围检查后交总控。

配置明确列出 stages（id/kind/memberIds/rounds）、limits（maxTurns/maxDurationMs/outputTokenLimit）及 endCondition。自由群聊和双模型对话允许多个显式阶段；修订链固定五种语义顺序但自由指定各阶段成员；辩论固定陈述/交锋/总结，可指定每阶段成员顺序与交锋次数。结束条件仅为计划结束或指定阶段结束，不解析模型文本、脚本、表达式或动态跳转。

轮数指每阶段完整成员序列的重复次数，回合指单次成员请求。限制为每阶段最多32轮、最多16阶段、每阶段最多32成员、计划最多256回合、累计执行时间最多24小时、单次输出最多65536 Token。配置超过自身回合上限拒绝；运行期更严格的限制仍可提前阻止后续调度。暂停时间不由本模块计时，累计时间来自 R04。

## 公共接线需求（待总控批准，尚未接线）

1. **Shared/版本**：现行 workflowSnapshot 只是任意安全 JSON，未冻结计划/进度。请总控审查本模块内部配置、步骤和快照，提升唯一 Schema 到 Shared 后再让 Main/Renderer/IPC 消费。不要在 Shared 之外复制第二套公开协议。历史 `{templateId:'draft-review-finalize',version:1}` 不能解释为新五阶段快照；本模块拒绝其执行，保留历史读取。未知版本拒绝，同一构建交付，旧 RunService 会忽略新计划，禁止降级执行。
2. **R04/RunService**：启动前从 Main 可信当前成员编译；原子保存冻结计划及成员。以 steps[index].agentId 替换 modulo 调度，并在请求前校验 next-step；计划结束停止。Step/Pause/Stop/超时 Abort、Attempt/事件事务仍由 R04；不增加第二个调度器。重复请求保留原 Turn/stage，不能消耗新步骤。`nextWorkflowStep` 只验证执行字段与 Turn 投影，不验证 Run/room 身份或最新 Attempt；R04 必须核对快照房间/冻结成员与 Run 关联，并保留原有 `assertSettled`、活动锁和来源验证。`kind:'next'` 只是计划查询结果，绝非发送授权。
3. **持久化**：优先复用 workflow_snapshot JSON 列与既有 nextTurnIndex/elapsedExecutionMs、Turn/Attempt 证据，不自行分配 migration。nextTurnIndex 是已分配位置，不是完成数量；校验连续完成前缀和最后未结 Turn，失败/中断不跳过、不自动重发。重启读取原冻结计划；是否允许恢复仍由现行 R04 显式恢复门禁决定。数据库结构若需变化由总控单独分配版本。
4. **R05/上下文**：把本模块内置、可信阶段说明加入 applicationInstructions，再对完整 Provider 输入重新计数；公共历史仍通过 R05 的可见/已完成消息选择。任意 workflow 字符串、模型正文与 @Stop/@Override 都不能成为 system/host 权限。当前生产 builder 未消费阶段，独立 fixture 不能代替该接线。
5. **进度投影/IPC**：批准 TurnSnapshot.turnIndex 或 Main 阶段/下一步投影（二择一），UI 不按完成数量猜进度；现有事件触发快照可复用。公开的新增字段须 strict 双端校验、兼容测试，不增加通用 invoke。
6. **App/session**：生产 startRun 在 rendererSession 中硬编码模板，需总控扩已批准参数并装配独立 feature，注入当前成员、Main 预览/进度及 action。feature 的 presentation props 不视为已批准 wire；Renderer 不导入 Main 编译器、不自行执行 Provider。

所需联合测试：四模板精确阶段和 Provider 输入、非法配置零 Run/请求、Step/Pause/Stop/Resume、完成前后崩溃/事务回滚、显式 retry 与 interrupted 门禁、原快照跨重启、时间/回合/输出上限及伪命令。数据库和 Key 均使用测试隔离；真实调用、R12/R13/R14、发布与 main 合并不在本轮授权内。

## 使用入口和文件清单

- `definition.ts`：Main 私有严格配置/步骤/快照 Schema、可信阶段说明。
- `compiler.ts`：`compileWorkflow(config, roomId, currentMembers)` 返回深度冻结的配置、成员及有限步骤；`readWorkflowSnapshot(json)` 验证版本、成员集合及步骤与配置的一致性。二者不进行任何 I/O。
- `progress.ts`：`nextWorkflowStep(snapshot, execution, turns)` 返回 next/complete/limit/blocked。传入既有 StoredRun 和完整 Turn 读快照的投影；暂停时间、事务和 Attempt 由 R04 处理。
- `index.ts`：模块导出；本 `README.md`：设计、接线申请和验证交付。
- `src/renderer/features/workflows/{WorkflowFeature.tsx,index.ts,workflows.css,README.md}`：独立表单、版本范围隔离、预览/应用防重复、Main 只读进度、双主题与适配说明。
- `tests/unit/workflows/{fixtures.ts,compiler.test.ts,progress.test.ts}`：四模板、非法输入、版本冻结、有限计划和证据门禁。
- `tests/unit/rendererWorkflows/{fixtures.ts,WorkflowFeature.test.tsx}`：编辑、阶段顺序、成员顺序、过期预览、重复/迟到操作、错误与权威进度。
- `tests/integration/workflows/{planConsumer.test.ts,featurePreview.test.tsx}`：SQLite/R05/Mock 提议接缝和 UI 经 fixture 父层调用真实编译器。前者测试消费者只在测试目录存在，不是生产 RunService 的另一套实现。

## 本次验证记录（2026-10-20，macOS arm64）

使用现有官方受控 Node24.18.1 完整 runtime 及其同版 headers、ABI137，pnpm11.25.0、TypeScript5.9.3、Vitest3.2.7、better-sqlite3 12.11.1；未升级 package/lock。首次从无 node_modules 起点，以独立复制的内容缓存/只读 SQLite 索引备份准备本 Worktree 私有 store/cache/state，再 `--frozen-lockfile --offline --package-import-method=copy --side-effects-cache=false` 安装成功（646包、0下载）。这不是冷缓存联网安装，也没有复制或共享可变 node_modules。Node 原生源码重建成功，真实 SQLite 内存与临时文件读写由专项实际执行。

本轮监督器及原始日志保留在 `/private/tmp/r11-validation-tpu214ls`（临时目录，不入库）。执行以下命令时通过该目录的 `bin` 将 PATH 内 node/pnpm 均固定为已核对 runtime/CLI，`npm_config_nodedir` 指向完整 Node runtime，TMPDIR/npm/cache 均为本次私有目录。每个命令外部上限300秒。

| 实际命令 | 退出码/结果 | 证据与边界 |
| --- | --- | --- |
| `pnpm --config.store-dir=/private/tmp/r11-validation-tpu214ls/store --config.cache-dir=/private/tmp/r11-validation-tpu214ls/cache --config.state-dir=/private/tmp/r11-validation-tpu214ls/state install --frozen-lockfile --offline --package-import-method=copy --side-effects-cache=false --reporter=append-only` | 0 | `install.json` / `logs/install.log`；store/cache/state 为本轮私有 |
| `pnpm exec vitest run tests/unit/workflows tests/unit/rendererWorkflows --reporter=dot`（实现前） | 1，预期 RED | 编译器/feature 尚不存在，3个测试文件导入失败；不是通过或空集成功 |
| `pnpm run native:node` | 0 | `native-node.json`；24.18.1 同版 headers/arm64，编译警告保留 |
| `pnpm exec vitest run tests/unit/workflows tests/integration/workflows tests/unit/rendererWorkflows --reporter=dot`（最终专项） | 0，5文件86/86 | `focused-complete.json`；57 Main 单元 + 15 UI 单元 + 14 集成，重叠不与全量相加 |
| `pnpm run test --reporter=dot`（允许回环 fixture） | 0，92文件1403/1403 | `full.json`；此后仅新增5项 UI/实际编译器 fixture 测试，已包含在最终86项中；业务代码无后续变化 |
| `pnpm run typecheck`（最终树） | 0 | `typecheck-handoff.json` |
| `pnpm run build`（最终树） | 0 | `build-handoff.json`；既有 Zod PURE 注释警告保留。App 未接入本模块，不能把成功构建当生产工作流已可用 |
| `pnpm run native:electron` | 0 | `electron-rebuild.json`；改用本轮私有的Electron38.8.6 headers，gyp确认ABI139/arm64，不混Node headers，不共享可变原生文件 |
| `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /private/tmp/r11-validation-tpu214ls/sqlite-smoke.cjs` | 0 | `electron-smoke.json`；实际Electron38.8.6、内置Node22.22.0、ABI139，内存建表/写入/查询/关闭成功，不加载Main |
| `ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/workflows tests/integration/workflows tests/unit/rendererWorkflows --reporter=dot` | 0，5文件86/86 | `electron-r11.json`；与Node专项分开，不算桌面E2E或生产接线 |

最终原生文件留在 Electron ABI139。后续运行 Node 数据库测试前须使用同版 Node24.18.1 headers 重建，再恢复 Electron；不能直接沿用默认 Node24.21.0。未为独立 feature 启动完整 Electron 应用，不触碰个人 profile 或 OS Keychain。

中间失败均保留：首轮 UI 测试用 input.disabled 错判 fieldset 继承禁用，改为有效 `:disabled` 断言；首次类型检查发现测试表的隐式 any，补明确类型；首轮 SQLite fixture 把整 StoredRun 交 strict 子集校验，修为字段投影；其后 fixture senderName 与冻结成员显示名不一致被 R05 正确拒绝，修正测试数据。新增双模型跨阶段第三成员和删除阶段测试先 RED 后修复。独立审查实际复现删除中间阶段后添加导致标题重名，补回归并统一使用稳定 nextId；没有改他人代码或降低校验。

任务书形式 `pnpm run test -- tests/unit/workflows tests/integration/workflows tests/unit/rendererWorkflows --reporter=dot` 在 pnpm11 将 `--` 原样传给 Vitest，筛选未生效，沙箱中意外全量：92文件、66失败/1336通过、40个未处理错误、exit1，均来自本机回环监听 EPERM。`focused-final.json` 与原日志保留；不将其标为通过。随后本机端口获许可，明确完整命令复验1403/1403成功；专项使用 `pnpm exec vitest run ...` 正确筛选。没有修改 package、测试配置或现有失败测试。

真实浏览器仅加载临时的独立 feature fixture（不加载 Electron Main/IPC），在1280×720实际视口观察亮/暗主题、模板控件及五阶段切换。初次启动未固定子进程 PATH，误用默认 Node24.21.0，Rollup原生签名失败；补正确 PATH 后沙箱 localhost EPERM，获许可后启动成功。IAB Playwright label 选择器无匹配，改用已观察到的原生可访问控件，实际五阶段变化已确认。这些是有限界面观察，不是正式 E2E、完整窗口矩阵或生产装配验收。

## 遗留与停止边界

没有新增/改写 Shared、SQL migration、RunService、状态机、context、IPC、Preload、App、store、session、package/lock、治理状态看板；生产调度仍保持原行为，等待总控统一批准和接线。旧快照执行与降级策略必须先审查，不能忽略新计划运行；R11 配置/计划不是真实调用许可。

生产计划驱动的 Pause/Stop/Step/Resume、显式 retry/recovery、公开进度和同房间实际阶段输入、生产重启/退出恢复均**未验证**；独立 fixture/原 R04 全回归不能替代总控联合验收。未发真实付费请求，未访问用户 DB/Keychain，未实施 R12/R13/R14/R17。正式 Electron E2E、窗口矩阵/对比度/键盘全路径、跨平台、打包/安装/签名/发布均未验证。交付停在本 Worktree 独立提交，不合 main，不更新 merged/verified。
