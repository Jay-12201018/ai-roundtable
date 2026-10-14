# R03 完整交接与共享变更申请

本轮授权：仅 R03 独立模块开发；不合 main，不启动 R04。基线 `be37fad9d05050a9bad1847e5008bc67752523f6`，当前独立 Worktree `/Users/zhangwenjie/.codex/worktrees/2e06/AI交互`，分支 `codex/r03-persistence-backup-recovery`。用户本次正式授权优先于治理文件中的历史“未授权”状态；不修改总控状态看板。

## 实施设计与文件归属

按既有 [R03 任务书](../../../../tasks/R03-persistence-backup-recovery.md) 执行，数据库仍是唯一事实来源。R03 不访问 Database 的私有连接、不增设 repository、不分配 migration 版本、不实现请求调度。总控将来把自身 SQLite 连接交给备份模块。

主代理独占 `backup/createVerifiedBackup.ts`、`recovery/validateDatabase.ts`、`recovery/prepareRestore.ts`、本文，以及备份/完整性测试与 fixture。协作代理独占纯分类器及其测试；另一代理独占 `tests/unit/database.test.ts` 和旧 schema 测试。公共文件全部只读。

实施顺序：

- [x] 当前 Worktree 上安装独立锁定依赖，严格配对 Node 24.18.1 runtime/headers；执行既有 R02 测试基线。
- [x] 先写并执行失败测试；实现在线备份、独立数据库校验、候选恢复、纯异常分类。
- [x] 在每例独立临时目录验证 WAL busy、并发写、取消/超时、恢复、原 schema 兼容、真实 migration 失败回滚。
- [x] 独立审查，完整回归、类型、构建和适用原生验证；准备仅含授权文件的独立提交。

### SQLite 一致性与发布

使用已安装 `better-sqlite3.backup()`，不是复制主 DB 或依赖 checkpoint 成功。源保持可用；第二写连接可能令备份重启。进行中只存在随机私有 staging 目录，不能登记为有效备份。备份完成后把副本转换为独立 DELETE journal 文件，再运行完整 SQLite `integrity_check`、`foreign_key_check`、迁移 ledger 和关键关系检查。

对全部持久表的 schema/逐行值计算证据摘要，结果只返回计数和摘要，不回显任务文本/请求输入/密钥记录。以可写句柄 fsync 后，通过不覆盖目标的 hard link 发布唯一 `backup-<UUID>.sqlite3`，macOS/Linux 同步目录后返回文件 SHA-256、字节数、页数及校验结果。失败/取消/超时不发布；只清理本次 staging 和本次新发布路径。已有备份不被覆盖。Windows 不调用 Node 不支持的目录 fsync，仍必须完成文件 flush；目录项断电持久性及 ACL 继承未实测，不能外推跨平台发布通过。

`prepareRestore` 校验已批准备份的 SHA-256，再使用 SQLite 备份 API 恢复到新临时目录中的候选 DB，并核对完整性及证据摘要。只返回候选文件，绝不替换原 DB。备份完整性检查不等于 R02 wire 事件合法性：保留合法 JSON 的旧事件/未知事件和旧错误文本，传输适配仍由现有 Shared/服务负责；损坏 JSON/关联失败明确拒绝，原字节保留。

纯分类器采用 Shared 的 ID/状态校验，筛选已批准转换的 running/pausing/paused/cancelling；不写数据、不建 Provider 请求、不重试。idle 的既有状态机不支持转 interrupted，保持不变，交总控登记后再扩展。

实现依据：[SQLite Online Backup API](https://www.sqlite.org/backup.html)、[better-sqlite3 12.11.1 backup API](https://github.com/WiseLibs/better-sqlite3/blob/v12.11.1/docs/api.md)、[Windows FlushFileBuffers 写权限](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers)。SQLite backup 得到一致的已提交快照；busy/并发修改可影响进度，因此结果页数、超时、取消和恢复校验均不能省略。

### Main 内的使用与责任

四个模块均为真实实现，没有空接口；当前没有任何生产调用方，总控独占接线。`VerifiedBackup`/`DatabaseValidation` 仅是 Main 辅助函数的返回结果，不是新的 Shared 协议、repository 或运行状态事实来源。

```ts
const backup = await createVerifiedBackup(mainSqliteConnection, trustedBackupDirectory, { signal });
const candidate = await prepareRestore(backup, trustedStagingDirectory, { signal });
const runIds = classifyInterruptedRuns(persistedRuns);
```

`validateDatabase(connection)` 在同步读取事务内做 integrity/外键/业务关联检查；成功返回版本、Run/Turn/Message/Event 计数和完整持久内容摘要，失败抛错且不修改原库。摘要涵盖所有非内部持久表（包括已有受保护 Key 记录），不打印内容。

完整旧业务 schema 缺少版本表或版本表为空时返回 `schemaVersion: 0`，表示登记版本未知，不创建表、不宣布迁移已完成。非空 ledger 仍须连续 1..N。只读校验允许保全更高连续版本的备份；实际迁移/打开的支持版本上限由总控判断，不能把本模块的完整性通过当作应用兼容该版本。

`createVerifiedBackup` 默认 30 秒进度截止，拒绝同连接重叠及源连接内未提交事务。原生 backup 以每步 100 页推进，busy 零页结果也拒绝。staging 使用私有 mkdtemp、最终文件 chmod 0600；完成后返回可重新核对的 SHA-256/字节数/页数/校验结果。同步 SQLite 校验和文件系统调用不能被 JS 强制抢占，截止/取消在步骤之间检查；不是硬实时终止保证。

`prepareRestore` 拒绝符号链接和非独立 journal 文件，复制前后核对源 SHA-256，恢复副本再次验证完整性和证据摘要；返回 `{path,directory,...校验结果}`。成功后该独立临时目录由总控拥有并负责清理；失败只删本次目录。总控确认、关闭原连接、备份登记、最终替换和新库重新打开不在本模块中，未替换任何原数据库。两处 directory 参数必须来自可信 Main 配置，不暴露任意 Renderer/模型路径。

### 变更文件

| 文件 | 作用 |
| --- | --- |
| `src/main/database/backup/createVerifiedBackup.ts` | 原生在线备份、取消/截止、校验与独占发布、SHA-256 |
| `src/main/database/recovery/validateDatabase.ts` | SQLite/外键/版本/Run 关联/事件序列/全内容摘要检查 |
| `src/main/database/recovery/prepareRestore.ts` | 备份复核与隔离恢复候选，不替换原库 |
| `src/main/database/recovery/classifyInterruptedRuns.ts` | Shared 校验后的纯异常分类 |
| `src/main/database/recovery/R03-HANDOFF.md` | 本交接及 R03-SHARED-01 |
| `tests/unit/database.test.ts` | 保留原两例，增加磁盘重开、per-Run cursor、版本幂等 |
| `tests/unit/persistence/fixtures.ts` | 每例独立临时磁盘库与 WAL fixture |
| `tests/unit/persistence/integrity.test.ts` | 损坏/关联/状态/旧事件与证据摘要测试 |
| `tests/unit/persistence/classifyInterruptedRuns.test.ts` | 17 项分类守卫及终态/冻结输入/非法 ID 测试 |
| `tests/integration/persistence/backupRecovery.test.ts` | WAL busy、并发/未提交写、重叠、取消/截止/关闭、篡改、恢复、Windows I/O 模型 |
| `tests/integration/persistence/legacyMigration.test.ts` | 原始 schema 旧库与真实 migration 回滚测试 |

## R03-SHARED-01（申请，未实施）

现有 Shared 已有 interrupted；不需要另建状态枚举。Database 仅有 v1 migration，getRun 仍仅返回 id/roomId/status/workflowSnapshot。执行元数据、请求尝试和分页接口前置尚未提供，以下必须由总控实施，之后才能做 R03 端到端验收。

1. **持久执行记录**：workflow_runs 增加 task、membersSnapshot、nextTurnIndex、elapsedExecutionMs。SQL建议 `task TEXT`、`members_snapshot TEXT`（nullable有效JSON数组）、`next_turn_index INTEGER`、`elapsed_execution_ms INTEGER`（nullable非负安全整数）；命名/版本由总控冻结。新 Run 必填准确值，旧行保留 NULL 并贯穿Shared表示历史未知；不能从 room.objective 猜 task，也不能把未知 elapsed 置 0。nextTurnIndex 为0基下一逻辑Turn分配序号，与Turn创建同事务推进；retry同Turn只新增Attempt，不推进此序号；成员调度位置由R04另外依据冻结成员和进度决定。成员开始时冻结实际生效的有序 agentId/displayName/roleTemplateId/systemPrompt/providerId/modelId/displayOrder，只允许 Key 引用。暴露现有 mode/maxTurns/maxDurationMs/outputTokenLimit/currentTurnId/currentAgentId/时间列，避免重复配置。
2. **请求证据**：总控定义同一 Shared 执行/Attempt Schema 并派生数据库及安全投影类型。建议新增request_attempts表，每次尝试保存独立 requestId/runId/turnId/messageId/attemptIndex/status/inputSnapshot/providerRequestId?/createdAt/startedAt?/finishedAt?/updatedAt；requestId 全局唯一，(turnId,attemptIndex) 唯一，messageId与某次Attempt一一对应。runId/turnId/messageId均外键，写事务验证Attempt.runId=Turn.runId=Message.runId且Message.turnId=Attempt.turnId；非NULL inputSnapshot.requestId必须等于Attempt.requestId。新尝试保存新输入，已有输入快照不改。status复用现有Shared的Turn状态值，由总控定义合法转换，不由R03建第二枚举。输入复用 R02 Provider Schema，移除 signal/Key/SDK 对象；旧准确输入未知时为 NULL。旧Turn只有现存唯一可证明的requestId/Message归属时才能登记历史Attempt；无法证明时保留legacy记录，不伪造输入或请求身份。部分文本继续保留 messages.content 和既有 legacy turns.partial_content，不新增第三份文本事实。
3. **事件迁移**：追加持久 protocolVersion/requestId，不改已发布 migration；旧记录明确 v0，不捏造历史 requestId。R02 订阅当前只匹配 TurnSnapshot 的单个请求/消息；总控将其扩展为某次已保存 Attempt 的归属校验，否则未来同 Turn 多次尝试会让旧事件失配。v1 严格验证，未知版本重同步，损坏原 JSON 保留。
4. **数据库方法**：沿用 Database；完整 getRun/创建执行记录/更新进度方法由 Shared 类型派生。新增 `listRunMessages`、`getRunEventSequence`、带 `(cursor,throughSequence,limit)` 的事件查询、同同步事务的 snapshot+事件读取；追加事务返回确切已保存事件，而非仅 sequence。sequence 分配与 INSERT 在同一写事务；提交后才通知，回滚不通知。不得在同步 SQLite transaction callback 内 await。
5. **分页语义**：事件按 Run 的 sequence 升序，排除 cursor、包含 throughSequence；limit为1..500整数，nextCursor 为最后返回事件（空页仍为输入cursor），快照 cursor 固定；页结果还需throughSequence/hasMore，由总控定义统一DTO。Message 使用持久的稳定单调排序键，不用 OFFSET，不把跨 Run ID 当 cursor；旧行由总控迁移确定稳定顺序和必要索引。订阅 nextCursor=snapshot.sequence，事件不可越过快照上界，不混 Run。若事件超过limit，必须同事务读齐或返回R02已有snapshot重同步，不能把部分首批events当完整订阅并跳过其余序号。现有 `getSnapshot` 是事务，但 `subscribe` 的事件查询在其后，须统一读取边界。
6. **异常启动恢复**：事务内先捕获分类 Run ID，再只更新这些父 Run 的 queued/pending/running Turns及对应非终态Attempts为interrupted，streaming Messages为aborted（Shared没有Message interrupted），保留文本/身份/请求输入，清理活动指针、每 Run 追加一条现有 interrupted 状态事件。完成/取消/error/interrupted 及其子行不误改，重启幂等，不建请求。现有 SQL 漏 paused 且无父 Run 限定；idle 政策另需批准状态机转换。
7. **迁移和启动**：总控分配新 migration 版本，原 v1 字节不变；检查 ledger 连续和高于应用支持版本时拒绝降级打开。既有完整业务库磁盘初始化必须 `await 一致备份 → 独立恢复校验 → 同步迁移事务 → 异常分类 → 服务/窗口`，共享同步 initialize 不能继续 checkpoint+copy。仅全新不存在/空数据库可直接初始迁移，无9业务表的非空/冲突数据库不能冒充完整VerifiedBackup，须保留原件并停止或由总控提供单独取证方案。内存初始化可保留同步接口。退出屏障须等待异步初始化，await 后再次检查退出状态，备份未结束不提前关闭源连接。登记校验通过的 schema_backups 及摘要，不把遗留 staging 文件列作有效备份。
8. **备份登记**：沿用已有schema_backups，不新建目录扫描事实来源。总控在成功返回之后独立写事务登记路径/版本及建议新增的sha256/byteCount/totalPages/evidenceSha256/verifiedAt，全部由模块实际结果提供。旧登记缺校验元数据时标记未知，必须重新复核后才供restore使用；文件名、临时文件、未登记的新发布文件都不能直接等同“可恢复”。备份发布与catalog写入不是同一事务，崩溃后未登记文件只能作为候选取证，不自动使用。

接口调用的最小约定：保留并扩展现有`getRun`/`insertRun`，不新建平行repository；总控定义Shared派生的进度更新/Attempt创建读取方法及`listRunMessages(runId,{after,limit})`、`listRunEvents(runId,{cursor,throughSequence,limit})`、`getRunEventSequence(runId)`、`readRunSubscription(runId,cursor)`。事件MAX、快照和事件区间要在同一同步读事务；Run/Turn/Message/Attempt与事件要在同一同步写事务。分页方法返回明确页结果，已有R02订阅返回完整订阅或重同步；记录不存在/游标属于别的Run时拒绝，不作全房间查询后内存过滤。备份初始化/登记与恢复候选管理只在Main可信入口调用，不把native连接或通用文件操作暴露给IPC。

兼容迁移不能补回原来未保存的 task/成员/计时/输入，旧数据明确不可完整续跑，只能 inspect/discard 或由未来可信显式命令重新开始。迁移失败须保留原库和验证过的备份，不自动覆盖原库恢复。新增 strict DTO 字段需同构建交付 Main/Preload/Renderer，不能宣称可选字段天然兼容旧 bundle。

安全与调用关系：所有接口只在 Main；R04 消费完整执行记录/冻结成员/进度/累计时间/attempts/确切事件并负责调度与显式重试；R05 只读 task/成员/公开历史和限制；R06 消费安全 task/状态/一致 snapshot/cursor。完整请求输入不进普通 IPC/导出，模型文本不能触发恢复操作，自动测试只有临时 SQLite/Mock。

所需集成测试：新 metadata/attempts 重开、旧未知值保留、paused 与终态子行隔离、重复恢复无重复事件、多请求历史关联、原始损坏 JSON 保留、第二连接在快照中追加、分页与跨 Run 隔离、append 返回确切记录/回滚不通知、异步初始化中退出、真正新 migration 升级与中途回滚。上述接口未提供，因此这些端到端项目均待集成，不能标 R03 verified。

## 本轮实际验证与环境

测试执行日期 2026-10-14，提交范围检查日期 2026-10-15；macOS darwin-arm64。受检基线为本文开头 main SHA，加上述11个授权文件。Node24.18.1/ABI137、pnpm11.25.0、better-sqlite3 12.11.1、Vitest3.2.7、TypeScript5.9.3、Electron38.8.6/ABI139，package/lock/共享配置未改。
验证根 `/private/tmp/roundtable-r03-validation-0uo0f5lp`，每个命令有独立 `logs/<label>.log`、`<label>.json` 和外部进程上限；本地原始日志为临时证据，未提交。以下逐条为本次真实完整命令，不使用历史PASS。`run.py` 设置受控PATH/独立缓存、关闭core dump、移除NODE_OPTIONS并记录退出状态；Node模式指定完整同版runtime，Electron模式改为独立复制的目标Electron headers，electron-node模式仅设置ELECTRON_RUN_AS_NODE。
Node runtime/headers只读复用ENVIRONMENT已经验官方SHA的 `/private/tmp/roundtable-r02-integration-b0c3ktgt/runtime-24.18.1/node-v24.18.1-darwin-arm64`；没有本轮重新下载的声明，没有24.21 runtime/24.18 headers混用。pnpm真实入口为 `/Users/zhangwenjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.mjs`，独立shim让嵌套脚本也使用受控Node。Electron headers从已有38.8.6缓存只读复制进本轮 `electron-headers/38.8.6`，node_version.h/config.gypi逐字节相同；生成Makefile的全部include路径指向这个副本，config.gypi为arm64/ABI139，实际运行确认内嵌Node22.22.0。

### 成功命令

**r02-baseline**：exit 0，1.638秒。18 files / 228 tests，通过；此时原 database.test 仍为2例。
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py r02-baseline 90 node pnpm exec vitest run tests/integration/mockRun.test.ts tests/integration/runControls.test.ts tests/integration/shutdown.test.ts tests/unit/appLifecycle.test.ts tests/unit/contracts/boundaries.test.ts tests/unit/contracts/dto.test.ts tests/unit/contracts/ipc.test.ts tests/unit/contracts/preload.test.ts tests/unit/contracts/provider.test.ts tests/unit/contracts/service.test.ts tests/unit/database.test.ts tests/unit/keyService.test.ts tests/unit/lifecycle/ipcSource.test.ts tests/unit/lifecycle/preloadBuild.test.ts tests/unit/lifecycle/windowSecurity.test.ts tests/unit/mockProvider.test.ts tests/unit/rendererSync.test.tsx tests/unit/stateMachine.test.ts --reporter=dot
```

**r03-target-final**：exit 0，2.042秒。5 files / 60 tests，通过；含原数据库2例、新增58例。
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py r03-target-final 90 node pnpm exec vitest run tests/unit/database.test.ts tests/unit/persistence tests/integration/persistence --reporter=dot
```

**r03-full-final**：exit 0，2.474秒。22 files / 286 tests，通过；既有R01/R02安全/契约回归全部保留。
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py r03-full-final 90 node pnpm exec vitest run --reporter=dot
```

**r03-typecheck-final**：exit 0，2.512秒。类型检查通过。
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py r03-typecheck-final 90 node pnpm run typecheck
```

**r03-build-final**：exit 0，1.959秒。Main / CJS Preload / Renderer构建通过；既有Zod注释warning，不证明R03生产接线。
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py r03-build-final 90 node pnpm run build
```

**native-node**：exit 0，10.749秒。Node24.18.1同版darwin-arm64 include/config源码编译通过。
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py native-node 150 node pnpm run native:node
```

**r03-native-electron**：exit 0，11.579秒。匹配Electron38.8.6 headers源码编译通过，原生文件最终ABI139。
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py r03-native-electron 150 electron pnpm run native:electron --build-from-source
```

**r03-electron-sqlite**：exit 0，0.238秒。Electron38.8.6 / 内嵌Node22.22.0 / ABI139，内存加载写读关闭通过。
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py r03-electron-sqlite 30 electron-node node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /private/tmp/roundtable-r03-validation-0uo0f5lp/sqlite-probe.cjs
```

**r03-electron-target**：exit 0，1.154秒。ELECTRON_RUN_AS_NODE目标运行时，5 files / 60 tests，通过；不是桌面E2E。
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py r03-electron-target 90 electron-node node_modules/electron/dist/Electron.app/Contents/MacOS/Electron node_modules/vitest/vitest.mjs run tests/unit/database.test.ts tests/unit/persistence tests/integration/persistence --reporter=dot
```

Node SQLite压力：`r03-sqlite-stress-1`至`-5`各30万次prepare/get、自然分配GC及正常进程退出，5/5 exit0；每次0.50–0.53秒。精确形式：
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py r03-sqlite-stress-1 30 node node /private/tmp/roundtable-r03-validation-0uo0f5lp/sqlite-probe.cjs --stress
```
其余4条仅label末尾为2/3/4/5，每次独立 `:memory:`。probe只require当前Worktree的better-sqlite3，执行断言，不导入Main入口、不访问userData/Provider/Key。全部磁盘测试使用每例新建临时目录，关闭连接后只清理自身目录。最终SQLite已恢复为Electron ABI；重跑Node测试必须先按上述Node模式重建，不能直接以Node加载ABI139。

### 冻结安装与保留的失败证据

首次无node_modules。网络安装多次有界失败，保留原始结果；最终在新独立store以包内容缓存安装，明确不是本轮全新在线下载PASS。只读取R02 content-addressed store的文件，APFS clone成独立inode，并通过immutable只读SQLite连接备份索引到本轮store；没有复制或共享node_modules、运行数据库或原生构建产物。安装采用package-import-method=copy、禁用side-effects复用，既有年龄/完整性策略和安装脚本保持执行，646个包全部reuse，最后本Worktree源码重建ABI。

冻结离线安装：exit0，16.608秒。
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py install-offline-cache 300 node pnpm --config.store-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/seeded-store --config.cache-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/cache --config.state-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/state install --frozen-lockfile --offline --package-import-method=copy --side-effects-cache=false --reporter=append-only
```
仓库锁文件与 `node_modules/.pnpm/lock.yaml` 字节相同；package/lock/工作区配置Git无差异。没有升级依赖或修改全局Node。

| label | exit | 原因 |
| --- | --- | --- |
| install | 124 | 沙箱DNS ENOTFOUND；300秒外部上限 |
| install-network | 124 | 网络连接reset/timeout；300秒上限 |
| install-resume | 1 | 供应链元数据请求timeout |
| install-controlled | 1 | 元数据725项检查完成，剩余tarball timeout |
| install-final-downloads | 1 | 642/646包已下载，剩余tarball timeout |
| install-transport | 1 | 临时localhost固定官方HTTPS转发仍遇上游curl timeout/502，已停本次服务 |
| node-version | 124 | 未完整安装时pnpm exec触发自动安装，DNS失败；后续改直接控制runtime检查，确认24.18.1/ABI137 |

以上不是业务或SQLite测试失败，不隐去失败，也不视作在线安装成功。完整精确安装失败命令：
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py install 300 node pnpm --config.store-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/store --config.cache-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/cache --config.state-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/state install --frozen-lockfile --fetch-timeout=60000 --fetch-retries=1 --reporter=append-only
```
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py install-network 300 node pnpm --config.store-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/store --config.cache-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/cache --config.state-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/state install --frozen-lockfile --fetch-timeout=60000 --fetch-retries=1 --reporter=append-only
```
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py install-resume 300 node pnpm --config.store-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/store --config.cache-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/cache --config.state-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/state install --frozen-lockfile --fetch-timeout=60000 --fetch-retries=1 --reporter=append-only
```
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py install-controlled 300 node pnpm --config.store-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/store --config.cache-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/cache --config.state-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/state install --frozen-lockfile --fetch-timeout=120000 --fetch-retries=1 --network-concurrency=8 --reporter=append-only
```
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py install-final-downloads 600 node pnpm --config.store-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/store --config.cache-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/cache --config.state-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/state install --frozen-lockfile --fetch-timeout=300000 --fetch-retries=0 --network-concurrency=2 --reporter=append-only
```
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py install-transport 300 node pnpm --config.store-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/store --config.cache-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/cache --config.state-dir=/private/tmp/roundtable-r03-validation-0uo0f5lp/state install --frozen-lockfile --registry=http://127.0.0.1:50590 --fetch-timeout=120000 --fetch-retries=0 --network-concurrency=2 --reporter=append-only
```
```sh
python3 /private/tmp/roundtable-r03-validation-0uo0f5lp/run.py node-version 20 node pnpm exec node -p 'JSON.stringify({node:process.version,abi:process.versions.modules,arch:process.arch,headers:process.env.npm_config_nodedir})'
```


### 红绿过程、修正与审查

| label | exit / 结果 | 说明 |
| --- | --- | --- |
| classifier-red → classifier-green | 1：16 fail/1 pass → 0：17/17 | 先验证纯分类行为失败，再实施；非终态/终态/非法数据不放宽 |
| backup-validation-red → backup-validation-green | 1：25 fail/1 pass → 0：26/26 | 首次实现前的失败；首轮还报告重叠测试首个Promise未处理拒绝，补即时catch但仍await其真实结果，最终无未处理错误 |
| disk-database-tests → disk-database-tests-node-environment | 1：旧库fixture两例URL环境失败 → 0：7/7 | 只给旧库测试加同类已有Node环境声明，原2断言和所有业务期待保留 |
| legacy-event-red → legacy-event-green | 1：4 fail/17 pass → 0：33/33含backup | 独立审查发现真实v0事件turn_id为空；只读COALESCE校验，四种旧事件接受、三种坏身份拒绝，原JSON/列不改 |
| windows-flush-red → windows-flush-red-model → windows-flush-green | 1：ESM命名空间spy失败 → 1：模拟真实write-access失败 → 0：13/13 | 先修测试mock方式，再改文件r+、win32跳过目录fsync；macOS模型测试不冒充Windows实测 |
| legacy-backup-red → legacy-backup-green | 1：2新例fail/原2pass → 0：25/25含integrity | 原始135bf82完整schema无/空ledger，备份恢复schemaVersion0，原始身份/部分输出/配置/事件字节保留 |

每个label的完整argv及结果保留在同名JSON/log。初轮目标50/50、全量276/276、typecheck/build也exit0；兼容修正后重新执行上面的最终60/286、typecheck/build，最终结果优先，未删除、skip或改变既有期望。
独立只读审查定位v0事件P1和Windows句柄P2，均已修复并走红绿；另一协作者独立复读最后Windows/ledger/COALESCE修正，与代码描述一致。审查没有自行编辑公共文件，也没有代替本轮实际回归。

## 验收边界、未完成项目与集成建议

| R03要求 | 本轮证据 | 尚待集成 |
| --- | --- | --- |
| 磁盘重启保存执行证据 | 当前Run/Turn/Message/requestId/已有配置及限制/部分文本重开测试 | task、冻结成员、累计时间、独立Attempt、可靠恢复进度尚无公共字段/API |
| 一致SQLite备份 | WAL reader阻塞checkpoint、第二连接并发提交、未提交排除、busy/关闭/取消/截止/重叠均实测 | Database.initialize替换旧checkpoint+copy、catalog持久登记及启动屏障 |
| 暂存恢复与完整性 | 独立目录恢复、integrity/FK/跨Run/事件序列/旧原文/摘要，失败保留源与已有备份 | 最终原库替换及重新打开需可信总控入口；本模块只交候选 |
| 异常退出分类 | running/pausing/paused/cancelling纯分类、终态/非法状态守卫 | 父Run限定的数据库事务转换、状态事件、启动幂等；idle政策需另批准 |
| 升级与回滚 | 原始135bf82 schema读取、missing/empty ledger备份恢复、v1幂等、真实DDL中途失败回滚 | v1→新增版本的真实升级/回滚；没有擅自创建migration或测试假v2 |
| per-Run分页与快照 | 当前事件cursor排除边界、跨Run隔离和磁盘重开实测 | listRunMessages、限量页及nextCursor/上界、快照+事件同事务、多写连接一致性 |
| R01/R02回归 | 既有228项全保留，最终286项完整回归通过 | 真实启动/桌面E2E不由单元测试或构建替代 |

现存Database.initialize仍使用checkpoint+复制，并非本模块的可靠方案；现存启动恢复SQL遗漏paused且未限定终态父Run的子行，本轮未改该总控文件。分类器没有写回数据库，因此实际重启行为尚未改变。**当前可交付R03独立模块候选，整体R03待集成，不标verified。**

旧库兼容：备份、恢复和只读校验支持完整原始/v1业务schema、原始payload-only事件、缺失/空ledger，不丢失消息、部分文本、Run/requestId、workflow/限制；损坏JSON和矛盾关联拒绝但原库保留。真实migration失败测试证明业务DDL/索引回滚且版本未登记；现存initialize在事务外创建空ledger，其存在不是半升级成功，不把它描述成完全无任何schema变化。曾未保存的task/成员/计时不能事后恢复。

仍有的边界：

- validateDatabase当前按v0/v1的Turn单请求关系验证；总控批准多Attempt Schema及migration后，还须扩展该校验与历史请求归属测试，不能仅新增表就宣称兼容。当前持久表使用rowid、事件完整保留且sequence从1连续；未来WITHOUT ROWID或事件压缩需要同步调整校验，不静默接受未知结构。
- SHA-256/证据摘要检测已登记内容改变，不提供外部签名或抵御能同时改备份与catalog的本地攻击者。可信Main控制目录、catalog与恢复动作，模型文本没有恢复权限。
- 无桌面启动、生产Bridge/真实数据库替换、pack/dist、正式E2E、安装/升级发行、Windows/Linux实机、发布签名或真实Provider/Key验证；无收费请求。当前没有lint脚本，不虚构lint PASS。Windows测试仅模拟API限制，目录项断电持久性/ACL和网络/不支持hardlink的文件系统未验证；不支持的IO会明确失败，不退化为复制主文件。
- JS不能强制抢占同步integrity/hash步骤或OS文件系统调用；取消/截止在阶段边界判定。进程崩溃可能遗留私有staging，永不靠文件名自动当有效备份；遗留文件清理/保全和最终备份catalog生命周期由总控接线。

建议总控先审查本独立提交及R03-SHARED-01，分配公共Schema/migration/Database/启动的唯一执行人，完成公共前置和接线后重跑上面的检查及所列集成测试。R04才能依据持久执行记录和Attempts调度；R05只用安全只读投影；R06只用同一版本的权威快照/游标。不存在自动重试授权，也没有提前实现任何后续模块。

本报告随R03授权文件创建一个独立commit；完整SHA由交付消息及 `git log -1 --format=%H` 提供，避免在提交内容中写入无法自引用的SHA。分支 `codex/r03-persistence-backup-recovery`，base/main核查为 `be37fad9d05050a9bad1847e5008bc67752523f6`。只提交上述11文件，提交后检查工作区干净，不合main。

提交前范围检查：暂存11个授权文件、package/lock/公共配置无差异、锁文件字节相同、git diff及暂存diff的--check均exit0。敏感正则初轮将文档中的disk测试命令label子串误认为Key模式而exit1；逐项核实只有这一处公开label，未删除命令记录，未发现真实敏感候选。无数据库、备份、环境、密钥文件或原始日志入库。
