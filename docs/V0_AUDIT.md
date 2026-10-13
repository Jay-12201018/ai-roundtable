# V0 审查基线与实际状态

基线：main / `135bf82c6462ade6dd5300717d6f0102ce4a660c`。本文整理已获批准的源码审查；静态证据不等于运行验证。R00 不修业务缺陷。本次执行结果另见 [R00 验证](verification/2026-10-13-r00-baseline.md)。

## 当前产品

它是具有 Main 调度、流式 IPC、SQLite 落库和运行控制的 Mock 原型，不是静态气泡页面，也不是已完成的真实多模型协作产品。

| 能力 | 源码状态 | 证据 |
| --- | --- | --- |
| Main/Preload/React | 存在基础边界 | `src/main/index.ts`、`src/preload/index.ts`、`src/renderer/App.tsx` |
| Mock 三成员 | 固定起草/审查/综合，各执行一次 | RunService.createDemoRoom/runLoop；MockProvider.responseFor |
| 流式/事务持久化/单活动 Run | 存在实现 | RunService.executeTurn/start/getSnapshot；Database.transaction |
| Pause/Stop/Step/Resume | 同进程路径存在，有边界缺陷 | RunService.pause/stop/step/resumeRun |
| 刷新快照 | 恢复当前 Run 消息与游标，不重发模型 | App.syncRun；RunService.subscribe |
| DB 恢复/备份 | 部分；非完整执行恢复 | Database.initialize/markInFlightRunsInterrupted |
| 真实 Provider/公共上下文 | 缺失 | Main 固定 Mock；executeTurn 仅发送原始 task，SDK 只在依赖声明中 |
| 工作流模板/主持人完整操作 | 缺失 | workflowSnapshot 不参与调度；无 Override/插话/持续指令 |
| 重试/续写 | 占位 | retryTurn/continueMessage/recoverInterruptedRun 的有效路径仍抛错 |
| Key | 模块存在，UI/IPC/Provider 链路缺失 | KeyService/electronSafeStorage；Main 创建后只调用 getStatus |
| 房间/成员 | 仅 Demo 创建，没有完整 CRUD/历史浏览 | room.createDemo；Database 的有限方法 |
| Zustand/Markdown/虚拟列表 | 未使用/缺失 | App 使用 React state 与原文 p；messages.map 全量渲染 |
| 摘要/费用预算/产物/代码导出 | 缺失 | 无对应服务、契约、表和 UI |
| 双主题/完整 i18n | 部分 | 固定暗色与状态字典 |
| 跨平台 | 仅有打包目标，当前运行不能据此确认 | electron-builder.yml；历史验证记录 |

## 问题登记

以下均为源码推导，除本次验证明确记录的项目外没有执行复现；未确认 P0。

| ID / 优先级 | 具体问题、位置和触发条件 | 后续责任 |
| --- | --- | --- |
| A01 / P1 | RunService.shutdown 不终结 paused，Database.markInFlightRunsInterrupted 排除 paused；重启丢失 context 后 Step/Resume/Stop 失败，App 又禁用开始 | R01/R03/R04/R06 |
| A02 / P1 | Main before-quit 的 shutdownStarted 分支不 preventDefault；等待 shutdown 时第二次退出可越过等待 | R01 |
| A03 / P1 | runLoop 仅回合前检查超时、Resume 重置计时；executeTurn 把 text_delta 数量当 Token，未传 Provider 上限 | R04/R05，真实调用门槛 |
| A04 / P2 | stateMachine 转换函数未约束服务状态写入；Step/maxTurns:1 在三成员房间一回合后仍 paused，下次 Step 零回合才完成 | R04 |
| A05 / P2 | Shared 允许 recovery resume，实际 Preload/IPC/service 拒绝；重复参数类型/Schema，payload unknown，响应 Schema 未接入 | R02 |
| A06 / P2 | executeTurn 的 turn_started 只落库不通知，后续首字触发 App 缺口恢复；Main/Mock requestId 各自生成 | R04 |
| A07 / P2 | notifyLastEvent 每个增量读取解析全部事件；getSnapshot 读取房间全部消息后筛选 Run | R03/R04 |
| A08 / P2 | will-navigate startsWith 放行 localhost.attacker.example 等来源，IPC 仅检查 webContents；当前纯文本 UI 未确认可达远程利用链 | R01，Markdown 前门槛 |
| A09 / P2 | migration 前 checkpoint 结果未检查即复制单个 db；外部读连接使 checkpoint busy 时可能少备份；无恢复验证 | R03 |
| A10 / P2 | task/调度进度只在内存，getRun 不返回完整执行配置；Agent 模型等字段预留但方法未落实 | R03/R07 |
| A11 / P2 | App 刷新后标题回到默认 task，草稿改变历史标题；创建无 pending 锁，可能用旧 roomId；控制连点可留下拒绝错误；快照与消息分开投影 | R06 |
| A12 / P2 | createMainWindow 丢弃 loadURL/loadFile Promise，加载失败不进入外层同步启动错误处理 | R01 |
| A13 / P2 | 多 Agent 测试未断言共享输入；Key 仅 fake backend；DB 仅内存；空测试原可成功；无 Electron E2E/CI/lint | R00 收紧空测试；其余 R03/R05/R08/R17 |

创建回复严重乱序导致活动 Run 丢失仅是条件性风险，当前同步 createDemo 路径不足以证明可达，不把它当已确认 P1。长输出布局和性能需 R16 实际测量，不能以默认三条 Mock 消息宣布达标。

## 保留与升级

保留 Main 权威、参数化 SQL/事务、有限 Preload、Mock、Abort、单活动锁、先监听再抓快照、序号去重/缺口恢复、32ms 批处理和 Key 双后端。升级边界与任务见 [任务清单](../tasks/README.md)，不新增调度框架或重建 Electron 工程。

## 证据边界

原始审查只执行无输出 TypeScript 检查，未启动应用或运行测试。旧 [窗口验证记录](verification/2026-10-13-window-fix.md)记录此前 52 tests、macOS 目录包和 Mock 操作，它是保留的历史材料，不是 R00 本轮结果，也不证明共享上下文、真实 Key 或 V1 完成。

当前用户 DB、系统密钥链、网络 Provider、费用、长历史性能和三平台安装运行仍没有本轮验证。依赖供应链全量安全审计不在本轮范围。
