# DeepSeek 安全准备 main 合并与验收（2026-10-18）

用户仅授权合并已审核准备候选及主线复验，未授权任何真实API。**本轮安全准备merged/verified，DEEPSEEK-TOKEN-01继续blocked；真实DeepSeek生成默认禁止。**

## Git与范围

- 合并前main：`dc387146e1535a596508a5b58ea8bfe3903fc658`。
- 精确获批候选：`codex/deepseek-safety-prep` / `30d578356d283a55b1c15a122c0a37465c6e4b25`，直接基于上述main；实际11个获批文本文件，无多余DB/Key/构建产物或依赖/迁移修改。
- main及18WT重新核对干净后，实际`git merge --ff-only codex/deepseek-safety-prep` exit0，主线直接推进候选，无额外merge commit；原分支、Worktree和历史全部保留。
- 本轮没有产品或验证脚本修改；只更新治理状态及本轮证据。主线最终HEAD为本文所在独立治理提交，完整SHA由交付消息和本文件Git历史定位。

## 本次主线实际复验

| 项目 | 结果 | exit |
| --- | --- | --- |
| Node完整单元/集成 | 76文件1105/1105 | 0 |
| DeepSeek专项 | 32/32：精确目标/参数、CNY边界、有效期/超限、Key前拒绝、usage/无usage、错误无自动重试及partial/Attempt | 0 |
| strict /生产构建 | Main218.84kB、CJS Preload232.20kB、Renderer964.20kB | 均0 |
| Node SQLite | 严格24.18.1 runtime/headers、ABI137/arm64；100内存DB/10000行自然退出 | 0 |
| Electron SQLite/完整回归 | 匹配38.8.6 headers重建，实际Node22.22.0/ABI139/arm64读写压力；76文件1105/1105 | 均0 |
| 生产入口安全门禁 | 真实built Main/Preload/App，DeepSeek9条拒绝/保密断言；拒绝区间假Key解密29→29 | 0 |
| 新进程重启 | HTTP0；DeepSeek9条断言、解密3→3；配置/历史恢复、确认失效 | 0 |
| 两次退出SQLite审计 | 完整性/外键、公共上下文/usage/Attempt/partial、无活动Run和无明文fake Key | 均0 |
| 收尾范围/隔离 | 171个src/tests指纹不变，18WT及其他native inode/SHA保留 | 0 |

命令、UTC、实际退出码与日志摘要见[本轮台账](2026-10-18-deepseek-main-commands.md)。专项及双运行时有重叠，不累加。本轮失败0，没有跳过用例或放宽断言；此前候选失败记录保持原样。main使用自己的既有独立依赖和新临时测试环境，没有新install或冷缓存下载复验。

## 保持禁止与阻塞

生产Main仍`new ProviderRegistry(database,keyService)`，没有提供真实policyResolver。公开DeepSeek参数/价格元数据不等于ApprovedModelPolicy；没有注册未经证明的counter，也没有字符比例/通用tokenizer/fixture计数回退。未确认目标返回forbidden；确认后生成、鉴权和单Agent启动仍unsupported，模型列表也unsupported，在Key读取和transport之前拒绝。

`DEEPSEEK-TOKEN-01`仍指当前1017 API完整输入Token/隐式封装上界未证明；本轮未继续研究或实现Tokenizer。1024输入/128输出、¥0.05是候选约束，不代表可真实调用。原价格证据有效期仍为2026-10-18T00:00:00Z（北京时间08:00），没有自动续期或重新核价；到期门禁专项通过，之后开放前仍须重新审查。

生产烟测仅使用临时userData/DB、全fake safeStorage、mock-keychain和自有HTTP fixture；既有R09的12次本地fixture交互不是DeepSeek请求。DeepSeek专属断言不注入model policy，拒绝期间无新增解密；外网尝试列表为空。**本轮真实公网模型API请求0，未读取真实Key或用户数据库。**

本轮登记仅安全准备merged/verified，R09原fixture状态不外推为真实模型验收。未进行真实API/Keychain、正式E2E、打包/跨平台；不启动其他任务，不公开GitHub。合并和复验结束后停止。
