# R01 启动、退出与窗口安全边界实施任务计划

> 当前状态见 [STATUS](../docs/STATUS.md)。未来范围定义；本轮未获实施授权，不得自动启动。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 让启动失败、重入退出、窗口再激活和可信来源校验形成可验证的安全生命周期。

**Architecture:** 沿用 Electron 主进程与有限 Preload，使用一次关闭屏障等待活动请求与数据库收尾。严格解析来源；可行时收敛 Preload 构建和 sandbox，而非任意关闭安全边界。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [src/main/index.ts](../src/main/index.ts) 第 47–56 行 第二次 before-quit 在 shutdownStarted 时直接返回；等待清理期间存在重入退出路径。
- [src/main/index.ts](../src/main/index.ts) 第 61–83 行 有窗口关闭提示与同步错误处理；[src/main/windows/createMainWindow.ts](../src/main/windows/createMainWindow.ts) 第 29–32 行 丢弃加载 Promise，异步失败不能可靠进入启动错误处理。
- [src/main/windows/createMainWindow.ts](../src/main/windows/createMainWindow.ts) 第 12–17,25–26 行 ESM Preload 导致 sandbox:false，导航以 startsWith 判定；[src/main/ipc/registerIpc.ts](../src/main/ipc/registerIpc.ts) 第 11–13 行 仅比较 webContents。
- [src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 135–143 行 shutdown 只 abort/等待/清 Map，未终结 paused；完整执行恢复留给 R03/R04。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

修复启动/加载失败提示与退出、幂等退出屏障、正常退出终结活动及 paused Run 的协调、Mac 再激活、严格导航/外链/IPC frame 来源、CSP 与 Preload 构建兼容证据。

明确不做：不实现 DB 完整恢复/备份、重试、Provider、共享协议大重构或 UI 改版。RunService 业务状态机变更交给总控协调，不能抢 R04 后续归属。

## 前置与必读

R00 交付经用户审核；用户另行授权 R01。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 现存（135bf82） | src/main/windows/createMainWindow.ts | R01 | 窗口加载、安全导航、外链与 sandbox 证据 |
| 现存（135bf82） | src/main/index.ts；src/main/ipc/registerIpc.ts；src/preload/index.ts；electron.vite.config.ts；src/renderer/index.html | 总控（R01 接线） | 生命周期组装、IPC 来源、Preload 构建/CSP；R02 随后串行修改 |
| 现存（135bf82） | src/main/services/RunService.ts | 总控协调 | 仅正常退出 paused 终结所需最小修改；接口/状态机登记给 R04 |
| 现存（135bf82） | tests/unit/appLifecycle.test.ts | R01 | 排他生命周期测试 |
| 拟新增 | tests/unit/lifecycle/windowSecurity.test.ts；tests/unit/lifecycle/ipcSource.test.ts | R01 | 排他生命周期测试 |

## Worktree 可独立与可并行

可独立 Worktree，分支 codex/r01-startup-lifecycle-security；须明确创建授权。R00→R01→R02 串行，因 R01 涉及 IPC/Preload 构建，不与 R02 同时编辑。新测试 fixture 不共享真实 userData。

## 共享依赖与接线规则

提出 shutdown 与窗口加载接口申请，由总控统一 Main/IPC/Preload 接线；所有来源允许值在 CONTRACTS/DECISIONS 登记。若 sandbox 仍不可行，给出实际构建/运行证据和受信来源限制，不能仅修改布尔值。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 添加退出重入、加载拒绝和来源伪装的行为测试并记录基线失败。
- [ ] 完成窗口模块修复，提交所需共享接线申请。
- [ ] 总控接线后运行生命周期与安全测试，再验证构建产物。
- [ ] 交付来源规则、sandbox 证据与遗留恢复问题，停止在 R01 授权边界。

## 详细验收

- [ ] 数据库初始化及 loadURL/loadFile 失败均显示中文错误且收尾；不会留下空窗/无窗常驻进程。
- [ ] 等待 shutdown 时每次 before-quit 都受同一屏障约束；仅关闭一次数据库并在清理结束后退出。
- [ ] 正常退出 running/paused 状态留下明确终态；部分输出保留；异常退出识别由 R03 接手。
- [ ] macOS 关窗后再次 activate/second-instance 可正确绑定唯一 IPC，旧监听与 handler 被释放。
- [ ] 来源比较使用 URL 解析、精确 origin/frame 与开发地址；生产 file 来源限制到受信页面，拒绝子 frame 与导航伪装。
- [ ] 外链仅可信协议且受用户操作触发；Preload 仍只暴露受限 API；CSP、sandbox/build 决定有明确验证边界。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 退出重入 | shutdown Promise 挂起时两次 before-quit | 两次阻止默认退出，未早关 DB；释放后只退出一次 |
| 加载失败 | mock loadFile/loadURL reject | 错误可见、DB 关闭，未留下可操作窗口 |
| 暂停退出 | step 后 paused，再执行正常退出 | paused 终结、文本保留；重新打开没有卡住的活动锁 |
| 来源伪装 | localhost.attacker.example、不同端口、远程 file、子 frame invoke | 全部拒绝；仅准确受信 Renderer 可调用 |
| 再激活 | Mac 关窗/activate/第二实例/生成中取消退出 | 窗口和 IPC 数量正确；取消退出不丢活动请求 |

pnpm run test -- tests/unit/appLifecycle.test.ts tests/unit/lifecycle；pnpm run typecheck；pnpm run build。隔离桌面验证按 VALIDATION 进行，无法隔离则记录未运行。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。
