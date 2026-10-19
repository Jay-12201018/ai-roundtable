# DeepSeek 三项最终收尾实施与主线验收

2026-10-19。基线 dc8a7a0a4b8f2469a39c87403d26dd7d48d0b220；独立分支 codex/deepseek-final-readiness。实施715c2ebe4bd1b669a938eb866daceaf9640ae485已依本次授权严格ff-only合入main，主线独立验收通过；治理登记另建独立提交。

## 实现与使用

- 官方价格重新读取 https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ ，deepseek-flash对应DeepSeek-V4.1-Flash-1017。CNY：高峰缓存命中0.04/百万、未命中2/百万、输出8/百万；闲时分别减半。本轮一律2/8，输出按完整completion核算，thinking.disabled；不假定缓存/闲时优惠。快照核验2026-10-19T11:08:06Z，有效24小时至2026-10-20T11:08:06Z（北京时间20日19:08:06）；到期安全拒绝。价格页允许变价，这只是可追溯短期快照。
- 固定Reply OK.估算67输入Tokens，max_tokens128，预计1158microCNY=¥0.001158；非精确计数、非绝对费用上限。全额预留50000microCNY=¥0.05，普通真实生成DEEPSEEK-TOKEN-01仍blocked。
- migration5审计+释放marker，迁移1–4不改。原unknown/state/data_json/usage/error/原reservedMicroCny保留。审计有人工时间、安全固定证据及决定，append-only、身份绑定、全局未处理预留唯一锁。原生「人工对账与预留处理…」先核对页面再单独批准；取消不改账，可只记录并保留；「查看人工对账记录…」可复查。不把页面0消费写成usage0/实际费用0。
- 启动器「准备本会话单次许可…」→Provider选择→仅准备一次许可确认→用户亲自最终发送确认。内存lease绑定请求/Provider/Keyrevision/报价，取消/Stop/关窗/退出/超时失效；重启不会继承，不自动retry。原始独立profile/Keychain身份、显式proxy参数保持；普通真实Run不解锁。

## 实际候选验证

独立依赖646包冻结离线copy安装，Node24.18.1/同版headers源码编译ABI137，再串行Electron38.8.6/ABI139重建。未改package/lock或全局环境，不共享可变native。

|检查|实际结果|
|---|---|
|初始安装|exit1，复制store但缺独立cache元数据；补齐已有公开依赖metadata后冻结安装exit0，无跳过供应链策略|
|报价+菜单RED|exit1，7项预期失败，旧快照和缺失菜单|
|对账RED/时间覆盖RED|exit1，19项API/v5缺失；新增覆盖窗口断言2项失败，均保留|
|新migration/对账专项|23/23，exit0；真实v4→v5/重复初始化/失败原文件回滚/备份恢复/审计不可变/孤立marker拒绝|
|既有迁移/数据库专项|61/61，exit0|
|首次完整Node回归|1321/1322；唯一失败是旧proxy fixture时钟早于新报价窗口，非业务安全门禁放宽|
|修正fixture时钟后的费用/菜单/proxy专项|71/71，exit0；原过期拒绝断言保留|
|受控Service/互斥等第一次专项|77/77，exit0|
|完整Electron回归|88文件1322/1322，exit0|
|strict/生产构建|exit0；Main/Preload/Renderer均实际构建；保留Zod/Rollup注释警告|
|Python启动器|24/24，exit0|
|Node会话/quote/gate|22/28/57断言均exit0，13个proxy gate场景|
|Electron quote lease|28断言，exit0|
|新版launcher+真实生产App|首次37断言/仅1次自有本地HTTP fixture，重启18断言/0请求，均自然exit0|

真实生产探针覆盖：启动默认未授权；取消拒绝于Key读取之前；人工对账cancel/retain/release_cancel/明确release；原unknown JSON逐字不变；对账不解密Key；两次原生确认才唯一一次固定SSE请求；usage71/8核算206microCNY；第二次许可、原菜单重放和普通真实生成拒绝；新进程不继承许可，审计和原unknown保留；公网尝试0、真实Keychain调用0。fake Key和独立临时DB不能外推真实付费成功。

## 文件范围

src/main/providers/controlledTrial/{estimate,ControlledTrialService,menu,reconciliation}.ts；Database.ts、migration5、recovery/validateDatabase.ts；Main仅导出可信wrapper所需Service/报价；scripts/controlled-desktop/{main,controlled-network,session-authorization}.cjs与launcher.py/README。新增对账/v5/许可/quote/真实生产probe；旧迁移测试同步最新版本，旧fixture时钟移到新报价窗口。Shared/IPC/Preload普通API、R10/R11、系统代理/证书未改。

## 原始记录与授权边界

本轮完全不打开或修改用户现有profile，不读取真实Key/Keychain、不释放原首次unknown的¥0.05、不重新启动/关闭当前App、不发任何公网模型请求、不为当前用户自动准备许可。正式使用由用户自己打开最新启动入口，核对旧请求后明确决定是否释放，再重新确认目标和最终发送。人工0页面不证明首次请求绝对未到达/绝对不计费。

## 证据与失败保留

本轮监督器与log/receipt根目录 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-final-readiness-b3vrv8e3`；每条有argv/cwd/超时/真实exit/源码指纹。命令台账另附；RED、旧fixture时钟及初次安装失败不删除。不执行真实API/OS Keychain/正式发布和跨平台E2E。


## 主线独立验收与最终状态

合并前再次确认main=dc8a7a0、候选=715c2ebe4bd1b669a938eb866daceaf9640ae485，两侧干净且直接祖先；ff-only自然exit0，无额外merge commit、重写/删除历史或修改原Worktree。

main新证据根 `/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-final-main-0crem0dr`：完整Electron88文件1322/1322（其中包含v4→v5/回滚/备份恢复/费用/引用/原有功能），新的launcher.prepare实际strict+三端生产构建+ABI139内存SQL、Python24、Node会话22、Electron quote28、代理gate57、真实新版launcher/Main/App37断言/1次自有fixture、重启18断言/0请求，全部exit0。未重新编译main native或覆盖main/out；独立构建在.cache版本目录，生产探针明确使用该新out。stdout sandbox_extension提示及Rollup注释警告保留，进程自然exit0，不能外推真实OS Keychain/E2E/付费网络。

三项软件阻塞在上述本地安全验收范围merged/verified。迁移1–4原文不变，新migration5默认保留原unknown锁；不会自动把旧¥0.05释放、核销或记为零。当前用户应用没有被关闭/重启/授予许可；用户需自行退出旧窗口，打开绑定最终干净main的新版本，再使用原生人工对账及许可菜单。旧profile仍不应交给老版本读取。

最新Finder入口（本地生成，非正式发布）：`.cache/controlled-desktop-main/打开最新版AI圆桌-受控单次测试.command`，显式127.0.0.1:7890与trust-proxy-dns，原独立profile及Keychain身份不变，打开仍未授权。

本轮未验证真实Key解密/系统Keychain/付费回复，未发公网模型请求。价格截止北京时间2026-10-20 19:08:06；超过后须重新官方核价，不自动续期。人工释放只解除客户端预留阻塞，不代表账单无费用。普通真实Run仍blocked。
