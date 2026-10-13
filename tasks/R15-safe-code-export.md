# R15 安全代码导出实施任务计划

> 当前状态见 [STATUS](../docs/STATUS.md)。未来范围定义；本轮未获实施授权，不得自动启动。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 在路径校验、diff 预览和逐文件人工确认后写入候选代码，并提供可验证的实际结果。

**Architecture:** Main-only export 模块负责真实路径/符号链接/覆盖竞态防护和写入；Renderer 只展示预览并发送显式确认。模型候选不能直接调用文件系统或执行代码。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [src/preload/index.ts](../src/preload/index.ts) 第 5–27 行 只有 room/run API，没有文件写盘通道。
- [src/main/database/Database.ts](../src/main/database/Database.ts) 第 51–154 行 无导出事务记录；[src/renderer/App.tsx](../src/renderer/App.tsx) 第 173–201 行 无候选 diff/路径确认。
- 基线没有 artifact/export 模块；代码导出是 R14 后新增能力，不可把现有聊天复制当作完成。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

选择导出根目录、候选路径规范化/真实路径校验、文件内容/diff/新增覆盖预览、逐文件确认、确认绑定版本/哈希、写前再校验、可靠写盘与可追踪结果；临时文件系统攻击测试。

明确不做：不执行生成代码/终端命令、不自动写盘、不越过用户选择根、不默默覆盖、不改 artifact/RunService/App/store；不操作真实用户文件做测试，不写通用任意文件 IPC。

## 前置与必读

R14 有效代码候选、来源/版本契约已合入；R01 安全边界可用；R15 获实施授权。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

涉及 UI，先读 [DESIGN_GUIDELINES](../docs/DESIGN_GUIDELINES.md)，功能决定布局、体验决定交互；UI 组件只消费已合入契约。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 拟新增 | src/main/export/**；src/renderer/features/codeExport/** | R15 | 校验/预览/确认/写入与 diff UI |
| 拟新增 | tests/unit/codeExport/**；tests/integration/codeExport/**；tests/unit/rendererCodeExport/** | R15 | 路径、symlink、竞态、失败及确认 UI |
| 拟新增 | src/shared/contracts/export.ts；src/shared/schemas/export.ts | 总控 | 受限导出命令、可信根引用、记录与 IPC |
| 现存（135bf82） | src/main/ipc/registerIpc.ts；src/preload/index.ts；src/main/database/Database.ts | 总控 | 受限导出命令、可信根引用、记录与 IPC |
| 现存（135bf82） | src/main/index.ts；src/renderer/App.tsx | 总控协调相应 owner | service/feature 组装与产物导出状态接线 |
| 依赖任务提供（当前拟新增） | src/renderer/store/**；src/main/artifact/** | 总控协调相应 owner | service/feature 组装与产物导出状态接线 |

## Worktree 可独立与可并行

可独立 codex/r15-safe-code-export Worktree，与 R16 可并行；codeExport/export 目录不与 timeline/theme 重叠。UI 预览组件只消费 R16 基础样式接口；任何 App/公共组件接线由总控。

## 共享依赖与接线规则

总控登记 preview→confirm→write 分离命令、用户选择根目录引用与内容哈希，不能让模型路径冒充已授权目标。确认绑定具体候选版本/目标状态；目标变化时重新预览确认，写盘结果再更新 artifact 状态。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 建立临时根/根外哨兵的路径和确认攻击测试。
- [ ] 实现分离预览/确认/可靠写入与独立 diff UI。
- [ ] 总控接线受限 IPC、根引用和产物结果状态。
- [ ] 验证竞态/失败/逐文件写入，交付可复现安全证据。

## 详细验收

- [ ] 所有候选在受信根内：拒绝 ../、绝对/UNC/驱动路径、NUL/非法名及平台变体；跨平台 normalization 有测试。
- [ ] 解析真实父目录和 symlink，不可借链接越界；确认后写前重新校验并防目标被替换，不存在明显 TOCTOU 绕过。
- [ ] 展示每文件目标、内容、diff、新增/覆盖/冲突/路径状态；逐文件人工确认，取消/关闭/选择无效项均零写入。
- [ ] 确认绑定候选版本/内容和目标当前状态；预览后内容/已有文件变更使确认失效，不能覆盖新变化。
- [ ] 写入失败、磁盘/权限问题和部分成功有明确逐文件结果；写入策略不损坏旧文件，成功才标已导出。
- [ ] 输入不暴露通用文件系统/执行能力；模型生成内容从不执行；Key/隐私内容不自动附加。
- [ ] 全部文件测试用临时根且只清理测试创建内容；真实写盘仅在用户界面明确预览确认后执行。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 路径越界 | ../a、绝对路径、UNC、Windows 驱动、混合分隔符 | Main 拒绝；根外哨兵文件不变 |
| 链接越界 | 根内 symlink→根外，预览后替换父目录/目标 | 拒绝写入或重新确认；外部文件不改 |
| 预览无副作用 | 多文件候选预览、勾选部分、取消 | 预览/取消零写；确认只写指定文件 |
| 覆盖竞态 | 预览后现有文件被修改或候选改版本 | 旧确认失效，需新 diff 与人工确认 |
| 写入失败 | 注入权限/磁盘错误与第二文件失败 | 旧文件可用，逐项结果真实，无虚假全成功 |
| 代码不执行 | 候选包含可运行命令，确认写入 | 仅文本落盘，无子进程/终端执行 |

pnpm run test -- tests/unit/codeExport tests/integration/codeExport tests/unit/rendererCodeExport；pnpm run typecheck；pnpm run build。所有写盘断言使用测试独占临时目录。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。
