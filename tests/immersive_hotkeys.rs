use akagi::ipc::immersive_host::{space_shortcut, SpaceShortcut};

#[test]
fn guidance_and_menu_have_exclusive_space_chords() {
    assert_eq!(
        space_shortcut(true, false, true, false, false),
        Some(SpaceShortcut::Guidance)
    );
    assert_eq!(
        space_shortcut(true, false, true, true, false),
        Some(SpaceShortcut::Menu)
    );
    assert_eq!(space_shortcut(true, false, false, false, false), None);
    assert_eq!(space_shortcut(true, false, true, false, true), None);
}

#[test]
fn releasing_shift_or_repeating_space_does_not_toggle_guidance_after_opening_menu() {
    assert_eq!(
        space_shortcut(true, false, true, true, false),
        Some(SpaceShortcut::Menu)
    );
    assert_eq!(space_shortcut(true, true, true, false, false), None);
    assert_eq!(space_shortcut(false, true, true, false, false), None);
    assert_eq!(
        space_shortcut(true, false, true, false, false),
        Some(SpaceShortcut::Guidance)
    );
}
