//! Original-resource control contours and fitted tile shells in the game's 16 × 9 area.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct VisualTarget {
    pub id: String,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ContourRequest {
    pub key: String,
    pub targets: Vec<VisualTarget>,
}
#[derive(Clone, Debug, Serialize)]
pub struct Silhouette {
    pub id: String,
    pub paths: Vec<Vec<[f64; 2]>>,
    pub bounds: [f64; 4],
}
#[derive(Clone, Debug, Default, Serialize)]
pub struct ContourFrame {
    pub key: String,
    pub generation: u64,
    pub shapes: Vec<Silhouette>,
}

pub fn stabilize(frame: &mut ContourFrame, previous: &ContourFrame, width: usize) {
    if frame.key != previous.key || frame.generation != previous.generation {
        return;
    }
    let epsilon = 2.5 * 16.0 / width.max(1) as f64;
    for current in &mut frame.shapes {
        if let Some(old) = previous.shapes.iter().find(|s| s.id == current.id) {
            // Hold sub-stroke boundary noise, not the previous observation.
            // A hover lift / button animation over 2.5 px is accepted at once;
            // missing shapes are never copied from the preceding frame.
            let edges = |s: &Silhouette| {
                [
                    s.bounds[0],
                    s.bounds[1],
                    s.bounds[0] + s.bounds[2],
                    s.bounds[1] + s.bounds[3],
                ]
            };
            if edges(current)
                .iter()
                .zip(edges(old))
                .all(|(a, b)| (a - b).abs() <= epsilon)
            {
                *current = old.clone();
            } else if current.id.starts_with("tile-") {
                // A badge can change the crown by tens of pixels while the
                // exposed left/right/bottom edges only have sampling noise.
                // Stabilize those edges independently; never delay a real lift.
                let mut stable = edges(current);
                for (edge, old_edge) in stable.iter_mut().zip(edges(old)) {
                    if (*edge - old_edge).abs() <= epsilon {
                        *edge = old_edge;
                    }
                }
                let before = current.bounds;
                let after = [
                    stable[0],
                    stable[1],
                    stable[2] - stable[0],
                    stable[3] - stable[1],
                ];
                if before[2] > 0. && before[3] > 0. && after[2] > 0. && after[3] > 0. {
                    for path in &mut current.paths {
                        for point in path {
                            point[0] = after[0] + (point[0] - before[0]) * after[2] / before[2];
                            point[1] = after[1] + (point[1] - before[1]) * after[3] / before[3];
                        }
                    }
                    current.bounds = after;
                }
            }
        }
    }
}

pub fn detect(
    pixels: &[u8],
    width: usize,
    height: usize,
    request: &ContourRequest,
) -> ContourFrame {
    let mut result = ContourFrame {
        key: request.key.clone(),
        generation: 0,
        shapes: vec![],
    };
    if width < 160
        || height < 90
        || width > 3840
        || height > 2160
        || pixels.len() != width * height * 4
    {
        return result;
    }
    let unit = width as f64 / 16.0;
    let tiles: Vec<_> = request
        .targets
        .iter()
        .filter(|t| t.kind == "tile")
        .collect();
    if !tiles.is_empty() {
        let left = tiles
            .iter()
            .map(|t| t.x - t.w / 2.0 - 0.25)
            .fold(16.0, f64::min);
        let right = tiles
            .iter()
            .map(|t| t.x + t.w / 2.0 + 0.5)
            .fold(0.0, f64::max);
        let roi = region(left, 7.0, right, 9.0, unit, width, height);
        let mut pieces: Vec<_> = components(pixels, width, roi)
            .into_iter()
            .filter(|c| {
                let w = c.w as f64 / unit;
                let h = c.h as f64 / unit;
                (0.48..=0.98).contains(&w)
                    && (0.65..=1.65).contains(&h)
                    && (c.y + c.h) as f64 / unit > 8.25
                    && c.points.len() > c.w * c.h / 3
            })
            .collect();
        pieces.sort_by_key(|c| c.x);
        // Full-width Maka labels can join neighbouring tile components in the
        // composed capture. Retry inside physical tile slots; every slot must
        // still contain a real lower tile body, never just a floating label.
        if pieces.len() != tiles.len() {
            pieces = tiles
                .iter()
                .enumerate()
                .filter_map(|(i, t)| {
                    let left = if i == 0 {
                        t.x - t.w * 0.56
                    } else {
                        (tiles[i - 1].x + t.x) / 2.
                    };
                    let right = if i + 1 == tiles.len() {
                        t.x + t.w * 0.56
                    } else {
                        (t.x + tiles[i + 1].x) / 2.
                    };
                    components(
                        pixels,
                        width,
                        region(left, 7., right, 9., unit, width, height),
                    )
                    .into_iter()
                    .filter(|c| {
                        let w = c.w as f64 / unit;
                        let h = c.h as f64 / unit;
                        (0.48..=0.98).contains(&w)
                            && (0.65..=1.95).contains(&h)
                            && (c.y + c.h) as f64 / unit > 8.25
                            && c.points
                                .iter()
                                .filter(|(_, y)| *y as f64 / unit > 8.1)
                                .count()
                                > c.w * 5
                            && c.points.len() > c.w * c.h / 3
                    })
                    .max_by_key(|c| c.points.len())
                })
                .collect();
        }
        // Never shift probabilities onto the next tile during sorting / dealing animations.
        if pieces.len() == tiles.len()
            && tiles
                .iter()
                .zip(&pieces)
                .all(|(t, c)| ((c.x as f64 + c.w as f64 / 2.0) / unit - t.x).abs() < 0.30)
        {
            for (target, component) in tiles.iter().zip(pieces) {
                result.shapes.push(tile_shell(target, &component, unit));
            }
        }
    }
    for target in request.targets.iter().filter(|t| t.kind != "tile") {
        let choice = target.kind == "choice";
        if !choice {
            result.shapes.extend(super::immersive_templates::detect(
                pixels, width, height, target,
            ));
            continue;
        }
        let half_w = target.w / 2.0 + 0.15;
        let half_h = target.h / 2.0 + 0.22;
        let roi = region(
            target.x - half_w,
            target.y - half_h,
            target.x + half_w,
            target.y + half_h,
            unit,
            width,
            height,
        );
        let pieces: Vec<_> = components(pixels, width, roi)
            .into_iter()
            .filter(|c| {
                c.points.len() as f64 > unit * unit * 0.0015
                    && c.w > 2
                    && c.h > 2
                    && (choice || c.h as f64 > unit * 0.27 && c.w as f64 > unit * 0.4)
                    && c.x > roi.0
                    && c.y > roi.1
                    && c.x + c.w < roi.2
                    && c.y + c.h < roi.3
            })
            .collect();
        let area: usize = pieces.iter().map(|p| p.points.len()).sum();
        let solid_control = pieces.iter().any(|c| {
            c.w as f64 > unit * if choice { 0.35 } else { 0.8 }
                && c.h as f64 > unit * 0.35
                && c.points.len() * 10 > c.w * c.h * 3
        });
        if solid_control
            && !pieces.is_empty()
            && pieces.len() <= 64
            && area as f64 > unit * unit * 0.025
        {
            result.shapes.extend(shape(&target.id, &pieces, unit, true));
        }
    }
    result
}

/// Dirty rectangle for the next capture. All detector ROIs and template sample
/// searches are inside it, so unchanged pixels outside this rectangle are unused.
pub fn capture_roi(width: usize, height: usize, request: &ContourRequest) -> Option<[usize; 4]> {
    let unit = width as f64 / 16.;
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for t in &request.targets {
        let b = match t.kind.as_str() {
            "tile" => Some([
                (t.x - t.w / 2. - 0.25) * unit,
                7. * unit,
                (t.x + t.w / 2. + 0.5) * unit,
                9. * unit,
            ]),
            "choice" => Some([
                (t.x - t.w / 2. - 0.15) * unit,
                (t.y - t.h / 2. - 0.22) * unit,
                (t.x + t.w / 2. + 0.15) * unit,
                (t.y + t.h / 2. + 0.22) * unit,
            ]),
            _ => super::immersive_templates::sample_bounds(t, unit),
        };
        if let Some(b) = b {
            bounds[0] = bounds[0].min(b[0]);
            bounds[1] = bounds[1].min(b[1]);
            bounds[2] = bounds[2].max(b[2]);
            bounds[3] = bounds[3].max(b[3]);
        }
    }
    if !bounds.iter().all(|v| v.is_finite()) {
        return None;
    }
    let b = [
        bounds[0].floor().clamp(0., width as f64) as usize,
        bounds[1].floor().clamp(0., height as f64) as usize,
        bounds[2].ceil().clamp(0., width as f64) as usize,
        bounds[3].ceil().clamp(0., height as f64) as usize,
    ];
    (b[2] > b[0] && b[3] > b[1]).then_some(b)
}

fn region(
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    unit: f64,
    w: usize,
    h: usize,
) -> (usize, usize, usize, usize) {
    (
        (x0 * unit).max(0.0).min(w as f64) as usize,
        (y0 * unit).max(0.0).min(h as f64) as usize,
        (x1 * unit).max(0.0).min(w as f64).ceil() as usize,
        (y1 * unit).max(0.0).min(h as f64).ceil() as usize,
    )
}

#[cfg(test)]
pub(super) fn hand_components_for_diagnostic(
    pixels: &[u8],
    width: usize,
    height: usize,
) -> Vec<[usize; 5]> {
    let unit = width as f64 / 16.0;
    components(
        pixels,
        width,
        region(1.6, 7.0, 13.3, 9.0, unit, width, height),
    )
    .into_iter()
    .filter(|c| c.points.len() > 500)
    .map(|c| [c.x, c.y, c.w, c.h, c.points.len()])
    .collect()
}
struct Component {
    x: usize,
    y: usize,
    w: usize,
    h: usize,
    points: Vec<(usize, usize)>,
}

fn tile_shell(target: &VisualTarget, c: &Component, unit: f64) -> Silhouette {
    // Maka badges overlap the crown and can widen the component asymmetrically.
    // Measure horizontal edges only through the exposed lower tile body, so a
    // label cannot feed its own position back into the next capture.
    let bottom = (c.y + c.h) as f64;
    let body_top = (bottom - target.h * unit * 0.45).max(c.y as f64) as usize;
    let body_bottom = (bottom - target.h * unit * 0.10) as usize;
    let body: Vec<_> = c
        .points
        .iter()
        .filter(|(_, y)| *y >= body_top && *y < body_bottom)
        .collect();
    let left = body.iter().map(|(x, _)| *x).min().unwrap_or(c.x);
    let right = body.iter().map(|(x, _)| *x + 1).max().unwrap_or(c.x + c.w);
    // The neutral interior can lose a few columns to a preceding HUD stroke.
    // Fit the known native tile shell width around that interior; never trace
    // its letters, stripe-shaped label cuts, or the old outline's concavities.
    let expected = target.w * unit * (0.785 / 0.762);
    let measured = (right - left) as f64;
    let incomplete_interior =
        body.len() as f64 / (measured * (body_bottom - body_top).max(1) as f64) < 0.96;
    let w = if incomplete_interior && (expected * 0.88..expected).contains(&measured) {
        expected
    } else {
        measured
    };
    let (x, y, h) = (left as f64 + (measured - w) / 2., c.y as f64, c.h as f64);
    let radius = (unit * 0.045).min(w / 8.).min(h / 8.);
    let mut path = Vec::with_capacity(36);
    for (cx, cy, start) in [
        (x + w - radius, y + radius, -90.),
        (x + w - radius, y + h - radius, 0.),
        (x + radius, y + h - radius, 90.),
        (x + radius, y + radius, 180.),
    ] {
        for i in 0..=8 {
            let theta = ((start + i as f64 * 90. / 8.) as f64).to_radians();
            path.push([
                (cx + radius * theta.cos()) / unit,
                (cy + radius * theta.sin()) / unit,
            ]);
        }
    }
    Silhouette {
        id: target.id.clone(),
        bounds: [x / unit, y / unit, w / unit, h / unit],
        paths: vec![path],
    }
}
fn components(p: &[u8], width: usize, roi: (usize, usize, usize, usize)) -> Vec<Component> {
    let (x0, y0, x1, y1) = roi;
    let rw = x1 - x0;
    let rh = y1 - y0;
    let mut mask = vec![false; rw * rh];
    for y in 0..rh {
        for x in 0..rw {
            let i = ((y0 + y) * width + x0 + x) * 4;
            let b = p[i] as i32;
            let g = p[i + 1] as i32;
            let r = p[i + 2] as i32;
            let neutral = r.min(g).min(b) > 140 && r.max(g).max(b) - r.min(g).min(b) < 65;
            let gold = r > 145 && g > 85 && g * 100 < r * 92 && b * 100 < g * 78;
            mask[y * rw + x] = neutral || gold;
        }
    }
    {
        // A previous 1–2 px HUD stroke can cut across a newly lifted tile.
        // Bridge only tiny vertical cuts; closing horizontally would merge
        // neighbouring hand tiles and shift their probability assignments.
        // This bridges the thin HUD stroke, not a game-sized feature. Growing
        // it beyond 3px can connect probability text above a 4K tile; keep
        // the smaller original tolerance for low-resolution windows.
        let gap = ((width as f64 / 1920.0 * 3.0).ceil() as usize).min(3);
        for x in 0..rw {
            let mut previous = None;
            for y in 0..rh {
                if mask[y * rw + x] {
                    if let Some(from) = previous {
                        if y - from <= gap + 1 {
                            for yy in from + 1..y {
                                mask[yy * rw + x] = true;
                            }
                        }
                    }
                    previous = Some(y);
                }
            }
        }
    }
    let mut out = Vec::new();
    for seed in 0..mask.len() {
        if !mask[seed] {
            continue;
        }
        let mut queue = vec![seed];
        mask[seed] = false;
        let mut head = 0;
        let (mut left, mut top, mut right, mut bottom) = (rw, rh, 0, 0);
        let mut points = Vec::new();
        while head < queue.len() {
            let i = queue[head];
            head += 1;
            let x = i % rw;
            let y = i / rw;
            left = left.min(x);
            right = right.max(x);
            top = top.min(y);
            bottom = bottom.max(y);
            points.push((x + x0, y + y0));
            for j in [
                if x > 0 { Some(i - 1) } else { None },
                if x + 1 < rw { Some(i + 1) } else { None },
                if y > 0 { Some(i - rw) } else { None },
                if y + 1 < rh { Some(i + rw) } else { None },
            ]
            .into_iter()
            .flatten()
            {
                if mask[j] {
                    mask[j] = false;
                    queue.push(j);
                }
            }
        }
        if points.len() >= 6 {
            out.push(Component {
                x: left + x0,
                y: top + y0,
                w: right - left + 1,
                h: bottom - top + 1,
                points,
            });
        }
    }
    out
}
fn shape(id: &str, components: &[Component], unit: f64, outer_only: bool) -> Option<Silhouette> {
    let mut bounds = [usize::MAX, usize::MAX, 0, 0];
    let mut paths = Vec::new();
    for c in components {
        bounds[0] = bounds[0].min(c.x);
        bounds[1] = bounds[1].min(c.y);
        bounds[2] = bounds[2].max(c.x + c.w);
        bounds[3] = bounds[3].max(c.y + c.h);
        let mut loops = trace(c);
        loops.sort_by(|a, b| area(b).abs().total_cmp(&area(a).abs()));
        if outer_only {
            loops.truncate(1);
        }
        for points in loops {
            if area(&points).abs() < 2.0 {
                continue;
            }
            paths.push(
                simplify(&points)
                    .into_iter()
                    .map(|p| [(p[0] + c.x as f64) / unit, (p[1] + c.y as f64) / unit])
                    .collect(),
            );
        }
    }
    if paths.is_empty() || paths.iter().map(Vec::len).sum::<usize>() > 4096 {
        return None;
    }
    Some(Silhouette {
        id: id.into(),
        paths,
        bounds: [
            bounds[0] as f64 / unit,
            bounds[1] as f64 / unit,
            (bounds[2] - bounds[0]) as f64 / unit,
            (bounds[3] - bounds[1]) as f64 / unit,
        ],
    })
}
fn trace(c: &Component) -> Vec<Vec<[f64; 2]>> {
    use std::collections::BTreeMap;
    let mut mask = vec![false; c.w * c.h];
    for &(x, y) in &c.points {
        mask[(y - c.y) * c.w + x - c.x] = true;
    }
    let mut edges: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    let stride = c.w + 1;
    for y in 0..c.h {
        for x in 0..c.w {
            if !mask[y * c.w + x] {
                continue;
            }
            let a = y * stride + x;
            let b = a + 1;
            let d = a + stride;
            let e = d + 1;
            for (visible, from, to) in [
                (y == 0 || !mask[(y - 1) * c.w + x], a, b),
                (x + 1 == c.w || !mask[y * c.w + x + 1], b, e),
                (y + 1 == c.h || !mask[(y + 1) * c.w + x], e, d),
                (x == 0 || !mask[y * c.w + x - 1], d, a),
            ] {
                if visible {
                    edges.entry(from).or_default().push(to);
                }
            }
            if edges.len() > 6000 {
                return vec![];
            }
        }
    }
    let mut result = Vec::new();
    while let Some((&start, _)) = edges.first_key_value() {
        let mut at = start;
        let mut path = Vec::new();
        loop {
            path.push([(at % stride) as f64, (at / stride) as f64]);
            let Some(nexts) = edges.get_mut(&at) else {
                break;
            };
            let next = nexts.pop().unwrap();
            if nexts.is_empty() {
                edges.remove(&at);
            }
            at = next;
            if at == start {
                break;
            }
        }
        if path.len() >= 4 {
            result.push(path);
        }
    }
    result
}
fn area(p: &[[f64; 2]]) -> f64 {
    p.iter()
        .zip(p.iter().cycle().skip(1))
        .take(p.len())
        .map(|(a, b)| a[0] * b[1] - b[0] * a[1])
        .sum::<f64>()
        / 2.0
}
fn simplify(p: &[[f64; 2]]) -> Vec<[f64; 2]> {
    let mut closed = p.to_vec();
    closed.push(p[0]);
    let mut keep = vec![false; closed.len()];
    keep[0] = true;
    let mut work = vec![(0, closed.len() - 1)];
    while let Some((from, to)) = work.pop() {
        let p = &closed[from..=to];
        let a = p[0];
        let b = p[p.len() - 1];
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        let len = (dx * dx + dy * dy).sqrt();
        let mut furthest = 0;
        let mut distance = 0.0;
        for (i, q) in p.iter().enumerate().take(p.len() - 1).skip(1) {
            let d = if len == 0.0 {
                ((q[0] - a[0]).powi(2) + (q[1] - a[1]).powi(2)).sqrt()
            } else {
                (dy * q[0] - dx * q[1] + b[0] * a[1] - b[1] * a[0]).abs() / len
            };
            if d > distance {
                distance = d;
                furthest = i;
            }
        }
        if distance > 0.6 {
            let split = from + furthest;
            keep[split] = true;
            work.push((from, split));
            work.push((split, to));
        }
    }
    closed
        .into_iter()
        .zip(keep)
        .filter_map(|(p, keep)| keep.then_some(p))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn image() -> Vec<u8> {
        [100, 55, 25, 255].repeat(1600 * 900)
    }
    fn fill(p: &mut [u8], x: usize, y: usize, w: usize, h: usize, rgb: [u8; 3]) {
        for yy in y..y + h {
            for xx in x..x + w {
                let i = (yy * 1600 + xx) * 4;
                p[i..i + 3].copy_from_slice(&[rgb[2], rgb[1], rgb[0]]);
            }
        }
    }
    #[test]
    fn lifted_hand_and_separate_draw_follow_pixels() {
        let mut p = image();
        fill(&mut p, 190, 725, 72, 135, [225, 224, 217]);
        fill(&mut p, 295, 770, 72, 125, [225, 224, 217]);
        let req = ContourRequest {
            key: "12:hand".into(),
            targets: vec![
                target("a", "tile", 2.23, 8.36, 0.762, 1.19),
                target("b", "tile", 3.31, 8.36, 0.762, 1.19),
            ],
        };
        let f = detect(&p, 1600, 900, &req);
        assert_eq!(f.shapes.len(), 2);
        assert_eq!(f.shapes[0].id, "a");
        assert_eq!(f.shapes[0].bounds, [1.90, 7.25, 0.72, 1.35]);
        assert_eq!(f.shapes[1].bounds, [2.95, 7.70, 0.72, 1.25]);
    }
    #[test]
    fn incomplete_hand_is_not_assigned_to_the_wrong_tile() {
        let mut p = image();
        fill(&mut p, 190, 770, 72, 125, [225, 224, 217]);
        let req = ContourRequest {
            key: "13".into(),
            targets: vec![
                target("a", "tile", 2.2, 8.36, 0.76, 1.19),
                target("b", "tile", 3.0, 8.36, 0.76, 1.19),
            ],
        };
        assert!(detect(&p, 1600, 900, &req).shapes.is_empty());
    }
    #[test]
    fn same_count_impostor_must_not_shift_tile_probabilities() {
        let mut p = image();
        fill(&mut p, 185, 770, 55, 125, [225, 224, 217]);
        fill(&mut p, 245, 770, 55, 125, [225, 224, 217]);
        let req = ContourRequest {
            key: "13".into(),
            targets: vec![
                target("a", "tile", 2.23, 8.36, 0.76, 1.19),
                target("b", "tile", 3.31, 8.36, 0.76, 1.19),
            ],
        };
        assert!(detect(&p, 1600, 900, &req).shapes.is_empty());
    }
    #[test]
    fn oversized_capture_is_rejected_before_allocating() {
        assert!(detect(&[], 7680, 4320, &ContourRequest::default())
            .shapes
            .is_empty());
    }
    #[test]
    fn selector_component_traces_the_outer_edge_without_outlining_internal_artwork() {
        let mut p = image();
        // A ring with a protruding tab, not a stand-in rectangle or a font icon.
        fill(&mut p, 790, 670, 70, 60, [240, 192, 90]);
        fill(&mut p, 810, 690, 30, 20, [25, 55, 100]);
        fill(&mut p, 860, 690, 22, 20, [240, 192, 90]);
        let req = ContourRequest {
            key: "14:pon".into(),
            targets: vec![target("choice-0", "choice", 8.4, 7.0, 1.75, 0.66)],
        };
        let f = detect(&p, 1600, 900, &req);
        assert_eq!(f.shapes.len(), 1);
        assert_eq!(
            f.shapes[0].paths.len(),
            1,
            "do not outline artwork inside the button"
        );
        assert!(
            f.shapes[0].paths.iter().any(|p| p.len() > 4),
            "trace the tab, not its bounding box"
        );
        assert_eq!(f.shapes[0].bounds, [7.9, 6.7, 0.92, 0.6]);
    }
    #[test]
    fn empty_blue_table_has_no_guessed_outline() {
        let req = ContourRequest {
            key: "15".into(),
            targets: vec![target("pon", "action", 8.4, 7., 1.75, 0.66)],
        };
        assert!(detect(&image(), 1600, 900, &req).shapes.is_empty());
        assert!(detect(&[], 1600, 900, &req).shapes.is_empty());
    }
    #[test]
    fn leftover_hud_outline_cannot_keep_a_disappeared_button_alive() {
        for color in [[245, 206, 84], [57, 229, 140]] {
            let mut p = image();
            fill(&mut p, 750, 650, 205, 80, color);
            fill(&mut p, 752, 652, 201, 76, [25, 55, 100]);
            let request = ContourRequest {
                key: "stale-outline".into(),
                targets: vec![target("button-pon", "action", 8.4, 7., 2.25, 0.9)],
            };
            assert!(
                detect(&p, 1600, 900, &request).shapes.is_empty(),
                "a stroke without a filled game control is not a button"
            );
            let mut choice_pixels = image();
            fill(&mut choice_pixels, 750, 590, 148, 86, color);
            fill(&mut choice_pixels, 752, 592, 144, 82, [25, 55, 100]);
            let choice_request = ContourRequest {
                key: "choice".into(),
                targets: vec![target("choice-0", "choice", 8.24, 6.33, 1.48, 0.86)],
            };
            assert!(
                detect(&choice_pixels, 1600, 900, &choice_request)
                    .shapes
                    .is_empty(),
                "choice also needs visible tile bodies"
            );
        }
    }
    #[test]
    fn crown_changes_do_not_disable_stability_of_the_exposed_tile_body() {
        let previous = ContourFrame {
            key: "same".into(),
            generation: 1,
            shapes: vec![Silhouette {
                id: "tile-0".into(),
                bounds: [2., 7.7, 0.76, 1.25],
                paths: vec![],
            }],
        };
        let mut current = previous.clone();
        current.shapes[0].bounds = [1.99, 7.49, 0.78, 1.47];
        current.shapes[0].paths =
            vec![vec![[1.99, 7.49], [2.77, 7.49], [2.77, 8.96], [1.99, 8.96]]];
        stabilize(&mut current, &previous, 1920);
        assert_eq!(current.shapes[0].bounds[0], 2.);
        assert!((current.shapes[0].bounds[2] - 0.76).abs() < 1e-9);
        assert!((current.shapes[0].bounds[1] + current.shapes[0].bounds[3] - 8.95).abs() < 1e-9);
        assert!((current.shapes[0].paths[0][2][0] - 2.76).abs() < 1e-9);
        let old = current.clone();
        current.shapes[0].bounds[1] -= 0.4;
        stabilize(&mut current, &old, 1920);
        assert!(
            (current.shapes[0].bounds[1] + current.shapes[0].bounds[3] - 8.55).abs() < 1e-9,
            "a real lift still follows in the first frame"
        );
    }
    #[test]
    fn stabilization_stops_stroke_growth_but_follows_hover_and_disappearance() {
        let base = Silhouette {
            id: "tile-0".into(),
            bounds: [2.0, 7.7, 0.76, 1.25],
            paths: vec![vec![[2.0, 7.7], [2.76, 7.7], [2.76, 8.95], [2.0, 8.95]]],
        };
        let old = ContourFrame {
            key: "same".into(),
            generation: 1,
            shapes: vec![base.clone()],
        };
        let mut jitter = old.clone();
        jitter.shapes[0].bounds = [1.99, 7.69, 0.78, 1.27];
        stabilize(&mut jitter, &old, 1920);
        assert_eq!(
            jitter.shapes[0].bounds, base.bounds,
            "re-sampling a 1–2 px HUD edge must not make it grow"
        );
        let mut both_edges = old.clone();
        both_edges.shapes[0].bounds = [1.984, 7.684, 0.792, 1.282];
        stabilize(&mut both_edges, &old, 1920);
        assert_eq!(
            both_edges.shapes[0].bounds, base.bounds,
            "a 1.92 px expansion on each edge is stroke feedback, even though width grows 3.84 px"
        );
        let mut lifted = old.clone();
        lifted.shapes[0].bounds[1] -= 0.4;
        stabilize(&mut lifted, &old, 1920);
        assert_eq!(
            lifted.shapes[0].bounds[1], 7.3,
            "a real hover lift follows immediately"
        );
        let mut absent = old.clone();
        absent.shapes.clear();
        stabilize(&mut absent, &old, 1920);
        assert!(absent.shapes.is_empty(), "never retain a vanished control");
        let mut next = old.clone();
        next.generation = 2;
        next.shapes[0].bounds[0] -= 0.01;
        stabilize(&mut next, &old, 1920);
        assert_ne!(
            next.shapes[0].bounds, base.bounds,
            "never carry geometry across requests"
        );
    }
    #[test]
    #[ignore = "opt-in analysis of a user-supplied screenshot, never a live screen capture"]
    fn supplied_screenshot_diagnostic() {
        let path = std::env::var("AKAGI_SUPPLIED_BGRA")
            .expect("path to supplied screenshot converted to BGRA");
        let p = std::fs::read(path).unwrap();
        let targets = (0..14)
            .map(|i| {
                target(
                    &format!("tile-{i}"),
                    "tile",
                    2.23125 + i as f64 * 0.790625 + if i == 13 { 0.246875 } else { 0.0 },
                    8.3625,
                    0.762,
                    1.19,
                )
            })
            .collect();
        let result = detect(
            &p,
            1920,
            1080,
            &ContourRequest {
                key: "supplied".into(),
                targets,
            },
        );
        for s in &result.shapes {
            println!(
                "{} {:?} {} vertices",
                s.id,
                s.bounds.map(|v| v * 120.0),
                s.paths.iter().map(Vec::len).sum::<usize>()
            );
        }
        // This supplied image contains the OLD HUD strokes and labels. It can
        // expose self-capture contamination, but cannot prove clean edge fit.
        println!("diagnostic only: old HUD obscures the lifted tile and splits the draw; do not treat shape count as an alignment assertion");
    }
}
