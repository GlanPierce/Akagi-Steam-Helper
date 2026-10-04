# Windows 构建与 Steam 配置

版本显示为 `alpha_test_0.0.1_20261004`；Cargo/npm 使用对应的语义版本 `0.0.1-alpha.20261004`。

## 环境

Windows 10/11、Visual Studio C++ Build Tools 与 Windows SDK、Rust stable、Node.js 22.12+ 和 npm、Protocol Buffers `protoc`、WebView2 Runtime。本机需安装 Steam 雀魂；转发使用单独安装的 [ProxyBridge v4.0.0](https://github.com/InterceptSuite/ProxyBridge/releases/tag/v4.0.0)。

## 生成游戏资源

公开仓库不包含 `frontend/public/maka/` 贴图、字体及开发预览贴图。先从自己的客户端生成资源，否则构建的界面缺少原版外观。在仓库根目录执行，将资源目录改成实际位置：

```powershell
python -m pip install UnityPy==1.25.3 Pillow
$bundleDirectory = 'D:\SteamLibrary\steamapps\common\MahjongSoul\Jantama_MahjongSoul_Data\StreamingAssets\StandaloneWindows'
python scripts/extract_steam_maka.py --bundles $bundleDirectory --output frontend/public/maka
python scripts/build_steam_icons.py
```

脚本固定了已核对的资源包名，客户端更新后若名称变化，需要更新映射。它不写入游戏目录；输出哈希与切片元数据记录在本机 `frontend/public/maka/provenance.json`。不要把提取结果提交到公开仓库。

控件几何可用 `scripts/extract_steam_controls.py` 重新测量（另需 NumPy、SciPy）。当前菜单动画来自游戏运行时 Lua/DOTween，参数及源哈希保存在 `frontend/src/immersive/nativeMenuMotion.json`。`scripts/extract_steam_menu_motion.py` 只导出已禁用的旧 AnimationClip，用于历史诊断，必须指定输出目录；它不能生成当前菜单动画。参数见 `--help`。

## 编译

```powershell
Push-Location frontend
npm ci
npm test
npm run build
Pop-Location
cargo build --release --features custom-protocol
```

默认输出 `target/release/akagi.exe`；设置 `CARGO_TARGET_DIR` 时以该目录为准。资源在构建时嵌入助手，无需修改游戏客户端。

启动器检查可运行 `scripts/steam-hud/Test-GameLaunch.ps1` 和 `Test-BridgeHealth.ps1`，不启动游戏。原生单元测试为 `cargo test --lib`，像素回归为 `cargo test --test immersive_pixels`；静态回归不能代替对应客户端版本的实局检查。

## 安装布局

```text
root/
  Run-AkagiSteam.ps1
  AkagiSteam/
    akagi.exe
    configs/                  # 本机配置，不提交
    mjai_bot/                 # 自行导入的模型
  ProxyBridge/
    ProxyBridge_CLI.exe       # 单独安装官方发行包及配套文件
  steam-integration/
    Steam-BridgeHealth.ps1
    steam-majsoul.pbprofile   # 本机创建的 ProxyBridge 配置
```

启动器与检查脚本来自 `scripts/steam-hud/`。启动器检查助手监听端口 `23410` 与 ProxyBridge 转发监听端口 `34010`，使用 `steam-majsoul.pbprofile`。配置应只匹配雀魂进程并转发到本机助手；创建步骤见 ProxyBridge 4.0.0 官方说明。仓库不包含本机配置或证书；维护脚本不作为通用安装器。

已有安装更新前退出助手，复制并校验旧程序和启动脚本的备份，再替换经过校验的新文件，保留配置、模型、证书和历史数据。

日常运行 `Run-AkagiSteam.ps1`。助手与转发就绪后，它检测 `Jantama_MahjongSoul`；未运行时通过 Steam App ID `1329410` 启动。菜单快捷键 `Ctrl+Shift+Space`，指导开关 `Ctrl+Space`。

## 模型与发布内容

内置模型来自 Akagi `native_bot`，不需要 Python。外部模型通过游戏内「模型 → 导入」安装，运行环境按其原作者说明准备；S42、298k 等外部模型包不随本仓库发布，三人和四人模型分别选择。

公开 `main` 保留 Akagi 上游历史，并汇总 Steam 适配源码。它不包含本地开发历史中的完整游戏资源。提取文件由 `.gitignore` 排除；图标生成会修改已有上游图标，公开提交前应恢复上游图标。
