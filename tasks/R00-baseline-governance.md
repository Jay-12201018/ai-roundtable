# R00 基线治理与真实验证实施任务计划

> 当前状态见 [STATUS](../docs/STATUS.md)。本轮已获实施授权。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 把原始原型、V1 目标、后续任务归属和真实验证边界纳入当前仓库，形成可审查的一次治理交付。

**Architecture:** 保留 main / 135bf82 的源码、现有测试与历史，仅建立治理文档及必要验证配置。当前 main 文档提交是用户明确批准的例外，不创建 Worktree。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [README.md](../README.md) 的第 38–40 行把 Mock 闭环与部分恢复描述在一起；需要用事实看板拆开当前能力和目标。
- [src/main/services/RunService.ts](../src/main/services/RunService.ts) 第 34–38,224–248,272 行 固定三角色、各执行一次、仅输入 task；不能写成已完成公共历史协作。
- [package.json](../package.json) 第 14–15 行 原始 test 使用 passWithNoTests；[playwright.config.ts](../playwright.config.ts) 第 4 行 指向尚无测试的 tests/e2e。源码审查及历史记录均不等于本次测试 PASS。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

纳入原始 SPEC；创建工程规则、现状审查、接口登记、决策、状态、验证、设计规范及 20 份任务；收紧空测试配置和敏感文件忽略；执行授权范围的隔离验证并记录。

明确不做：不改 src 或现有 tests，不实现 R01–R18，不安装/升级依赖，不重写 Git 历史，不启动真实用户数据上的应用，不调用 Provider，不创建 Worktree。

## 前置与必读

无。当前唯一获实施授权的任务。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 现存（135bf82） | README.md；package.json；vitest.config.ts；.gitignore | 总控 | 仅治理说明/空测试失败/忽略规则；.gitignore 已存在 |
| R00 已建立（原基线新增） | AGENTS.md；SPEC.md；docs/CONTRACTS.md；docs/DECISIONS.md；docs/STATUS.md；docs/V0_AUDIT.md；docs/VALIDATION.md；docs/DESIGN_GUIDELINES.md | 总控分配的单文件负责人 | 文档内容与证据 |
| 拟新增 | tasks/README.md；tasks/R00-baseline-governance.md 至 tasks/R18-v1-1-evaluations-adrs.md（含 R10A/R10B） | 任务文档负责人 | 本次独占 tasks/** |
| 拟新增 | docs/verification/2026-10-13-r00-baseline.md | 总控 | 本轮实际命令和失败记录 |

## Worktree 可独立与可并行

本次禁止 Worktree。tasks/**、设计规范和其余治理文档可由不同负责人并行写；同一文件排他。其余业务任务只有定义，没有实施授权。

## 共享依赖与接线规则

总控核对任务/STATUS/SPEC 一致，再审查 R00 diff、验证配置与实际证据。R00 完成后仍不启动 R01；用户审核并单独授权后才进入下一项。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 核对基线与原始材料，将事实和目标分别登记。
- [ ] 写入全部治理文档、设计规范、任务定义和验证守卫。
- [ ] 按 VALIDATION 执行已授权检查，失败不扩大到业务修复。
- [ ] 校验链接、清单、diff 和敏感文件，再交总控创建独立治理提交。

## 详细验收

- [ ] 原始 SPEC 实际可读并保留不可缩水功能、排除项、V1 最终验收；UI 条款按用户最新指令更新。
- [ ] 20 个任务及 README 的依赖无环，R10A/R10B 独立编号；文件归属、测试情景和总控接线均具体。
- [ ] 所有仓库内 Markdown 链接可解析，不依赖仓库外工具包路径；不遗留旧任务编号清单。
- [ ] 对类型、单元/集成、空筛选、build、Node/Electron SQLite ABI 分别记录；没有 E2E/lint/三平台运行证据就写未运行。
- [ ] git diff --check 无格式错误；src、原有 tests、lockfile、原生脚本保持原始基线内容；不纳入密钥/数据库/备份。
- [ ] 独立提交主题 chore: establish R00 governance baseline；报告真实 Commit SHA，用户可查看完整交付。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 空筛选守卫 | 执行 VALIDATION 中空筛选命令 | No test files found、exit 1；禁止将空集标成功 |
| 现有安全测试 | 审查 DB/IPC/app fixture 隔离后运行一次测试集 | 记录实际结果和失败，不能以历史 52 tests 代替 |
| 原生 ABI | Node 测试完成后重编译 Electron，再用 :memory: 自检 | 分别记录两个 ABI；不导入 Main、不触及 userData |
| 授权边界 | 比较原始基线 diff 和工作区文件 | 只有 R00 文档/配置；没有业务实施或 Worktree |

按 [VALIDATION](../docs/VALIDATION.md) 的 R00 检查顺序执行。本任务文档只定义验收；实际结果放入本轮 verification 文件。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。

R00 的 main 独立提交是用户明确例外，由总控完成；本任务文档线程不自行提交。后续实施授权仍需用户单独给出。
