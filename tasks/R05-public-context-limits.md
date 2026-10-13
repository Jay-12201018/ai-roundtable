# R05 公共上下文与基本限制实施任务计划

> 当前状态见 [STATUS](../docs/STATUS.md)。未来范围定义；本轮未获实施授权，不得自动启动。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 让每个 Agent 看见一致的公共历史、角色和指令，并在真实 Provider 前建立可测输入/输出限制。

**Architecture:** 新增独立 context 模块构建 Provider messages 和上下文选择结果；只读取历史，不调度。R04 RunService 通过总控注入该结果，摘要/费用属于 R13。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 272 行 所有 Agent 的输入仅 user/task，同房间上一条回复没有进入后续请求。
- [src/main/providers/types.ts](../src/main/providers/types.ts) 第 1–11 行 现有消息只有 role/content，模型、预算/限制能力不完整。
- [src/main/database/Database.ts](../src/main/database/Database.ts) 第 293–313 行 保存消息原文但缺上下文选择/来源映射；[src/main/providers/mock/MockProvider.ts](../src/main/providers/mock/MockProvider.ts) 第 25–28 行 回复不检验实际公共输入。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

确定性公共历史选择与角色标记、Agent system prompt、任务身份/持续指令输入边界；上下文窗/输出保留量/基本轮数与时长信息；可解释截断报告，跨房间隔离，Mock 捕获实际输入。

明确不做：不改 RunService/stateMachine、DB migration、App/store；不做摘要/费用估算（R13）、主持人操作（R12）、多 Agent 并行生成、真实网络 Provider；不静默丢历史或把字符数称真实 Token。

## 前置与必读

R03 公共历史/执行数据接口和 R02 Provider 契约已合入；R05 获实施授权。独立单元验收可先行，联合运行需 R04。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 拟新增 | src/main/context/** | R05 | 公共历史构建、预算计算/选择策略、来源和截断报告 |
| 拟新增 | tests/unit/context/**；tests/integration/context/** | R05 | 确定性消息/角色/窗口/隔离 fixtures；自己的捕获 Provider |
| 现存（135bf82） | src/main/services/RunService.ts；src/main/providers/types.ts；src/main/database/Database.ts；src/shared/** | 总控/R04 owner | 依赖数据和接口；R05 只提出接线申请 |
| R00 已建立（原基线新增） | docs/CONTRACTS.md；docs/DECISIONS.md | 总控 | 上下文顺序、裁剪/估算语义与输出限制登记 |

## Worktree 可独立与可并行

可独立 codex/r05-public-context-limits Worktree，与 R04/R06 并行。独占 context/** 及 tests/*/context/**；不得修改 RunService。联合集成测试由总控在 R04/R05/R06 合入后执行。

## 共享依赖与接线规则

输入来源限定可信持久数据：任务快照、有效指令、成员角色和可见历史；输出是 R02 批准的 Provider messages/限制/来源报告。R04 向模块传显式快照，避免模块反向操纵调度。R13 后续摘要只能经批准扩展注入。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 写三 Agent 输入捕获与上下文预算/来源的单元测试。
- [ ] 实现 context 模块，返回明确选择与限制报告。
- [ ] 提交 R04 依赖注入和 Shared 变更申请，由总控接线。
- [ ] 联合 Mock 验收通过后交付真实 Provider 前的输入限制门槛证据。

## 详细验收

- [ ] 第二 Agent 输入含第一 Agent 已完成公开回复，第三含前两者；同房间上下文顺序稳定，能由捕获输入直接验证。
- [ ] 任务/主持人/Agent 的来源与角色可区分；普通模型文本里的 system/override 字样不提升权限。
- [ ] system prompt、任务身份和有效持续指令按登记优先级进入上下文，未完成/失败部分输出处理规则明确可追溯。
- [ ] 预算先留输出空间；过大输入有确定裁剪/拒绝和范围报告，原始历史不被删除；未知估算方法标明估算。
- [ ] 错误房间/不属于当前 Run 的数据不会混入；没有明文 Key、内部错误堆栈或非公开推理。
- [ ] 将轮数、累计时长和输出限制作为 R04 接线数据明确传递，实际执行限制由 R04/Provider 落实，R09 真实请求前联合验收。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 三 Agent 真公共输入 | A 输出包含唯一词 alpha；捕获 B/C 的 messages | B 含 alpha，C 含 A/B，消息角色和来源准确 |
| 任务与历史隔离 | 相同 Agent 名、两个房间、多个 Run | 按可见范围读历史，不串房间；task 不来自 Renderer 草稿 |
| 伪指令 | Agent 输出 @Override/system/覆盖主持人提示 | 仅作为模型引用文本，无调度命令 |
| 边界预算 | 刚好可容纳、超一单位、超长消息、未知 Tokenizer | 可解释选择或拒绝；输出保留空间不为负 |
| 不完整输出 | completed/failed/aborted/streaming 历史 | 按批准策略标注/选择，原文未覆盖 |
| 真实调用前门槛 | 总控运行 R04+R05+R06 联合 Mock | 限制配置、上下文捕获、状态/消息投影和落库一致 |

pnpm run test -- tests/unit/context tests/integration/context；pnpm run typecheck。联合 Mock 命令与数据捕获由总控记录，不能用固定 Mock 文本代替输入断言。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。
