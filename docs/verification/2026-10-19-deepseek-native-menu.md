# DeepSeek 原生许可菜单最小修复

2026-10-19；基线6c907326aaebbbb4ba44a1566af482b093f77bf4，分支codex/deepseek-native-menu-fix；复用干净独立Worktree与其独立Electron38.8.6/ABI139依赖，不安装、不重编译、不改当前用户窗口。

## 根因与改动

CUA实际读取运行中的main6c90732原生macOS菜单，只有原5项，确实没有“准备本会话单次许可…”。源码installTrialMenu先Menu.setApplicationMenu，随后启动器才向JS submenu追加许可项，没有重新安装。旧探针直接item.click，只证明JS对象存在，未验证原生菜单栏。

产品修复只有scripts/controlled-desktop/main.cjs一行：追加后对同一顶层菜单重新Menu.setApplicationMenu。没有修改Service、Shared/IPC/Preload、Key、迁移、报价、默认权限或网络门禁。Main原生入口无需新增Renderer IPC。

探针新增安装时不可变标签快照断言（不保存可变Menu对象），以及仅fixture使用的限时AX观察等待。旧代码RED自然exit1，精确失败native installation includes the session-permit item，在配置Key/生成之前退出；失败日志保留。修复后实际CUA在自有fixture窗口的原生菜单看到第6项“准备本会话单次许可…”，没有选择真实用户许可。

## 实际验证

- 安装快照RED exit1；GREEN真实新版launcher/Main/App38条具名断言，1次自有local HTTP fixture、真实API0/真实Keychain0，exit0。
- CUA真实AX先确认用户当前菜单缺项，再确认自有fixture菜单实际可见；没有点击用户的许可/发送、没有重启用户窗口。
- 独立新进程重启19断言，自动请求0，exit0。
- 会话权限22断言、菜单/互斥37测试、Python启动器24测试、TypeScript strict、diff --check均exit0。不重复无关全量回归。
- 保持单次、Provider/request/Keyrevision绑定、固定Reply OK./128/¥0.05、取消/退出/重启失效、无自动重试；普通真实Run仍blocked。

没有读取真实Key、用户SQLite、Keychain、旧unknown或人工对账记录；没有改FClash/系统网络，未授予真实发送许可。实际用户已人工处理的记录不再操作。

## 使用

用户自行正常退出旧窗口，双击最新绑定main的本地启动入口，原独立profile及显式127.0.0.1:7890代理保持。设置中重新确认精确目标后，“受控测试 → 准备本会话单次许可…”→选择DeepSeek Provider→“仅准备这一次许可”→最终“授权并发送这一次请求”（仅用户本人）。不需要重复人工对账。

## 实际命令与失败台账

监督器根：`/private/var/folders/qk/z0rypzwd1_18tfqhzyswz7b00000gn/T/roundtable-native-menu-ixqq8cmd`。每条argv/exit/timeout及日志SHA如下；stderr既有sandbox_extension提示保留，不等于正式桌面E2E或真实Keychain通过。
