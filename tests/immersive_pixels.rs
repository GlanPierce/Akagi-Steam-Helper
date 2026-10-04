//! Cropped real Steam screenshots supplied with the reported alignment failure.
use akagi::ipc::immersive_contours::{
    capture_roi, detect, stabilize, ContourFrame, ContourRequest, VisualTarget,
};
use flate2::read::GzDecoder;
use std::io::Read;

fn fixture(bytes: &[u8], x: usize, y: usize, w: usize, h: usize) -> Vec<u8> {
    let mut crop = Vec::new();
    GzDecoder::new(bytes).read_to_end(&mut crop).unwrap();
    assert_eq!(crop.len(), w * h * 4);
    let mut frame = [100, 55, 25, 255].repeat(1920 * 1080);
    for row in 0..h {
        let to = ((y + row) * 1920 + x) * 4;
        frame[to..to + w * 4].copy_from_slice(&crop[row * w * 4..(row + 1) * w * 4]);
    }
    frame
}

// Exact native Maka RGBA, sliced like NativeSprite, then composed at HUD opacity.
fn paint_maka(
    pixels: &mut [u8],
    width: usize,
    height: usize,
    bounds: [f64; 4],
    size: [f64; 2],
    gold: bool,
) {
    let (compressed, sw): (&[u8], usize) = if gold {
        (
            include_bytes!("fixtures/immersive/maka-corner-1.rgba.gz"),
            75,
        )
    } else {
        (
            include_bytes!("fixtures/immersive/maka-corner-2.rgba.gz"),
            71,
        )
    };
    let mut sprite = Vec::new();
    GzDecoder::new(compressed).read_to_end(&mut sprite).unwrap();
    let unit = width as f64 / 16.;
    let bw = (size[0] * 1.16 * unit).round() as usize;
    let bh = (bw as f64 * 64. / 116.).round() as usize;
    let x0 = ((bounds[0] + bounds[2] / 2.) * unit - bw as f64 / 2.).round() as isize;
    let y0 = ((bounds[1] + bounds[3] - size[1] + size[1] * 22. / 167.) * unit - bh as f64).round()
        as isize;
    let l = (20. * bh as f64 / 63.).round() as usize;
    let r = (45. * bh as f64 / 63.).round() as usize;
    for y in 0..bh {
        for x in 0..bw {
            let xx = x0 + x as isize;
            let yy = y0 + y as isize;
            if xx < 0 || yy < 0 || xx >= width as isize || yy >= height as isize {
                continue;
            }
            let sx = if x < l {
                x * 20 / l
            } else if x >= bw - r {
                sw - 45 + (x - (bw - r)) * 45 / r
            } else {
                20 + (x - l) * (sw - 65) / (bw - l - r)
            };
            let si = (y * 63 / bh * sw + sx) * 4;
            let alpha = sprite[si + 3] as f64 / 255. * 0.95;
            let di = (yy as usize * width + xx as usize) * 4;
            for c in 0..3 {
                pixels[di + c] = (pixels[di + c] as f64 * (1. - alpha)
                    + sprite[si + 2 - c] as f64 * alpha)
                    .round() as u8;
            }
        }
    }
}

#[test]
fn native_maka_badges_keep_adjacent_real_tiles_separate_through_feedback() {
    let base = fixture(
        include_bytes!("fixtures/immersive/maka-clean-hand.bgra.gz"),
        210,
        906,
        1370,
        174,
    );
    let request = ContourRequest {
        key: "maka-hand".into(),
        targets: (0..13)
            .map(|i| {
                target(
                    &format!("tile-{i}"),
                    "tile",
                    2.23125 + i as f64 * 0.790625,
                    8.3625,
                    0.762,
                    1.19,
                )
            })
            .collect(),
    };
    for (width, height, scale) in [
        (960, 540, 0.5),
        (1920, 1080, 1.),
        (2560, 1440, 4. / 3.),
        (3840, 2160, 2.),
    ] {
        let original = transformed(&base, width, height, scale, 0., 0.);
        let clean = detect(&original, width, height, &request);
        assert_eq!(clean.shapes.len(), 13, "clean {width}");
        let size = [clean.shapes[7].bounds[2], clean.shapes[7].bounds[3]];
        let mut previous = clean.clone();
        for tick in 0..8 {
            let mut composed = original.clone();
            for (i, s) in previous.shapes.iter().take(5).enumerate() {
                paint_maka(&mut composed, width, height, s.bounds, size, i == 2);
            }
            let current = detect(&composed, width, height, &request);
            assert_eq!(
                current.shapes.len(),
                13,
                "{width}: connected pieces lost on frame {tick}"
            );
            for (s, c) in current.shapes.iter().zip(&clean.shapes) {
                assert!(
                    ((s.bounds[0] + s.bounds[2] / 2.) - (c.bounds[0] + c.bounds[2] / 2.)).abs()
                        * width as f64
                        / 16.
                        <= 1.,
                    "tile centre moved at {width} on frame {tick}: {} clean={:?} current={:?}",
                    s.id,
                    c.bounds,
                    s.bounds
                );
                assert!(
                    ((s.bounds[1] + s.bounds[3]) - (c.bounds[1] + c.bounds[3])).abs()
                        * width as f64
                        / 16.
                        <= 3.,
                    "bottom moved at {width} on frame {tick}"
                );
            }
            previous = current;
        }
    }
}
fn target(id: &str, kind: &str, x: f64, y: f64, w: f64, h: f64) -> VisualTarget {
    VisualTarget {
        id: id.into(),
        kind: kind.into(),
        x,
        y,
        w,
        h,
    }
}

#[test]
fn cropped_capture_preserves_real_control_and_lifted_tile_measurements() {
    for (original, targets) in [
        (
            fixture(
                include_bytes!("fixtures/immersive/win-hud.bgra.gz"),
                870,
                740,
                570,
                160,
            ),
            vec![
                target("button-ron", "action", 8.6375, 7., 2.25, 0.9),
                target("button-pass", "action", 10.875, 7., 2.25, 0.9),
            ],
        ),
        (
            fixture(
                include_bytes!("fixtures/immersive/raised-north.bgra.gz"),
                1478,
                863,
                111,
                167,
            ),
            vec![target("tile-13", "tile", 12.77, 8.3625, 0.762, 1.19)],
        ),
    ] {
        let request = ContourRequest {
            key: "crop".into(),
            targets,
        };
        let roi = capture_roi(1920, 1080, &request).expect("visible target region");
        assert!((roi[2] - roi[0]) * (roi[3] - roi[1]) < 1920 * 1080 / 3);
        let mut cropped = vec![0u8; original.len()];
        for y in roi[1]..roi[3] {
            let a = (y * 1920 + roi[0]) * 4;
            let b = (y * 1920 + roi[2]) * 4;
            cropped[a..b].copy_from_slice(&original[a..b]);
        }
        let expected = detect(&original, 1920, 1080, &request);
        assert!(!expected.shapes.is_empty());
        assert_eq!(
            serde_json::to_value(detect(&cropped, 1920, 1080, &request)).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
    }
}

// Approximate Chromium's antialiased SVG stroke over the original game pixels.
// Each next capture contains the last displayed HUD, not accumulated paint.
fn composite_hud(pixels: &mut [u8], frame: &ContourFrame, colors: [[f64; 3]; 2]) {
    for s in &frame.shapes {
        let (rgb, radius) = if s.id == "button-pon" {
            (colors[0], 0.95)
        } else {
            (colors[1], 0.70)
        };
        let x0 = (s.bounds[0] * 120.0 - 3.0).max(0.0) as usize;
        let y0 = (s.bounds[1] * 120.0 - 3.0).max(0.0) as usize;
        let x1 = ((s.bounds[0] + s.bounds[2]) * 120.0 + 4.0).min(1920.0) as usize;
        let y1 = ((s.bounds[1] + s.bounds[3]) * 120.0 + 4.0).min(1080.0) as usize;
        let mut coverage = vec![0.0f64; (x1 - x0) * (y1 - y0)];
        for path in &s.paths {
            for (a, b) in path
                .iter()
                .zip(path.iter().cycle().skip(1))
                .take(path.len())
            {
                let (ax, ay, bx, by) = (a[0] * 120.0, a[1] * 120.0, b[0] * 120.0, b[1] * 120.0);
                let (dx, dy) = (bx - ax, by - ay);
                for y in
                    (ay.min(by) - 2.0).max(0.0) as usize..(ay.max(by) + 3.0).min(1080.0) as usize
                {
                    for x in (ax.min(bx) - 2.0).max(0.0) as usize
                        ..(ax.max(bx) + 3.0).min(1920.0) as usize
                    {
                        let t = (((x as f64 + 0.5 - ax) * dx + (y as f64 + 0.5 - ay) * dy)
                            / (dx * dx + dy * dy).max(1e-9))
                        .clamp(0.0, 1.0);
                        let distance = ((x as f64 + 0.5 - ax - t * dx).powi(2)
                            + (y as f64 + 0.5 - ay - t * dy).powi(2))
                        .sqrt();
                        let alpha = (radius + 0.5 - distance).clamp(0.0, 1.0) * 0.95;
                        let i = (y - y0) * (x1 - x0) + x - x0;
                        coverage[i] = coverage[i].max(alpha);
                    }
                }
            }
        }
        for y in y0..y1 {
            for x in x0..x1 {
                let alpha = coverage[(y - y0) * (x1 - x0) + x - x0];
                for channel in 0..3 {
                    let i = (y * 1920 + x) * 4 + channel;
                    pixels[i] =
                        (pixels[i] as f64 * (1.0 - alpha) + rgb[2 - channel] * alpha).round() as u8;
                }
            }
        }
    }
}

#[test]
fn repeated_composed_captures_keep_real_buttons_visible_and_stationary() {
    let original = fixture(
        include_bytes!("fixtures/immersive/buttons.bgra.gz"),
        870,
        760,
        570,
        140,
    );
    let request = ContourRequest {
        key: "same-decision".into(),
        targets: vec![
            target("button-pon", "action", 8.6375, 7.0, 2.25, 0.9),
            target("button-pass", "action", 10.875, 7.0, 2.25, 0.9),
        ],
    };
    let initial = detect(&original, 1920, 1080, &request);
    assert_eq!(initial.shapes.len(), 2);
    for colors in [
        [[57.0, 229.0, 140.0], [224.0, 209.0, 90.0]],
        [[242.0, 107.0, 107.0], [245.0, 206.0, 84.0]],
        [[156.0, 163.0, 175.0], [90.0, 225.0, 130.0]],
    ] {
        let mut previous = initial.clone();
        for tick in 0..32 {
            let mut composed = original.clone();
            composite_hud(&mut composed, &previous, colors);
            let mut current = detect(&composed, 1920, 1080, &request);
            stabilize(&mut current, &previous, 1920);
            assert_eq!(
                current.shapes.len(),
                2,
                "button disappeared on feedback frame {tick}"
            );
            for (shape, start) in current.shapes.iter().zip(&initial.shapes) {
                assert_eq!(
                    shape.paths.len(),
                    start.paths.len(),
                    "{} gained duplicate contours on frame {tick}",
                    shape.id
                );
                for (edge, initial_edge) in shape.bounds.iter().zip(start.bounds) {
                    assert!(
                        (edge - initial_edge).abs() * 120.0 <= 1.0,
                        "{} drifts on frame {tick}: {:?} -> {:?}",
                        shape.id,
                        start.bounds,
                        shape.bounds
                    );
                }
            }
            previous = current;
        }
    }
}

#[test]
fn actual_feedback_screenshot_keeps_button_body_without_nested_outlines() {
    let pixels = fixture(
        include_bytes!("fixtures/immersive/buttons-hud.bgra.gz"),
        870,
        730,
        570,
        170,
    );
    let request = ContourRequest {
        key: "actual-feedback".into(),
        targets: vec![
            target("button-pon", "action", 8.6375, 7.0, 2.25, 0.9),
            target("button-pass", "action", 10.875, 7.0, 2.25, 0.9),
        ],
    };
    let result = detect(&pixels, 1920, 1080, &request);
    assert_eq!(result.shapes.len(), 2);
    for (shape, expected) in result
        .shapes
        .iter()
        .zip([[894., 778., 1135., 874.], [1186., 781., 1424., 875.]])
    {
        assert!(
            shape.paths.len() <= 2,
            "{}: internal disconnected artwork is not a second button edge: {} paths",
            shape.id,
            shape.paths.len()
        );
        assert!(
            shape.bounds[2] * 120.0 > 235.0,
            "retain the full ribbon: {:?}",
            shape.bounds
        );
        // This input already contains expanded old strokes. Bound each side
        // against the hand-checked clean button, not twice that error in width.
        let [x, y, w, h] = shape.bounds;
        for (actual, expected) in [x, y, x + w, y + h].iter().zip(expected) {
            assert!(
                (actual * 120.0 - expected).abs() <= 6.0,
                "HUD must not move or inflate {} beyond the actual button: {:?}",
                shape.id,
                shape.bounds
            );
        }
    }
}

#[test]
fn real_lifted_tile_stays_whole_despite_old_probability_label_and_stroke() {
    let pixels = fixture(
        include_bytes!("fixtures/immersive/lifted.bgra.gz"),
        210,
        850,
        210,
        230,
    );
    let result = detect(
        &pixels,
        1920,
        1080,
        &ContourRequest {
            key: "lift".into(),
            targets: vec![target("tile-0", "tile", 2.23125, 8.3625, 0.762, 1.19)],
        },
    );
    assert_eq!(result.shapes.len(), 1);
    let b = result.shapes[0].bounds.map(|v| v * 120.0);
    assert!((b[0] - 222.0).abs() <= 3.0, "left {b:?}");
    assert!(
        (b[1] - 873.0).abs() <= 4.0,
        "must follow the raised tile top, not the old outline: {b:?}"
    );
    assert!(
        (b[2] - 94.0).abs() <= 4.0 && (b[3] - 151.0).abs() <= 5.0,
        "whole tile: {b:?}"
    );
}

#[test]
fn real_raised_north_outlines_only_the_tile_shell_not_the_letter_or_old_label() {
    let pixels = fixture(
        include_bytes!("fixtures/immersive/raised-north.bgra.gz"),
        1478,
        863,
        111,
        167,
    );
    let result = detect(
        &pixels,
        1920,
        1080,
        &ContourRequest {
            key: "raised-north".into(),
            targets: vec![target("tile-13", "tile", 12.77, 8.3625, 0.762, 1.19)],
        },
    );
    assert_eq!(result.shapes.len(), 1);
    let shape = &result.shapes[0];
    assert_eq!(shape.paths.len(), 1);
    let [x, y, w, h] = shape.bounds.map(|v| v * 120.0);
    assert!(
        (x - 1486.0).abs() <= 4.0
            && (y - 873.0).abs() <= 4.0
            && (w - 94.0).abs() <= 4.0
            && (h - 153.0).abs() <= 5.0,
        "follow the measured raised tile: {:?}",
        shape.bounds
    );
    for p in &shape.paths[0] {
        let [px, py] = p.map(|v| v * 120.0);
        assert!(px < x + 5.0 || px > x + w - 5.0 || py < y + 5.0 || py > y + h - 5.0, "tile outline entered its interior at {px},{py}; must never trace the North glyph or old probability text");
    }
    assert!(
        shape.paths[0].len() >= 8,
        "retain the measured rounded corners rather than a fixed rectangle"
    );
}

#[test]
fn real_steam_cyan_pon_and_gray_skip_trace_the_entire_ribbons() {
    let pixels = fixture(
        include_bytes!("fixtures/immersive/buttons.bgra.gz"),
        870,
        760,
        570,
        140,
    );
    let result = detect(
        &pixels,
        1920,
        1080,
        &ContourRequest {
            key: "buttons".into(),
            targets: vec![
                target("button-pon", "action", 8.6375, 7.0, 2.25, 0.9),
                target("button-pass", "action", 10.875, 7.0, 2.25, 0.9),
            ],
        },
    );
    assert_eq!(result.shapes.len(), 2, "both real buttons must be found");
    for (s, expected) in result
        .shapes
        .iter()
        .zip([[894., 778., 241., 96.], [1186., 781., 238., 94.]])
    {
        let b = s.bounds.map(|v| v * 120.0);
        for i in 0..4 {
            assert!(
                (b[i] - expected[i]).abs() <= 9.0,
                "{} must include its ribbon, not just the text: {b:?}",
                s.id
            );
        }
        assert!(
            s.paths.iter().any(|p| p.len() > 8),
            "sloped edges and raised glyph"
        );
        assert!(
            s.paths.len() <= 4,
            "{} should outline the outside, not every letter/flower inside it",
            s.id
        );
    }
    // Optional developer output: only vector paths of the supplied fixture.
    if let Some(path) = std::env::var_os("AKAGI_FIXTURE_CONTOURS") {
        std::fs::write(path, serde_json::to_vec(&result).unwrap()).unwrap();
    }
}

#[test]
fn real_win_and_skip_use_the_original_visible_edges_despite_old_hud_strokes() {
    let pixels = fixture(
        include_bytes!("fixtures/immersive/win-hud.bgra.gz"),
        870,
        740,
        570,
        160,
    );
    let result = detect(
        &pixels,
        1920,
        1080,
        &ContourRequest {
            key: "win-screenshot".into(),
            targets: vec![
                target("button-ron", "action", 8.6375, 7.0, 2.25, 0.9),
                target("button-pass", "action", 10.875, 7.0, 2.25, 0.9),
            ],
        },
    );
    assert_eq!(
        result.shapes.len(),
        2,
        "both red win and gray skip must be outlined"
    );
    if let Some(path) = std::env::var_os("AKAGI_WIN_CONTOURS") {
        std::fs::write(path, serde_json::to_vec(&result).unwrap()).unwrap();
    }
    // Visible original-alpha edges, checked on the supplied pixels. Old red
    // strokes extend farther and must not be used as ground truth.
    for (shape, expected) in result
        .shapes
        .iter()
        .zip([[892., 757., 1135., 874.5], [1182., 779., 1424., 874.]])
    {
        let [x, y, w, h] = shape.bounds.map(|v| v * 120.0);
        for (actual, edge) in [x, y, x + w, y + h].into_iter().zip(expected) {
            assert!(
                (actual - edge).abs() <= 3.0,
                "{} must fit the original control, not the old overlay: {:?}",
                shape.id,
                shape.bounds
            );
        }
        assert!(
            shape.paths.len() <= 3,
            "only the original body and detached ribbon trim"
        );
    }
    if let Some(path) = std::env::var_os("AKAGI_WIN_CONTOURS") {
        std::fs::write(path, serde_json::to_vec(&result).unwrap()).unwrap();
    }
}

fn transformed(
    source: &[u8],
    width: usize,
    height: usize,
    scale: f64,
    dx: f64,
    dy: f64,
) -> Vec<u8> {
    let mut output = [100, 55, 25, 255].repeat(width * height);
    for y in 0..height {
        for x in 0..width {
            let sx = ((x as f64 - dx) / scale).round() as isize;
            let sy = ((y as f64 - dy) / scale).round() as isize;
            if (0..1920).contains(&sx) && (0..1080).contains(&sy) {
                let from = (sy as usize * 1920 + sx as usize) * 4;
                let to = (y * width + x) * 4;
                output[to..to + 4].copy_from_slice(&source[from..from + 4]);
            }
        }
    }
    output
}

#[test]
fn original_geometry_follows_hover_scale_and_native_4k_pixels() {
    let pixels = fixture(
        include_bytes!("fixtures/immersive/buttons.bgra.gz"),
        870,
        760,
        570,
        140,
    );
    let request = ContourRequest {
        key: "scale".into(),
        targets: vec![target("button-pon", "action", 8.6375, 7., 2.25, 0.9)],
    };
    let initial = detect(&pixels, 1920, 1080, &request);
    assert_eq!(initial.shapes.len(), 1);
    for (width, height, scale, dx, dy) in
        [(1920, 1080, 1.1, -101.5, -85.), (3840, 2160, 2., 0., 0.)]
    {
        let input = transformed(&pixels, width, height, scale, dx, dy);
        let result = detect(&input, width, height, &request);
        assert_eq!(
            result.shapes.len(),
            1,
            "follow the real control at {width}x{height}, scale {scale}"
        );
        let old = &initial.shapes[0];
        let new = &result.shapes[0];
        assert_eq!(new.paths.len(), old.paths.len());
        let expected = [
            old.bounds[0] * 120. * scale + dx,
            old.bounds[1] * 120. * scale + dy,
            old.bounds[2] * 120. * scale,
            old.bounds[3] * 120. * scale,
        ];
        for (actual, expected) in new.bounds.into_iter().zip(expected) {
            assert!(
                (actual * width as f64 / 16. - expected).abs() <= 3.5,
                "{width}x{height} pose {:?}; expected {expected}",
                new.bounds
            );
        }
    }
}

#[test]
fn a_different_label_and_an_empty_table_cannot_become_a_legal_control() {
    let pixels = fixture(
        include_bytes!("fixtures/immersive/buttons.bgra.gz"),
        870,
        760,
        570,
        140,
    );
    for input in [pixels, [100, 55, 25, 255].repeat(1920 * 1080)] {
        let result = detect(
            &input,
            1920,
            1080,
            &ContourRequest {
                key: "wrong-control".into(),
                targets: vec![target("button-ron", "action", 8.6375, 7., 2.25, 0.9)],
            },
        );
        assert!(
            result.shapes.is_empty(),
            "a pon/empty table must not be outlined as win"
        );
    }
}

#[test]
fn real_buttons_remain_visible_after_720p_and_540p_downsampling() {
    for (bytes, x, y, w, h, action) in [
        (
            &include_bytes!("fixtures/immersive/buttons.bgra.gz")[..],
            870,
            760,
            570,
            140,
            "pon",
        ),
        (
            &include_bytes!("fixtures/immersive/buttons-hud.bgra.gz")[..],
            870,
            730,
            570,
            170,
            "pon",
        ),
        (
            &include_bytes!("fixtures/immersive/win-hud.bgra.gz")[..],
            870,
            740,
            570,
            160,
            "ron",
        ),
    ] {
        let original = fixture(bytes, x, y, w, h);
        for (width, height) in [(1280, 720), (960, 540)] {
            let factor = 1920 / width;
            let mut pixels = vec![0u8; width * height * 4];
            // Area average the source footprint to exercise smaller glyphs and
            // blended HUD edges. These are derived fixtures, not native captures.
            for y in 0..height {
                for x in 0..width {
                    for c in 0..4 {
                        let x0 = x * 1920 / width;
                        let y0 = y * 1080 / height;
                        let x1 = ((x + 1) * 1920 / width).max(x0 + factor);
                        let y1 = ((y + 1) * 1080 / height).max(y0 + factor);
                        let mut sum = 0usize;
                        for sy in y0..y1 {
                            for sx in x0..x1 {
                                sum += original[(sy * 1920 + sx) * 4 + c] as usize;
                            }
                        }
                        pixels[(y * width + x) * 4 + c] = (sum / ((x1 - x0) * (y1 - y0))) as u8;
                    }
                }
            }
            let result = detect(
                &pixels,
                width,
                height,
                &ContourRequest {
                    key: "small".into(),
                    targets: vec![
                        target(&format!("button-{action}"), "action", 8.6375, 7., 2.25, 0.9),
                        target("button-pass", "action", 10.875, 7., 2.25, 0.9),
                    ],
                },
            );
            assert_eq!(
                result.shapes.len(),
                2,
                "{action} and skip at {width}x{height}"
            );
            if action == "pon" {
                let wrong = detect(
                    &pixels,
                    width,
                    height,
                    &ContourRequest {
                        key: "small-wrong".into(),
                        targets: vec![target("button-ron", "action", 8.6375, 7., 2.25, 0.9)],
                    },
                );
                assert!(wrong.shapes.is_empty(), "wrong button at {width}x{height}");
            }
        }
    }
}

#[test]
fn probability_text_stays_outside_the_tile_shell_at_small_and_four_k_sizes() {
    for (width, height, tile, label) in [
        (3840, 2160, (450, 1848, 188, 300), (480, 1826, 80, 18)),
        (960, 540, (112, 462, 47, 75), (119, 444, 20, 15)),
    ] {
        let mut pixels = [100, 55, 25, 255].repeat(width * height);
        for (x, y, w, h) in [tile, label] {
            for yy in y..y + h {
                for xx in x..x + w {
                    let at = (yy * width + xx) * 4;
                    pixels[at..at + 4].copy_from_slice(&[218, 225, 230, 255]);
                }
            }
        }
        let result = detect(
            &pixels,
            width,
            height,
            &ContourRequest {
                key: "tile-label".into(),
                targets: vec![target("tile-0", "tile", 2.23125, 8.3625, 0.762, 1.19)],
            },
        );
        assert_eq!(result.shapes.len(), 1);
        assert_eq!(
            result.shapes[0].bounds[1], 7.7,
            "probability label is not part of the tile shell at {width}x{height}"
        );
    }
}

#[test]
#[ignore = "opt-in release tracking timing; no desktop access"]
fn release_tracking_latency_diagnostic() {
    let original = fixture(
        include_bytes!("fixtures/immersive/buttons.bgra.gz"),
        870,
        760,
        570,
        140,
    );
    for (width, height, scale) in [(1920, 1080, 1.), (3840, 2160, 2.)] {
        let mut pixels = transformed(&original, width, height, scale, 0., 0.);
        let mut targets = vec![];
        for i in 0..14 {
            let cx = 2.23125 + i as f64 * 0.790625 + if i == 13 { 0.246875 } else { 0. };
            targets.push(target(
                &format!("tile-{i}"),
                "tile",
                cx,
                8.3625,
                0.762,
                1.19,
            ));
            let unit = width as f64 / 16.;
            let (x, y, w, h) = (
                ((cx - 0.39) * unit) as usize,
                (7.7 * unit) as usize,
                (0.77 * unit) as usize,
                (1.25 * unit) as usize,
            );
            for yy in y..y + h {
                for xx in x..x + w {
                    let at = (yy * width + xx) * 4;
                    pixels[at..at + 4].copy_from_slice(&[218, 225, 230, 255]);
                }
            }
        }
        for (action, x, y) in [
            ("pass", 10.875, 7.),
            ("pon", 8.6375, 7.),
            ("chi", 6.4, 7.),
            ("ron", 10.875, 5.9),
            ("daiminkan", 8.6375, 5.9),
        ] {
            targets.push(target(
                &format!("button-{action}"),
                "action",
                x,
                y,
                2.25,
                0.9,
            ));
        }
        let request = ContourRequest {
            key: "latency".into(),
            targets,
        };
        let _ = detect(&pixels, width, height, &request);
        let mut timings = vec![];
        for _ in 0..12 {
            let start = std::time::Instant::now();
            std::hint::black_box(detect(&pixels, width, height, &request));
            timings.push(start.elapsed().as_secs_f64() * 1000.);
        }
        timings.sort_by(f64::total_cmp);
        println!("{width}x{height}: 14 tile targets + 5 action targets; median={:.2} ms max={:.2} ms; capture not included",timings[6],timings[11]);
    }
}
