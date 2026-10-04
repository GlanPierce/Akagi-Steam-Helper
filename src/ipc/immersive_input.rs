//! Region-limited input surface for HUD controls. The visual HUD remains
//! click-through: this window exists only inside the published control bounds.
use super::immersive_host::{self, HudHotspots};
use std::ptr::null_mut;
use tauri::{AppHandle, Emitter, Runtime};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    Graphics::Gdi::{CombineRgn, CreateRectRgn, DeleteObject, GetStockObject, SetWindowRgn, BLACK_BRUSH, RGN_OR},
    UI::{Input::KeyboardAndMouse::{GetCapture, ReleaseCapture, SetCapture}, WindowsAndMessaging::*},
};

#[derive(Clone, Copy)]
struct InputPress {
    generation: u64,
    right: bool,
    region: [i32; 4],
}
fn contains(region: &[i32; 4], x: i32, y: i32) -> bool {
    x >= region[0] && x < region[2] && y >= region[1] && y < region[3]
}
fn press_region(regions: &[[i32; 4]], x: i32, y: i32) -> Option<[i32; 4]> {
    // HUD siblings are published in DOM paint order. Native 110px toggle
    // boxes are only 108px apart, so their glow boxes overlap. Match the
    // later/topmost control selected by document.elementFromPoint.
    regions.iter().rev().find(|r| contains(r,x,y)).copied()
}
impl InputPress {
    fn accepts_release(&self, generation: u64, right: bool, x: i32, y: i32) -> bool {
        self.generation == generation && self.right == right && contains(&self.region,x,y)
    }
    fn cancel_event(&self) -> serde_json::Value {
        serde_json::json!({"generation":self.generation,"phase":"cancel","x":0,"y":0,"button":if self.right {"right"} else {"left"}})
    }
}
struct InputState<R: Runtime> {
    app: AppHandle<R>,
    generation: u64,
    width: i32,
    height: i32,
    regions: Vec<[i32; 4]>,
    press: Option<InputPress>,
}
impl<R: Runtime> InputState<R> {
    fn cancel_press(&mut self) {
        if let Some(press) = self.press.take() {
            let _ = self.app.emit_to(super::overlay::LABEL,"immersive-hud-pointer",press.cancel_event());
        }
    }
}
unsafe extern "system" fn input_proc<R: Runtime>(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut InputState<R>;
    if !ptr.is_null() {
        let state = &mut *ptr;
        match msg {
            WM_MOUSEACTIVATE => return MA_NOACTIVATE as LRESULT,
            WM_LBUTTONDOWN | WM_RBUTTONDOWN => {
                state.cancel_press();
                let generation = state.generation;
                let x = (l as u16 as i16) as i32;
                let y = ((l >> 16) as u16 as i16) as i32;
                let Some(region) = press_region(&state.regions,x,y) else {return 0;};
                let right = msg==WM_RBUTTONDOWN;
                SetCapture(hwnd);
                // Capture failure must not leave a synthetic held press.
                if GetCapture()==hwnd {
                    let state = &mut *ptr;
                    state.press = Some(InputPress {generation,right,region});
                    let _ = state.app.emit_to(super::overlay::LABEL,"immersive-hud-pointer",serde_json::json!({
                        "generation":generation,"phase":"down","x":x as f64/state.width as f64,"y":y as f64/state.height as f64,
                        "button":if right {"right"} else {"left"},
                    }));
                }
                return 0;
            }
            WM_LBUTTONUP | WM_RBUTTONUP => {
                let press = state.press.take();
                let x = (l as u16 as i16) as i32;
                let y = ((l >> 16) as u16 as i16) as i32;
                let right = msg==WM_RBUTTONUP;
                let click = press.is_some_and(|p| p.accepts_release(state.generation,right,x,y)).then(|| serde_json::json!({
                        "generation":state.generation, "x":x as f64/state.width as f64, "y":y as f64/state.height as f64,
                        "button":if right {"right"} else {"left"},
                    }));
                let app = state.app.clone();
                ReleaseCapture();
                if let Some(click) = click {
                    tracing::info!(button=if right {"right"} else {"left"}, "HUD native control click");
                    if let Err(error) = app.emit_to(super::overlay::LABEL, "immersive-hud-click", click) {
                        tracing::warn!(%error, "HUD native control dispatch failed");
                    }
                } else if let Some(press) = press {
                    let _ = app.emit_to(super::overlay::LABEL,"immersive-hud-pointer",press.cancel_event());
                }
                return 0;
            }
            WM_CAPTURECHANGED | WM_CANCELMODE => { state.cancel_press(); }
            _ => {}
        }
    }
    DefWindowProcW(hwnd, msg, w, l)
}

pub struct InputPlane<R: Runtime> {
    hwnd: HWND,
    state: Box<InputState<R>>,
    bounds: Option<(i32,i32,i32,i32)>,
}

unsafe fn create_input_window(overlay: HWND, procedure: WNDPROC) -> HWND {
    let name: Vec<u16> = "MAKA_INGAME_INPUT\0".encode_utf16().collect();
    let instance = GetWindowLongPtrW(overlay,GWLP_HINSTANCE) as *mut core::ffi::c_void;
    let class = WNDCLASSW {lpfnWndProc:procedure,hInstance:instance,lpszClassName:name.as_ptr(),hbrBackground:GetStockObject(BLACK_BRUSH) as _,..Default::default()};
    RegisterClassW(&class);
    // An owner on the Tauri thread implicitly joins its input queue to this
    // worker's queue. The worker's Tauri getters wait without pumping Win32
    // messages, so GUI activation/show operations can then deadlock both.
    // This independent surface follows/hides with the host instead. It must
    // be topmost at creation: it no longer inherits that band from an owner,
    // and a background process cannot rely on later Z-order promotion.
    CreateWindowExW(WS_EX_TOPMOST|WS_EX_LAYERED|WS_EX_NOACTIVATE|WS_EX_TOOLWINDOW,name.as_ptr(),name.as_ptr(),WS_POPUP,0,0,1,1,null_mut(),null_mut(),instance,null_mut())
}

impl<R: Runtime> InputPlane<R> {
    pub fn new(app: AppHandle<R>, overlay: HWND) -> Option<Self> {
        let mut state = Box::new(InputState {app,generation:0,width:1,height:1,regions:Vec::new(),press:None});
        let hwnd = unsafe {
            let hwnd = create_input_window(overlay,Some(input_proc::<R>));
            if hwnd.is_null() { return None; }
            SetWindowLongPtrW(hwnd,GWLP_USERDATA,(&mut *state as *mut InputState<R>) as isize);
            // Alpha zero is click-through under Windows. One alpha step gives
            // these small native hit regions input without a visible new box.
            if SetLayeredWindowAttributes(hwnd,0,1,LWA_ALPHA) == 0 { DestroyWindow(hwnd); return None; }
            hwnd
        };
        Some(Self {hwnd,state,bounds:None})
    }
    pub fn pump() {
        unsafe {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg,null_mut(),0,0,PM_REMOVE) != 0 { TranslateMessage(&msg); DispatchMessageW(&msg); }
        }
    }
    pub fn holding(&self) -> bool { self.state.press.is_some() }
    pub fn cancel_press(&mut self) {
        self.state.cancel_press();
        unsafe { if GetCapture()==self.hwnd {ReleaseCapture();} }
    }
    pub fn hide(&mut self) {
        self.cancel_press();
        self.state.regions.clear();
        self.bounds = None;
        unsafe { ShowWindow(self.hwnd,SW_HIDE); }
    }
    pub fn update(&mut self, bounds:(i32,i32,i32,i32), hotspots:&HudHotspots) {
        let pixels = immersive_host::hotspot_pixels(hotspots,bounds.2,bounds.3);
        if pixels.is_empty() { self.hide(); return; }
        if self.bounds != Some(bounds) || self.state.generation != hotspots.generation {
            self.cancel_press();
            unsafe {
                let region = CreateRectRgn(0,0,0,0);
                if region.is_null() { self.hide(); return; }
                for p in &pixels {
                    let part = CreateRectRgn(p[0],p[1],p[2],p[3]);
                    if part.is_null() || CombineRgn(region,region,part,RGN_OR) == 0 {
                        if !part.is_null() { DeleteObject(part); }
                        DeleteObject(region); self.hide(); return;
                    }
                    DeleteObject(part);
                }
                if SetWindowRgn(self.hwnd,region,1) == 0 { DeleteObject(region); self.hide(); return; }
            }
            self.bounds = Some(bounds);
            self.state.generation = hotspots.generation;
            self.state.width = bounds.2; self.state.height = bounds.3;
            self.state.regions = pixels;
        }
        if unsafe { SetWindowPos(self.hwnd,HWND_TOPMOST,bounds.0,bounds.1,bounds.2,bounds.3,SWP_NOACTIVATE|SWP_SHOWWINDOW) } == 0 { self.hide(); }
    }
}
impl<R: Runtime> Drop for InputPlane<R> {
    fn drop(&mut self) {
        self.cancel_press();
        unsafe {
        if GetWindowLongPtrW(self.hwnd,GWLP_USERDATA)==(&*self.state as *const InputState<R>) as isize {
            SetWindowLongPtrW(self.hwnd,GWLP_USERDATA,0); DestroyWindow(self.hwnd);
        }
    } }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlapping_glow_boxes_use_the_same_topmost_control_as_the_dom() {
        let risk = [100,100,210,210];
        let master = [100,208,210,318];
        let region = press_region(&[risk,master],150,209).unwrap();
        let press = InputPress {generation:7,right:false,region};
        assert!(press.accepts_release(7,false,150,260),"pressing the top of MAKA must not be owned by the risk toggle below it");
        assert!(!press.accepts_release(7,false,150,150));
        assert!(press_region(&[risk,master],99,209).is_none());
    }

    #[test]
    fn release_must_match_the_original_control_generation_and_mouse_button() {
        let press = InputPress {generation:7,right:false,region:[100,200,150,250]};
        assert!(press.accepts_release(7,false,125,225));
        assert!(!press.accepts_release(8,false,125,225));
        assert!(!press.accepts_release(7,true,125,225));
        assert!(!press.accepts_release(7,false,150,225));
        assert!(!press.accepts_release(7,false,125,199));
        // Another published button must not activate after dragging off this one.
        assert!(!press.accepts_release(7,false,125,325));
        assert_eq!(press.cancel_event()["generation"],7);
        assert_eq!(press.cancel_event()["phase"],"cancel");
    }

    #[test]
    fn native_input_does_not_attach_its_queue_to_the_visual_overlay() {
        unsafe {
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let overlay = CreateWindowExW(0,class.as_ptr(),class.as_ptr(),WS_POPUP,0,0,1,1,null_mut(),null_mut(),null_mut(),null_mut());
            assert!(!overlay.is_null());
            let input = create_input_window(overlay,Some(DefWindowProcW));
            assert!(!input.is_null());
            let owner = GetWindow(input,GW_OWNER);
            let style = GetWindowLongPtrW(input,GWL_EXSTYLE) as u32;
            DestroyWindow(input);
            DestroyWindow(overlay);
            assert!(owner.is_null(),"an owner would join the worker and GUI input queues");
            assert_eq!(style & (WS_EX_LAYERED|WS_EX_NOACTIVATE|WS_EX_TOOLWINDOW),WS_EX_LAYERED|WS_EX_NOACTIVATE|WS_EX_TOOLWINDOW);
            assert_ne!(style & WS_EX_TOPMOST,0,"the independent input surface must start above the game, without relying on an owner or later activation");
            assert_eq!(style & WS_EX_TRANSPARENT,0,"the native control regions must consume mouse input");
        }
    }
}
