# Renderer 状态接入

`rendererStore.ts` 是单个 Renderer 窗口的 Zustand vanilla Store。`subscriptions/rendererSession.ts` 负责它的监听、同步与命令；Main 仍是唯一持久事实来源。当前 App 为窗口创建一次 session，组件按 selector 读取同一个 Store，不再分别保存 messages、Run、Turn 和 cursor。

## 状态结构

| 字段 | 含义 |
| --- | --- |
| `roomId / runId` | 当前选择；只有 Main 快照确认后才具有任务内容 |
| `snapshot` | Run、Turn、Message、execution、attempts 的单一投影；`snapshot.sequence` 就是 cursor |
| `generation` | 每次选择递增，隔离旧选择的异步响应 |
| `draft` | 输入草稿，不是已创建任务的身份 |
| `roomTask` | 本窗口 createDemo 提交时捕获的目标，仅用于尚无 Run 的新房间 |
| `pending` | 当前命令的 id、command、generation、发送时 sequence |
| `syncStatus / error` | idle、syncing、ready、error 以及中文操作反馈 |

Run 标题使用 `selectTaskTitle`，优先 Main 的 `snapshot.execution.task`；旧数据没有目标时明确显示“历史任务（目标未记录）”。不会用草稿或 localStorage 填造历史标题。localStorage 仅保存 `roundtable.runId` 定位提示，刷新必须重新 subscribe。

## Feature 消费方式

由总控将同一个 `session.store` 与命令回调传给 Feature；不要在 Feature 再创建 session/Store 或监听 run.event。类型可从 `RendererState` 和 `ReturnType<typeof createRendererSession>` 派生。

```tsx
const snapshot = useStore(store, state => state.snapshot);
const title = useStore(store, selectTaskTitle);
const canStop = useStore(store, state => canCommand(state, 'stop'));
const draft = useStore(store, state => state.draft);
// 表单编辑只更新草稿。
store.getState().setDraft(nextDraft);
// 点击操作交给总控传入的 session.control 等回调。
```

只选择所需字段，避免返回每次新建的数组/对象。messages/turns 从 snapshot 派生；不要再复制到 useState 或另建权威缓存。Feature 不应调用 `setState`、`applySnapshot`、`applyDeltas`、`beginCommand` 等协调器内部入口。

## 协调器入口

```ts
const session = createRendererSession(window.roundtable, localStorage);
const dispose = session.mount(); // 先监听，再读取已保存 Run 的快照
await session.selectRun(knownRunId); // 历史导航；从 Main 取任务/房间身份
session.selectRoom(knownRoomId); // 仅切换选择，不做房间 CRUD/恢复生成
await session.synchronize(); // 手动重试同步，绝不调用 start/recover
await session.createRoom();
await session.startRun();
await session.control('pause'); // 另有 stop、step、resumeRun
// 窗口组件卸载时调用；dispose 幂等。
dispose();
```

32ms 批处理同批连续 delta，按 sequence 排序、去重，原子更新文本、Turn.outputText 和 cursor。关联必须符合 Run/Turn/request/Message/Attempt；不猜缺失身份。reasoning/usage 不混入正文。返回订阅的 snapshot 已包含 replay events，因此不再追加这些事件。

缺口、冲突重复、未知版本/类型、结构事件和 snapshot_required 都取权威快照。控制标记单独消费，不推进 cursor、不覆盖同序号文本。缓冲最多 500 项，超过后改取快照；连续两次游标不推进仍有缺口时保留旧文本、显示同步失败，由用户重试。正常快照持续推进时继续追赶。终态由快照校正文本、消息状态、活动指针和执行记录，不修改 Main 原始记录。

Create/Start/Pause/Stop/Step/Resume 共用 pending。Main 确认状态变化后可解除长 Step/Resume 命令的 pending，让 Pause/Stop 可用；旧 Promise 的错误和 finally 不能清掉新 token。其余状态权限与现有 Main 一致；interrupted 不当 paused，不暴露尚不支持的恢复命令。同步失败/同步期间禁用业务命令，部分输出保持可读。

## 文件归属

本轮 R06 独占 App 的首次状态拆分，此后 App 页面组装交还总控。R07/R08/R11–R16 只修改自身 Feature，消费已登记 selector/action；公共 Store 的字段或行为扩展须由总控协调 R06 单一负责人。共享 DTO/事件/命令及可选字段均须先申请 Shared 契约，不能通过私有 IPC、复制 Schema 或另一套 Store 绕过。具体共享申请、验证证据与集成条件见 [R06_HANDOFF](R06_HANDOFF.md)。
