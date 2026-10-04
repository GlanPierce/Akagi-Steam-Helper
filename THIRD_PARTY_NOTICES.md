# 来源与第三方说明

## 基础项目

本项目基于 [Shinkuan 的 Akagi](https://github.com/shinkuan/Akagi) v3.7.1 / `81f530639cf10740ca1876df827d3c08efbe1175`，保留 [Apache-2.0 许可证](LICENSE.txt)、原作者版权和 [NOTICE](NOTICE)。Steam 适配集中在 `frontend/src/immersive/`、`src/ipc/immersive*.rs`、`src/autoplay/steam.rs`、`scripts/steam-hud/` 及相应状态管理和测试。

公开分支保留上游历史，并汇总 Steam 修改；本地开发过程中包含完整游戏资源的提交不进入公开分支历史。

## 随源码或依赖使用的主要项目

| 来源 | 使用方式 | 许可／声明 |
| --- | --- | --- |
| [EndlessCheng/mahjong-helper](https://github.com/EndlessCheng/mahjong-helper) | Akagi `src/analysis/` 部分算法移植自 Go `util/` | MIT；完整声明保留在 NOTICE |
| [smly/RiichiEnv](https://github.com/smly/RiichiEnv) | `riichienv-core` Cargo 依赖 | Apache-2.0；原声明保留在 NOTICE |
| [eric200203/mahgen](https://github.com/eric200203/mahgen) | 前端牌面组件与后端 DSL | MIT；完整声明保留在 NOTICE |
| [tauri-apps/tauri](https://github.com/tauri-apps/tauri) | 桌面窗口、IPC、托盘图标 | MIT 或 Apache-2.0 |
| [facebook/react](https://github.com/facebook/react) | 前端界面 | MIT |
| [huggingface/candle](https://github.com/huggingface/candle) | Akagi `native_bot` 的 Rust 推理 | MIT 或 Apache-2.0 |

此表不替代每个依赖包自身的许可证。完整版本和依赖树见 Cargo/npm 锁定文件。

## 外部程序、模型与工具

- **[InterceptSuite/ProxyBridge](https://github.com/InterceptSuite/ProxyBridge)**：启动器调用单独安装的 `ProxyBridge_CLI.exe`。当前适配验证版本为 4.0.0；[该版本 MIT 许可证](https://github.com/InterceptSuite/ProxyBridge/blob/v4.0.0/LICENSE) 署名 Anof-cyber/InterceptSuite，2025。本仓库不包含它的可执行文件、驱动或用户配置。
- **[Equim-chan/Mortal](https://github.com/Equim-chan/Mortal)**：外接 Mortal/libriichi 引擎的来源。其代码采用 [AGPL-3.0](https://github.com/Equim-chan/Mortal/blob/main/LICENSE)，项目说明允许使用后续版本。外部模型以子进程通过 mjai JSONL 通信。本仓库不包含 Mortal/libriichi 源码、二进制或 S42／298k 模型包，Apache-2.0 不替代其许可；权重及适配包的来源与分发条件需分别核对。
- **[K0lb3/UnityPy](https://github.com/K0lb3/UnityPy)**：资源提取脚本使用的开发工具，MIT，Copyright 2019–2026 K0lb3。由使用者安装；运行已经构建的助手不需要 UnityPy。
- **Python、Pillow、NumPy、SciPy**：资源处理脚本使用的工具，按各自包内许可证提供，没有改署为本项目。

Akagi 自带 `native_bot` 使用上游自身的 Rust/Candle 实现及 `native_bot/weights/` 权重，继续保留在源码中，与外部 Mortal/libriichi 区分。

## 协议参考

上游 NOTICE 列出 [MajsoulMax-rs](https://github.com/Xerxes-2/MajsoulMax-rs)、[Gimite mjai 规范](https://gimite.net/pukiwiki/index.php?Mjai) 和 [mjai.app](https://github.com/smly/mjai.app)。按上游说明，它们是协议／约定参考，没有复制其代码。

## 雀魂资源

完整角色立绘、UI 贴图、字体、Unity 资源包，以及由它们生成的应用图标不随本公开分支发布。`scripts/extract_steam_maka.py` 只读提取使用者自己的 Steam 客户端；`scripts/build_steam_icons.py` 在本机生成图标。游戏资源仍属于原权利人，源码许可证不授予其再分发许可。

`tests/fixtures/immersive/` 包含少量位置／像素回归所需的牌面、按钮裁片，来源和尺寸见该目录 README；没有账号、聊天或凭据。这些测试样本不作为完整素材包提供，也不构成 Apache-2.0 的游戏美术授权。控件几何、动画和布局 JSON 是适配测量数据；提取脚本记录源文件哈希。

公开构建初始使用 Akagi 上游应用图标，本机提取后可生成 MAKA 图标。上游 README 和既有资源保留原有来源。
