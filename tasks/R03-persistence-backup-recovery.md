# R03 持久化、可靠备份与恢复数据实施任务计划

> 当前状态见 [STATUS](../docs/STATUS.md)。子项目及总控集成已获用户授权；本分支为 review / 待最终合并审核，未合 main。后续任务不得自动启动。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 持久保存可重建 Run 的执行证据，完成可验证备份与异常退出分类，提供后续模块安全数据接口。

**Architecture:** SQLite 仍只在 Main。总控统一 migration 与现有 Database 单文件；新增备份/恢复模块分责。数据库负责数据事实，调度恢复和付费重试决定由 R04/可信命令负责。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [src/main/database/Database.ts](../src/main/database/Database.ts) 第 169–192 行 迁移前 checkpoint 后复制单 DB，未校验 checkpoint 是否 busy，备份没有恢复验证。
- [src/main/database/Database.ts](../src/main/database/Database.ts) 第 246–258 行 getRun 只返回简版字段，异常分类排除 paused；task/进度/请求上下文无法重建。
- [src/main/database/Database.ts](../src/main/database/Database.ts) 第 310–327 行 按房间全量读消息、按游标读事件；[src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 322–324 行 每增量全读事件找最后条。
- [tests/unit/database.test.ts](../tests/unit/database.test.ts) 第 5–34 行 现有 DB 测试仅 :memory:，不能证明磁盘备份、升级或恢复。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

执行配置/成员与任务快照、进度/请求尝试/累计执行时间的数据层；一致性备份、迁移失败与恢复验证；异常非终态统一 interrupted；Run 定向消息与事件查询、分页基础。

明确不做：不自动重发中断请求、不实现 RunService 状态机/Provider/房间 UI；不操作真实 userData、不修改已发布 migration、不把拷贝成功当可恢复证明。

## 前置与必读

R02 契约/迁移归属已合入；R03 获实施授权。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 现存（135bf82） | src/main/database/Database.ts | 总控（R03 数据协调） | 所有 migration 与现有单文件数据 API，后续扩展也走总控 |
| 拟新增 | src/main/database/backup/**；src/main/database/recovery/** | R03 | 一致备份/校验/恢复模块，不在模块内自行编号迁移 |
| 现存（135bf82） | tests/unit/database.test.ts | R03 | 临时磁盘数据库、升级失败、备份恢复与游标查询 |
| 拟新增 | tests/unit/persistence/**；tests/integration/persistence/** | R03 | 临时磁盘数据库、升级失败、备份恢复与游标查询 |
| 现存（135bf82） | src/main/index.ts | 总控 | 恢复启动接线和数据/迁移语义 |
| R00 已建立（原基线新增） | docs/CONTRACTS.md；docs/DECISIONS.md | 总控 | 恢复启动接线和数据/迁移语义 |

## Worktree 可独立与可并行

可独立 codex/r03-persistence-backup-recovery Worktree；R00→R01→R02→R03 串行。数据结构合入后 R04/R05/R06 才可并行；三者不得并发修改 Database，迁移申请串行。

## 共享依赖与接线规则

总控先合入执行元数据与 repository 接口。迁移提交包括升级来源、回滚/备份策略和 fixture；不得由各模块各加版本号。R04 消费完整 Run，R05 消费公开历史，R06 消费一致快照。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [x] 建立旧 schema、WAL busy 与异常退出磁盘 fixture。
- [x] 总控在集成候选接线数据契约与新增 migration 2；实现模块化备份/恢复（尚未合 main）。
- [x] 运行升级、失败、恢复和一致读取测试，检查无真实用户数据访问。
- [x] 交付 migration 版本、数据接口和 R04/R05/R06 接线说明，见[实际集成报告](../docs/verification/2026-10-15-r03-integration.md)。

## 详细验收

- [x] 重开临时文件 DB 可读任务身份、配置/成员快照、进度、请求尝试、部分文本和限制；paused 不依赖旧进程 Map 才能识别。
- [x] 异常退出时所有应恢复的非终态归 interrupted（idle 按总控 D035 保持原值），保留部分输出；完成/取消不误改，不发起 Provider。
- [x] 备份采用 SQLite 一致性机制；busy/失败明示，不把遗漏 WAL 的拷贝登记成功。
- [x] 备份恢复到独立临时文件后 integrity/外键和关键数据一致；迁移失败不留下半升级或覆盖有效备份。
- [x] Run 消息和快照/事件 cursor 同一一致读取边界；追加事务返回确切事件，不要求 R04 每次全量读。
- [x] 已发布 migration 内容保留；新版本由总控分配；旧基线升级与最新重启都可验证。

以上复选为集成候选已运行的验收证据，不代表用户最终批准或 main 已 verified。正式 E2E/跨平台/发布/真实模型及同步校验截止的限制见集成报告；完整恢复调度与累计限制仍属 R04。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 升级与持久化 | 135bf82 schema 临时磁盘 fixture 写入 Run/部分文本后升级重开 | 关系/文本/配置完整，schema 版本只前进一次 |
| checkpoint busy | 第二读连接占用 WAL 时触发备份 | 一致备份或明确失败；恢复内容不缺已提交写入 |
| 失败回滚 | 注入 migration 中途异常 | 无半升级；原数据仍读得出，备份可恢复 |
| 恢复分类 | 分别构造 running/pausing/paused/cancelling/completed/cancelled | 仅非终态按规则中断，不产生网络请求 |
| 快照游标 | 事务前后抓快照、并发附加增量再订阅 | 消息与 cursor 一致；无缺字、重复或跨 Run 混入 |

pnpm run test -- tests/unit/database.test.ts tests/unit/persistence tests/integration/persistence；pnpm run typecheck。所有文件 DB 位于每例独立临时目录，测试只清理自身目录。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。
