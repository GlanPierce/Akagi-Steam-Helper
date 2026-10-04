//! Steam input transport for the existing Majsoul planner. Session-only opt-in;
//! every delayed press is tied to one tracker revision and one enable epoch.
use crate::ipc::{
    immersive::ImmersiveCache,
    immersive_host::{HostControl, SharedHost},
    state::CaptureControl,
};
use std::sync::{atomic::Ordering, Arc};
use tokio::sync::Mutex;

// The HUD host records GameSurface in physical pixels from a per-monitor V2
// thread. Tokio workers may use Windows' DPI-virtualized coordinate space, so
// every Win32 geometry/cursor query for a Steam press must use that same DPI
// context. Restore the worker's original context before the next await.
#[cfg(windows)]
struct PhysicalDpiGuard(windows_sys::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT);

#[cfg(windows)]
impl PhysicalDpiGuard {
    fn enter() -> Option<Self> {
        use windows_sys::Win32::UI::HiDpi::{
            SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        };
        let previous =
            unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
        (!previous.is_null()).then_some(Self(previous))
    }
}

#[cfg(windows)]
impl Drop for PhysicalDpiGuard {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::UI::HiDpi::SetThreadDpiAwarenessContext(self.0) };
    }
}

#[derive(Clone)]
pub struct SteamTarget {
    pub host: SharedHost,
    pub cache: ImmersiveCache,
    pub capture: Arc<Mutex<CaptureControl>>,
}

pub fn decision_current(
    host: &HostControl,
    epoch: u64,
    revision: u64,
    current: u64,
    can_act: bool,
    connected: bool,
) -> bool {
    host.enabled.load(Ordering::SeqCst)
        && host.autoplay.load(Ordering::SeqCst)
        && host.autoplay_epoch.load(Ordering::SeqCst) == epoch
        && host.foreground.load(Ordering::SeqCst)
        && !host.panel.load(Ordering::SeqCst)
        && revision == current
        && can_act
        && connected
}

/// Some external mjai models name only Reach. Resolve its tile from a clone
/// and the existing local efficiency ranking; never feed a speculative reach
/// into the live tracker or a stateful model. The regular native model already
/// names its riichi tile and does not use this fallback.
pub fn fallback_reach_discard(tracker: &crate::game_state::GameTracker) -> Option<String> {
    use riichienv_core::{
        action::ActionType, parser::tid_to_mjai, state::legal_actions::GameStateLegalActions,
        state_3p::legal_actions::GameState3PLegalActions,
    };
    let seat = tracker.our_seat()?;
    let event = riichienv_core::replay::MjaiEvent::Reach {
        actor: seat as usize,
    };
    let legal = if let Some(state) = tracker.state() {
        if !state
            ._get_legal_actions_internal(seat)
            .iter()
            .any(|a| a.action_type == ActionType::Riichi)
        {
            return None;
        }
        let mut clone = state.clone();
        clone.apply_mjai_event(event);
        clone._get_legal_actions_internal(seat)
    } else if let Some(state) = tracker.state_3p() {
        if !state
            ._get_legal_actions_internal(seat)
            .iter()
            .any(|a| a.action_type == ActionType::Riichi)
        {
            return None;
        }
        let mut clone = state.clone();
        clone.apply_mjai_event(event);
        clone._get_legal_actions_internal(seat)
    } else {
        return None;
    };
    let snapshot = tracker.snapshot()?;
    let info = crate::analysis::snapshot_adapter::to_player_info(&snapshot, seat).ok()?;
    let ranked = crate::analysis::analyze_14(&info);
    let mut legal: Vec<String> = legal
        .into_iter()
        .filter(|a| a.action_type == ActionType::Discard)
        .filter_map(|a| a.tile.map(tid_to_mjai))
        .collect();
    // Prefer retaining an aka when both colors are legal and efficiency ties.
    legal.sort_by_key(|tile| tile.ends_with('r'));
    for candidate in ranked.maintain.iter().chain(&ranked.backwards) {
        if let Some(tile) = legal.iter().find(|tile| {
            tile.trim_end_matches('r') == candidate.discard
                && snapshot.players[seat as usize].tehai.contains(tile)
        }) {
            return Some(tile.clone());
        }
    }
    None
}

impl SteamTarget {
    pub fn stop(&self) {
        self.host.stop_autoplay();
    }
    pub fn owns_input(&self) -> bool {
        self.host.enabled.load(Ordering::SeqCst)
            && (self.host.autoplay.load(Ordering::SeqCst)
                || self
                    .host
                    .vision
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .surface
                    .is_some())
    }
    async fn current(
        &self,
        epoch: u64,
        revision: u64,
        tracker: &Mutex<crate::game_state::GameTracker>,
    ) -> bool {
        if !matches!(
            self.capture.lock().await.status,
            crate::schema::CaptureStatus::Running { .. }
        ) {
            return false;
        }
        let tracker = tracker.lock().await;
        decision_current(
            &self.host,
            epoch,
            revision,
            tracker.events_seen,
            tracker.round_active && tracker.our_seat_can_act() == Some(true),
            crate::proxy::game_transport::connected(),
        )
    }
    async fn wait(
        &self,
        ms: u32,
        epoch: u64,
        revision: u64,
        tracker: &Mutex<crate::game_state::GameTracker>,
        pending: Option<(&super::verify::InputWatch, super::verify::InputTicket)>,
    ) -> bool {
        let until = tokio::time::Instant::now() + std::time::Duration::from_millis(ms as u64);
        loop {
            if !self.current(epoch, revision, tracker).await
                || pending.is_some_and(|(watch, ticket)| watch.sent_since(ticket))
            {
                return false;
            }
            let now = tokio::time::Instant::now();
            if now >= until {
                return true;
            }
            tokio::time::sleep((until - now).min(std::time::Duration::from_millis(25))).await;
        }
    }
    /// No speculative retries of multi-step menus: the observed uplink proves
    /// completion, while every following press still checks the same revision.
    pub async fn execute(
        &self,
        steps: &[super::Step],
        epoch: u64,
        revision: u64,
        tracker: &Mutex<crate::game_state::GameTracker>,
        watch: &super::verify::InputWatch,
        cfg: &crate::config::MajsoulAutoplayConfig,
        action: &crate::schema::MjaiEvent,
        opened_at: std::time::Instant,
        riichi_discard: bool,
    ) -> bool {
        let ticket = watch.ticket();
        if watch.sent_after(opened_at) {
            return false;
        }
        for (index, step) in steps.iter().enumerate() {
            if !self.current(epoch, revision, tracker).await || watch.sent_since(ticket) {
                return false;
            }
            match step {
                super::Step::Sleep { duration_ms } => {
                    // First offer and sub-choice rows both animate into place.
                    let delay = (*duration_ms).max(if index == 0 { 500 } else { 350 });
                    if !self
                        .wait(delay, epoch, revision, tracker, Some((watch, ticket)))
                        .await
                    {
                        return false;
                    }
                }
                super::Step::Click { x_norm, y_norm } => {
                    if !self
                        .press(
                            *x_norm, *y_norm, epoch, revision, tracker, cfg, watch, ticket,
                        )
                        .await
                    {
                        return false;
                    }
                }
                _ => return false,
            }
        }
        // A vanished decision after our press is successful only when the game
        // sent its input. Otherwise leave that decision retired, never click a
        // replacement prompt on the assumption that the first press was lost.
        for _ in 0..40 {
            use super::verify::ActionCheck;
            let checked = watch.action_since(ticket, action, riichi_discard);
            match checked {
                ActionCheck::Confirmed => return true,
                ActionCheck::Mismatch => {
                    watch.record(serde_json::json!({"event":"action_mismatch", "revision":revision, "expected":action}));
                    return false;
                }
                ActionCheck::Pending | ActionCheck::AwaitingServer => {}
            }
            // The server may already have advanced the tracker after accepting
            // our request. Allow its matching action echo to finish this check.
            if checked == ActionCheck::Pending && !self.current(epoch, revision, tracker).await {
                return false;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        false
    }

    #[cfg(not(windows))]
    async fn press(
        &self,
        _x: f64,
        _y: f64,
        _epoch: u64,
        _revision: u64,
        _tracker: &Mutex<crate::game_state::GameTracker>,
        _cfg: &crate::config::MajsoulAutoplayConfig,
        _watch: &super::verify::InputWatch,
        _ticket: super::verify::InputTicket,
    ) -> bool {
        false
    }

    #[cfg(windows)]
    async fn press(
        &self,
        x: f64,
        y: f64,
        epoch: u64,
        revision: u64,
        tracker: &Mutex<crate::game_state::GameTracker>,
        cfg: &crate::config::MajsoulAutoplayConfig,
        watch: &super::verify::InputWatch,
        ticket: super::verify::InputTicket,
    ) -> bool {
        use windows_sys::Win32::{
            Foundation::{HWND, POINT, RECT},
            Graphics::Gdi::ClientToScreen,
            UI::{Input::KeyboardAndMouse::*, WindowsAndMessaging::*},
        };
        let Some(surface) = self
            .host
            .vision
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .surface
        else {
            return false;
        };
        if !x.is_finite() || !y.is_finite() || !(0.0..16.0).contains(&x) || !(0.0..9.0).contains(&y)
        {
            return false;
        }
        // Keep raw HWND local to synchronous checks so no pointer crosses await.
        let geometry = || unsafe {
            let _dpi = PhysicalDpiGuard::enter()?;
            let hwnd = surface.hwnd as HWND;
            if GetForegroundWindow() != hwnd || IsIconic(hwnd) != 0 {
                return None;
            }
            let mut rect = RECT::default();
            let mut origin = POINT::default();
            if GetClientRect(hwnd, &mut rect) == 0
                || ClientToScreen(hwnd, &mut origin) == 0
                || rect.right != surface.width
                || rect.bottom != surface.height
            {
                return None;
            }
            let (ox, oy, w, h) =
                crate::ipc::immersive_host::content_rect(rect.right as f64, rect.bottom as f64);
            Some((
                origin.x + (ox + x * w / 16.0).round() as i32,
                origin.y + (oy + y * h / 9.0).round() as i32,
            ))
        };
        let Some(point) = geometry() else {
            return false;
        };
        let idle = || unsafe {
            [
                VK_LBUTTON, VK_RBUTTON, VK_MBUTTON, VK_CONTROL, VK_MENU, VK_SHIFT,
            ]
            .iter()
            .all(|key| GetAsyncKeyState(*key as i32) >= 0)
        };
        if watch.sent_since(ticket)
            || !idle()
            || !PhysicalDpiGuard::enter()
                .is_some_and(|_dpi| unsafe { SetCursorPos(point.0, point.1) } != 0)
        {
            return false;
        }
        if !self
            .wait(
                cfg.hover_delay_ms.max(60),
                epoch,
                revision,
                tracker,
                Some((watch, ticket)),
            )
            .await
            || geometry() != Some(point)
            || !idle()
        {
            return false;
        }
        if !self.current(epoch, revision, tracker).await {
            return false;
        }
        let mut cursor = POINT::default();
        if !PhysicalDpiGuard::enter().is_some_and(|_dpi| unsafe { GetCursorPos(&mut cursor) } != 0)
            || (cursor.x, cursor.y) != point
        {
            return false;
        }
        let mouse = |flags| INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dwFlags: flags,
                    ..Default::default()
                },
            },
        };
        watch.record(
            serde_json::json!({"event":"mouse_target", "revision":revision,
            "epoch":epoch, "normalized":[x,y], "screen":[point.0,point.1],
            "surface":[surface.width,surface.height]}),
        );
        if watch.sent_since(ticket)
            || geometry() != Some(point)
            || !idle()
            || !self.host.enabled.load(Ordering::SeqCst)
            || self.host.panel.load(Ordering::SeqCst)
            || !self.host.autoplay.load(Ordering::SeqCst)
            || self.host.autoplay_epoch.load(Ordering::SeqCst) != epoch
        {
            return false;
        }
        if unsafe {
            SendInput(
                1,
                &mouse(MOUSEEVENTF_LEFTDOWN),
                std::mem::size_of::<INPUT>() as i32,
            )
        } != 1
        {
            return false;
        }
        // Always release even if the user switches windows or disables during
        // the hold. No later press can survive the epoch/revision checks.
        let _ = self
            .wait(
                cfg.click_hold_ms.clamp(45, 150),
                epoch,
                revision,
                tracker,
                None,
            )
            .await;
        unsafe {
            SendInput(
                1,
                &mouse(MOUSEEVENTF_LEFTUP),
                std::mem::size_of::<INPUT>() as i32,
            );
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Exercise only the receipt-waiting phase, without sending native input.
    /// A bare "some discard happened" cannot establish that 2m was played.
    #[tokio::test]
    async fn steam_does_not_confirm_an_unidentified_discard() {
        use crate::{
            autoplay::verify::{InputKind, InputWatch},
            schema::{CaptureKind, CaptureStatus, MjaiEvent},
        };
        let target = SteamTarget {
            host: Arc::new(HostControl::default()),
            cache: Default::default(),
            capture: Arc::new(Mutex::new(Default::default())),
        };
        target.host.enabled.store(true, Ordering::SeqCst);
        target.host.foreground.store(true, Ordering::SeqCst);
        target.host.autoplay.store(true, Ordering::SeqCst);
        target.capture.lock().await.status = CaptureStatus::Running {
            kind: CaptureKind::Mitm,
            descriptor: "receipt test".into(),
        };
        let mut state = crate::game_state::GameTracker::new();
        for value in [
            serde_json::json!({"type":"start_game","id":0,"names":["a","b","c","d"]}),
            serde_json::json!({"type":"start_kyoku","bakaze":"E","kyoku":1,"honba":0,"kyotaku":0,"oya":0,"scores":[25000,25000,25000,25000],"dora_marker":"9p",
                "tehais":[["1m","2m","3m","4m","5m","6m","7p","8p","9p","2s","3s","4s","E"],vec!["?";13],vec!["?";13],vec!["?";13]]}),
            serde_json::json!({"type":"tsumo","actor":0,"pai":"N"}),
        ] {
            state
                .handle(&serde_json::from_value::<MjaiEvent>(value).unwrap())
                .unwrap();
        }
        let revision = state.events_seen;
        let tracker = Mutex::new(state);
        let connection = "127.0.0.1:60401".parse().unwrap();
        crate::proxy::game_transport::observe_game(connection);
        let watch = Arc::new(InputWatch::default());
        let incoming = watch.clone();
        let received = tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            incoming.note_sent(InputKind::Discard);
        });
        let expected = MjaiEvent::Dahai {
            actor: 0,
            pai: "2m".into(),
            tsumogiri: false,
        };
        let confirmed = target
            .execute(
                &[],
                0,
                revision,
                &tracker,
                &watch,
                &Default::default(),
                &expected,
                std::time::Instant::now(),
                false,
            )
            .await;
        received.await.unwrap();
        crate::proxy::game_transport::close(connection);
        assert!(
            !confirmed,
            "an unspecified discard must not confirm the requested 2m"
        );
    }
    #[cfg(windows)]
    #[test]
    fn steam_input_uses_physical_dpi_and_restores_worker_context() {
        use windows_sys::Win32::UI::HiDpi::{
            AreDpiAwarenessContextsEqual, GetThreadDpiAwarenessContext,
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
        };
        let original = unsafe { GetThreadDpiAwarenessContext() };
        {
            let _dpi = PhysicalDpiGuard::enter().expect("per-monitor V2 context available");
            assert_ne!(
                unsafe {
                    AreDpiAwarenessContextsEqual(
                        GetThreadDpiAwarenessContext(),
                        DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
                    )
                },
                0
            );
        }
        assert_ne!(
            unsafe { AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(), original) },
            0,
            "the Tokio worker's DPI context must be restored before an await"
        );
    }
    #[test]
    fn unresolved_reach_uses_only_legal_tiles_without_declaring_in_the_tracker() {
        use crate::schema::MjaiEvent;
        let mut tracker = crate::game_state::GameTracker::new();
        for value in [
            serde_json::json!({"type":"start_game","id":0,"names":["a","b","c","d"]}),
            serde_json::json!({"type":"start_kyoku","bakaze":"E","kyoku":1,"honba":0,"kyotaku":0,"oya":0,"scores":[25000,25000,25000,25000],"dora_marker":"9p",
                "tehais":[["1m","2m","3m","4m","5m","6m","7p","8p","9p","2s","3s","4s","E"],vec!["?";13],vec!["?";13],vec!["?";13]]}),
            serde_json::json!({"type":"tsumo","actor":0,"pai":"N"}),
        ] {
            tracker
                .handle(&serde_json::from_value::<MjaiEvent>(value).unwrap())
                .unwrap();
        }
        let before = serde_json::to_value(tracker.snapshot()).unwrap();
        assert!(matches!(
            fallback_reach_discard(&tracker).as_deref(),
            Some("N" | "E")
        ));
        assert_eq!(serde_json::to_value(tracker.snapshot()).unwrap(), before);
    }

    #[test]
    fn no_game_surface_does_not_claim_browser_autoplay() {
        let target = SteamTarget {
            host: Arc::new(HostControl::default()),
            cache: Default::default(),
            capture: Arc::new(Mutex::new(Default::default())),
        };
        target.host.set_enabled(true);
        assert!(!target.owns_input());
        target.host.vision.lock().unwrap().surface =
            Some(crate::ipc::immersive_host::GameSurface {
                hwnd: 1,
                width: 1920,
                height: 1080,
            });
        assert!(target.owns_input());
        target.host.set_enabled(false);
        assert!(!target.owns_input());
    }
    #[test]
    fn stale_or_disabled_decisions_cannot_press_even_after_quick_reenable() {
        let host = HostControl::default();
        host.enabled.store(true, Ordering::SeqCst);
        host.foreground.store(true, Ordering::SeqCst);
        assert!(!decision_current(&host, 0, 12, 12, true, true));
        host.autoplay.store(true, Ordering::SeqCst);
        assert!(decision_current(&host, 0, 12, 12, true, true));
        // Hiding suggestions leaves the explicit autoplay switch independent.
        host.hints_hidden.store(true, Ordering::SeqCst);
        assert!(decision_current(&host, 0, 12, 12, true, true));
        assert!(!decision_current(&host, 0, 12, 13, true, true));
        assert!(!decision_current(&host, 0, 12, 12, false, true));
        assert!(!decision_current(&host, 0, 12, 12, true, false));
        host.autoplay_epoch.store(2, Ordering::SeqCst);
        assert!(!decision_current(&host, 0, 12, 12, true, true));
        assert!(decision_current(&host, 2, 12, 12, true, true));
        host.panel.store(true, Ordering::SeqCst);
        assert!(!decision_current(&host, 2, 12, 12, true, true));
        host.panel.store(false, Ordering::SeqCst);
        host.foreground.store(false, Ordering::SeqCst);
        assert!(!decision_current(&host, 2, 12, 12, true, true));
    }
}
