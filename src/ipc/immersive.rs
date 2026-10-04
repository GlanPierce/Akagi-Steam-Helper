//! A coherent, public-information-only frame for the Steam table HUD.
use super::AppState;
use crate::{
    analysis::result::AnalysisResult,
    bot::BotResponse,
    game_state::snapshot::GameStateSnapshot,
    schema::{BotStatus, CaptureStatus},
};
use riichienv_core::state::legal_actions::GameStateLegalActions;
use riichienv_core::state_3p::legal_actions::GameState3PLegalActions;
use riichienv_core::{
    action::{Action, ActionType},
    parser::tid_to_mjai,
};
use serde::Serialize;
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;

#[derive(Clone, Default)]
pub struct ImmersiveCache(pub Arc<RwLock<Option<BotResponse>>>);

pub fn response_revision(response: &BotResponse) -> Option<u64> {
    response.meta.as_ref()?.get("akagi_revision")?.as_u64()
}
pub fn response_for_revision(response: Option<BotResponse>, revision: u64) -> Option<BotResponse> {
    response.filter(|r| response_revision(r) == Some(revision))
}
impl ImmersiveCache {
    pub async fn store(&self, response: &BotResponse) {
        let Some(revision) = response_revision(response) else {
            return;
        };
        let mut slot = self.0.write().await;
        if slot
            .as_ref()
            .and_then(response_revision)
            .is_none_or(|old| revision >= old)
        {
            *slot = Some(response.clone());
        }
    }
}

#[derive(Clone, Serialize)]
pub struct LegalAction {
    pub kind: &'static str,
    pub tile: Option<String>,
    pub consumed: Vec<String>,
}
impl From<Action> for LegalAction {
    fn from(a: Action) -> Self {
        let kind = match a.action_type {
            ActionType::Discard => "discard",
            ActionType::Chi => "chi",
            ActionType::Pon => "pon",
            ActionType::Daiminkan => "daiminkan",
            ActionType::Ankan => "ankan",
            ActionType::Kakan => "kakan",
            ActionType::Riichi => "reach",
            ActionType::Tsumo => "tsumo",
            ActionType::Ron => "ron",
            ActionType::KyushuKyuhai => "ryukyoku",
            ActionType::Kita => "kita",
            ActionType::Pass => "pass",
        };
        Self {
            kind,
            tile: a.tile.map(tid_to_mjai),
            consumed: a.consume_tiles.into_iter().map(tid_to_mjai).collect(),
        }
    }
}

#[derive(Serialize)]
pub struct ImmersiveFrame {
    pub revision: u64,
    pub game: Option<GameStateSnapshot>,
    pub can_act: bool,
    pub legal_actions: Vec<LegalAction>,
    pub riichi_discards: Vec<String>,
    pub transport_connected: bool,
    pub response: Option<BotResponse>,
    pub analysis: Option<AnalysisResult>,
    pub capture: CaptureStatus,
    pub bot_status: BotStatus,
}

#[tauri::command]
pub async fn get_immersive_frame(
    state: State<'_, AppState>,
    cache: State<'_, ImmersiveCache>,
) -> Result<ImmersiveFrame, String> {
    let (revision, game, can_act, legal_actions, riichi_discards) = {
        let tracker = state.game_tracker.lock().await;
        let mut game = tracker.snapshot();
        if let Some(ref mut g) = game {
            g.is_done |= !tracker.round_active;
        }
        let active = tracker.round_active
            && game
                .as_ref()
                .is_some_and(|g| !g.is_done && g.our_seat.is_some());
        let can_act = active && tracker.our_seat_can_act() == Some(true);
        let actions = if can_act {
            let seat = game.as_ref().and_then(|g| g.our_seat).unwrap();
            if let Some(s) = tracker.state() {
                s._get_legal_actions_internal(seat)
            } else if let Some(s) = tracker.state_3p() {
                s._get_legal_actions_internal(seat)
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        };
        let reach = if actions.iter().any(|a| a.action_type == ActionType::Riichi) {
            let seat = game.as_ref().and_then(|g| g.our_seat).unwrap();
            // Simulate the declaration only on a clone, never mutate the tracker.
            let event = riichienv_core::replay::MjaiEvent::Reach {
                actor: seat as usize,
            };
            if let Some(s) = tracker.state() {
                let mut clone = s.clone();
                clone.apply_mjai_event(event);
                clone._get_legal_actions_internal(seat)
            } else if let Some(s) = tracker.state_3p() {
                let mut clone = s.clone();
                clone.apply_mjai_event(event);
                clone._get_legal_actions_internal(seat)
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        };
        let riichi_discards = reach
            .into_iter()
            .filter(|a| a.action_type == ActionType::Discard)
            .filter_map(|a| a.tile.map(tid_to_mjai))
            .collect();
        (
            tracker.events_seen,
            game,
            can_act,
            actions.into_iter().map(LegalAction::from).collect(),
            riichi_discards,
        )
    };
    let capture = state.capture_control.lock().await.status.clone();
    let config = state.config.read().await;
    let transport_connected = config.capture.mode != crate::config::CaptureMode::Mitm
        || config.platform.kind != crate::config::Platform::Majsoul
        || crate::proxy::game_transport::connected();
    drop(config);
    let live = matches!(capture, CaptureStatus::Running { .. }) && transport_connected;
    let response = if live && can_act {
        response_for_revision(cache.0.read().await.clone(), revision)
    } else {
        None
    };
    let analysis = if live && game.as_ref().is_some_and(|g| !g.is_done) {
        state
            .analysis_cache
            .read()
            .await
            .clone()
            .filter(|a| a.revision == revision)
    } else {
        None
    };
    let bot_status = state.bot_status.read().await.clone();
    let frame = ImmersiveFrame {
        revision,
        game,
        can_act: can_act && live,
        legal_actions,
        riichi_discards,
        transport_connected,
        response,
        analysis,
        capture,
        bot_status,
    };
    diagnostic(&frame);
    Ok(frame)
}

// Opt-in numeric boundary evidence; excludes hand identities and credentials.
fn diagnostic(frame: &ImmersiveFrame) {
    use std::sync::{
        atomic::{AtomicI64, Ordering},
        OnceLock,
    };
    static PATH: OnceLock<Option<std::path::PathBuf>> = OnceLock::new();
    static LAST: AtomicI64 = AtomicI64::new(0);
    let Some(path) = PATH.get_or_init(|| {
        std::env::var_os("AKAGI_HUD_CONTOUR_DIAGNOSTICS")
            .map(|p| std::path::PathBuf::from(p).with_extension("frame.json"))
    }) else {
        return;
    };
    let now = chrono::Utc::now().timestamp_millis();
    let previous = LAST.load(Ordering::Relaxed);
    if now - previous < 1000
        || LAST
            .compare_exchange(previous, now, Ordering::Relaxed, Ordering::Relaxed)
            .is_err()
    {
        return;
    }
    let summary = serde_json::json!({"sampled_at":chrono::Utc::now().to_rfc3339(),"revision":frame.revision,"can_act":frame.can_act,"done":frame.game.as_ref().map(|g| g.is_done),"legal":frame.legal_actions.iter().map(|a| a.kind).collect::<Vec<_>>(),"response_revision":frame.response.as_ref().and_then(response_revision),"transport":frame.transport_connected});
    let _ = std::fs::write(path, summary.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::MjaiEvent;
    fn response(revision: u64) -> BotResponse {
        BotResponse {
            action: MjaiEvent::None,
            meta: Some(serde_json::json!({"akagi_revision": revision})),
        }
    }
    #[test]
    fn immersive_rejects_late_future_and_untagged_results() {
        for rev in [11, 13] {
            assert!(response_for_revision(Some(response(rev)), 12).is_none());
        }
        assert!(response_for_revision(Some(response(12)), 12).is_some());
        assert!(response_for_revision(
            Some(BotResponse {
                action: MjaiEvent::None,
                meta: None
            }),
            12
        )
        .is_none());
    }
    #[tokio::test]
    async fn immersive_cache_never_rewinds() {
        let cache = ImmersiveCache::default();
        cache.store(&response(13)).await;
        cache.store(&response(12)).await;
        assert_eq!(
            response_revision(cache.0.read().await.as_ref().unwrap()),
            Some(13)
        );
    }
}
