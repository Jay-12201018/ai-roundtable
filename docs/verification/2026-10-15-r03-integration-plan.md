# R03 总控共享接线实施计划

> 总控按已授权任务及 R03-SHARED-01 在 codex/integrate-r03 执行；不合 main，不启动 R04。Shared、migration、Database、Main、RunService 由总控唯一写入，协作者只读审查或独占临时依赖准备。

**Goal:** 在既有 Database 上补齐可持久执行证据、一致备份、异常恢复及安全分页，不新增 repository 或调度功能。

**Architecture:** migration 2 追加新字段/Attempt/事件身份/备份元数据，v1 原文不变。旧缺失信息保留 NULL。同步 SQLite 事务负责关联与游标；磁盘升级先 await 在线备份和独立恢复验证。Main 的退出屏障等待已开始的初始化，之后仍按 R01 清理。idle 保持原值，不扩展状态机。

**Tech Stack:** 原锁文件，官方 Node 24.18.1/同版 arm64 headers，Electron 38.8.6，better-sqlite3 12.11.1，Shared Zod。

**Spec:** tasks/R03-persistence-backup-recovery.md；src/main/database/recovery/R03-HANDOFF.md 的 R03-SHARED-01；本次用户授权。

## 顺序、归属与验收

- [x] 在独立缓存/依赖运行引入后的基线；结果与历史286项分列。
- [x] 先写 metadata/Attempt/分页/恢复/迁移/初始化退出失败测试，观察缺失行为，再实现。
- [x] 总控修改 src/shared/schemas/run.ts 与新增 persistence.ts：Main完整执行/输入证据、安全Attempt投影、消息/事件页Schema；Provider输入复用R02。普通IPC绝不返回inputSnapshot。
- [x] 总控追加 migration 2；扩展 Database.ts 的 getRun/insertRun、createAttempt/getAttempt/listAttempts/updateAttempt、updateRunProgress、listRunMessages、事件上界分页、readRunSubscription、准确append结果。保留旧入口兼容，旧记录未知值不猜测。
- [x] 接线 initialize 的磁盘异步备份/恢复候选校验/catalog，拒绝未知/过高/间断ledger；同步迁移失败回滚，保留源库及备份。恢复只处理分类的4类父Run，幂等追加interrupted事件，不自动替换文件或重发。
- [x] 接线 RunService 的实际任务/冻结成员、实际请求Attempt/进度/累计时间；快照同事务读取、订阅多Attempt归属、只通知已提交准确事件。保持现有调度策略，不实现重试/恢复调度。
- [x] Main等待初始化后再建服务/窗口，退出等待初始化；新增延迟成功/失败与重复退出测试。prepareRestore完整调用的取消/截止和v2完整性校验纳入回归。
- [x] 专项、全回归、类型、生产构建、Node压力/正常退出、Electron重编译/ABI/隔离启动实际运行；逐命令退出码和限制写入最终报告。
- [x] 完成提交前原v1字节、全diff、敏感路径/内容与main/原R03未变的核对；独立交付提交SHA以最终Git检查为准，R03仅review/待最终合并审核。

执行结果见 [报告](2026-10-15-r03-integration.md)和[命令台账](2026-10-15-r03-commands.md)。这里的进度只指集成候选；最终提交后停止等待用户审核。

消息游标绑定runId及稳定单调键，拒绝跨Run游标；事件页排除cursor/包含固定上界，limit 1..500；订阅超过上限返回权威快照重同步，不静默丢后页。Attempt requestId全局唯一、(turnId,attemptIndex)/message唯一；旧可证明唯一归属才登记legacy Attempt，输入/请求时间未知保留NULL。安全快照保留历史Attempt身份但不包含请求输入。备份目录/恢复动作仅可信Main管理，未登记文件不自动信任。
