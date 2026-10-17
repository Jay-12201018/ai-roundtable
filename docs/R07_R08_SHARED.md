# R07/R08 共享前置调用与文件归属

2026-10-16；申请号 `SHARED-R07-R08-01`；共享前置已合main并verified；R07/R08及接线已ff-only合main，但本次验收因补充桥脚本错误停止、未verified，见[实际主线记录](verification/2026-10-17-r07-r08-main.md)。共享开发原始基线 `510f58a75c676496f6e4e5960eb89553d04ab8ac`，原候选分支 `codex/shared-r07-r08-foundation`。候选历史见[实施报告](verification/2026-10-16-r07-r08-shared.md)；共享阶段独立主线历史见[main验收](verification/2026-10-16-r07-r08-shared-main.md)及[main命令台账](verification/2026-10-16-r07-r08-shared-main-commands.md)。本页与 Shared 源码一起交付，不依赖 Downloads 或临时文件作为产品规范。

## 唯一事实来源与层级

- `src/shared/schemas/configuration.ts` 定义运行时输入、输出、游标、Key 状态；`src/shared/contracts/configuration.ts` 从 Schema 派生 DTO、typed API、feature props 和输入/输出表。Shared 不依赖 Electron、数据库或 SDK。
- `RoomManagementApiContract` / `ProviderSettingsApiContract` 是未来可信服务和 Renderer 的调用边界，方法集合由 `roomManagementContracts` / `providerSettingsContracts` 覆盖。它们已注册受限rooms/settings IPC，Main/Preload双端校验。
- `Database` 是唯一持久层，沿用已有事务、备份、恢复和 Run 快照；`KeyService` 是唯一 Key 生命周期入口。不得另建 repository、协议或 Provider 引用格式。
- 当前生产 `window.roundtable` 已含room/run/rooms/settings，Main服务及feature真实接线；无通用invoke/resolveKey或空成功handler。真实网络仍明确unsupported，本次最终主线验收尚未完成。

## Provider、Model 与失效配置

`providerId` 是稳定的配置实例 ID，不是厂商名、Adapter kind 或显示名。两个 OpenAI 配置可有不同 ID、端点和 Key。模型身份必须为 `(providerId, modelId)`，不能仅按 modelId 建全局缓存或选择状态。

`kind` 为 mock、openai、openai-compatible、anthropic、gemini。显式 Mock 只能使用 modelId=mock 且不能保存端点或 Key。默认 Provider 最多一个，必须 enabled；设新默认在同一事务清除旧默认。默认配置不自动替代成员已保存的引用。

普通 Provider 配置包含 id/name/kind/baseUrl/enabled/isDefault/defaultModelId/customModels/keyReference/createdAt/updatedAt。安全摘要 `ProviderSummary` 只含身份、种类、启用/默认、模型、configurationValid、hasStoredKey；不含 URL、密文或明文。hasStoredKey 只说明属于该 Provider 的密文记录存在，不代表可解密、可联网或可生成；会话 Key 由 `getProviderKeyState` 单独报告。

新建/更新 Agent 的 providerId/modelId 必须同时为空或同时有值；同时为空表示尚未配置。未知 Provider 拒绝；已禁用配置仍可显示/保存用于修复，但启动时拒绝。真实模型 ID 允许自定义，不把当前模型列表当厂商永久白名单；真实可用性留真实 Adapter 验证。旧库半配置保留可读输出，编辑保存须修复为完整对或空对。

目前仍使用Mock resolver；Database.listAgents在新Run前校验，RunService所有schedule路径改变状态前复验冻结Provider/model；真实返回unsupported，禁用/失效明确拒绝，不落Mock。旧Demo只兼容null Provider+mock model。R09真实resolver仍须总控统一接入并补测试，不能只删门禁。

端点仅允许 HTTPS，或原始 authority 明确为 localhost/127.0.0.1/[::1] 的 HTTP；拒绝 userinfo、query、fragment、反斜线、控制字符及 URL 数值别名绕过。Schema 返回规范化 URL。DNS 解析、重定向、真实网络目标和用户确认留 R08/R09；Schema 通过不代表已经完成网络安全验证。

## Database 调用

Database 直接方法以同步事务运行，create 输入带 Main 生成的 id；typed API 的 create 输入不带 id，由 Main 服务 `randomUUID()` 补入。输入都经过 Schema。`get*Configuration(id)` 找不到返回 undefined，服务应转为既有 `ContractError('not_found')`；typed API 不返回 undefined。

| Database 方法 | 输入/结果与规则 |
| --- | --- |
| createRoom / updateRoom | RoomInput → RoomConfiguration；完整字段替换，不是任意 patch |
| getRoomConfiguration / listRooms | id / {includeArchived?}；默认隐藏归档 |
| archiveRoom / deleteRoom | id, archived=true；活动 Run 禁止归档；有 Run/消息禁止硬删 |
| createAgent / updateAgent | AgentInput → AgentConfiguration；roomId 不可跨房修改，旧冻结快照不改 |
| getAgentConfiguration / listAgentConfigurations | id / roomId, includeArchived=false；含 enabled 和角色/systemPrompt/引用 |
| reorderAgents | roomId, agentIds；必须恰好覆盖全部未归档成员，含禁用成员；一次事务写连续序号 |
| archiveAgent / deleteAgent | id, archived=true；归档保留身份；Turn、currentAgent 或任何 Run 冻结成员引用存在则禁止硬删 |
| createProvider / updateProvider | ProviderInput → ProviderConfiguration；活动冻结引用禁止更新，单一默认及目标变更 Key 撤销同事务 |
| getProviderConfiguration / listProviderSummaries | 完整配置或安全摘要；失效旧配置仅提供受限摘要，不回传原始坏 URL |
| validateModelSelection | providerId, modelId → 配置；检查存在、启用和显式 Mock 模型 |
| assertProviderMutable | providerId；running/pausing/paused/cancelling 的冻结成员引用锁定；旧无快照 Run 回查当前成员 |
| getProviderKeyRevision / replaceProviderKey | Main KeyService 专用；revision CAS、密文/引用切换/旧密文删除同事务；不向 Renderer 暴露 |
| listRoomMessages / listRoomRuns | 输入/输出以 Shared Page Schema 为准，规则见下 |

Provider 删除由设置服务调用 `KeyService.deleteProvider`，其先执行 Database 保护删除，成功后才清理会话 Key；失败保留原 Key。任何成员（含归档成员）或历史冻结成员引用都阻止 Provider 硬删。先明确解绑/删除未使用配置；已发生的历史不可为清理配置而改写。

成员编辑、启停、排序、归档只影响后续 Run。RunService 继续复制冻结成员，原消息、Turn、Attempt 和部分输出不被修改。旧终态/中断 Run 的显式操作规则仍按 R04，不因设置页引入自动重发。

## Key 调用及撤销

- `storeKey(providerId, plaintext): Promise<KeyReference>`：输入仅在 Main 调用及独立设置命令中短暂存在。每 Provider 串行，异步加密前后检查活动冻结引用和 revision；失败保留旧值。
- `resolveKey(providerId, reference): Promise<string | undefined>`：Main-only；验证归属、当前引用、后端和 revision，异步解密结束再次检查。跨 Provider、旧引用、删除后重建或目标已变更的引用不得返回明文。
- `deleteKey(providerId)`：原子清引用、删旧密文、更新 revision，再清会话；活动 Run 拒绝。
- `deleteProvider(providerId)`：上述受保护删除入口，禁止服务绕过它遗留会话 Key。
- `getProviderKeyState(providerId)` 返回 missing/configured/session/unavailable 及受限引用/存储状态。配置成功不代表鉴权/生成能力。异常仅为固定公开错误，不传播后端详情。
- `getStatus()` 返回 secure/persistent=true 或 memory/persistent=false 与固定提示。

可靠后端只落密文；不可靠后端明文与引用仅保存在 KeyService 会话内存，不进入 providers/key_records，重建服务即 missing。内存项绑定 Key revision，Provider ID 重用不会恢复旧 Key。更改 kind 或规范化 baseUrl 的事务会撤销旧密文及 revision；旧会话项也立即无法解析，查询状态时清理。界面必须在更换目标前提示用户需重新输入 Key。重命名不改变身份。

仅 `setProviderKeyInputSchema` 的独立请求携带 apiKey；普通配置/摘要/历史 Schema 为 strict 并拒绝额外凭据字段。后续 handler 不得记录此 payload；Renderer 表单提交/离开后清除，不存持久 store/localStorage。resolveKey 永不进入 Preload。任意用户文本无法靠 DTO 字段名自动识别秘密，禁止将 Key 拼入用户文本。

## 稳定历史分页

消息按 sortKey 升序，首次固定 throughKey；cursor={roomId,afterKey,throughKey}。Run 按 (createdAt,id) 升序，首次同时固定 through 位置和 throughRowId 插入上界；cursor={roomId,throughRowId,after,through}。SQLite BINARY ID 排序与 Shared Unicode code point 比较保持一致，同时间戳后插入的较小 ID 不会混入旧页。

limit 默认100、范围1–500；hasMore=true 当且仅当有 nextCursor，游标等于本页最后一项；末页 nextCursor=null。游标必须属于当前房间，边界实际存在且不越界，伪造跨房或越界返回 invalid_input。顺序不依赖 updatedAt。刷新要丢弃旧游标，从第一页开始。

这固定的是当前分页窗口的记录成员及顺序，不是跨多次请求冻结所有可变文本或 Run 状态；活动流式 Run 继续使用既有 getSnapshot/subscribe。Room/Run 删除保护保证正常调用不会使历史边界被硬删。此版本不提供签名游标或跨数据库迁移持久游标。

## Feature API 与延后接线

R07 导出组件 props 使用 `RoomsFeatureProps`：api、providers 安全摘要、providerLoadState、onReloadProviders、onSelectRoom、onSelectRun、onOpenSettings。R08 使用 `SettingsFeatureProps`：api、onClose。两个 feature 不直接互 import，不读全局 Key、数据库或通用 IPC。

`ProviderSettingsApiContract.listModels` 是列表能力，`testConnection` 单独使用 configuration/authentication/generation level；generation 要求 modelId。请求身份由 Main/Adapter 生成，不能让普通 UI 伪造 requestId。未接入真实 Adapter 时不得声称真实鉴权/生成成功，不能用 Mock 成功替代真实配置。

总控在联合集成负责：实例化 room/settings 服务、注入 Database/KeyService/真实可用 Adapter、双端 IPC 注册和来源验证、敏感命令专用脱敏、Preload typed API、App/provider 摘要加载/刷新及 R06 选择投影。模块提供真实服务和独立 feature；总控不得为这些待完成服务预置空 handler。Provider factory 的真实网络能力属于 R09/R10，R08 自动化仅 fake/fixture。

## 排他文件归属和启动门槛（原模块阶段登记，现态见文末）

| 唯一写入者 | 目录/文件 |
| --- | --- |
| 总控 | src/shared/**；src/main/database/**（含 migration3）；src/main/ipc/**；src/preload/**；src/main/index.ts；src/renderer/App.tsx；store/subscriptions 公共投影；RunService/context/Provider factory 公共接线；package/lock；治理文档 |
| 总控公共回归 | tests/unit/contracts/configuration.test.ts；tests/unit/configuration/**；tests/integration/configuration/**；既有公共数据库/迁移/联合/生命周期测试和 probes |
| R07（以后单独授权） | src/main/room/**；src/renderer/features/rooms/**；tests/unit/rooms/**；tests/integration/rooms/**；tests/unit/rendererRooms/** |
| R08（以后单独授权） | src/main/settings/**；src/renderer/features/settings/**；src/main/security/KeyService.ts；src/main/security/electronSafeStorage.ts；tests/unit/keyService.test.ts；tests/unit/settings/**；tests/integration/settings/**；tests/unit/rendererSettings/** |

共享前置实施及本次主线验收均由总控独占；R08 启动后总控冻结 KeyService 写入，公共 Key 回归由 R08 运行但不能自行改公共断言。需要 Shared/DB 变更先提交含调用方、迁移、安全和测试影响的申请，唯一负责人处理。

migration3 只归总控；migration1/2 原文不变，后续新版本再分配，不得由 R07/R08 各建一份3。3为配置字段、归档、Key revision、单默认索引和历史索引；保留旧未知任务/执行时间，不创建虚假 Provider/模型/Key。初始化前沿用验证过的 SQLite 在线备份与候选恢复，迁移同事务失败回滚。

**以下为共享前置阶段历史启动门槛，非当前授权状态**：用户批准1e1f971已从510f58a以ff-only合main，本轮主线独立复验通过。未来R07/R08必须从包含本次状态更新的同一最新main完整SHA开始（最终交付给出，启动前以 `git rev-parse main` 重新核验），分别为 `codex/r07-rooms-agents-history` 和 `codex/r08-key-provider-settings`。二者可并行，生产接线仍由总控在联合集成完成；需用户下一次明确授权，当前未创建这两个Worktree。

## 测试方法

按 [ENVIRONMENT](ENVIRONMENT.md) 准备每 Worktree 独立依赖和官方 Node24.18.1/darwin-arm64 同版 include/config；不得复用可变 node_modules、数据库或 userData。Node 与 Electron 原生重编译串行进行。

```sh
# 先受控 Node native:node，环境与命令台账一致
pnpm exec vitest run tests/unit/contracts/configuration.test.ts tests/unit/configuration tests/integration/configuration --reporter=dot
pnpm test --reporter=dot
pnpm typecheck
pnpm build
# 全部Node测试结束后，使用对应38.8.6 headers编译Electron ABI139
pnpm native:electron
```

Database fixture 优先 `:memory:`；磁盘迁移/备份使用测试自己 mkdtemp 的私有目录，Key 用 fake backend 和唯一假值。现有公共测试可直接消费，无须启动生产应用或使用真实 Key。完整实际命令、压力与安全隔离探针见本次台账；上述方法不是未执行功能测试的 PASS 声明。


## 联合接线及最终合并现态（2026-10-17）

上述共享前置与功能启动门槛为历史。本轮已另获 R07/R08 联合授权，总控在 codex/integrate-r07-r08 完成真实 Main 服务、受限 rooms/settings Bridge、App feature 与 R06 协调；获批d3205b2已正式ff-only合main，但本次主线验收因补充桥包装器错误停止，未verified。见 [接口登记](CONTRACTS.md)及[本轮报告](verification/2026-10-17-r07-r08-integration.md)。

新增 props 仅 onClearRoom?: () => void（空选择）和 initialRoomId?: string（首次恢复）；既有 onSelectRoom(string) 不变。会话依赖 RunSessionApiContract，App 依赖完整 RoundtableApiContract。Bridge Promise 拒绝为安全 ApiError DTO，无 Error 实例/stack；成功值、持久化 Schema 不变。

原模块目录归属保留；本次公共接线、窄窗与最小兼容修正均由总控独占。真实网络/factory 与正式 E2E/发布仍须 R09/R10/R17 后续授权，没有新增 migration。

实际Main/Preload/App接线已合入，不再需要创建R07/R08 Worktree。原目录归属保留，后续Shared/Database/migration/Main/App/公共投影和工厂由总控统一修改。补充桥字段检查未完成，R09仍blocked/未授权；本轮不继续实施或创建Worktree。
