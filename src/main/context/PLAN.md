# R05 公共上下文实施与验收计划

本目录独立模块，实施依据 `tasks/R05-public-context-limits.md` 与本次用户正式授权。基线 `37766666ff10981c302e54636cd0f0378d1c722e`，使用当前专属 Worktree/分支，不创建第二 Worktree。

- [x] 核对任务、治理、真实 Git 与 R02/R03 接口；不消费 R04 未合并代码。
- [x] 独立环境重新执行原有 313 项基线测试。
- [x] 先写失败测试，覆盖可信指令、冻结角色、公共历史、来源、隔离、去重与窗口边界。
- [x] 实现 `buildPublicContext(input, counter?)`：Main-only 纯函数，不调度、不写库、不请求 Provider。
- [x] 使用 R03 内存数据库与本模块 Capturing Provider 捕获 A/B/C 实际输入，并验证 Attempt 的最终输入证据。
- [x] 专项、全回归、typecheck、build 与适用原生检查；独立审查后修复本范围问题。
- [x] 编写本目录交接与 R05-SHARED-01，检查完整差异，创建独立 Commit 并保持干净（最终 SHA 随交付）；待总控联合集成。

设计：调用方从一致 R03 快照显式白名单投影 run/messages/turns/attempts，并传入可见消息 ID、可信应用及已生效持续指令。模块使用冻结成员身份，保留快照消息顺序；仅完成的公开消息及其完成 Turn/Attempt 可进入上下文，当前/未来回合、其他房间/Run、不可见及非公开类型排除并报告，冲突身份拒绝。相同 ID 的完全相同记录去重，冲突重复拒绝。

Provider 仅接收 R02 role/content；可信 system 层依次为应用边界、应用指令、持续主持指令、当前 Agent 角色，任务是 user，公开历史按 sender 映射 assistant/user 并以 JSON 标明发言者。普通文本不会被解析为命令。来源/排除报告独立返回，不污染 Provider DTO。

预算先扣输出预留，必要指令及任务绝不裁剪；按最近连续历史后缀选择整条消息，不能容纳的旧前缀逐条报告 UTF-16 原文范围及原因。计数器必须由可信 Main 为指定模型提供 exact/upper_bound 的完整 messages 计数（含供应商封装）；不可靠、异常、非安全整数、非单调计数拒绝。未知计数器仅提供 UTF-8 字节估算并拒绝发送，不宣称真实 Token 或保证可发。最大回合、累计时长及上限仅作为 R04 执行输入返回。

写入归属：主代理独占 src/main/context/** 和 tests/unit/context/**；集成测试代理仅写 tests/integration/context/**。环境代理只写独立忽略依赖与临时目录；其他代理只读。禁止修改共享、RunService、数据库、MockProvider、Renderer、package/lock 及总控文档。
