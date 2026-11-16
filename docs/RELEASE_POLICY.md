# 发布与授权

2026-11-03 用户决定取代 2026-10-16 的方案。2026-11-17 起，本文是现行发布政策。更早的非商业许可方案不再有效。本文不是发布授权：创建仓库、推送和公开仍须用户明确同意。

## 许可证

- 项目许可证是 **MIT**。全文在仓库根目录 `LICENSE`，`package.json` 的 `license` 字段为 `MIT`。版权行与安装包里已有的署名一致：`Copyright (c) 2026 AI Roundtable`。
- 软件本身免费。用户自备模型服务的 API Key，模型费用由服务商向用户收取。应用不收费，没有会员、订阅、激活码、商业支付或反盗版。
- 第三方依赖、Electron、原生模块、字体和图标保留各自的许可证和版权声明，不改标成 MIT。

## 分发

- 计划公开的仓库是 `Jay-12201018/ai-roundtable`。源码和 macOS arm64 安装包通过 GitHub Releases 提供。尚未推送。
- 不做 Apple Developer ID 签名，不做公证。macOS 安装包只做 ad-hoc 封装（`electron-builder.yml` 的 `identity: "-"`），否则 Apple Silicon 上的捆绑包无法通过校验。这是现行做法。第一次打开若被系统拦下，在「系统设置 → 隐私与安全性」里点「仍要打开」。
- 仓库里没有公证脚本。`.github/workflows/check.yml` 只跑 `pnpm typecheck` 和 `pnpm test`，不启动应用、不打开用户数据、不调用模型。仓库还没有远程，这份检查还没在 GitHub 上跑过。`pnpm-lock.yaml` 里的 `@electron/notarize` 是 `electron-builder` 自带的传递依赖，本项目没有调用它。
- 首发只声明 macOS arm64。Windows 和 Linux 的目标写在 `electron-builder.yml` 里，未验证就不能说已经支持。
- 真实讨论只验证过 DeepSeek 和豆包。其余 6 家服务还没有用真实 Key 跑过一场讨论。

## 公开前仍须另得授权的事

- 扫描将要公开的历史和发布包，确认没有 Key、真实数据库、备份或私有配置。发现秘密就停止，不擅自改写 Git 历史。
- 用户确认具体版本之后才推送、打 tag 或上传 Release。
