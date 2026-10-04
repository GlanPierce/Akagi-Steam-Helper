//! Samples only the visible foreground game, keeps pixels in memory, exports vector contours.
use super::{
    immersive_contours::{self, ContourFrame},
    immersive_host::{self, SharedHost},
    overlay,
};
use std::{
    ptr,
    sync::atomic::Ordering,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Runtime};
use windows_sys::Win32::{
    Foundation::{HWND, POINT},
    Graphics::Gdi::*,
    UI::{
        HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2},
        WindowsAndMessaging::{GetForegroundWindow, IsIconic, IsWindow},
    },
};

struct Buffer {
    dc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
    pixels: *mut u8,
    width: i32,
    height: i32,
}
impl Buffer {
    unsafe fn new(width: i32, height: i32) -> Option<Self> {
        if !(160..=3840).contains(&width) || !(90..=2160).contains(&height) {
            return None;
        }
        let dc = CreateCompatibleDC(ptr::null_mut());
        if dc.is_null() {
            return None;
        }
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = ptr::null_mut();
        let bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &mut pixels, ptr::null_mut(), 0);
        if bitmap.is_null() || pixels.is_null() {
            if !bitmap.is_null() {
                DeleteObject(bitmap);
            }
            DeleteDC(dc);
            return None;
        }
        let previous = SelectObject(dc, bitmap);
        if previous.is_null() || previous as isize == -1 {
            DeleteObject(bitmap);
            DeleteDC(dc);
            return None;
        }
        Some(Self {
            dc,
            bitmap,
            previous,
            pixels: pixels.cast(),
            width,
            height,
        })
    }
    #[cfg(test)]
    unsafe fn sample(
        &mut self,
        game: HWND,
        x: i32,
        y: i32,
        source_width: i32,
        source_height: i32,
    ) -> Option<&[u8]> {
        self.sample_region(
            game,
            x,
            y,
            source_width,
            source_height,
            [0, 0, self.width as usize, self.height as usize],
        )
    }
    unsafe fn sample_region(
        &mut self,
        game: HWND,
        x: i32,
        y: i32,
        source_width: i32,
        source_height: i32,
        roi: [usize; 4],
    ) -> Option<&[u8]> {
        let mut origin = POINT { x, y };
        if ClientToScreen(game, &mut origin) == 0 {
            return None;
        }
        let source = GetDC(ptr::null_mut());
        if source.is_null() {
            return None;
        }
        // Copy the currently composed client area. GetDC(game) + SRCCOPY can
        // return an old backing surface for this Unity swap chain underneath
        // a layered window (including a tile's pre-hover position).
        // CAPTUREBLT is required for fresh desktop composition. Detection
        // tolerates the thin HUD strokes instead of assuming they are absent.
        let ok = if self.width == source_width && self.height == source_height {
            BitBlt(
                self.dc,
                roi[0] as i32,
                roi[1] as i32,
                (roi[2] - roi[0]) as i32,
                (roi[3] - roi[1]) as i32,
                source,
                origin.x + roi[0] as i32,
                origin.y + roi[1] as i32,
                SRCCOPY | CAPTUREBLT,
            )
        } else {
            SetStretchBltMode(self.dc, COLORONCOLOR);
            StretchBlt(
                self.dc,
                0,
                0,
                self.width,
                self.height,
                source,
                origin.x,
                origin.y,
                source_width,
                source_height,
                SRCCOPY | CAPTUREBLT,
            )
        };
        ReleaseDC(ptr::null_mut(), source);
        if ok == 0 || GdiFlush() == 0 {
            return None;
        }
        Some(std::slice::from_raw_parts(
            self.pixels,
            self.width as usize * self.height as usize * 4,
        ))
    }
}
impl Drop for Buffer {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.previous);
            DeleteObject(self.bitmap);
            DeleteDC(self.dc);
        }
    }
}

pub fn start<R: Runtime>(app: AppHandle<R>, host: SharedHost) {
    std::thread::Builder::new().name("steam-hud-contours".into()).spawn(move || {
        unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2); }
        let mut buffer: Option<Buffer> = None;
        let diagnostics = std::env::var_os("AKAGI_HUD_CONTOUR_DIAGNOSTICS").map(std::path::PathBuf::from);
        let mut last_diagnostic = Instant::now();
        let mut sequence = 0u64;
        let mut previous_frame: Option<(immersive_host::GameSurface, ContourFrame)> = None;
        let mut next_tick = Instant::now();
        loop {
            // Missed deadlines still yield CPU to the game; processing time
            // consumes the frame budget instead of adding a fixed 40ms delay.
            std::thread::sleep(next_tick.saturating_duration_since(Instant::now()).max(Duration::from_millis(2)));
            next_tick = Instant::now() + Duration::from_millis(16);
            let (request, surface, generation) = { let state = host.vision.lock().unwrap_or_else(|e| e.into_inner()); (state.request.clone(), state.surface, state.generation) };
            let active = host.enabled.load(Ordering::Relaxed) && host.foreground.load(Ordering::Relaxed) && !host.panel.load(Ordering::Relaxed) && !host.hints_hidden.load(Ordering::Relaxed) && surface.is_some() && !request.targets.is_empty();
            if !active {
                next_tick = Instant::now() + Duration::from_millis(40);
                previous_frame = None;
                if let Some(path) = &diagnostics {
                    if last_diagnostic.elapsed() > Duration::from_secs(1) {
                        let summary = serde_json::json!({"sampled_at":chrono::Utc::now().to_rfc3339(),"captured":false,"foreground":host.foreground.load(Ordering::Relaxed),"panel":host.panel.load(Ordering::Relaxed),"targets":request.targets.iter().map(|t| &t.id).collect::<Vec<_>>(),"shapes":[]});
                        let _ = std::fs::write(path,summary.to_string()); last_diagnostic=Instant::now();
                    }
                }
                continue;
            }
            let Some(surface) = surface else { continue; };
            let game = surface.hwnd as HWND;
            if unsafe { GetForegroundWindow() != game || IsWindow(game) == 0 || IsIconic(game) != 0 } { continue; }
            let (x,y,w,h) = immersive_host::content_rect(surface.width as f64, surface.height as f64);
            let (source_width,source_height)=(w.round() as i32,h.round() as i32);
            let downscale=(w/3840.0).max(h/2160.0).max(1.0);
            let (w,h) = ((w/downscale).round() as i32, (h/downscale).round() as i32);
            if buffer.as_ref().is_none_or(|b| b.width != w || b.height != h) { buffer = unsafe { Buffer::new(w,h) }; }
            let started = Instant::now();
            let mut frame = ContourFrame { key: request.key.clone(), generation, shapes: vec![] };
            let mut captured = false;
            let mut fingerprint = 0u64;
            let mut capture_ms = 0;
            let roi = immersive_contours::capture_roi(w as usize,h as usize,&request);
            if let Some(pixels) = roi.and_then(|roi| buffer.as_mut().and_then(|b| unsafe { b.sample_region(game,x.round() as i32,y.round() as i32,source_width,source_height,roi) })) {
                capture_ms = started.elapsed().as_millis();
                captured = true;
                fingerprint = pixels.iter().step_by(509).fold(0xcbf29ce484222325u64, |h, p| (h ^ *p as u64).wrapping_mul(0x100000001b3));
                frame = immersive_contours::detect(pixels,w as usize,h as usize,&request);
                frame.generation = generation;
            }
            // A result must still refer to the current viewport, decision and selector.
            let current = { let state = host.vision.lock().unwrap_or_else(|e| e.into_inner()); state.surface == Some(surface) && state.generation == generation && state.request.key == request.key };
            if !current || unsafe { GetForegroundWindow() } != game || host.panel.load(Ordering::Relaxed) || host.hints_hidden.load(Ordering::Relaxed) { continue; }
            if let Some((old_surface,old)) = &previous_frame {
                if *old_surface == surface { immersive_contours::stabilize(&mut frame,old,w as usize); }
            }
            previous_frame = Some((surface, frame.clone()));
            if let Some(path) = &diagnostics {
                if last_diagnostic.elapsed() > Duration::from_secs(1) {
                    // Opt-in local QA: geometry/counts only, never pixels, tile identities or auth data.
                    sequence += 1;
                    let revision = serde_json::from_str::<serde_json::Value>(&request.key).ok().and_then(|v| v[0].as_u64());
                    let summary = serde_json::json!({"sampled_at":chrono::Utc::now().to_rfc3339(),"sequence":sequence,"source":"composed-client","generation":generation,"revision":revision,"fingerprint":format!("{fingerprint:016x}"),"captured":captured,"milliseconds":started.elapsed().as_millis(),"capture_ms":capture_ms,"capture_roi":roi,"width":w,"height":h,"targets":request.targets.iter().map(|t| &t.id).collect::<Vec<_>>(),"shapes":frame.shapes.iter().map(|s| serde_json::json!({"id":s.id,"bounds":s.bounds,"paths":s.paths.len(),"vertices":s.paths.iter().map(Vec::len).sum::<usize>()})).collect::<Vec<_>>()});
                    let _ = std::fs::write(path, summary.to_string()); last_diagnostic = Instant::now();
                }
            }
            let _ = app.emit_to(overlay::LABEL,"immersive-contours",frame);
        }
    }).expect("spawn Steam HUD contour tracking");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::immersive_contours::{ContourRequest, VisualTarget};
    use windows_sys::Win32::{Foundation::RECT, UI::WindowsAndMessaging::GetClientRect};

    // Explicit local integration check of this product's capture backend.
    // Exports only counts/bounds; never images, OCR, game identities or input.
    #[test]
    #[ignore = "requires the foreground Steam game for opt-in capture QA"]
    fn composed_client_geometry_diagnostic() {
        assert_eq!(std::env::var("AKAGI_HUD_CAPTURE_QA").as_deref(), Ok("1"));
        unsafe {
            SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
            let game = GetForegroundWindow();
            assert!(
                super::super::immersive_windows::is_game_window(game),
                "foreground must be the Steam game"
            );
            let mut rect = RECT::default();
            assert_ne!(GetClientRect(game, &mut rect), 0);
            let (x, y, w, h) = immersive_host::content_rect(rect.right as f64, rect.bottom as f64);
            assert_eq!(
                (w, h),
                (1920.0, 1080.0),
                "diagnostic expects the user's 1080p game"
            );
            let mut buffer = Buffer::new(1920, 1080).unwrap();
            let mut origin = POINT {
                x: x as i32,
                y: y as i32,
            };
            ClientToScreen(game, &mut origin);
            println!("client_origin={},{}", origin.x, origin.y);
            let mode = std::env::var("AKAGI_HUD_CAPTURE_QA_MODE").unwrap_or_default();
            if mode == "legacy-window" {
                let dc = GetDC(game);
                assert!(!dc.is_null());
                assert_ne!(
                    BitBlt(buffer.dc, 0, 0, 1920, 1080, dc, x as i32, y as i32, SRCCOPY),
                    0
                );
                ReleaseDC(game, dc);
                GdiFlush();
            }
            let p = if mode == "legacy-window" {
                std::slice::from_raw_parts(buffer.pixels, 1920 * 1080 * 4)
            } else {
                buffer.sample(game, x as i32, y as i32, 1920, 1080).unwrap()
            };
            let reference = std::fs::read(
                std::env::var_os("AKAGI_HUD_CAPTURE_REFERENCE")
                    .expect("BGRA reference from the game's current Steam screenshot"),
            )
            .unwrap();
            assert_eq!(reference.len(), p.len());
            let error = p
                .chunks_exact(4)
                .zip(reference.chunks_exact(4))
                .map(|(a, b)| {
                    (0..3)
                        .map(|c| (a[c] as f64 - b[c] as f64).abs())
                        .sum::<f64>()
                })
                .sum::<f64>()
                / (1920.0 * 1080.0 * 3.0);
            println!("RGB mean error against current game screenshot: {error:.2}");
            assert!(
                error < 12.0,
                "capture must match the current game, not its cached backing surface"
            );
            println!(
                "minmax={:?} hand_components={:?}",
                (p.iter().step_by(4).min(), p.iter().step_by(4).max()),
                immersive_contours::hand_components_for_diagnostic(p, 1920, 1080)
            );
            for count in [13, 14] {
                let targets = (0..count)
                    .map(|i| VisualTarget {
                        id: format!("tile-{i}"),
                        kind: "tile".into(),
                        x: 2.23125 + i as f64 * 0.790625 + if i == 13 { 0.246875 } else { 0.0 },
                        y: 8.3625,
                        w: 0.762,
                        h: 1.19,
                    })
                    .collect();
                let frame = immersive_contours::detect(
                    p,
                    1920,
                    1080,
                    &ContourRequest {
                        key: "capture-qa".into(),
                        targets,
                    },
                );
                println!(
                    "requested={count} detected={} bounds={:?}",
                    frame.shapes.len(),
                    frame.shapes.iter().map(|s| s.bounds).collect::<Vec<_>>()
                );
            }
        }
    }
}
