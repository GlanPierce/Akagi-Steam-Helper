//! Read-only game-window following. No injection, rendering hooks or input automation.
use super::{
    immersive_host::{self, SharedHost},
    overlay,
};
use std::{
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Runtime, WebviewWindow};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT},
    Graphics::Gdi::ClientToScreen,
    System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::{
        HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2},
        Input::KeyboardAndMouse::{
            GetAsyncKeyState, VK_CONTROL, VK_ESCAPE, VK_LBUTTON, VK_MENU, VK_RBUTTON, VK_SHIFT,
            VK_SPACE, VK_MBUTTON,
        },
        WindowsAndMessaging::*,
    },
};

unsafe extern "system" fn find_game(hwnd: HWND, context: LPARAM) -> i32 {
    if is_game_window(hwnd) {
        *(context as *mut HWND) = hwnd;
        return 0;
    }
    1
}

pub(super) unsafe fn is_game_window(hwnd: HWND) -> bool {
    if IsWindowVisible(hwnd) == 0 {
        return false;
    }
    let mut pid = 0;
    GetWindowThreadProcessId(hwnd, &mut pid);
    let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if process.is_null() {
        return false;
    }
    let mut path = [0u16; 32768];
    let mut length = path.len() as u32;
    let ok = QueryFullProcessImageNameW(process, 0, path.as_mut_ptr(), &mut length);
    CloseHandle(process);
    ok != 0
        && String::from_utf16_lossy(&path[..length as usize])
            .rsplit('\\')
            .next()
            .is_some_and(|s| s.eq_ignore_ascii_case("Jantama_MahjongSoul.exe"))
}
fn down(key: u16) -> bool {
    unsafe { GetAsyncKeyState(key as i32) < 0 }
}

fn schedule_overlay_state<R: Runtime>(
    window: WebviewWindow<R>,
    host: SharedHost,
    expected_hwnd: usize,
    game: usize,
    state: immersive_host::HostState,
    previous: Option<immersive_host::HostState>,
) -> tauri::Result<()> {
    let dispatcher = window.clone();
    let panel_changed = previous.map(|s| s.panel) != Some(state.panel);
    if panel_changed { tracing::info!(panel=state.panel, "HUD menu transition queued"); }
    dispatcher.run_on_main_thread(move || {
        // A closed/recreated host or a newer menu/focus state supersedes this
        // queued work. Never show an old window after its host has been hidden.
        if !host.enabled.load(Ordering::Relaxed) || host.snapshot() != state {
            if panel_changed { tracing::info!(panel=state.panel, "HUD menu transition superseded"); }
            return;
        }
        let Ok(native) = window.hwnd() else {
            if panel_changed { tracing::info!(panel=state.panel, "HUD menu transition skipped: window closed"); }
            return;
        };
        if native.0 as usize != expected_hwnd {
            if panel_changed { tracing::info!(panel=state.panel, "HUD menu transition skipped: window replaced"); }
            return;
        }
        let hwnd = native.0 as HWND;
        let game = game as HWND;
        unsafe {
            let foreground = GetForegroundWindow();
            let owned = foreground == hwnd || (!foreground.is_null() && GetAncestor(foreground, GA_ROOTOWNER) == hwnd);
            if state.foreground && (game.is_null() || IsWindow(game) == 0 || IsIconic(game) != 0
                || !(foreground == game || owned)) {
                if panel_changed { tracing::info!(panel=state.panel, "HUD menu transition skipped: game lost foreground"); }
                return;
            }
        }
        // Tauri may rewrite extended styles when cursor passthrough changes.
        // Apply its update first, then the host's no-activation policy, all on
        // the thread that owns the HWND and without a host mutex held.
        let accepts_input = state.foreground && state.panel;
        if let Err(error) = window.set_ignore_cursor_events(!accepts_input) {
            tracing::warn!(%error, "HUD cursor passthrough update failed");
            return;
        }
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
            let style = if state.panel { style & !WS_EX_NOACTIVATE } else { style | WS_EX_NOACTIVATE };
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style as isize);
            SetWindowPos(hwnd, std::ptr::null_mut(), 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
            ShowWindow(hwnd, if state.foreground { SW_SHOWNOACTIVATE } else { SW_HIDE });
            // Previous is the last queued state, which may have been skipped.
            // Consult the real foreground when deciding whether focus is due.
            let foreground = GetForegroundWindow();
            if state.panel && foreground != hwnd { SetForegroundWindow(hwnd); }
            else if !state.panel && foreground == hwnd && state.foreground { SetForegroundWindow(game); }
        }
        if panel_changed { tracing::info!(panel=state.panel, "HUD menu transition applied"); }
        let _ = window.emit_to(overlay::LABEL, "immersive-host", state);
    })
}

pub fn start<R: Runtime>(app: AppHandle<R>, host: SharedHost) {
    super::immersive_capture::start(app.clone(), host.clone());
    std::thread::Builder::new().name("steam-hud-host".into()).spawn(move || {
        unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2); }
        let mut game: HWND = std::ptr::null_mut();
        let mut last_search = Instant::now() - Duration::from_secs(2);
        let mut previous = None;
        let mut previous_rect = None;
        let mut previous_hwnd = 0usize;
        let mut capture_ready = false;
        let mut input: Option<super::immersive_input::InputPlane<R>> = None;
        let mut keys = [false; 4];
        let mut tray_menu_deadline = None;
        loop {
            std::thread::sleep(Duration::from_millis(16));
            super::immersive_input::InputPlane::<R>::pump();
            let Some(window) = overlay::get(&app) else {
                if host.autoplay.load(Ordering::SeqCst) {host.stop_autoplay();}
                input=None; previous_hwnd=0; continue
            };
            if !host.enabled.load(Ordering::Relaxed) { input=None; previous_hwnd=0; previous = None; previous_rect = None; tray_menu_deadline = None; continue; }
            let Ok(native) = window.hwnd() else { if let Some(input)=input.as_mut() {input.hide();} continue };
            let hwnd = native.0 as HWND;
            if previous_hwnd != hwnd as usize {
                previous = None; previous_rect = None; previous_hwnd = hwnd as usize;
                capture_ready = false;
                input = super::immersive_input::InputPlane::new(app.clone(),hwnd);
                if input.is_none() { tracing::warn!("HUD native controls unavailable; keyboard menu remains available"); }
            }
            let tray_menu_requested = host.take_panel_request();
            if tray_menu_requested || last_search.elapsed() > Duration::from_secs(1) {
                game = std::ptr::null_mut();
                unsafe { EnumWindows(Some(find_game), &mut game as *mut HWND as LPARAM); }
                last_search = Instant::now();
            }
            if tray_menu_requested && !game.is_null() && unsafe { IsWindow(game) } != 0 {
                // Restoring a minimized game is asynchronous. Allow the normal
                // foreground checks below to observe the restored window.
                unsafe {
                    if IsIconic(game) != 0 { ShowWindowAsync(game, SW_RESTORE); }
                    SetForegroundWindow(game);
                }
                tray_menu_deadline = Some(Instant::now() + Duration::from_secs(1));
            } else if tray_menu_requested {
                tracing::info!("tray menu requested without a running Steam game");
            }
            let mut foreground = unsafe { GetForegroundWindow() };
            if let Some(deadline) = tray_menu_deadline {
                if foreground == game && !game.is_null() && unsafe { IsIconic(game) } == 0 {
                    host.panel.store(true, Ordering::Relaxed);
                    tray_menu_deadline = None;
                } else if Instant::now() >= deadline {
                    tray_menu_deadline = None;
                    tracing::warn!("tray menu request expired before game activation");
                }
            }
            let panel = host.panel.load(Ordering::Relaxed);
            let valid = !game.is_null() && unsafe { IsWindow(game) } != 0;
            let overlay_owned = foreground == hwnd || (!foreground.is_null() && unsafe { GetAncestor(foreground, GA_ROOTOWNER) } == hwnd);
            // Closing with the drawer button changes panel before this loop;
            // return focus before computing visibility, otherwise the overlay
            // would hide while leaving Windows to activate an arbitrary app.
            if valid && overlay_owned && !panel && previous.is_some_and(|s: immersive_host::HostState| s.panel) {
                unsafe { SetForegroundWindow(game); }
                foreground = unsafe { GetForegroundWindow() };
            }
            let visible = immersive_host::visible(valid, valid && unsafe { IsIconic(game) } != 0, foreground == game, overlay_owned, panel);
            host.foreground.store(visible, Ordering::Relaxed);
            if !visible {
                if host.autoplay.load(Ordering::SeqCst) {host.stop_autoplay();}
                host.panel.store(false, Ordering::Relaxed); host.vision.lock().unwrap_or_else(|e| e.into_inner()).surface = None;
            }
            let pressed = [down(VK_SPACE), down(VK_ESCAPE), down(VK_LBUTTON), down(VK_RBUTTON)];
            if !pressed[2] && !pressed[3] && input.as_ref().is_some_and(|input|input.holding()) {
                // A non-activating window may not receive release outside its
                // region. Drain queued releases, then fail closed on key-up.
                super::immersive_input::InputPlane::<R>::pump();
                if let Some(input)=input.as_mut() {input.cancel_press();}
            }
            if immersive_host::accepts_shortcuts(visible, foreground == game, foreground == hwnd) {
                // Track the physical Space edge, not each modifier combination:
                // releasing Shift while holding Space must not toggle guidance.
                match immersive_host::space_shortcut(pressed[0], keys[0], down(VK_CONTROL), down(VK_SHIFT), down(VK_MENU)) {
                    Some(immersive_host::SpaceShortcut::Guidance) => { host.toggle_guidance(); }
                    Some(immersive_host::SpaceShortcut::Menu) => { host.panel.fetch_xor(true, Ordering::Relaxed); }
                    None => {}
                }
                if pressed[1] && !keys[1] {
                    host.panel.store(false, Ordering::Relaxed);
                    let _ = app.emit_to(overlay::LABEL, "immersive-cancel", ());
                }
            }
            let state = host.snapshot();
            if !state.foreground || state.panel { if let Some(input)=input.as_mut() {input.hide();} }
            if previous != Some(state) {
                match schedule_overlay_state(window.clone(), host.clone(), hwnd as usize, game as usize, state, previous) {
                    Ok(()) => previous = Some(state),
                    Err(error) => tracing::warn!(%error, "HUD native state scheduling failed"),
                }
            }
            let mut hotspot = false;
            if visible {
                let mut rect = RECT::default(); let mut origin = POINT::default();
                if unsafe { GetClientRect(game, &mut rect) } != 0 && unsafe { ClientToScreen(game, &mut origin) } != 0 && rect.right > 0 && rect.bottom > 0 {
                    let bounds = (origin.x, origin.y, rect.right, rect.bottom);
                    // The capture worker uses the currently composed client
                    // area. Layered is an input/style readiness check only;
                    // it does not guarantee that the HUD is absent in pixels.
                    let layered = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 } & WS_EX_LAYERED != 0;
                    let ready = layered && !state.panel;
                    if ready && !capture_ready { tracing::info!("HUD contour sampling ready (composed client area)"); }
                    capture_ready = ready;
                    host.vision.lock().unwrap_or_else(|e| e.into_inner()).surface = if ready { Some(immersive_host::GameSurface { hwnd: game as usize, width: rect.right, height: rect.bottom }) } else { None };
                    if previous_rect != Some(bounds) {
                        unsafe { SetWindowPos(hwnd, HWND_TOPMOST, bounds.0, bounds.1, bounds.2, bounds.3, SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS); }
                        previous_rect = Some(bounds);
                    }
                    let mut point = POINT::default();
                    let cursor_ok = unsafe { GetCursorPos(&mut point) } != 0;
                    if cursor_ok && !state.panel {
                        let regions = host.hotspots.lock().unwrap_or_else(|e| e.into_inner());
                        let aspect = rect.right as f64 / rect.bottom as f64;
                        hotspot = (regions.aspect-aspect).abs() < 0.002 && immersive_host::hotspot_hit(&regions.regions,
                            (point.x-origin.x) as f64/rect.right as f64,
                            (point.y-origin.y) as f64/rect.bottom as f64);
                    }
                    let hud_press = input.as_ref().is_some_and(|input|input.holding());
                    if !state.panel && !hotspot && !hud_press && ((pressed[2] && !keys[2]) || (pressed[3] && !keys[3])) {
                        if cursor_ok {
                            let (x, y, width, _) = immersive_host::content_rect(rect.right as f64, rect.bottom as f64);
                            let unit = width / 16.0;
                            let x = (point.x as f64 - origin.x as f64 - x) / unit;
                            let y = (point.y as f64 - origin.y as f64 - y) / unit;
                            if (0.0..=16.0).contains(&x) && (0.0..=9.0).contains(&y) {
                                let _ = app.emit_to(overlay::LABEL, "immersive-click", serde_json::json!({"x": x, "y": y, "button": if pressed[3] { "right" } else { "left" }}));
                            }
                        }
                    }
                    if let Some(input)=input.as_mut() {
                        // A press that started in the game keeps the input
                        // plane hidden even if the drag crosses a HUD control.
                        if !state.panel && (!(pressed[2] || pressed[3] || down(VK_MBUTTON)) || input.holding()) {
                            let hotspots = {
                                let regions = host.hotspots.lock().unwrap_or_else(|e|e.into_inner());
                                immersive_host::HudHotspots {generation:regions.generation,aspect:regions.aspect,regions:regions.regions.clone()}
                            };
                            input.update(bounds,&hotspots);
                        } else { input.hide(); }
                    }
                } else {
                    if let Some(input)=input.as_mut() {input.hide();}
                    host.vision.lock().unwrap_or_else(|e|e.into_inner()).surface = None;
                }
            }
            keys = pressed;
        }
    }).expect("spawn Steam HUD host");
}
