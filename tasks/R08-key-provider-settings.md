# R08 Key 与 Provider 设置实施任务计划

> 当前已按用户授权ff-only合main；本次主线验收因临时补充桥探针错误停止，状态merged、未verified。原任务定义及候选阶段文字保留历史，现态见[STATUS](../docs/STATUS.md)。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 建立受保护 Key、Provider 配置和分级连接测试的设置链路，给真实适配器只传可信引用。

**Architecture:** Main 的 KeyService 保管密钥并由 Provider factory 调用；Renderer 表单仅短暂持有输入，普通 DTO 返回掩码/引用/状态。独立 settings feature 不修改 App/store。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [src/main/security/KeyService.ts](../src/main/security/KeyService.ts) 第 26–54 行 有 store/resolve/delete/status；[src/main/security/electronSafeStorage.ts](../src/main/security/electronSafeStorage.ts) 第 5–10 行 不可靠后端降级内存。
- [src/main/index.ts](../src/main/index.ts) 第 36–38 行 创建 KeyService 后只 getStatus，没有设置 IPC 或 Provider 注入。
- [src/main/database/Database.ts](../src/main/database/Database.ts) 第 60–68 行 providers 有配置字段但无完整存取链路；Renderer 尚无设置页面。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

Provider 配置 CRUD、启停/默认/自定义模型、受保护 Key 输入更换删除、会话内存降级提示、Base URL 校验与用户确认、分级测试结果 UI，Main-only Key 注入边界。

明确不做：不做网络 Adapter 实现（R09/R10）、系统密钥链无隔离写入、账户/云同步、自动测试付费生成；不把 Key 回传普通 IPC，不改 rooms/RunService/App/store。

## 前置与必读

R04/R05/R06 联合 Mock 验收完成；R02 Provider/Key 契约可用；R08 获实施授权。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

涉及 UI，先读 [DESIGN_GUIDELINES](../docs/DESIGN_GUIDELINES.md)，功能决定布局、体验决定交互；UI 组件只消费已合入契约。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 现存（135bf82） | src/main/security/KeyService.ts；src/main/security/electronSafeStorage.ts；tests/unit/keyService.test.ts | R08 | Key 生命周期、后端状态与脱敏行为 |
| 拟新增 | src/main/settings/**；src/renderer/features/settings/** | R08 | Provider 设置、endpoint 校验和设置 UI |
| 拟新增 | tests/unit/settings/**；tests/integration/settings/**；tests/unit/rendererSettings/** | R08 | 配置/URL/Key 泄漏与表单场景 |
| 现存（135bf82） | src/main/database/Database.ts；src/shared/**；src/main/ipc/registerIpc.ts；src/preload/index.ts；src/main/index.ts；src/renderer/App.tsx | 总控 | 配置 migration、Key 引用与模块组装 |

## Worktree 可独立与可并行

可独立 codex/r08-key-provider-settings Worktree，与 R07 并行，settings/security 与 rooms 各自排他。共享引用/DB/IPC 先由总控处理；自动测试使用 fake backend，不共享系统 Key。

## 共享依赖与接线规则

总控登记 KeyStorageStatus、Provider 配置 DTO、endpoint 和分级 testConnection 契约；明文只能进入独立设置命令与 Main 必需调用。R09 通过 Main factory 解析引用，Renderer 不得获取 resolveKey 能力。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 写 fake Key 后端、URL 和泄漏测试，登记协议申请。
- [ ] 完成 settings 服务/表单与 Key 生命周期，不使用真实 Key。
- [ ] 总控连接 Provider factory 和 R07 引用，核对脱敏边界。
- [ ] 交付分级测试结果格式与真实调用必须明确触发的操作说明。

## 详细验收

- [ ] 可靠后端密文持久化；basic_text/不可用后端仅会话内存，重启明确需重新输入，不保存明文。
- [ ] Provider 可编辑/启停/默认与自定义 model；更换/删 Key 清理旧引用，引用跨 Provider 不能误取。
- [ ] Base URL 用 URL 解析验证：HTTPS 或明确 loopback HTTP；拒绝凭证、伪 localhost、非法协议，并显示实际目标供确认。
- [ ] 设置保存、列表、测试错误和日志不包含 Key；表单提交/离开后清除敏感输入，Renderer 持久 store/localStorage 不保存。
- [ ] 连接测试区分 endpoint/key、模型列表、真实生成能力；Mock/fixture 自动执行，真实生成须用户明确触发。
- [ ] secret 不进入公共历史、导出或常规 IPC；有泄漏断言和可靠/内存后端恢复场景。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 可靠/内存后端 | fake secure、unavailable、basic_text | 仅 secure 写密文；降级不写密钥记录且状态明确 |
| 更换与删除 | Key1→Key2→删除，旧引用被再次解析 | 旧引用失效；没有 plaintext DTO |
| 地址校验 | https、127.0.0.1、::1、localhost.attacker、userinfo、file:// | 仅批准地址可保存/测试，确认显示准确地址 |
| 泄漏捕获 | 注入唯一假 Key，捕获 IPC/log/DB/历史/存储 | 除 Main 必需路径外均不含假 Key |
| 分级测试 | fixture 列表失败/鉴权成功/生成失败 | 三项单独报告，不把列出模型当可生成 |
| 表单状态 | 保存失败、切页、取消、重复保存 | 输入/错误可理解且敏感值及时清除，无重复写入 |

pnpm run test -- tests/unit/keyService.test.ts tests/unit/settings tests/integration/settings tests/unit/rendererSettings；pnpm run typecheck；pnpm run build。真实系统后端仅在明确授权且已隔离时另行验证。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。


## 2026-10-16 共享前置主线验收与启动边界

用户已另行批准共享候选1e1f971正式合main，本轮独立主线必要复验通过，SHARED-R07-R08-01为merged/verified；证据见[主线报告](../docs/verification/2026-10-16-r07-r08-shared-main.md)。本feature仍ready、未实施，未授权创建Worktree。

实际接口、调用方法、错误/分页/引用规则及唯一文件归属统一见[共享调用手册](../docs/R07_R08_SHARED.md)，本任务不再定义第二套DTO或migration。未来启动必须登记包含本次治理更新的同一最新main完整SHA（由最终交付给出，开始前重新核验）；R07/R08各自仍须获得明确创建/实施授权。

Shared/Database/migration3/公共测试/Main/IPC/Preload/App/store等由总控冻结。模块只消费并提交接线申请；R07独占room/rooms及专属测试，R08独占settings/security及专属测试，R08启动后总控不并发写KeyService。生产handler/Preload/App接线留联合集成。此更新不勾选功能验收，也不推进R09/R17。


## 2026-10-17 联合候选交付（历史review阶段）

本模块原提交已独立完成并获本轮总控联合授权；在 codex/integrate-r07-r08 完成真实公共接线。当前为 review，不能将下方/此前历史 ready 说明当作当前状态，也不自行宣布 main 验收。代码提交 `64ac8ce5038813cc60374573dc8871da30d1eeb0`，详细逐项结果、原模块与总控改动清单见[联合报告](../docs/verification/2026-10-17-r07-r08-integration.md)及[台账](../docs/verification/2026-10-17-r07-r08-commands.md)。任务原始范围与技术路线不变；公共文件唯一归总控，原 Worktree 不回写，R09/R17 未实施。

## 2026-10-17 最终合并与验收停止

获批候选d3205b2c3fba2061437150e87a87508d44fbb660已从c1b5bea严格ff-only合main，原分支/Worktree保留。main本次846完整/292联合/111IPC/393Electron、strict/build、双ABI及生产UI/新进程重启/退出审计均通过；补充真桥字段探针在生产Main加载前因临时包装器错误失败，已停止验收，未修复重跑。本模块仅merged、未verified；R09仍blocked/未授权。

[主线报告](../docs/verification/2026-10-17-r07-r08-main.md)和[台账](../docs/verification/2026-10-17-r07-r08-main-commands.md)保留通过与失败的分别证据。本轮不改业务/测试/Schema/migration/依赖、不破坏性回滚、不启动后续模块。
