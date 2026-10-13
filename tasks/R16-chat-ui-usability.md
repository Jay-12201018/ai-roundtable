# R16 聊天 UI 与可用性实施任务计划

> 当前状态见 [STATUS](../docs/STATUS.md)。未来范围定义；本轮未获实施授权，不得自动启动。
> 执行时按工程规范选择已授权的执行方式；各项以复选框记录进度，不能因任务文件存在而标完成。

**Goal:** 形成安全 Markdown、长历史阅读、双主题和可访问的多 Agent 群聊界面，按实际功能适配桌面窗口。

**Architecture:** 独立 timeline、theme 和基础 UI 组件消费 R06 投影；既有 feature 保持原 owner。总控维护 App 组装并协调 R06 状态模块接口，布局按职责折叠而不固定常驻三栏。

**Tech Stack:** Electron、React、TypeScript strict、electron-vite、SQLite、Zod；Renderer Zustand 是 V1 目标，使用前先核对已合入实现。

**Spec:** [SPEC](../SPEC.md)，[V0 审查](../docs/V0_AUDIT.md)。

## 目标与当前证据

- [src/renderer/App.tsx](../src/renderer/App.tsx) 第 185–189 行 全量 messages.map、原文 p 和单行 input，尚无 Markdown/虚拟列表/多行输入。
- `src/renderer/styles.css` 第 1–7 行固定暗色、min-width:1080 和三栏；[src/main/windows/createMainWindow.ts](../src/main/windows/createMainWindow.ts) 第 8 行 最小宽度 1080。
- [package.json](../package.json) 第 34–36 行 虽声明 Markdown/sanitize 依赖，基线 UI 没有使用；不能把依赖存在当渲染安全验收。
- `docs/DESIGN_GUIDELINES.md` 定义 800/1024/1280/1600 窗口、双主题、阅读/输入/焦点和对比度要求，当前仅设计规范。

以上源码与原始 README 证据来自基线 `135bf82c6462ade6dd5300717d6f0102ce4a660c`；治理文档引用指向 R00 文件。行号不代表当前 README 的更新位置。未声明本任务测试已经通过，执行时须重新核对基线和函数。

## 范围与明确不做

安全 Markdown/GFM/代码高亮/复制；1000+ 消息虚拟列表、滚动锚点/新消息提醒；多行输入/IME/快捷键；双主题/系统跟随/中文 i18n；响应折叠、键盘/焦点/对比度/缩放/减少动画与完整状态。

明确不做：不改 Provider/调度/数据库/版本/设置逻辑，不重新设计产品范围，不复制参考产品页面，不并发改其他 feature 或 App/store；不把截图等同交互/性能验证。

## 前置与必读

R06 状态/订阅接口已合入；主要交互（房间/设置/工作流/主持人/产物）接口和语义稳定后实施；R16 获实施授权。不存在提前全面改版授权。

每个执行线程先读 [AGENTS](../AGENTS.md)、[SPEC](../SPEC.md)、[CONTRACTS](../docs/CONTRACTS.md)、[DECISIONS](../docs/DECISIONS.md)、[STATUS](../docs/STATUS.md)、[VALIDATION](../docs/VALIDATION.md)；重新检查 Git 状态、真实文件和依赖提交。具体 wire shape 以总控已合入的 Shared 为准，本文不冻结第二套协议。

涉及 UI，先读 [DESIGN_GUIDELINES](../docs/DESIGN_GUIDELINES.md)，功能决定布局、体验决定交互；UI 组件只消费已合入契约。

## 文件归属

下列路径均相对仓库根；现存/拟新增以原始 `135bf82` 为准，拟新增路径尚不是已实现能力。共享文件由总控实施接线，不属于子项目自由修改范围。

| 状态 | 路径 | 写入负责人 | 责任 |
| --- | --- | --- | --- |
| 现存（135bf82） | src/renderer/styles.css；src/renderer/locales/zhCN.ts | R16（公共文案变更总控协调） | 设计 token、基础样式与通用 i18n；其他 feature 本地样式/语义归各 owner |
| 拟新增 | src/renderer/features/timeline/**；src/renderer/theme/**；src/renderer/components/ui/** | R16 | 阅读/Markdown/虚拟列表、主题与基础可访问组件 |
| 拟新增 | tests/unit/chatUI/**；tests/unit/markdownSecurity/**；tests/integration/chatUI/** | R16 | IME/滚动/1000+消息/主题/安全与可访问行为 |
| 现存（135bf82） | src/renderer/App.tsx；src/main/windows/createMainWindow.ts；src/shared/**；package.json；pnpm-lock.yaml | 总控协调 R06/R01 owner | 组装、最小窗口及必要依赖/公共接口；R16 不自行改公共文件 |
| 依赖任务提供（当前拟新增） | src/renderer/store/** | 总控协调 R06/R01 owner | 组装、最小窗口及必要依赖/公共接口；R16 不自行改公共文件 |
| 依赖任务提供（当前拟新增） | src/renderer/features/rooms/**；src/renderer/features/settings/**；src/renderer/features/workflows/**；src/renderer/features/host/**；src/renderer/features/usage/**；src/renderer/features/artifacts/**；src/renderer/features/codeExport/** | 各模块原 owner | 跨 feature 修改列申请，不与 R16 同文件并发 |

## Worktree 可独立与可并行

可独立 codex/r16-chat-ui-usability Worktree；R06 后可准备组件/测试，但主要交互稳定后才进行整体 UI 实施。可与 R15 并行，timeline/theme/ui 与 codeExport 分开；共用组件接口先由总控冻结。

## 共享依赖与接线规则

完整阅读 DESIGN_GUIDELINES。统一组件/tokens 提交后各 feature owner 逐项消费，总控组装 App 并调整窗口最小值；R16 不跨模块重写。新增渲染库仅在现有依赖不足且总控批准后处理，不擅自安装。

子项目提供契约需求、调用方、兼容性、migration/版本、测试与安全影响；总控先合入共享变化再允许消费。一份文件仅一个写入人，不用分支隔离掩盖同文件争用。共享迁移、IPC/Preload 注册、Main/App 组装及 package/lock 归总控；R04 负责 RunService 状态机模块；R06 阶段由总控登记唯一负责人完成状态拆分/store，之后 App 公共组装由总控维护；后继模块只提交接线申请。

## 实施步骤

- [ ] 依据规范建立 Markdown 安全、IME/滚动和主题行为测试。
- [ ] 实现独立 timeline/theme/ui，记录1000+样本性能。
- [ ] 总控协调 App/最小窗口及各 feature owner 消费公共组件。
- [ ] 在隔离桌面上验证四视口、双主题、缩放/键盘，交付真实证据。

## 详细验收

- [ ] Markdown/GFM 与代码高亮保留格式且 sanitize，拒绝 script/事件属性/危险 URL；外链交给 R01 可信规则，模型内容不执行。
- [ ] 1000+ 消息在流式更新中虚拟化，DOM 数量有界；记录实际平台/样本/渲染与交互测量，稳定 ID/锚点无跳失。
- [ ] 用户在底部可跟随，向上阅读/选字/看旧版本不抢滚动；新消息入口清楚，返回后保留草稿和阅读位置。
- [ ] Enter 发送、Shift+Enter 换行；IME composition Enter 不发送，按钮等价操作可键盘使用；动作名称明确区分发消息/启动协作。
- [ ] 浅色/深色/系统跟随覆盖所有主要区域和状态，切换持久；实际前景/背景文字至少 4.5:1、必要边界/焦点至少 3:1，给测量证据。
- [ ] 800×600/1024×768/1280×800/1600×1000 与 200% 缩放中输入/状态/Stop 可达，不靠全页面横向滚动维持固定三栏；抽屉焦点返回正确。
- [ ] 身份靠姓名/角色/模型文字，状态和错误中文可读，Token 流不逐字播报；reduced-motion、空/无Key/同步/流式/停止/中断/预算/无产物都有解释和下一步。
- [ ] Run/Turn 状态仍以 Main 为准，不点击即宣布暂停/完成；版本/产物/费用 feature 语义保持各任务验收。

## 具体测试情景

| 情景 | 操作/输入 | 必须观察的结果 |
| --- | --- | --- |
| Markdown 攻击 | script/onclick/javascript URL/畸形 HTML 与 GFM/长代码 | 不执行危险内容，合法内容可读/复制 |
| 大历史流式 | 1000+混长消息，每32ms增量与翻页/选字 | 节点有界、文本一致、锚点稳定，测量结果留档 |
| IME 与键盘 | compositionstart→Enter→compositionend，Shift+Enter | 组合确认不发送，快捷键无误发，全键盘可操作 |
| 尺寸/缩放 | 四个规范视口+200%+长标题路径代码 | 聊天/Stop/输入可达，辅助面板按需折叠 |
| 主题/对比度 | 系统切换/手动覆盖/重开，所有交互状态 | 选择恢复、整体覆盖，实测对比度达标 |
| 辅助技术 | 键盘抽屉/菜单、焦点、reduced-motion、流式通知 | 焦点返回和名称正确，无高频Token播报/不必要动画 |

pnpm run test -- tests/unit/chatUI tests/unit/markdownSecurity tests/integration/chatUI；pnpm run typecheck；pnpm run build。性能/IME/焦点/窗口须补实际桌面证据；隔离不成立则未运行。

依照 [VALIDATION](../docs/VALIDATION.md) 记录真实结果。未运行、失败、条件性验证分别说明；不得把静态证据、Mock、构建或截图互相替代。

## 交付格式

交付包含：任务 ID 与基线/分支；逐项文件清单；行为和操作说明；精确测试命令、日期、退出码、关键输出与未运行项；契约申请和数据库影响；遗留问题；本模块 Commit SHA；总控接线与集成建议。只提交本任务获准文件，不向 main 自行合并。总控集成后复验才更新 merged/verified。
