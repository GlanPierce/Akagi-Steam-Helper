# MAKA INGAME · Akagi Steam Helper

当前版本：**alpha_test_0.0.1_20261004**。

这是基于 **[shinkuan/Akagi](https://github.com/shinkuan/Akagi)** 的 Windows Steam 雀魂适配版。上游基线为 **Akagi v3.7.1**，提交 [81f5306](https://github.com/shinkuan/Akagi/commit/81f530639cf10740ca1876df827d3c08efbe1175)，原作者为 **Shinkuan**。本仓库在其基础上增加 Steam 牌桌覆盖层、游戏内菜单、模型收藏与启动器，并修复相关显示和输入问题。

源码延续上游 **Apache-2.0** 许可证，保留原有版权和第三方声明。请参阅 [LICENSE](LICENSE.txt)、[NOTICE](NOTICE) 和 [第三方来源说明](THIRD_PARTY_NOTICES.md)。原始项目介绍保存在 [上游 README](README.upstream.md)。

## 功能

- Steam 牌桌上的出牌候选、操作概率、向听与进张、对手听牌和放铳估计。
- 游戏内模型导入、三人／四人分组、两次点击确认与收藏；空收藏区保留原版空状态。
- 原版菜单动画和控件样式，六项滑条校准，修改自动保存。
- Windows 托盘与桌面启动器；检测雀魂进程，尚未运行时通过 Steam 启动。
- 可独立开启自动操作，默认手动；通过日志区分模型建议和实际执行。

本版修正标题参数与底部留白、收藏分割线比例、切页横向滚动条、庄家首巡标签位置及操作提示间距。详细记录见 [Steam 适配说明](docs/steam-immersive-hud.md)。

## 构建

请阅读 [Windows 构建与 Steam 配置](docs/steam-build.md)。本仓库发布源码，不包含本机配置、证书、牌谱、日志及外部模型包。雀魂完整贴图、字体、客户端资源包和衍生应用图标不随公开分支发布；原版外观需要用提取脚本从自己的 Steam 客户端生成。

仓库保留 Akagi 上游的 `native_bot` 和三人／四人内置权重，这是 **Rust/Candle 内置引擎**。Mortal S42、298k 是另外导入的外部模型，不包含在仓库中；模型显示名称本身不能证明具体引擎或权重来源。

## 开源来源

| 项目 | 用途 | 许可证 |
| --- | --- | --- |
| [Akagi](https://github.com/shinkuan/Akagi) | 基础应用、协议、分析、模型管理和内置引擎 | Apache-2.0 |
| [mahjong-helper](https://github.com/EndlessCheng/mahjong-helper) | 上游分析模块的算法移植来源 | MIT |
| [RiichiEnv](https://github.com/smly/RiichiEnv) | 牌局状态、牌型与计分 | Apache-2.0 |
| [mahgen](https://github.com/eric200203/mahgen) | 麻将牌 Web Component | MIT |
| [ProxyBridge](https://github.com/InterceptSuite/ProxyBridge) | 启动器配合使用的外部转发程序 | MIT，核对版本 v4.0.0 |
| [Mortal](https://github.com/Equim-chan/Mortal) | 可外接的 Mortal/libriichi 引擎来源，本仓库不包含其代码或外部权重 | AGPL-3.0-or-later；权重另行核对 |
| [UnityPy](https://github.com/K0lb3/UnityPy) | 开发时读取本机 Unity 资源 | MIT |
| [Tauri](https://github.com/tauri-apps/tauri)、[React](https://github.com/facebook/react)、[Candle](https://github.com/huggingface/candle) | 桌面框架、前端、内置模型推理 | 分别为 MIT/Apache-2.0、MIT、MIT/Apache-2.0 |

依赖版本见 `Cargo.lock` 和 `frontend/package-lock.json`；完整原始声明及协议参考见 [NOTICE](NOTICE)。雀魂名称、角色立绘、MAKA 图案、游戏贴图和字体属于各自权利人，不因本仓库源码采用 Apache-2.0 而获得该许可。
