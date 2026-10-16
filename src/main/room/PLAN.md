# R07 实施与归属

基线 c1b5beaddfe254ca978f32874e6376b398d09836；仅当前 Worktree，分支 codex/r07-rooms-agents-history。

- [x] RoomService：实现既有 RoomManagementApiContract；Shared 输入、输出校验；Database 为唯一存储；Main 生成 UUID；固定公开错误。
- [x] RoomsFeature：房间与成员表单、启停/排序/归档恢复/删除确认，消费安全 ProviderSummary；Run/消息分页；请求代次隔离；Run 详情通过 onSelectRun 交现有 R06。
- [x] 专项：服务边界、磁盘重开、快照与暂停恢复保护、同时间戳分页、自定义三 Mock 公共历史、UI 迟到请求与交互。
- [x] 验证：独立冻结依赖、Node24.18.1/同版 include ABI137，专项/完整回归/strict/build，最后串行 Electron38.8.6 ABI139 及专项。
- [x] 审查所有差异、敏感文件及归属，编写 HANDOFF，Git 提交后停止。

不修改 Shared/DB/migration/IPC/Preload/Main/App/store/settings/security/package/lock。无真实用户数据、Key 或网络模型。生产接线与最终冻结快照详情展示归总控；模块测试不得写成生产 UI 闭环。
