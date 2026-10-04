use serde::{Deserialize, Serialize};

/// Bounds for [`OverlayConfig::top_n`]. One row is the minimum that still
/// says something; past five the window stops being a glanceable HUD.
pub const TOP_N_MIN: usize = 1;
pub const TOP_N_MAX: usize = 5;

/// Below ~0.3 the overlay is unreadable, which looks like a bug rather than
/// a setting. Clamp instead of trusting a hand-edited `config.toml`.
pub const OPACITY_MIN: f64 = 0.3;
pub const OPACITY_MAX: f64 = 1.0;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlayFeature {
    ShowDiscards,
    ShowActions,
    ShowAnalysis,
    ShowRisk,
}

/// The always-on-top suggestion overlay ("PiP") window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct OverlayConfig {
    /// Steam game-sized HUD; the original card remains available elsewhere.
    pub immersive: bool,
    pub show_analysis: bool,
    pub show_risk: bool,
    pub show_discards: bool,
    pub show_actions: bool,
    pub calibration: OverlayCalibration,
    /// Open the overlay window. On by default — the suggestions are the point
    /// of the app, and having to go find a setting to see them over the game is
    /// a worse first run than one extra window you can close with its × button.
    /// Persisted, so both the closing and the leaving-open stick.
    pub enabled: bool,
    /// How many Bot Show rows to render.
    pub top_n: usize,
    /// Card opacity. The window itself is transparent; this fades the card
    /// drawn inside it so the table stays partly visible underneath.
    pub opacity: f64,
    /// Keep the window above the game client. Off is useful on a second
    /// monitor, where being topmost only gets in the way.
    pub always_on_top: bool,
}

impl Default for OverlayConfig {
    fn default() -> Self {
        Self {
            immersive: false,
            show_analysis: true,
            show_risk: true,
            show_discards: true,
            show_actions: true,
            calibration: OverlayCalibration::default(),
            enabled: true,
            top_n: 3,
            opacity: 0.95,
            always_on_top: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct OverlayCalibration {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub hand_y: f64,
    pub button_y: f64,
}
impl Default for OverlayCalibration {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            hand_y: 0.0,
            button_y: 0.0,
        }
    }
}
impl OverlayCalibration {
    pub fn clamped(&self) -> Self {
        fn limit(v: f64, low: f64, high: f64, fallback: f64) -> f64 {
            if v.is_finite() {
                v.clamp(low, high)
            } else {
                fallback
            }
        }
        Self {
            x: limit(self.x, -2.0, 2.0, 0.0),
            y: limit(self.y, -2.0, 2.0, 0.0),
            scale: limit(self.scale, 0.8, 1.2, 1.0),
            hand_y: limit(self.hand_y, -1.0, 1.0, 0.0),
            button_y: limit(self.button_y, -1.0, 1.0, 0.0),
        }
    }
}

impl OverlayConfig {
    pub fn set_feature(&mut self, feature: OverlayFeature, enabled: bool) {
        match feature {
            OverlayFeature::ShowDiscards => self.show_discards = enabled,
            OverlayFeature::ShowActions => self.show_actions = enabled,
            OverlayFeature::ShowAnalysis => self.show_analysis = enabled,
            OverlayFeature::ShowRisk => self.show_risk = enabled,
        }
    }
    /// `top_n` clamped into [`TOP_N_MIN`, `TOP_N_MAX`].
    ///
    /// The frontend picks from a bounded control, but `config.toml` is a
    /// plain text file a user can put `top_n = 0` into — which would render
    /// an overlay with no rows and no explanation.
    pub fn clamped_top_n(&self) -> usize {
        self.top_n.clamp(TOP_N_MIN, TOP_N_MAX)
    }

    /// `opacity` clamped into [`OPACITY_MIN`, `OPACITY_MAX`], with NaN
    /// treated as the default.
    pub fn clamped_opacity(&self) -> f64 {
        if self.opacity.is_nan() {
            return Self::default().opacity;
        }
        self.opacity.clamp(OPACITY_MIN, OPACITY_MAX)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ingame_startup_preserves_preferences_without_mutating_saved_config() {
        let saved = OverlayConfig { enabled: false, immersive: false, show_actions: false, opacity: 0.7,
            calibration: OverlayCalibration { x: 0.2, ..Default::default() }, ..Default::default() };
        let mut config = super::super::AppConfig { overlay: saved.clone(), ..Default::default() };
        config.bot.enabled = false;
        config.bot.active_4p = "local-four".into();
        config.bot.active_3p = "local-three".into();
        let current = config.for_ingame();
        assert!(current.overlay.enabled && current.overlay.immersive && current.bot.enabled);
        assert!(!current.overlay.show_actions);
        assert_eq!(current.overlay.opacity, 0.7);
        assert_eq!(current.overlay.calibration, saved.calibration);
        assert_eq!(current.bot.active_4p, config.bot.active_4p);
        assert_eq!(current.bot.active_3p, config.bot.active_3p);
        assert!(!config.bot.enabled);
        assert!(!saved.enabled && !saved.immersive);
    }

    #[test]
    fn successive_feature_patches_preserve_other_settings() {
        let mut cfg = OverlayConfig::default();
        cfg.calibration.x = 0.3;
        cfg.set_feature(OverlayFeature::ShowDiscards, false);
        cfg.set_feature(OverlayFeature::ShowActions, false);
        cfg.set_feature(OverlayFeature::ShowRisk, false);
        assert!(!cfg.show_discards && !cfg.show_actions && !cfg.show_risk);
        assert!(cfg.show_analysis);
        assert_eq!(cfg.calibration.x, 0.3);
    }

    #[test]
    fn defaults_are_an_open_three_row_overlay() {
        let c = OverlayConfig::default();
        assert!(c.enabled, "overlay is on out of the box");
        assert_eq!(c.top_n, 3);
        assert!(c.always_on_top);
        assert_eq!(c.clamped_top_n(), 3);
        assert_eq!(c.clamped_opacity(), 0.95);
    }

    /// Upgrading users have a `config.toml` with no `[overlay]` section, so the
    /// default is what they get — and it has to be the same "on" the docs and
    /// the Settings toggle promise, not a silent opt-out.
    #[test]
    fn legacy_config_gets_the_overlay_switched_on() {
        let cfg: crate::config::AppConfig = toml::from_str("[bot]\nenabled = true\n").unwrap();
        assert!(cfg.overlay.enabled);
    }

    /// A hand-edited `config.toml` must not be able to produce a zero-row or
    /// invisible overlay — both read as "the feature is broken".
    #[test]
    fn out_of_range_values_are_clamped() {
        let zero = OverlayConfig {
            top_n: 0,
            opacity: 0.0,
            ..Default::default()
        };
        assert_eq!(zero.clamped_top_n(), TOP_N_MIN);
        assert_eq!(zero.clamped_opacity(), OPACITY_MIN);

        let huge = OverlayConfig {
            top_n: 99,
            opacity: 4.2,
            ..Default::default()
        };
        assert_eq!(huge.clamped_top_n(), TOP_N_MAX);
        assert_eq!(huge.clamped_opacity(), OPACITY_MAX);
    }

    #[test]
    fn nan_opacity_falls_back_to_default() {
        let nan = OverlayConfig {
            opacity: f64::NAN,
            ..Default::default()
        };
        assert_eq!(nan.clamped_opacity(), OverlayConfig::default().opacity);
    }

    /// A `config.toml` written before this section existed must still parse.
    #[test]
    fn missing_section_deserialises_to_defaults() {
        let cfg: crate::config::AppConfig =
            toml::from_str("[bot]\nenabled = true\n").expect("legacy config should parse");
        assert_eq!(cfg.overlay, OverlayConfig::default());
    }

    #[test]
    fn round_trips_through_toml() {
        let mut cfg = crate::config::AppConfig::default();
        cfg.overlay.enabled = true;
        cfg.overlay.top_n = 5;
        cfg.overlay.opacity = 0.6;
        cfg.overlay.always_on_top = false;
        cfg.overlay.show_discards = false;
        cfg.overlay.show_actions = false;
        cfg.overlay.show_analysis = false;
        cfg.overlay.show_risk = false;

        let body = toml::to_string_pretty(&cfg).unwrap();
        assert!(body.contains("[overlay]"), "expected [overlay] in:\n{body}");

        let back: crate::config::AppConfig = toml::from_str(&body).unwrap();
        assert_eq!(back.overlay, cfg.overlay);
    }
}
