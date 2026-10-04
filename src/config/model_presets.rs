use super::BotConfig;
use crate::bot::native::{NATIVE_3P, NATIVE_4P};
use serde::{Deserialize, Serialize};

pub const MODEL_PRESET_COUNT: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ModelPreset {
    pub name: String,
    pub model_4p: String,
    pub model_3p: String,
}

impl Default for ModelPreset {
    fn default() -> Self {
        Self {
            name: String::new(),
            model_4p: NATIVE_4P.into(),
            model_3p: NATIVE_3P.into(),
        }
    }
}

impl BotConfig {
    /// The existing active fields remain the runner's source of truth. This
    /// also folds choices made through older settings screens into the preset.
    pub fn normalize_presets(&mut self) {
        self.model_presets
            .resize_with(MODEL_PRESET_COUNT, ModelPreset::default);
        if self.active_model_preset >= MODEL_PRESET_COUNT {
            self.active_model_preset = 0;
        }
        for (index, preset) in self.model_presets.iter_mut().enumerate() {
            if preset.name.trim().is_empty() {
                preset.name = (index + 1).to_string();
            }
        }
        let current = &mut self.model_presets[self.active_model_preset];
        current.model_4p.clone_from(&self.active_4p);
        current.model_3p.clone_from(&self.active_3p);
    }

    pub fn set_preset_model(
        &mut self,
        index: usize,
        mode: &str,
        name: String,
    ) -> Result<(), String> {
        check_index(index)?;
        if !matches!(mode, "4p" | "3p") {
            return Err("未知局制".into());
        }
        self.normalize_presets();
        let preset = &mut self.model_presets[index];
        if mode == "4p" {
            preset.model_4p.clone_from(&name);
            if index == self.active_model_preset {
                self.active_4p = name;
            }
        } else {
            preset.model_3p.clone_from(&name);
            if index == self.active_model_preset {
                self.active_3p = name;
            }
        }
        Ok(())
    }

    pub fn activate_preset(&mut self, index: usize) -> Result<(), String> {
        check_index(index)?;
        self.normalize_presets();
        let preset = &self.model_presets[index];
        self.active_4p.clone_from(&preset.model_4p);
        self.active_3p.clone_from(&preset.model_3p);
        self.active_model_preset = index;
        Ok(())
    }

    pub fn rename_preset(&mut self, index: usize, name: String) -> Result<(), String> {
        check_index(index)?;
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 32 || name.chars().any(char::is_control) {
            return Err("方案名称须为 1–32 个字符".into());
        }
        self.normalize_presets();
        self.model_presets[index].name = name.into();
        Ok(())
    }
}

fn check_index(index: usize) -> Result<(), String> {
    if index < MODEL_PRESET_COUNT {
        Ok(())
    } else {
        Err("方案不存在".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AppConfig, BotConfig};

    #[test]
    fn model_presets_migrate_without_changing_the_active_pair() {
        let mut bot: BotConfig =
            toml::from_str("active_4p = 'mortal-s42'\nactive_3p = ''").unwrap();
        bot.normalize_presets();
        assert_eq!(bot.model_presets.len(), 10);
        assert_eq!(bot.active_model_preset, 0);
        assert_eq!(bot.model_presets[0].model_4p, "mortal-s42");
        assert_eq!(bot.model_presets[0].model_3p, "");
        assert_eq!(bot.active_4p, "mortal-s42");
        assert_eq!(bot.active_3p, "");
        assert_eq!(bot.model_presets[9].name, "10");
    }

    #[test]
    fn model_presets_edit_inactive_then_apply_both_modes_together() {
        let mut bot = BotConfig::default();
        bot.set_preset_model(1, "4p", "s42".into()).unwrap();
        bot.set_preset_model(1, "3p", "sanma".into()).unwrap();
        assert_eq!(bot.active_for(4), "akagi-native");
        assert_eq!(bot.active_for(3), "akagi-native3p");
        bot.activate_preset(1).unwrap();
        assert_eq!(bot.active_for(4), "s42");
        assert_eq!(bot.active_for(3), "sanma");
        assert_eq!(bot.active_model_preset, 1);
        bot.set_preset_model(1, "4p", "298k".into()).unwrap();
        assert_eq!(bot.active_for(4), "298k");
        assert_eq!(bot.active_for(3), "sanma");
    }

    #[test]
    fn model_presets_normalize_partial_config_and_track_external_active_changes() {
        let mut bot = BotConfig::default();
        bot.normalize_presets();
        bot.rename_preset(1, "自定义".into()).unwrap();
        bot.model_presets.truncate(2);
        bot.active_model_preset = 99;
        bot.active_4p = "external".into();
        bot.normalize_presets();
        assert_eq!(bot.model_presets.len(), MODEL_PRESET_COUNT);
        assert_eq!(bot.active_model_preset, 0);
        assert_eq!(bot.model_presets[0].model_4p, "external");
        assert_eq!(bot.model_presets[1].name, "自定义");
    }

    #[test]
    fn model_presets_reject_invalid_edits_and_roundtrip_unknown_config_fields() {
        let mut cfg = AppConfig::default();
        cfg.bot.normalize_presets();
        let before = serde_json::to_value(&cfg.bot).unwrap();
        assert!(cfg.bot.set_preset_model(10, "4p", "x".into()).is_err());
        assert!(cfg.bot.set_preset_model(0, "2p", "x".into()).is_err());
        assert!(cfg.bot.activate_preset(10).is_err());
        assert!(cfg.bot.rename_preset(0, "   ".into()).is_err());
        assert_eq!(serde_json::to_value(&cfg.bot).unwrap(), before);
        cfg.bot.rename_preset(2, " 东场 ".into()).unwrap();
        let merged = crate::config::merge_into(&cfg, "# keep\n[bot]\nforeign = 42\n").unwrap();
        let restored: AppConfig = toml::from_str(&merged).unwrap();
        assert_eq!(restored.bot.model_presets[2].name, "东场");
        assert!(merged.contains("foreign = 42"));
        assert!(merged.contains("# keep"));
    }
}
