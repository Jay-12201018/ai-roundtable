# R03 总控数据库接线与集成验证报告

日期：2026-10-15，macOS darwin-arm64。结论：R03 数据接线形成可审查的集成候选，建议进入最终合并审核；本轮不合 main、不标 verified、不启动 R04。正式发布、跨平台与完整桌面 E2E 不在通过结论内。

## Git、授权与文件归属

- 开始时 main 实际 HEAD：`be37fad9d05050a9bad1847e5008bc67752523f6`，工作区干净，R02 已 verified；原始 `135bf82c6462ade6dd5300717d6f0102ce4a660c` 历史保留。
- 原 R03 分支：`codex/r03-persistence-backup-recovery`，提交 `212808f780cc87d2827a977743f3fc16a028f5b5`，父基线就是上述 main。原 Worktree `/Users/zhangwenjie/.codex/worktrees/2e06/AI交互` 保留。
- 新建并附加独立集成 Worktree `/Users/zhangwenjie/.codex/worktrees/integrate-r03/AI交互`，分支 `codex/integrate-r03`，基于实际 main。安全 cherry-pick 得到 `f144ace84f7861c4f8cf577d0d0d40aa3aae8110`；该提交文件树与原 R03 提交完全相同。
- 本次共享接线、测试及本报告一起提交；交付完整 SHA 由本分支 `git rev-parse HEAD` 和最终交付消息给出。只引入一次原 R03 代码，没有重复合原分支，没有改写历史。
- 唯一共享写入人为总控：Shared Schema、migration 编号、Database、Main、RunService、共同测试及治理文档。协作者进行初期只读数据/生命周期审查，临时环境准备单独分责；没有并行改同一源码。最终修改由总控逐项审查，未把初期审查冒充最终独立复审。

## 相对 main 的完整文件清单

`A` 为新增，`M` 为修改；包含引入的原 R03 模块和本次共享接线，不包含忽略的依赖/构建/临时数据。

```text
M docs/CONTRACTS.md
M docs/DECISIONS.md
M docs/ENVIRONMENT.md
M docs/STATUS.md
M docs/VALIDATION.md
A docs/verification/2026-10-15-r03-commands.md
A docs/verification/2026-10-15-r03-integration-plan.md
A docs/verification/2026-10-15-r03-integration.md
M src/main/database/Database.ts
A src/main/database/backup/createVerifiedBackup.ts
A src/main/database/migrations/v2.ts
A src/main/database/recovery/R03-HANDOFF.md
A src/main/database/recovery/classifyInterruptedRuns.ts
A src/main/database/recovery/prepareRestore.ts
A src/main/database/recovery/validateDatabase.ts
M src/main/index.ts
M src/main/services/RunService.ts
M src/shared/schemas/index.ts
A src/shared/schemas/persistence.ts
M src/shared/schemas/run.ts
M tasks/R03-persistence-backup-recovery.md
M tasks/README.md
A tests/integration/persistence/attemptsAndCursors.test.ts
A tests/integration/persistence/backupRecovery.test.ts
A tests/integration/persistence/legacyMigration.test.ts
A tests/integration/persistence/migrationV2.test.ts
A tests/integration/persistence/r03Integration.test.ts
A tests/integration/persistence/restoreCancellation.test.ts
M tests/probes/r01-electron.cjs
M tests/probes/r01-sqlite.cjs
M tests/unit/appLifecycle.test.ts
M tests/unit/database.test.ts
A tests/unit/persistence/classifyInterruptedRuns.test.ts
A tests/unit/persistence/fixtures.ts
A tests/unit/persistence/integrity.test.ts
```

## 实际行为与 R03-SHARED-01

### 数据契约与 migration 2

`src/shared/schemas/persistence.ts` 是执行记录、成员快照、Attempt 和分页输入的 Zod 来源；类型从它派生。请求输入复用 R02 `streamChatInputSchema`。Main 私有 `StoredRun` 保留原 workflow JSON/lastError；普通 RunSnapshot 仍经 R02 安全 Schema 输出。Attempt 私有输入和 providerRequestId 不进入普通快照、事件或新增通用 IPC。

`src/main/database/migrations/v2.ts` 是总控分配的新增版本。原 migration 1 SQL 与 main 逐字节相同，SHA256 为 `84775352375dbb3cff387ef6da8c7c8a84872c4ca70c97be891b96bdf3009520`。新增内容：

1. Run：任务、冻结成员、下一 Turn 索引、累计已观察执行毫秒。既有限制、模式、指针和时间字段完整读取。
2. `request_attempts`：requestId 全局主键，Turn 内 attemptIndex 唯一且顺序分配，messageId 唯一；跨 Run/房间/Turn 关联校验，首 Attempt 保留 Turn 原 requestId；身份和输入不可修改，终态不能回到 running。
3. 事件新增持久协议版本和 Attempt requestId；原 v0 JSON/顺序/文本保持原文，新事件为 v1，未知协议输出时重同步。
4. 消息稳定单调 sort_key、持久计数器及 Run 定向索引，避免按 offset 翻页；备份目录增加 SHA、大小、页数、完整性证据和验证时间。

历史缺失 task/members/progress/time/input 一律 NULL；不把房间 objective 当任务，不用创建时间推算请求开始/执行时长。只有 requestId 全局唯一且有唯一明确消息关联的旧 Turn 才回填 legacy Attempt，输入及请求时间仍 NULL。旧备份目录行没有验证证明就不受信任。

### 同一个 Database 的持久化与一致读取

- `insertRun/getRun/updateRunProgress` 保存完整执行记录；新增 Run 的元数据先验证后单条 INSERT，失败不留半行；已知进度只前进，未知历史不能冒充从 0 开始。
- `createAttempt/getAttempt/listAttempts/updateAttempt` 保存实际请求及状态；RunService 在 Provider 调用前登记 pending Attempt，收到 start 后登记 running/providerRequestId，与 Turn/Message 终结写入同一事务。
- `appendRunEvent` 在 immediate 事务内分配 MAX+1、写入，并返回本次真实持久化对象。状态与事件一起提交；通知仅在最外事务提交后发出，回滚不会留下幽灵事件。不再为每个流增量全量读事件找最后条。
- `listRunMessages(runId,{after,limit})` 游标绑定 Run，limit 1..500，稳定键排除跨 Run 混入；消息页内查询也使用一个读事务。
- `listRunEvents(runId,{cursor,throughSequence,limit})` 排除 cursor、包含固定上界，新事件不混入已经冻结的分页；旧数字游标入口保留供现有调用方兼容。
- `readRunSnapshot/readRunSubscription` 在同一 SQLite 读事务获取 Run/Turn/Message/Attempt/事件上界。事件超过 500、缺序、损坏 JSON、未知协议或不能安全适配的历史事件返回权威快照及 resyncRequired，不假装只交付首 500 条就同步完成。

### 备份、升级失败与恢复候选

旧 checkpoint 后复制数据库流程已替换为 SQLite 在线一致性备份。`initialize()` 对磁盘旧库返回 Promise，Main 必须等待；空库/最新库仍兼容同步返回。

启动先拒绝不完整/间断/高于支持版本的数据库，不改变其 ledger 或 journal；磁盘升级先在规范化、无符号链接且 0700 的私有 backups 目录生成随机新文件，用 integrity/外键/关系/完整数据摘要验证，再创建独立恢复候选并再次验证。只有此后才在同步事务应用 migration 2、校验升级结果并登记备份。事务失败保留原数据和已验证备份；临时恢复候选只清理自身目录。测试实际注入 migration 中途失败，原数据库文件字节完全相同。

备份文件 0600，以硬链接排他发布，不覆盖既有有效备份；POSIX 同步文件和目录。`prepareRegisteredRestore(id)` 仅供可信 Main，通过已验证 catalog、目录/名称/文件类型/哈希及恢复证据后返回独立候选，**不会覆盖原数据库或自动启用发现的文件**。`prepareRestore` 的取消/总截止覆盖最终哈希阶段，失败清理自己的候选。

### 启动恢复与 R01 退出屏障

只将 running、pausing、paused、cancelling 父 Run 分类为 interrupted；其未终结 Turn/Attempt 同步中断、streaming Message 转 aborted，保留部分文本、请求身份和私有输入。清除活动指针，事务内追加一次 interrupted 事件。再次恢复返回 0，不碰其他父 Run 的子记录。

总控明确决定 idle 保持 idle，因为它没有证明已经发起执行；completed/cancelled/error/interrupted 等终态保持原值，不新增状态机转移或自动请求。恢复结束才创建 RunService/窗口，内存活动锁为空。

Main 退出屏障只等待**已经开始**的 initialize Promise，再停止服务/关闭一次数据库；退出期间不创建服务或窗口，晚到的初始化失败以非零退出。新增延迟成功/失败测试，保留既有 R01 窗口、IPC 来源、sandbox/CSP 和 disposer 测试。

RunService 的接线只记录现有执行事实：实际 task、当时有序成员、当前 Mock 有效模型/空 systemPrompt、限制、模式变更、请求输入、进度及活动执行段时间。暂停时间不累计，不猜测崩溃后未检查点的空档；没有把预留 Agent provider/model 配置冒充本轮实际调用配置。完整累计超时策略、跨进程 resume/retry/continue 和调度仍属于 R04。

## 本次环境与隔离

证据根为 `/private/tmp/roundtable-r03-integration-zbve4_w4`，每条受检命令有日志和 JSON 退出记录。所有文件数据库、Electron userData/sessionData/logs 在该根的 test-tmp 或测试自身 mkdtemp 中；桌面探针在 ready/Main import 前设置路径、阻断网络并拒绝权限，只使用 Mock。退出后验证 keys/providers 均为空，没有访问真实 Key 或真实用户数据库。

| 部件 | 本次实际受控版本/方式 |
| --- | --- |
| Node | 官方 24.18.1 darwin-arm64，ABI137，同一完整发行包 runtime/include/config |
| pnpm | 11.25.0，显式受控 Node 执行；入口、bundle、worker.js、package.json 与官方缓存 tarball 一致 |
| SQLite adapter | better-sqlite3 12.11.1；Node 与 Electron 分别源码编译，不共享可变 node_modules |
| Electron | 38.8.6，嵌入 Node22.22.0，arm64 ABI139；对应 38.8.6 headers |
| 测试/构建 | Vitest3.2.7、TypeScript5.9.3、electron-vite4.0.1；原 package/lock/workspace 文件未改 |

本次重新检查官方 runtime/header 归档、实际二进制及 pnpm 文件哈希。Node runtime tar.gz SHA256 `eb02f7fab96d3d67de40c5ec8566096fcb4c2026728787683ae5a97eb612b941`，headers tar.gz `bee7344a7fc6e3252c4822ca916a50cd6ddda9bb39374d6140a8046d9238fded`。没有使用 24.21.0 或跨补丁 headers。已确认的 24.21.0 ObjectWrap 上游风险仍按 R02 记录保留。

集成 Worktree 最初没有 node_modules。本次以独立 inode 的缓存内容/只读源索引备份准备独立 store/cache，冻结离线安装使用 `--package-import-method=copy --side-effects-cache=false`，646 reused / 0 downloaded，实际运行原生编译与安装脚本。最初缺 metadata 的离线安装失败后，补充独立元数据缓存并成功，未关闭完整性/年龄策略。**这是从缓存安装的独立依赖，不是本次全新冷缓存联网下载验证，也不是复制旧 node_modules**。ENV-R02-INSTALL-01 保持已解决，未使用曾导致悬挂的 raw 数字配置。

已安装锁文件与仓库锁文件逐字节一致，32 个直接依赖清单命令 exit0；main、原 R03、集成 R03 的 SQLite 原生文件 inode 不同。最终集成依赖恢复为 Electron ABI139，后续 Node 测试仍须先受控重编译。

## 实际验证结果

完整逐命令、超时、退出码和阶段记录见[命令台账](2026-10-15-r03-commands.md)。下面只列本次最终受检结果，绝不以子项目历史 286/286 替代。

| 检查 | 本次结果 | 关键覆盖 |
| --- | --- | --- |
| 引入提交基线 | 22 文件、286/286，exit0 | 在本集成独立依赖实际运行；与最终结果分列 |
| 完整 Node 单元/集成 | 26 文件、313/313，exit0 | 原测试全部保留；包含源码重编译的 pnpm test，随后增加磁盘重开断言再全回归 |
| 数据库/备份/恢复专项 | Node 9文件84/84 exit0；新增写锁断言后由最终313全回归覆盖；Electron最终9文件85/85 exit0 | 升级/失败回滚、WAL busy、并发读写/写锁、Attempt、固定游标、快照、恢复幂等 |
| TypeScript | exit0 | Shared、Main、全部测试消费一致 |
| 生产构建 | exit0 | Main、CJS Preload、Renderer；未改构建依赖 |
| Node SQLite | 内存 exit0；5 次各 30 万 prepare/get/自然 GC/正常退出，全部 exit0 | 严格 Node24.18.1 ABI137；不是仅检查 ABI 号 |
| Electron SQLite | 源码重编译、实际内存读写 exit0，ABI139 | 随后执行数据库专项 |
| 隔离真实 Electron | exit0 | 真实旧 v1 库升级、9 种父状态中仅 4 类恢复、生产页面/Bridge/事件注销/Mock/退出 |
| 退出后只读数据核对 | exit0 | 原部分文本/请求/未知输入、有效 v1 备份、正常 paused→cancelled、Key/Provider 空 |

专项中的关键证据：真正从原始 135bf82 SQL 生成 v1 fixture；升级重入 ledger 只到 [1,2]；中途失败原文件字节不变；WAL checkpoint busy 时备份含最新已提交消息；两个连接争写时在分配序号前受写锁保护，之后顺序为 [1,2]；另一个 WAL writer 在读取中提交时，消息页与快照仍取同一旧视图。多 Attempt 同 Turn 的两个 requestId 经订阅/备份/独立恢复仍保持对应输入；未知协议不返回原 payload。

隔离桌面证据：`test-tmp/roundtable-r01-electron-f0cOMS/probe-result.json`。sandbox/contextIsolation/webSecurity=true、nodeIntegration=false；nodeGlobalsAbsent/rootRendered/listenerCancelled=true；生产 CSP connect-src 'none'；preloadErrors/consoleErrors/CSP violations 均为空。本机仍输出 Electron sandbox_extension_issue_file_to_process 诊断，但退出码和上述实际断言均通过，不隐去该日志。

## 开发中失败与修复（没有掩盖失败）

- 最初环境预检把官方 worker.js 误写为 worker.mjs，修正后才验证来源；初次 pnpm exec 在未安装/未提权工作区触发自动安装 EPERM，受控运行权限修正后执行。没有当作 PASS。
- 离线安装 exit1：ERR_PNPM_NO_OFFLINE_META；补齐自己的 metadata 缓存后同冻结命令 exit0。
- 红测实际发现缺少执行字段/Attempt/分页、paused 恢复遗漏、事件返回值不准确；补齐公共数据接线后转绿。
- 生命周期/最终哈希取消红测共 3 项失败，修复初始化退出等待及恢复取消后转绿；保留测试。
- 首次全回归 8 项失败及 1 个未处理拒绝：旧 fixture 使用同步 disk initialize、数值 append 返回及版本1预期；改为等待真实升级、断言真实事件对象/[1,2]，并为真实 v2 失败保留单独回滚测试。没有放宽来源或数据安全断言。
- 两次 Attempt 的备份校验最初错误按 Turn 唯一 requestId 判 v1 事件；改为持久 Attempt 身份校验，原 v0 验证原样保留。
- 元数据原子性、state+event 回滚、首 Attempt 身份、假 current ledger、并发分页视图/有效 mode、负协议版本/错误 sender 红测均复现对应缺陷并转绿。
- 中间 TypeScript exit2、类型断言换行语法错误、Vitest each fixture 写法错误、Vite cache EPERM 均单列在台账；修复真实原因，最终类型/全回归通过。没有 skip、删除失败测试、passWithNoTests 或依赖升级。

## 验收、后续接口与未验证事项

| R03 验收项 | 集成候选结论 |
| --- | --- |
| 完整执行证据、实际 task/成员/Attempt/进度，旧未知不伪造 | 满足；磁盘重开与实际 Mock 生产路径都有断言 |
| 非终态启动分类、幂等、原部分输出/请求保留、终态不改、无自动付费请求 | 满足；idle 明确保持原值 |
| 一致备份、恢复验证后登记、WAL busy、升级失败保护 | 满足本机受检情景；不自动替换原数据库 |
| Run 定向消息、事件分页上界、一致快照、准确追加结果 | 满足；并发、跨 Run 和多 Attempt 回归覆盖 |
| 发布 migration 不改、统一 Schema、R01 生命周期/安全保留 | 满足；原 SQL 与未动文件逐字节核对，完整回归通过 |
| 最终 main 验收 | 未执行、未授权；R03 仍 review |

R04 消费完整 Run、冻结成员、Attempt/输入、nextTurnIndex/elapsed、准确追加及 afterCommit，显式重试须分配新 requestId/messageId/attemptIndex，不能改旧输入或假装首 requestId 就是所有请求。状态机、全局累计限制和不响应 abort 的调度政策仍由 R04 负责，不改变现有控制能力声明。

R05 消费 Run 定向消息及安全 DTO，实际上下文输入在 Main 形成并保存至对应 Attempt；本轮没有把 Mock 固定回答升级为真实公共上下文协作。

R06 消费同构建 RunSnapshot.execution/attempts、snapshot/sequence 与重同步信号；不能读取 Main 私有 inputSnapshot/providerRequestId/lastError，不新增任意 IPC。消息分页目前是 Main 数据 API；增加 Bridge 能力仍提交总控契约申请。

剩余限制：未运行正式 Electron E2E、开发 HMR、发布目录包/ASAR/安装升级、Windows/Linux、签名/公证、真实 Provider/Key。R02 的目录包历史通过不算本轮 R03 打包通过。大数据量启动 integrity/hash 性能、真实断电、Windows ACL/硬链接/目录持久性未验证；同步 SQLite 校验无法在单个调用中抢占，取消/截止在阶段边界检查。异常遗留的未登记文件只保留调查，不自动信任或恢复。没有发现本次受检路径的未解决阻塞，建议用户审核候选后另行授权合 main 和主线复验。
