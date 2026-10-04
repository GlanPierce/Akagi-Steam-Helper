//! Platform-neutral host policy, also exercised without a desktop.
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};

#[derive(Default)]
pub struct HostControl {
    lifecycle: Mutex<()>,
    pub enabled: AtomicBool,
    pub panel: AtomicBool,
    panel_requested: AtomicBool,
    pub hints_hidden: AtomicBool,
    pub autoplay: Arc<AtomicBool>,
    pub autoplay_epoch: AtomicU64,
    pub foreground: AtomicBool,
    pub vision: Mutex<VisionState>,
    pub hotspots: Mutex<HudHotspots>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct HudHotspot {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}
#[derive(Default)]
pub struct HudHotspots {
    pub generation: u64,
    pub aspect: f64,
    pub regions: Vec<HudHotspot>,
}
pub fn hotspot_hit(regions: &[HudHotspot], x: f64, y: f64) -> bool {
    regions.iter().any(|r| x >= r.x && x <= r.x+r.w && y >= r.y && y <= r.y+r.h)
}
pub fn hotspot_pixels(hotspots:&HudHotspots, width:i32, height:i32) -> Vec<[i32;4]> {
    if width <= 0 || height <= 0 || !valid_hotspots(&hotspots.regions,hotspots.aspect)
        || (hotspots.aspect-width as f64/height as f64).abs() >= 0.002 { return Vec::new(); }
    hotspots.regions.iter().filter_map(|r| {
        let rect = [(r.x*width as f64).ceil() as i32,(r.y*height as f64).ceil() as i32,
            ((r.x+r.w)*width as f64).floor().min(width as f64) as i32,((r.y+r.h)*height as f64).floor().min(height as f64) as i32];
        (rect[2]>rect[0] && rect[3]>rect[1]).then_some(rect)
    }).collect()
}
fn valid_hotspots(regions: &[HudHotspot], aspect: f64) -> bool {
    aspect.is_finite() && aspect > 0.0 && regions.len() <= 32 && regions.iter().all(|r| {
        [r.x,r.y,r.w,r.h].iter().all(|v| v.is_finite() && *v >= 0.0)
            && r.w > 0.0 && r.h > 0.0 && r.x+r.w <= 1.000001 && r.y+r.h <= 1.000001
    })
}
#[tauri::command]
pub fn set_immersive_hotspots(generation: u64, aspect: f64, regions: Vec<HudHotspot>, host: tauri::State<'_, SharedHost>) -> Result<(), String> {
    if !valid_hotspots(&regions,aspect) { return Err("invalid HUD interaction regions".into()); }
    let mut state = host.hotspots.lock().unwrap_or_else(|e| e.into_inner());
    if generation > state.generation { *state = HudHotspots { generation, aspect, regions }; }
    Ok(())
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GameSurface {
    pub hwnd: usize,
    pub width: i32,
    pub height: i32,
}
#[derive(Default)]
pub struct VisionState {
    pub generation: u64,
    pub request: super::immersive_contours::ContourRequest,
    pub surface: Option<GameSurface>,
}
pub type SharedHost = Arc<HostControl>;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpaceShortcut {
    Guidance,
    Menu,
}
pub fn space_shortcut(
    space: bool,
    previous_space: bool,
    ctrl: bool,
    shift: bool,
    alt: bool,
) -> Option<SpaceShortcut> {
    if !space || previous_space || !ctrl || alt {
        return None;
    }
    Some(if shift {
        SpaceShortcut::Menu
    } else {
        SpaceShortcut::Guidance
    })
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct HostState {
    pub foreground: bool,
    pub panel: bool,
    pub hints: bool,
    pub autoplay: bool,
}
impl HostControl {
    /// Tray clicks originate outside the game. Let the window-following thread
    /// activate the game before opening its existing menu; never expose a
    /// detached menu over whichever application is currently in front.
    pub fn request_panel_from_tray(&self) -> bool {
        let _guard = self.lifecycle.lock().unwrap_or_else(|e| e.into_inner());
        if !self.enabled.load(Ordering::SeqCst) {
            return false;
        }
        self.autoplay.store(false, Ordering::SeqCst);
        self.autoplay_epoch.fetch_add(1, Ordering::SeqCst);
        self.panel_requested.store(true, Ordering::SeqCst);
        true
    }

    pub fn take_panel_request(&self) -> bool {
        self.panel_requested.swap(false, Ordering::SeqCst)
    }

    /// Shared by the native shortcut and the MAKA button command.
    pub fn toggle_guidance(&self) {
        if self.foreground.load(Ordering::Relaxed) {
            self.hints_hidden.fetch_xor(true, Ordering::Relaxed);
        }
    }
    pub fn stop_autoplay(&self) {
        let _guard = self.lifecycle.lock().unwrap_or_else(|e|e.into_inner());
        self.autoplay.store(false, Ordering::SeqCst);
        self.autoplay_epoch.fetch_add(1, Ordering::SeqCst);
    }
    pub fn start_autoplay(&self) -> bool {
        let _guard = self.lifecycle.lock().unwrap_or_else(|e|e.into_inner());
        if !self.enabled.load(Ordering::SeqCst) || !self.foreground.load(Ordering::SeqCst)
            || self.panel.load(Ordering::SeqCst) || self.vision.lock().unwrap_or_else(|e|e.into_inner()).surface.is_none() {return false;}
        self.autoplay_epoch.fetch_add(1, Ordering::SeqCst);
        self.autoplay.store(true, Ordering::SeqCst);
        true
    }
    pub fn set_enabled(&self, enabled: bool) -> bool {
        let _guard = self.lifecycle.lock().unwrap_or_else(|e|e.into_inner());
        let changed = self.enabled.swap(enabled, Ordering::SeqCst) != enabled;
        if !enabled {
            self.panel_requested.store(false, Ordering::SeqCst);
            self.autoplay.store(false, Ordering::SeqCst);
            self.autoplay_epoch.fetch_add(1, Ordering::SeqCst);
        }
        changed
    }
    pub fn snapshot(&self) -> HostState {
        HostState {
            foreground: self.foreground.load(Ordering::Relaxed),
            panel: self.panel.load(Ordering::Relaxed),
            hints: !self.hints_hidden.load(Ordering::Relaxed),
            autoplay: self.autoplay.load(Ordering::Relaxed),
        }
    }
}
pub fn visible(
    valid: bool,
    minimized: bool,
    game_focused: bool,
    overlay_focused: bool,
    panel: bool,
) -> bool {
    valid && !minimized && (game_focused || overlay_focused && panel)
}
pub fn accepts_shortcuts(visible: bool, game_focused: bool, overlay_focused: bool) -> bool {
    // Owned modal dialogs keep the HUD visible but own Escape/Space themselves.
    visible && (game_focused || overlay_focused)
}
pub fn content_rect(width: f64, height: f64) -> (f64, f64, f64, f64) {
    let unit = (width / 16.0).min(height / 9.0).max(0.0);
    (
        (width - unit * 16.0) / 2.0,
        (height - unit * 9.0) / 2.0,
        unit * 16.0,
        unit * 9.0,
    )
}

#[tauri::command]
pub fn get_immersive_host(host: tauri::State<'_, SharedHost>) -> HostState {
    host.snapshot()
}

#[tauri::command]
pub async fn set_immersive_autoplay(enabled: bool, state: tauri::State<'_, super::AppState>, host: tauri::State<'_, SharedHost>) -> Result<(),String> {
    if enabled {
        if !cfg!(windows) || !host.enabled.load(Ordering::Relaxed) || !host.foreground.load(Ordering::Relaxed)
            || host.vision.lock().unwrap_or_else(|e|e.into_inner()).surface.is_none() {
            return Err("请在 Steam 对局中开启托管".into());
        }
        let config=state.config.read().await;
        if config.platform.kind!=crate::config::Platform::Majsoul || config.capture.mode!=crate::config::CaptureMode::Mitm {
            return Err("当前托管仅用于 Steam 雀魂对局".into());
        }
        drop(config);
        if !crate::proxy::game_transport::connected() || !matches!(*state.bot_status.read().await,crate::schema::BotStatus::Ready {..})
            || !state.game_tracker.lock().await.round_active { return Err("等待当前牌局与模型就绪".into()); }
    }
    if enabled {
        if !host.start_autoplay() {return Err("当前对局已退出或失去焦点".into());}
        super::commands::ensure_autoplay_manager(&state);
    } else {host.stop_autoplay();}
    Ok(())
}

#[tauri::command]
pub fn toggle_immersive_hints(host: tauri::State<'_, SharedHost>) {
    host.toggle_guidance();
}

#[tauri::command]
pub fn set_immersive_panel(open: bool, host: tauri::State<'_, SharedHost>) {
    host.panel.store(
        open && host.foreground.load(Ordering::Relaxed),
        Ordering::Relaxed,
    );
}

#[tauri::command]
pub fn set_immersive_targets(
    generation: u64,
    request: super::immersive_contours::ContourRequest,
    host: tauri::State<'_, SharedHost>,
) -> Result<(), String> {
    if request.key.len() > 8192
        || request.targets.len() > 32
        || request.targets.iter().any(|t| {
            t.id.len() > 64
                || !["tile", "action", "choice"].contains(&t.kind.as_str())
                || ![t.x, t.y, t.w, t.h].iter().all(|v| v.is_finite())
                || !(0.0..=16.0).contains(&t.x)
                || !(0.0..=9.0).contains(&t.y)
                || !(0.1..=4.0).contains(&t.w)
                || !(0.1..=3.0).contains(&t.h)
        })
    {
        return Err("invalid silhouette targets".into());
    }
    let mut state = host.vision.lock().unwrap_or_else(|e| e.into_inner());
    if generation > state.generation {
        state.generation = generation;
        state.request = request;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn tray_menu_request_waits_for_game_activation_without_toggling_guidance() {
        let host = super::HostControl::default();
        host.set_enabled(true);
        host.hints_hidden.store(true, super::Ordering::Relaxed);
        host.autoplay.store(true, super::Ordering::SeqCst);
        assert!(host.request_panel_from_tray());
        assert!(!host.snapshot().foreground);
        assert!(!host.snapshot().panel);
        assert!(!host.snapshot().hints);
        assert!(!host.snapshot().autoplay);
        assert!(host.take_panel_request());
        assert!(!host.take_panel_request());
    }

    #[test]
    fn disabling_the_host_discards_pending_tray_requests() {
        let host = super::HostControl::default();
        assert!(!host.request_panel_from_tray());
        host.set_enabled(true);
        assert!(host.request_panel_from_tray());
        host.set_enabled(false);
        host.set_enabled(true);
        assert!(!host.take_panel_request());
    }

    #[test]
    fn owned_file_dialog_keeps_menu_visible_without_consuming_its_keys() {
        assert!(super::visible(true, false, false, true, true));
        assert!(!super::accepts_shortcuts(true, false, false));
        assert!(super::accepts_shortcuts(true, false, true));
        assert!(super::accepts_shortcuts(true, true, false));
        assert!(!super::accepts_shortcuts(false, true, false));
    }
    use super::*;
    #[test]
    fn closing_the_host_revokes_autoplay_and_reopening_does_not_resume_it() {
        let host = HostControl::default();
        host.set_enabled(true);
        host.autoplay.store(true, Ordering::SeqCst);
        let epoch = host.autoplay_epoch.load(Ordering::SeqCst);
        host.set_enabled(false);
        assert!(!host.autoplay.load(Ordering::SeqCst));
        assert!(host.autoplay_epoch.load(Ordering::SeqCst) > epoch);
        // An enable command that returns from async readiness checks late
        // cannot re-arm a closed host.
        assert!(!host.start_autoplay());
        host.set_enabled(true);
        assert!(!host.autoplay.load(Ordering::SeqCst));
    }
    #[test]
    fn immersive_host_focus_policy() {
        assert!(visible(true, false, true, false, false));
        assert!(visible(true, false, false, true, true));
        assert!(!visible(true, false, false, true, false));
        assert!(!visible(true, true, true, false, false));
        assert!(!visible(false, false, true, false, false));
        assert!(!visible(true, false, false, false, true));
    }
    #[test]
    fn immersive_host_letterboxes_without_changing_game_graphics() {
        assert_eq!(content_rect(1920.0, 1200.0), (0.0, 60.0, 1920.0, 1080.0));
        assert_eq!(content_rect(2560.0, 1080.0), (320.0, 0.0, 1920.0, 1080.0));
        assert_eq!(content_rect(960.0, 540.0), (0.0, 0.0, 960.0, 540.0));
    }
    #[test]
    fn hud_hotspots_capture_only_their_visible_bounds_at_the_published_aspect() {
        let regions = [HudHotspot { x: 0.9, y: 0.8, w: 0.05, h: 0.1 }];
        assert!(hotspot_hit(&regions, 0.92, 0.85));
        assert!(!hotspot_hit(&regions, 0.8, 0.85));
        assert!(!hotspot_hit(&regions, f64::NAN, 0.85));
        assert!(valid_hotspots(&regions, 16.0 / 9.0));
        assert!(!valid_hotspots(&[HudHotspot { x: 0.99, y: 0.0, w: 0.5, h: 0.1 }], 1.0));
        assert!(!valid_hotspots(&regions, f64::NAN));
    }
    #[test]
    fn hud_input_region_never_extends_beyond_a_control_and_rejects_stale_sizes() {
        let hot = HudHotspots {generation:1,aspect:16.0/9.0,regions:vec![HudHotspot {x:0.9001,y:0.8001,w:0.05,h:0.1}]};
        assert_eq!(hotspot_pixels(&hot,1920,1080),vec![[1729,865,1824,972]]);
        assert!(hotspot_pixels(&hot,1280,800).is_empty());
        assert!(hotspot_pixels(&hot,0,1080).is_empty());
        assert!(hotspot_pixels(&HudHotspots {regions:vec![],..hot},1920,1080).is_empty());
    }
}
