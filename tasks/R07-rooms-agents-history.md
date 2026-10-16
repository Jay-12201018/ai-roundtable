# R07 房间、成员与公共历史实施任务计划

> 当前状态见 [STATUS](../docs/STATUS.md)。未来范围定义；本轮未获实施授权，不得自动启动。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 用可持久配置的房间、成员和历史替换固定 Demo，并保持旧 Run 的身份和执行快照。

**Architecture:** 独立 room 服务和 Renderer rooms feature 消费总控数据/IPC；成员编辑不反向修改运行中的快照或历史 Turn。公共历史仍由 R05 选择，不绕过上下文边界。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 34–53 行 固定三个 Demo 成员；[src/main/ipc/registerIpc.ts](../src/main/ipc/registerIpc.ts) 第 15–16 行 只有 createDemo/getMessages。
- [src/main/database/Database.ts](../src/main/database/Database.ts) 第 70–81,211–220 行 有 Agent 配置预留字段但有限 insert/list 方法未暴露模型/system prompt。
- [src/renderer/App.tsx](../src/renderer/App.tsx) 第 125–148,175–178 行 只有新建任务和当前 room-card，没有完整导航与 CRUD。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

房间/成员创建、编辑、排序、启停、归档/删除规则；每成员角色/system prompt/model/provider 引用；分页历史与 Run 浏览、持久任务标题，运行时配置快照；可用 UI。

明确不做：不做云账户/多用户/同步；不修改 RunService/context/store/App、设置 Key（R08）、真实 Provider（R09）、复杂消息版本（R12）；不因删成员破坏历史。

## 前置与必读

R04/R05/R06 已合入且三 Agent 公共历史/控制/投影联合 Mock 验收完成；R07 获实施授权。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

涉及 UI，先读 [DESIGN_GUIDELINES](../docs/DESIGN_GUIDELINES.md)，功能决定布局、体验决定交互；UI 组件只消费已合入契约。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 拟新增 | src/main/room/**；src/renderer/features/rooms/** | R07 | 房间/成员服务与独立导航、编辑、历史 UI |
| 拟新增 | tests/unit/rooms/**；tests/integration/rooms/**；tests/unit/rendererRooms/** | R07 | CRUD、历史快照、引用与 UI 场景 |
| 现存（135bf82） | src/main/database/Database.ts；src/shared/**；src/main/ipc/registerIpc.ts；src/preload/index.ts | 总控 | CRUD 数据接口、migration 与 typed IPC |
| 现存（135bf82） | src/main/services/RunService.ts；src/main/index.ts；src/renderer/App.tsx | 总控协调 R04/R06 owner | 配置快照与 features 组装 |
| 依赖任务提供（当前拟新增） | src/renderer/store/** | 总控协调 R04/R06 owner | 配置快照与 features 组装 |

## Worktree 可独立与可并行

可独立 codex/r07-rooms-agents-history Worktree，与 R08 并行；rooms/** 和 settings/** 不交叉。共同 Provider 引用/DB/IPC 需求先由总控合入，禁止各自修改 Database。

## 共享依赖与接线规则

提交 Room/Agent/History DTO 与 repository 需求，明确引用存在性、删除策略和执行中编辑规则；Provider 引用消费 R08 契约，R08 也不得直接改 rooms 模块。通过总控的单独接线完成调用方。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 建立临时 DB 的 CRUD/快照/删除规则测试。
- [ ] 实现 room 服务与独立 feature，向总控申请 DTO/数据/IPC。
- [ ] 总控组装 R04/R06 调用和 R08 Provider 引用。
- [ ] 运行可配置三成员 Mock 与历史浏览，交付 UI/数据证据。

## 详细验收

- [ ] 房间与成员 CRUD/排序/启停持久有效，刷新/重启仍正确；配置输入经 schema 验证。
- [ ] 成员支持 Provider/model/角色/system prompt，未配置引用的状态可理解；没有启用成员时启动明确拒绝。
- [ ] 启动复制成员/任务配置到 Run，后续编辑不改变旧 Run；历史显示当时姓名/模型/角色，不用当前配置覆盖旧消息。
- [ ] 存在历史 Turn 的成员删除采用批准保留策略；房间归档/删除有明确用户动作且不误操作其他房间。
- [ ] 分页历史顺序稳定、无漏重；选房后的迟到查询不覆盖新选择；跨房间数据不混。
- [ ] 完成可配置三 Agent Mock 公共协作而非只固定 Demo；UI 符合设计规范与 R06 命令状态。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 配置往返 | 创建/改名/排序/禁用成员，重开磁盘 DB | 配置与导航恢复；排序决定预期配置 |
| 历史不变 | 运行后改角色/姓名/model，再打开旧 Run | 旧快照与原消息身份保持 |
| 删除引用 | 有 Turn 的成员、无历史成员、活动房间 | 按批准规则归档/拒绝/删除，无孤儿记录 |
| 非法启动 | 零启用成员、无效 provider/model 引用 | 结构化错误，未创建付费请求 |
| 翻页切房 | 同时间戳大量历史+迟到旧房查询 | 顺序稳定，不漏重、不串房 |
| 联合 Mock | 自定义成员与输入，运行并刷新 | 公共历史进模型，身份/状态/DB/Renderer 一致 |

pnpm run test -- tests/unit/rooms tests/integration/rooms tests/unit/rendererRooms；pnpm run typecheck；pnpm run build。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。


## 2026-10-16 共享前置交付与启动边界

用户本轮仅授权总控共享前置候选，未授权本feature或其Worktree。实际接口、调用示例、错误/分页/引用规则及唯一文件归属统一见[共享调用手册](../docs/R07_R08_SHARED.md)；本任务不再自行定义第二套DTO或migration。候选分支 `codex/shared-r07-r08-foundation`，基线 `510f58a75c676496f6e4e5960eb89553d04ab8ac`，仍待审核/合main。

启动前先确认共享候选已由用户批准合入并完成main新鲜复验，登记真实最终完整main SHA；R07/R08均从该同一SHA开始，并各自获得创建/实施授权。Shared/Database/migration3/公共测试/Main/IPC/Preload/App/store等由总控冻结，模块只消费；所有新增接线请求统一交总控。此追加不勾选既有功能验收复选框，也不推进R09。
