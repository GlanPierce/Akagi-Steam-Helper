//! Narrow preset commands serialize with other config edits. A failed save
//! never changes the runner's effective model pair or the active scheme.
use crate::bot::{
    native::{NATIVE_3P, NATIVE_4P},
    registry::BotRegistry,
    runtime,
};
use crate::config::{AppConfig, BotConfig};
use crate::ipc::AppState;
use crate::util::resolve_dir;
use std::path::Path;
use tauri::State;

pub(super) fn validate_choice(bot: &BotConfig, mode: &str, name: &str) -> Result<(), String> {
    if !matches!(mode, "4p" | "3p") {
        return Err("未知局制".into());
    }
    if name.is_empty() {
        return Ok(());
    }
    if name == NATIVE_4P || name == NATIVE_3P {
        return if (mode == "4p" && name == NATIVE_4P) || (mode == "3p" && name == NATIVE_3P) {
            Ok(())
        } else {
            Err("此模型不支持所选局制".into())
        };
    }
    let registry = BotRegistry::scan(&resolve_dir(Path::new(&bot.dir)))
        .map_err(|e| format!("读取模型失败：{e:#}"))?;
    let entry = registry
        .find(name)
        .ok_or_else(|| format!("模型不存在：{name}"))?;
    let supported = entry.manifest.as_ref().map_or(mode == "4p", |m| {
        m.bot.supported_modes.iter().any(|m| m == mode)
    });
    if !supported {
        return Err("此模型不支持所选局制".into());
    }
    if entry.pyproject.is_none() || !runtime::is_synced(&entry.dir) {
        return Err(format!("请先安装 {name} 的依赖环境"));
    }
    Ok(())
}

pub(super) fn transact(
    config: &mut AppConfig,
    path: &Path,
    edit: impl FnOnce(&mut BotConfig) -> Result<(), String>,
) -> Result<BotConfig, String> {
    let mut next = config.clone();
    edit(&mut next.bot)?;
    super::commands::persist_config(&next, path).map_err(|e| format!("保存失败：{e}"))?;
    *config = next;
    Ok(config.bot.clone())
}

#[tauri::command]
pub async fn set_model_preset(
    index: usize,
    mode: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<BotConfig, String> {
    let mut config = state.config.write().await;
    transact(&mut config, &state.config_path, |bot| {
        validate_choice(bot, &mode, &name)?;
        bot.set_preset_model(index, &mode, name)
    })
}

#[tauri::command]
pub async fn activate_model_preset(
    index: usize,
    state: State<'_, AppState>,
) -> Result<BotConfig, String> {
    let mut config = state.config.write().await;
    transact(&mut config, &state.config_path, |bot| {
        bot.activate_preset(index)?;
        validate_choice(bot, "4p", &bot.active_4p)?;
        validate_choice(bot, "3p", &bot.active_3p)
    })
}

#[tauri::command]
pub async fn rename_model_preset(
    index: usize,
    name: String,
    state: State<'_, AppState>,
) -> Result<BotConfig, String> {
    let mut config = state.config.write().await;
    transact(&mut config, &state.config_path, |bot| {
        bot.rename_preset(index, name)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppConfig;

    #[test]
    fn model_presets_failed_write_keeps_effective_models_and_scheme() {
        let dir = tempfile::tempdir().unwrap();
        let mut cfg = AppConfig::default();
        cfg.bot
            .set_preset_model(1, "4p", "mortal-s42".into())
            .unwrap();
        let before = serde_json::to_value(&cfg).unwrap();
        // A directory cannot be replaced by a configuration file.
        assert!(transact(&mut cfg, dir.path(), |bot| bot.activate_preset(1)).is_err());
        assert_eq!(serde_json::to_value(&cfg).unwrap(), before);
    }

    #[test]
    fn model_presets_commit_the_pair_and_preserve_other_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        std::fs::write(&path, "# user's note\n[custom]\nvalue = 7\n").unwrap();
        let mut cfg = AppConfig::default();
        cfg.overlay.opacity = 0.65;
        cfg.bot
            .set_preset_model(2, "4p", "mortal-s42".into())
            .unwrap();
        cfg.bot.set_preset_model(2, "3p", "sanma".into()).unwrap();
        let saved = transact(&mut cfg, &path, |bot| bot.activate_preset(2)).unwrap();
        let body = std::fs::read_to_string(path).unwrap();
        let disk: AppConfig = toml::from_str(&body).unwrap();
        assert_eq!(saved.active_4p, "mortal-s42");
        assert_eq!(disk.bot.active_3p, "sanma");
        assert_eq!(disk.bot.active_model_preset, 2);
        assert_eq!(disk.overlay.opacity, 0.65);
        assert!(body.contains("value = 7"));
        assert!(body.contains("# user's note"));
    }

    #[test]
    fn model_presets_refuse_wrong_modes_and_missing_models() {
        let mut cfg = AppConfig::default();
        let dir = tempfile::tempdir().unwrap();
        cfg.bot.dir = dir.path().to_string_lossy().into_owned();
        assert!(validate_choice(&cfg.bot, "4p", "akagi-native").is_ok());
        assert!(validate_choice(&cfg.bot, "3p", "akagi-native3p").is_ok());
        assert!(validate_choice(&cfg.bot, "3p", "akagi-native").is_err());
        assert!(validate_choice(&cfg.bot, "4p", "akagi-native3p").is_err());
        assert!(validate_choice(&cfg.bot, "4p", "missing-model").is_err());
        assert!(validate_choice(&cfg.bot, "2p", "").is_err());
        // Preserve old analysis-only 3p configurations.
        assert!(validate_choice(&cfg.bot, "3p", "").is_ok());
    }
}
