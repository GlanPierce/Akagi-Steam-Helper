//! Backend ↔ frontend integration over Tauri.
//!
//! Two halves wired together by [`install`]:
//!
//! - **Outbound (backend → frontend)**: forwarder tasks subscribe to each
//!   `event_bus` channel and `app.emit()` the payload to every webview.
//!   Status buses additionally mirror the latest value into `AppState`
//!   so a fresh frontend can ask `get_status` for a snapshot.
//! - **Inbound (frontend → backend)**: `#[tauri::command]` handlers in
//!   [`commands`]; register them via the `ipc_handlers!()` macro on the
//!   `tauri::Builder`.
//!
//! Wiring example (in `lib.rs`):
//!
//! ```ignore
//! tauri::Builder::default()
//!     .invoke_handler(akagi::ipc_handlers!())
//!     .setup(move |app| {
//!         akagi::ipc::install(&app.handle(), state.clone())?;
//!         // …rest of setup
//!         Ok(())
//!     })
//!     .run(tauri::generate_context!())?;
//! ```
//!
//! Event names (kebab-case, Tauri convention):
//!
//! | Event             | Payload type                  |
//! |-------------------|-------------------------------|
//! | `mjai-event`       | `schema::MjaiEvent`           |
//! | `bot-response`     | `bot::BotResponse`            |
//! | `bot-status`       | `schema::BotStatus`           |
//! | `capture-status`   | `schema::CaptureStatus`       |
//! | `notify`           | `schema::Notification`        |
//! | `analysis-result`  | `analysis::AnalysisResult`    |
//! | `history-recorded` | `schema::HistoryEvent`        |
//! | `overlay-config`   | `config::OverlayConfig`       |
//!
//! All of the above are broadcast to every webview, which is what lets the
//! [`overlay`] window render suggestions without any dedicated plumbing.
//! `overlay-config` is the exception: it is emitted to the overlay label only.

pub mod capture_supervisor;
pub mod commands;
pub mod model_presets;
pub mod immersive;
pub mod immersive_contours;
mod immersive_templates;
pub mod immersive_host;
#[cfg(windows)]
mod immersive_windows;
#[cfg(windows)]
mod immersive_input;
#[cfg(windows)]
mod immersive_capture;
pub mod overlay;
#[cfg(windows)]
pub mod tray;
pub mod state;

pub use state::AppState;

use anyhow::Result;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::broadcast;
use tracing::warn;

/// Manage `state` on the Tauri app and spawn the five forwarder tasks.
/// Call from inside the builder's `.setup` closure.
pub fn install<R: Runtime>(app: &AppHandle<R>, state: AppState) -> Result<()> {
    app.manage(state.clone());
    app.manage(immersive::ImmersiveCache::default());
    let host: immersive_host::SharedHost = std::sync::Arc::new(immersive_host::HostControl::default());
    *state.autoplay_context.steam.write().unwrap_or_else(|e|e.into_inner()) = Some(crate::autoplay::steam::SteamTarget {
        host:host.clone(),cache:app.state::<immersive::ImmersiveCache>().inner().clone(),capture:state.capture_control.clone(),
    });
    app.manage(host.clone());
    #[cfg(windows)]
    immersive_windows::start(app.clone(), host);
    spawn_forwarders(app.clone(), state);
    Ok(())
}

fn spawn_forwarders<R: Runtime>(app: AppHandle<R>, state: AppState) {
    forward(app.clone(), state.mjai_bus.subscribe(), "mjai-event");
    forward(
        app.clone(),
        state.post_tracker_bus.subscribe(),
        "immersive-event",
    );
    let mut responses = state.bot_response_bus.subscribe();
    let cache = app.state::<immersive::ImmersiveCache>().inner().clone();
    let response_app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match responses.recv().await {
                Ok(response) => {
                    cache.store(&response).await;
                    let _ = response_app.emit("bot-response", &response);
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    *cache.0.write().await = None;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
    forward(app.clone(), state.notify_bus.subscribe(), "notify");
    forward(
        app.clone(),
        state.analysis_bus.subscribe(),
        "analysis-result",
    );
    forward(
        app.clone(),
        state.history_bus.subscribe(),
        "history-recorded",
    );

    // Status buses: forward AND snapshot into AppState.
    spawn_bot_status_forwarder(app.clone(), state.clone());
    spawn_capture_status_forwarder(app, state);
}

/// Plain forwarder: subscribe, drain, emit. `Lagged` is logged once and
/// the loop continues (broadcast auto-resumes after lag).
fn forward<R, T>(app: AppHandle<R>, mut rx: broadcast::Receiver<T>, event: &'static str)
where
    R: Runtime,
    T: Clone + serde::Serialize + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(payload) => {
                    if let Err(e) = app.emit(event, &payload) {
                        warn!("ipc emit {event} failed: {e}");
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    warn!("ipc forwarder {event} lagged by {n}");
                }
                Err(broadcast::error::RecvError::Closed) => return,
            }
        }
    });
}

fn spawn_bot_status_forwarder<R: Runtime>(app: AppHandle<R>, state: AppState) {
    let mut rx = state.bot_status_bus.subscribe();
    let snapshot = state.bot_status.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(s) => {
                    *snapshot.write().await = s.clone();
                    if let Err(e) = app.emit("bot-status", &s) {
                        warn!("ipc emit bot-status failed: {e}");
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    warn!("ipc forwarder bot-status lagged by {n}");
                }
                Err(broadcast::error::RecvError::Closed) => return,
            }
        }
    });
}

fn spawn_capture_status_forwarder<R: Runtime>(app: AppHandle<R>, state: AppState) {
    let mut rx = state.capture_status_bus.subscribe();
    let control = state.capture_control.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(s) => {
                    control.lock().await.status = s.clone();
                    if let Err(e) = app.emit("capture-status", &s) {
                        warn!("ipc emit capture-status failed: {e}");
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    warn!("ipc forwarder capture-status lagged by {n}");
                }
                Err(broadcast::error::RecvError::Closed) => return,
            }
        }
    });
}
