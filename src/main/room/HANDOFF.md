# R07 模块开发交付报告

交付日期：2026-10-17（Asia/Shanghai）。本模块为独立开发交付、待总控审核与集成；不自行更新公共 STATUS，不声明 merged/verified。

## Git 与范围

- Worktree：`/Users/zhangwenjie/.codex/worktrees/b278/AI交互`
- 分支：`codex/r07-rooms-agents-history`
- 起点：`c1b5beaddfe254ca978f32874e6376b398d09836`，开始时 detached HEAD、干净且匹配授权基线；随后在此建立命名分支，无重置或历史重写。
- 本报告随模块一同提交，完整 Commit SHA 见最终交付消息（同一提交不能包含自身哈希）。提交后保留分支和 Worktree，不合 main、不推送、不改 R08。
- 所有新增文件均在授权的五个路径内；Shared、Database/migration、IPC/Preload/Main/App/store/subscriptions、settings/security、package/lock、公共配置/文档/测试均未修改。

## 已实现功能与操作

`new RoomService(database)` 实现已合入的全部 15 个 `RoomManagementApiContract` 方法。Main 生成 UUID；输入和输出使用 `roomManagementContracts` 同一 Schema 表；缺失记录返回 `not_found`，非法输入/输出与未知异常返回固定公开错误。唯一存储和事务/引用规则仍为现有 Database，没有第二套 DTO、IPC、repository 或调度状态。

导出 `src/renderer/features/rooms/index.ts` 的 `RoomsFeature`，props 严格使用 Shared `RoomsFeatureProps`。注入真实 typed API 即可操作；本模块没有注册生产 IPC 或挂到 App。

1. 新建房间并填写名称/目标；导航选择房间；编辑、取消、保存反馈；归档须确认，默认隐藏后可勾选显示并恢复。删除须单独确认；有 Run/消息或历史引用时 Database 拒绝。空列表、加载、失败与重试均有状态。
2. 在“成员配置”新增或编辑名称、角色、System prompt、Provider/Model；启用/禁用，上移/下移（包含全部未归档禁用成员），归档、恢复与受保护删除。表单保留失败输入并在原生模态框内展示安全错误。
3. Provider 只消费安全摘要。实例 ID 与模型 ID 成对；保留失效引用供修复，旧 Provider 为空但有遗留模型时允许手动清空；明确显示未配置、禁用、失效、加载失败与真实能力未验证。真实模型 ID 可自定义；仅用户显式选择 Mock 后才配置 `mock`；没有 Key 输入或真实模型调用。
4. “历史记录”按稳定升序分页浏览 Run 和房间消息；加载更多保持首次固定窗口，刷新从第一页重建窗口。选择 Run 筛选已加载消息并调用 `onSelectRun`。较后的所选 Run 消息可能尚未加载，界面明确提示继续加载。房间切换清空局部 Run 选择、草稿和请求状态；请求序号、generation 与卸载守卫丢弃迟到查询/分页/保存反馈。
5. 消息使用持久化的当时 `senderName`、原始正文及状态；不会拿当前成员配置回填历史。文本直接由 React 转义，不执行 HTML。已有 Run 的冻结姓名、角色、模型、提示、顺序在配置修改/归档后仍保持；暂停/中断 Run 使用冻结成员继续执行。

界面采用独立作用域样式、系统亮暗主题、克制的列表与操作层级；窄窗导航重排，历史区可纵向排列。原生 dialog 提供模态焦点、Escape 和触发点返回；禁用按钮保留可读文字与语义。

## 验证结果

本轮使用官方 Node24.18.1/darwin-arm64、同发行包 include/config、pnpm11.25.0、锁文件固定依赖。安装为独立缓存的冻结离线安装（646 reused / 0 downloaded），不是冷缓存联网安装。Node/Electron 原生重建严格串行，最终 native 留在 Electron ABI139。

完整 argv、UTC、退出码、源码摘要、耗时与中间失败见同目录 `VERIFICATION.md`。以下均为本轮实际执行结果：

| 项目 | 命令（均经受控 runner） | 结果 / exit |
| --- | --- | --- |
| R07 Node 专项 | `pnpm exec vitest run tests/unit/rooms tests/integration/rooms tests/unit/rendererRooms --reporter=dot` | 7 文件 / 68 项通过，0 |
| 完整 Node 回归 | `pnpm test --reporter=dot` | 51 文件 / 680 项通过，0 |
| Node 原生重编译 | `pnpm native:node`（由上述 pretest 调用） | 同版 headers 源码编译 ABI137，0 |
| TypeScript strict | `pnpm typecheck` | 0 |
| 生产构建 | `pnpm build` | strict + Main/CJS Preload/现有 App Renderer 成功，0 |
| 独立 rooms fixture 生产 bundle | `pnpm exec vite build --config <本轮临时根>/preview/vite.config.mjs` | rooms feature 确实单独编译打包，0 |
| Electron 重建 | `pnpm native:electron` | 对应 38.8.6 headers 源码重编译，0 |
| Electron 原生实测 | `ELECTRON_RUN_AS_NODE=1 <Electron> <本轮临时根>/sqlite-electron.cjs` | Electron38.8.6 / Node22.22.0 / ABI139 / arm64，内存 SQL 写读/关闭与正常退出，0 |
| Electron R07 专项 | `ELECTRON_RUN_AS_NODE=1 <Electron> node_modules/vitest/vitest.mjs run tests/unit/rooms tests/integration/rooms tests/unit/rendererRooms --reporter=dot` | 最终 7 文件 / 68 项通过，0 |

专项涵盖房间/成员配置往返、真实磁盘关闭重开、排序启停/归档恢复/删除与结构化错误、未配置/禁用/失效/真实 Provider 的零 fallback 调用、零启用成员、冻结快照不可变、未来尚无 Turn 的成员保护、暂停后继续/中断显式恢复、同时间戳及 Unicode Run 游标/并发插入上界/跨房拒绝、迟到查询及 mutation 隔离、分页失败重试、真实 RoomService/SQLite 注入 UI 的配置三 Mock 成员协作。

浏览器为独立临时 Chrome context，外部请求阻断，只访问本地 fixture，不启动生产 Main 或真实 Key。亮暗各 800×600 / 1024×768 / 1280×800 / 1600×1000 共 8 组无水平溢出；原生 modal、初始焦点、Escape 返回、历史与大字体重排断言通过。最终 probe 同时加载现有公共样式，fixture 明确覆盖其 `body min-width`，因此这是独立 feature 证据，不能算生产 App 的窄窗验收。大字体重排也不等于原生浏览器 200% 缩放验收。

Token 组合按实际色值计算：亮/暗最小正文对比度 5.21 / 4.98，控件边界 3.24 / 3.80，焦点 5.27 / 5.68，主按钮文字 6.28 / 9.24。未据此声称全应用所有组合或辅助技术审计完成。

环境只读审计确认官方 runtime 4703 文件与缓存 archive 一致，pnpm 核心字节匹配官方缓存包，32 个直接依赖及安装锁匹配；node_modules 与自身 store/旧 Worktree 无共享 inode，其他 Worktree native 未改。测试仅 `:memory:` 或自建临时目录，没有现有用户数据库、Key 或付费模型访问。

## 未完成与总控接线申请

### R07-WIRING-01：生产服务与 typed Bridge

调用方：Main、IPC、Preload、RoomsFeature。实例化 `RoomService(database)`；按已合入的 `roomManagementContracts` 双端校验所有命令与结果，沿用可信 sender/source/envelope/固定错误及 disposer。Preload 仅暴露 typed 方法；不得添加通用 invoke、空 handler 或假成功。本模块无新 Schema/DTO/迁移/依赖，正常旧 room/run Bridge 兼容。

测试：原 Bridge 与生命周期回归、新 API 的成功/失败/非法 sender、房间创建/重开、受保护删除和真实生产页面。风险：未接线前 `window.roundtable` 仍无这些命令，当前 `pnpm build` 不会把未导入的 R07 服务/feature 自动装进生产入口。

### R07-WIRING-02：App、R06 选择与冻结历史详情

App 挂载 `RoomsFeature`，从 R08 的安全摘要加载状态注入 `providers/providerLoadState/onReloadProviders`，设置返回后刷新摘要。`onSelectRoom` 负责清理旧 R06 Run 选择/订阅/游标/请求代次；`onSelectRun` 使用既有 `run.getSnapshot/subscribe` 并保持 R06 的迟到保护。

**冻结角色与模型详情待集成。** `HistoryMessage`/`RunSummary` 没有这些字段，`RoomsFeatureProps` 也没有取快照方法。本模块没有复制 API 或用当前配置猜测。总控应在执行详情从 `snapshot.execution.membersSnapshot` 按 agentId 展示冻结姓名/角色/provider/model（旧记录为 null 时显示未知）；现有 App 尚未呈现这些详情。持久快照及回调已在本轮测试验证，生产详情 UI 未验证。

测试：切房时旧 Run/旧订阅不得留在新房，点选历史的冻结详情不随当前成员编辑变化，活动 Run 继续实时投影。无 DB/migration 改动，禁止重写旧消息。

### R07-SHARED-01：空选择通知（申请，未自行实施）

当前 `onSelectRoom(roomId: string)` 不能表达删除/隐藏最后一个房间后的空选择。feature 内部会清空，但父级 R06 不会收到空 ID。建议总控在 Shared `RoomsFeatureProps` 增加可选 `onClearRoom?: () => void`，随后统一在 feature 的 `select(undefined)` 接线，并让 App 清空旧 Run/订阅/请求。本次未加入未批准字段。

兼容性：可选 props 保留已有调用方；不修改现有 wire DTO、数据库或 migration。测试增加删除最后房间、归档最后房间、过滤后无可选房间时父投影清理；安全影响为避免旧房间内容残留，不引入权限或 Key 能力。若总控选择其他统一选择协议，应先批准 Shared 再适配，不能让模块私建第二套协议。

### R07-WIRING-03：公共布局与最终 UI 验收

公共 `src/renderer/styles.css` 的 `body min-width:1080px` 仍限制实际窄窗；总控须在 App 组装时处理。rooms 已局部抵消公共 header padding 和 disabled opacity，但没有越权修改公共文件。全应用主题选择/持久偏好、正式 200% 缩放、辅助技术、中文输入法及 1000+ 消息虚拟化未验证，最终大规模聊天 UI 属后续范围。

## 集成与验收建议

仅在审核本提交及上述申请后，由总控统一接线并新建隔离 userData 验证：从 UI 建房 → 配置三个显式 Mock → 排序/启停 → 发起自定义 Run → 暂停期间编辑未来成员 → 继续并检查冻结身份 → 浏览旧 Run → 重启读取 → 验证归档/删除保护 → 快速切房和加载更多。须重跑完整回归、strict/build、双 ABI 与原 Bridge；联合证据通过后再更新公共看板。

正式 Electron 生产 UI 闭环、真实 Provider/系统 Key、打包/安装/签名、公证、Windows/Linux、冷缓存联网安装与断电极限：均未验证。未运行 lint（仓库无命令）或正式 E2E（无 tests/e2e）。本模块测试与浏览器 fixture 成功不能替代这些验收。

## 实际文件清单

- `src/main/room/RoomService.ts` — typed Main 服务。
- `src/main/room/PLAN.md` — 本模块执行归属。
- `src/main/room/HANDOFF.md` — 本报告。
- `src/main/room/VERIFICATION.md` — 本轮命令/失败台账。
- `src/renderer/features/rooms/RoomsFeature.tsx` — 房间管理与选择。
- `src/renderer/features/rooms/MembersPanel.tsx` — 成员表单及操作。
- `src/renderer/features/rooms/HistoryPanel.tsx` — 历史 Run/消息分页。
- `src/renderer/features/rooms/ui.tsx` — 原生确认框及安全中文错误。
- `src/renderer/features/rooms/rooms.css` — 独立作用域主题及布局。
- `src/renderer/features/rooms/index.ts` — feature 导出。
- `tests/unit/rooms/RoomService.test.ts` — 服务边界 18 项。
- `tests/integration/rooms/rooms.test.ts` — 数据/Run/分页 17 项。
- `tests/integration/rooms/featureIntegration.test.tsx` — 真实服务注入 UI 1 项。
- `tests/unit/rendererRooms/RoomsFeature.test.tsx` — 主要交互 11 项。
- `tests/unit/rendererRooms/edgeCases.test.tsx` — 竞态/Provider/分页 10 项。
- `tests/unit/rendererRooms/dialogErrors.test.tsx` — modal/错误/语义 8 项。
- `tests/unit/rendererRooms/roomLifecycle.test.tsx` — 房间成功路径/消息重试 3 项。
- `tests/unit/rendererRooms/fixtures.ts` — 纯 typed API 测试 fixture。
