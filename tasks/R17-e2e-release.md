# R17 Electron E2E 与发布验收实施任务计划

> 当前状态见 [STATUS](../docs/STATUS.md)。未来范围定义；本轮未获实施授权，不得自动启动。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 建立隔离真实 Electron 的 E2E 与可重复发布流程，以完整 V1 验收证据判断三平台发布状态。

**Architecture:** Playwright 启动真正 Electron 并使用独立 userData/临时 DB/fixture Provider；CI 和原生打包分别验证。总控管理启动开关、脚本/依赖和打包配置，E2E owner 不改变业务语义。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)，[发布与授权政策](../docs/RELEASE_POLICY.md)。

## 目标与当前证据

- [playwright.config.ts](../playwright.config.ts) 第 4–12 行 只有 Web Playwright 配置，tests/e2e 尚不存在；不能称 Electron E2E 通过。
- [package.json](../package.json) 第 10,14,22–24 行 存在 Node/Electron ABI 切换，工作树不能共享可变原生依赖。
- [electron-builder.yml](../electron-builder.yml) 第 10–28 行 声明三平台目标和 native hooks，只证明配置；不证明安装/启动/签名。
- [src/main/index.ts](../src/main/index.ts) 第 33 行 默认真实 userData 数据库，测试必须先隔离才能启动应用；历史窗口记录不能替代本次 E2E。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

早期 Electron harness、独立 userData、fixture/provider 注入、安全数据隔离和少量基础场景；后期完整 V1 E2E、无空集/CI、native ABI、包内自检、三平台打包/安装/启动矩阵、发布说明与已知限制。

最终发布另须满足“免费、源码公开、非商业授权”的许可/版权/贡献审查与个人 GitHub / 跨平台 Releases 准备。PolyForm Noncommercial 1.0.0 为优先候选，正式发布前核对全文并由用户确认；不把 MIT/Apache-2.0 当项目默认候选，不称 OSI 标准开源。软件免费、用户 BYOK/承担厂商费用，不开发收费、订阅、激活、支付或反盗版系统；原有功能、依赖和 Worktree 模式不变。

明确不做：不以浏览器 mock 页面代替 Electron、不访问用户数据库/系统 Key、不在 CI 自动发付费请求、不为绿灯隐藏空集/失败；不擅自修业务、升级依赖、签名发布/上传。

## 前置与必读

骨架可在 R02 后单独获授权实施；最终 V1 验收必须 R07–R16 全部（含 R10A/R10B）合入，R01–R06 基础亦已验收。R17 未因骨架 ready 而自动授权。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

涉及 UI，先读 [DESIGN_GUIDELINES](../docs/DESIGN_GUIDELINES.md)，功能决定布局、体验决定交互；UI 组件只消费已合入契约。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 现存（135bf82） | playwright.config.ts | R17 | Electron harness 与串行/隔离 fixture；配置变更总控审核 |
| 拟新增 | tests/e2e/**；tests/fixtures/e2e/** | R17 | 仅 E2E/fixture，用户数据完全隔离 |
| 拟新增 | scripts/e2e/**；docs/release/**；.github/workflows/** | R17（脚本/CI总控审核集成） | 可重复验证与发布矩阵，CI 不含真实秘密 |
| 现存或拟新增（以执行时核对为准） | docs/RELEASE_POLICY.md；README.md；LICENSE；第三方通知/贡献规则文件；GitHub 仓库与 Releases 设置 | 总控 | 用户确认最终许可/权属/贡献条款，统一接线随包通知；R17 提供清单与验收证据，不自行改许可或执行公开发布 |
| 现存（135bf82） | package.json；pnpm-lock.yaml；electron-builder.yml；scripts/rebuild-native.cjs；scripts/verify-native.cjs；src/main/index.ts | 总控 | 启动隔离/fixture注入、ABI与打包组装 |
| 依赖任务提供（当前拟新增） | src/main/providers/registry.ts | 总控 | 启动隔离/fixture注入、ABI与打包组装 |
| 现存（135bf82） | src/**；tests/unit/**；tests/integration/** | 对应原 owner | E2E 发现业务缺陷回报原任务，不跨范围修改 |

## Worktree 可独立与可并行

可独立 codex/r17-e2e-release Worktree。R02 后可授权准备骨架并与业务模块并行；最终验收等待全部任务合入。测试 userData/DB/fixture/依赖目录不共享，pack 与 Node 测试按 ABI 顺序独立运行；同平台可变原生模块不并发。

## 共享依赖与接线规则

总控先提供可证明的测试 userData 路径/fixture Provider 注入，不存在就不能 launch。E2E 记录实际 Electron 版本/ABI。空集失败、lint 若新增须真实配置，不能运行不存在命令；包/签名/上传各为独立动作，发布动作需单独授权。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 骨架阶段先提供隔离证据和真实 Electron harness，验证少量基础场景。
- [ ] 在最终依赖全部合入后增补完整 V1 checklist 的 E2E。
- [ ] 总控按 ABI 顺序执行类型/测试/build/包内自检，并回传业务问题。
- [ ] 各平台验证安装启动，汇总发行矩阵；不自动发布或进入 R18。
- [ ] 按下列发布门槛完成许可、权属、历史扫描和仓库/Releases 材料，再由用户审核具体版本；未授权不创建/公开仓库或上传资产。

## 详细验收

- [ ] 启动前/运行时证明 app.getPath(userData) 指向测试创建目录；密钥使用 fake/session backend，零真实用户数据访问与网络付费。
- [ ] 早期骨架可测启动/窗口/有限 IPC/快照恢复，骨架完成不表示最终 V1 verified。
- [ ] 最终 E2E 覆盖可配置三 Mock Agent 公共辩论、任意 Turn Stop partial、可信点名、Pause/Step/Resume、重启 interrupted 不重发、结构化成果与代码确认写盘。
- [ ] 四类 Provider 共用协议/fixture通过，真实 smoke 单独列明；Key 不明文存库/日志/普通IPC/导出，Markdown/路径安全场景可重复。
- [ ] TypeScript、单元/集成、Electron E2E、build、native ABI、包内 DB 自检、安装启动分别记录；空测试是失败且CI可复现。
- [ ] Windows/macOS/Linux 在对应环境构建安装包并核对启动/关键流程/安全存储；不能把 macOS 输出外推为三平台通过。
- [ ] 发行说明包含版本、完整任务/Commit、平台/架构、安装与升级/备份、已知问题和真实验证矩阵；未签名/公证/未验证状态写清。
- [ ] 最终 V1 checklist 每条有对应新鲜证据；缺任一不可缩水能力或必需验证不能宣布 V1 完成，遗留业务问题交回 owner。

### 最终发布与授权验收（本轮仅追加规划）

- [ ] 用户确认准确许可证/版本、版权主体和适用范围；优先 PolyForm Noncommercial 1.0.0，核对官方全文，根目录及源码/安装包附全文和必要通知，不以本任务说明代替正式许可。
- [ ] 审查自有代码权属、外部贡献授权及实际分发的直接/传递依赖、Electron/原生组件、字体/图标等素材；记录版本、来源、许可兼容性、版权及通知义务，第三方原许可各自保留。贡献规则须明确可提交权利、入站/出站授权及雇主/第三方/AI 来源；DCO/CLA 适用性由用户确认，不推定版权自动转让。
- [ ] README 提供一致的中英文授权说明：软件免费、Source Available、非商业限制、BYOK/厂商费用、正式许可证全文与贡献规则入口；无 OSI 开源或默认 MIT/Apache-2.0 的误导表述。
- [ ] 扫描当前树、拟公开 refs 的完整 Git 历史、分支/标签及发布资产中的 Key、真实数据库/备份、私有配置和敏感个人信息，记录范围、命令、结果与人工复核。发现秘密先停止公开并处理凭据，历史清理另获授权，不擅自破坏原始历史。
- [ ] 准备用户个人 GitHub 仓库的账号/名称、公开范围、权限、贡献与安全反馈入口、待推 refs/tag 和隔离 CI 配置；用户审核后另行授权创建、推送与公开，不能从 ready 或 E2E PASS 推导发布许可。
- [ ] Windows/macOS/Linux 的对应环境均有安装包、包内许可/通知、安装启动/关键流程证据及 Releases 资产清单；版本/tag/Commit、架构、校验和、签名/公证和限制明确。源码 zip/tar 不替代安装包，未验证平台不算跨平台发布完成；用户确认具体版本后才上传/发布。

上述为最终发布验收的必要条件，不能由早期 E2E 骨架代替。详细停止条件、外部贡献与官方依据见 [发布政策](../docs/RELEASE_POLICY.md)。本轮没有实施以上项目。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| 隔离证明 | launch 前显式临时 userData；通过受限测试通道读取实际路径 | 路径等于测试根，真实 DB/Key未访问；失败不启动 |
| 完整 Mock 闭环 | 配置三成员/工作流→辩论→Stop/Step/主持人 | 公共输入/事件/UI/DB一致，partial与下一位准确 |
| 重启与中断 | 流中非正常退出，再用同测试目录启动 | interrupted保留partial，零自动重发 |
| 产物与代码 | 有效/无效结构候选，预览/取消/逐文件确认 | 无效不导出；确认前零写；根外不变 |
| 空集与CI失败 | 错误筛选/空E2E目录/注入失败 | 明确exit非零，不能passWithNoTests |
| 三平台矩阵 | 各原生环境 Node测试→ElectronABI→包内自检→安装启动 | 各项单独结果；未执行平台记未验证 |

pnpm run typecheck；pnpm run test；pnpm run e2e；pnpm run build；原生重编译/包内自检按 VALIDATION；获授权的打包使用 pnpm run pack。安装/启动须先证明隔离；每条单独记录退出码。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。
