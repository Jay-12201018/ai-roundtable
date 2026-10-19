# R11 独立工作流视图

`WorkflowFeature` 是 props/action 驱动的配置与进度视图。它不导入 Main、不访问 IPC/SQLite/Provider、不保存 localStorage、不自行推导运行状态。模板及表单值是本模块私有的 presentation model，**不是新增的 Shared wire 协议**。

总控装配时提供：

- `scopeKey`：房间及配置修订身份。变化时重置草稿并隔离旧异步结果。
- `members`：Main 当前有效成员的安全显示投影；禁用成员不能选择，已选成员消失时保留“不可用”提示。
- `onPreview(draft)`：将字符串数字等表单值适配为唯一获批 Shared 配置，在 Main 严格编译后返回预览。预览 ID 必须由父层绑定房间、配置及成员修订；不能把 Renderer 预览当发送授权。
- `onApply({previewId,draft})`：父层核对预览身份和修订、重新校验后应用到下一次任务配置。当前组件不把成功返回当运行、暂停或落库成功；提示“等待主界面确认”。异常结果可能已有副作用，预览保持已消费，需要先检查再重新验证，不自动重发。
- `progress`：Main 权威的当前阶段、下一步、完成回合及累计用时。组件原样展示，即使编辑了新模板，历史进度也不会随草稿改变。
- `theme`：light/dark/system；默认跟随系统，样式仅影响本 feature。

未提供回调时仍可编辑草稿，但预览/应用分别禁用并说明尚未接入；不伪装成可用生产功能。所有编辑都会使旧预览失效，预览中可继续编辑，应用中锁定配置，迟到结果和重复点击受保护。自由群聊/双模型对话可增删、调整显式阶段；修订链和辩论保持各自阶段语义顺序。成员可在不同阶段复用，同一阶段是否重复/上限等最终由 Main 拒绝非法配置。

父层适配与 Main 编译器的实际联动仅在 `tests/integration/workflows/featurePreview.test.tsx` 中验证；该 fixture 不是公开 IPC 实现。Main、RunService、上下文、版本/持久化和公开进度的完整接线申请见 `src/main/workflow/README.md`。总控批准 Shared 后再替换这些私有视图模型的适配边界，不在本分支跨层接线。
