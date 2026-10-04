# Steam contour regression inputs

These are small BGRA crops of the screenshots supplied with the user's
2026-10-02 bug report, compressed with gzip. No account names or credentials
are included. They are test data, never runtime button substitutes.

- `lifted.bgra.gz`: 210 × 230, placed at (210, 850) in a 1920 × 1080 client.
  The first hand tile is lifted, but the old HUD line and label cross it.
- `buttons.bgra.gz`: 570 × 140, placed at (870, 760). The window's 1 px side
  border and 45 px title bar were excluded. Contains the real cyan pon and
  gray skip ribbons.
- `buttons-hud.bgra.gz`: 570 × 170, placed at (870, 730). The later flicker
  report contains the real buttons, probability captions, and the old HUD
  strokes that fragmented the gray skip control. No avatars or account data.

Run `cargo test --test immersive_pixels`. The assertions cover complete outer
edges rather than merely detecting pale text. A feedback regression composites
antialiased strokes with 0.95 opacity over the clean button crop, then runs the
real detector and stabilizer on 32 consecutive frames for each of three color
pairs. Each frame starts from the original image plus the last HUD, matching
desktop composition rather than accumulating every historical stroke.
Live capture is checked separately
by the opt-in diagnostic in `immersive_capture.rs`, against a simultaneous
Steam screenshot converted to BGRA. Static fixtures do not prove live alignment.

Maka badge feedback inputs:
- `maka-clean-hand.bgra.gz`: 1370 × 174 at (210, 906), cropped from the user's
  clean 1922 × 1126 Steam screenshot after excluding the window frame. Contains
  13 real hand tiles and no player names.
- `maka-corner-{1,2}.rgba.gz`: lossless raw RGBA of the original native gold
  75 × 63 and blue 71 × 63 assets in `frontend/public/maka/common`.

The Maka regression composes five adjacent badges at opacity 0.95 and runs
eight feedback frames at 540P, 1080P, 1440P and 4K, checking all tile components
and their bottom edges. It deliberately reconstructs label position from a
clean tile size and the measured bottom, as the frontend does.
