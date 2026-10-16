# R08 设置模块接入说明

本模块交付独立 Main 服务与 Renderer feature。生产 Main/IPC/Preload/App 接线由总控完成；当前没有新增生产 handler。

```ts
// Main：复用同一个应用 Database 与 KeyService，不再创建持久层。
import { ProviderSettingsService } from './settings';
const settings = new ProviderSettingsService(database, keyService);

// Renderer：只注入 ProviderSettingsApiContract。
import { SettingsFeature } from './features/settings';
// <SettingsFeature api={providerSettingsApi} onClose={closeSettings} />
```

服务完整实现既有 `ProviderSettingsApiContract`。输入/输出沿用 `providerSettingsContracts`，Provider/request ID 由 Main 生成。Database 负责配置事务、单一默认、成员/历史/活动 Run 引用保护和目标变更撤销；Key 操作统一通过既有 KeyService，Provider 删除也必须走它。

真实 Provider 的自定义模型保存在 `customModels`，默认模型可留空或手动输入。模型身份始终是 `(providerId, modelId)`，更改默认模型不重写成员或历史。`listModels` 是独立远程发现能力：当前仅显式 Mock 返回本地列表，真实 Provider 返回 `unsupported`。

`testConnection(configuration)` 只检查本地配置：启用状态、既有安全 URL Schema、兼容端点地址和显式模型组合。它不查 DNS、不访问网络、不验证 Key。真实 Provider 的 authentication/generation 返回 `ok:false/unsupported`；显式 Mock 的成功仅表示本地模拟。真实网络目标检查、重定向/DNS 防护及真实 Adapter 留 R09/R10，不能根据本地配置检查成功绕过它们。

设置 UI 包含实例 CRUD、启停/默认、自定义模型、独立 Key 输入/更换/删除、规范化目标确认、分级结果、失败重试与危险操作确认。Key 只短暂存在于 password DOM 和专用保存调用；输入框失焦、提交、取消、切换、关闭与卸载时清除。保存/替换可按 Enter，也可点击按钮；普通配置与状态不携带 Key。

总控接线申请（无新增 DTO/Schema/migration）：

1. 在 Main 创建上述服务，复用已初始化 Database 和唯一 KeyService，保持方法调用时的实例绑定。
2. 根据既有 `providerSettingsContracts` 注册有限 typed IPC，双端验证；沿用可信窗口/主 frame/source 校验及固定公开错误。`setKey` 必须走敏感命令路径，不记录请求 payload、明文或后端错误。
3. Preload 只暴露既有设置方法；不得暴露 `resolveKey`、通用 invoke/send、Node 或数据库。响应只含配置/摘要/Key 状态。
4. App 挂载 `SettingsFeature` 并注入 typed API。关闭设置后刷新 Provider 摘要给 R07；不直接互相 import 两个 feature，不把 Key 输入放进持久 store。更换 API 数据源会重建设置会话。
5. 联合验证 R07 成员/历史引用、活动 Run 保护、设置返回后的摘要刷新及 R06 原控制行为。旧失效配置仅显示受限摘要；读取失败可重试或明确确认删除，删除仍受 Main 引用保护。

测试入口（须先遵循 `docs/ENVIRONMENT.md` 准备 Worktree 独立 Node 24.18.1 依赖与同版 headers）：

```sh
pnpm exec vitest run tests/unit/keyService.test.ts tests/unit/settings tests/integration/settings tests/unit/rendererSettings --reporter=dot
pnpm run typecheck
pnpm run test --reporter=dot
pnpm run build
# 全部 Node 检查结束后，再串行重建 Electron 原生模块并验证实际 ABI。
pnpm run native:electron
```

测试仅用 fake backend、虚拟 API、`:memory:` 或本次测试自己的临时目录。`settingsFeature.test.tsx` 额外连接真实 feature、settings service、Database 与内存 KeyService，但不经过生产 IPC/Preload/App，不能算桌面端到端验证。真实系统安全存储、真实 Provider/Key、发布打包与跨平台均需另行验证。
