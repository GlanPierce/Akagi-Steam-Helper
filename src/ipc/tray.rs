//! The Steam helper has no standalone window. Its tray icon lives for the
//! entire app lifetime, including while no game is running.
use super::immersive_host::SharedHost;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

const ID: &str = "maka-ingame";
const OPEN: &str = "maka-open-menu";
const EXIT: &str = "maka-exit";

fn open_menu<R: Runtime>(app: &AppHandle<R>) {
    app.state::<SharedHost>().request_panel_from_tray();
}

pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if app.tray_by_id(ID).is_some() {
        return Ok(());
    }
    let open = MenuItem::with_id(app, OPEN, "打开菜单", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let exit = MenuItem::with_id(app, EXIT, "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &separator, &exit])?;
    let mut builder = TrayIconBuilder::with_id(ID)
        .tooltip("MAKA INGAME · 运行中")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }) {
                open_menu(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            OPEN => open_menu(app),
            EXIT => {
                app.state::<SharedHost>().set_enabled(false);
                // The existing launcher stops its relay when Akagi exits.
                // The game remains running.
                app.exit(0);
            }
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    let tray = builder.build(app)?;
    tracing::info!(id = ID, rect = ?tray.rect().ok().flatten(), "MAKA system tray registered");
    Ok(())
}
