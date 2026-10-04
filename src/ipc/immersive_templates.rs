//! Original Steam control silhouettes; screen pixels determine only pose/visibility.
use super::immersive_contours::{Silhouette, VisualTarget};
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize)]
struct Pack {
    templates: Vec<Template>,
}
#[derive(Deserialize)]
struct Template {
    actions: Vec<String>,
    width: f64,
    height: f64,
    bounds: [f64; 4],
    paths: Vec<Vec<[f64; 2]>>,
    samples: Vec<[f64; 8]>,
}
fn templates() -> &'static [Template] {
    static PACK: OnceLock<Pack> = OnceLock::new();
    &PACK
        .get_or_init(|| {
            serde_json::from_str(include_str!("steam_controls.json"))
                .expect("embedded Steam control pack")
        })
        .templates
}

#[derive(Clone, Copy)]
struct Pose {
    x: f64,
    y: f64,
    scale: f64,
    error: f64,
}

struct Screen<'a> {
    pixels: &'a [u8],
    width: usize,
    height: usize,
}
impl Screen<'_> {
    fn rgb(&self, x: f64, y: f64) -> [f64; 3] {
        let x = x.clamp(0., (self.width - 2) as f64);
        let y = y.clamp(0., (self.height - 2) as f64);
        let (ix, iy) = (x as usize, y as usize);
        let (dx, dy) = (x - ix as f64, y - iy as f64);
        let at = (iy * self.width + ix) * 4;
        std::array::from_fn(|c| {
            let c = 2 - c;
            let upper =
                self.pixels[at + c] as f64 * (1. - dx) + self.pixels[at + 4 + c] as f64 * dx;
            let lower = self.pixels[at + self.width * 4 + c] as f64 * (1. - dx)
                + self.pixels[at + self.width * 4 + 4 + c] as f64 * dx;
            upper * (1. - dy) + lower * dy
        })
    }
    fn score(&self, t: &Template, p: Pose, stride: usize) -> f64 {
        if p.x < 0.
            || p.y < 0.
            || p.x + t.width * p.scale >= self.width as f64
            || p.y + t.height * p.scale >= self.height as f64
        {
            return f64::INFINITY;
        }
        // Opaque interior reference points are at least 3.5 original pixels
        // inside the sprite: antialiased HUD strokes are never edge evidence.
        let mut observed = [[0.; 3]; 256];
        // Small controls are minified by Unity and by any capture downsampling.
        // Compare the matching filtered reference, not crisp high-res glyph
        // samples; keep the visibility threshold identical at all resolutions.
        let blur = ((1. - p.scale) / 0.4).clamp(0., 1.);
        let reference =
            |sample: &[f64; 8], c: usize| sample[c + 2] + blur * (sample[c + 5] - sample[c + 2]);
        let (mut dot, mut norm) = (0., 0.);
        for (i, sample) in t.samples.iter().step_by(stride).enumerate() {
            let rgb = self.rgb(p.x + sample[0] * p.scale, p.y + sample[1] * p.scale);
            observed[i] = rgb;
            for c in 0..3 {
                let value = reference(sample, c);
                dot += rgb[c] * value;
                norm += value * value;
            }
        }
        // Unity tints a hovered/pressed control. Fit its gain without changing
        // the original alpha geometry or accepting arbitrary background colors.
        let gain = (dot / norm.max(1.)).clamp(0.65, 1.2);
        let mut error = 0.;
        let mut count = 0;
        for (i, sample) in t.samples.iter().step_by(stride).enumerate() {
            let squared: f64 = (0..3)
                .map(|c| (observed[i][c] - reference(sample, c) * gain).powi(2))
                .sum();
            error += (squared / 3.).sqrt().min(70.);
            count += 1;
        }
        error / count.max(1) as f64
    }
}

pub(super) fn detect(
    pixels: &[u8],
    width: usize,
    height: usize,
    target: &VisualTarget,
) -> Option<Silhouette> {
    let action = target.id.strip_prefix("button-").unwrap_or(&target.id);
    let unit = width as f64 / 16.;
    let base_scale = unit / 100. * target.w / 2.25;
    if !(0.25..=6.).contains(&base_scale) {
        return None;
    }
    let screen = Screen {
        pixels,
        width,
        height,
    };
    let mut winner: Option<(&Template, Pose)> = None;
    for t in templates()
        .iter()
        .filter(|t| t.actions.iter().any(|a| a == action))
    {
        let cx = target.x * unit - (t.bounds[0] + t.bounds[2] / 2.) * base_scale;
        let cy = target.y * unit + 0.40 * unit - t.height * base_scale;
        let mut candidates: Vec<Pose> = Vec::with_capacity(17);
        let step = unit / 30.;
        for factor in [0.9, 0.95, 1., 1.05, 1.1, 1.15] {
            for dy in -10..=10 {
                for dx in -13..=13 {
                    let mut p = Pose {
                        x: cx + dx as f64 * step,
                        y: cy + dy as f64 * step,
                        scale: base_scale * factor,
                        error: 0.,
                    };
                    p.error = screen.score(t, p, 4);
                    if p.error.is_finite() {
                        let at = candidates.partition_point(|old| old.error < p.error);
                        if at < 16 {
                            candidates.insert(at, p);
                            candidates.truncate(16);
                        }
                    }
                }
            }
        }
        // Refine translation and scale together to subpixel precision, using
        // all samples so a repeated ribbon pattern cannot substitute its label.
        // Subsampling is only a coarse search: a minified, partly occluded
        // glyph can give one wrong pose the best sparse score. Re-rank a small
        // shortlist with the entire reference before committing to refinement.
        let Some(mut best) = candidates
            .into_iter()
            .map(|mut p| {
                p.error = screen.score(t, p, 1);
                p
            })
            .min_by(|a, b| a.error.total_cmp(&b.error))
        else {
            continue;
        };
        for (step, ds) in [
            (unit / 120., base_scale / 60.),
            (unit / 480., base_scale / 300.),
        ] {
            let origin = best;
            for ds_i in -2..=2 {
                for dy in -3..=3 {
                    for dx in -3..=3 {
                        let mut p = Pose {
                            x: origin.x + dx as f64 * step,
                            y: origin.y + dy as f64 * step,
                            scale: origin.scale + ds_i as f64 * ds,
                            error: 0.,
                        };
                        p.error = screen.score(t, p, 1);
                        if p.error < best.error {
                            best = p;
                        }
                    }
                }
            }
        }
        if winner
            .as_ref()
            .is_none_or(|(_, old)| best.error < old.error)
        {
            winner = Some((t, best));
        }
    }
    let (t, p) = winner?;
    // The reported gray skip with an old yellow stroke scores about 17; clean
    // controls score 3–5. Blue felt and different labels fail this gate.
    if p.error > 20. {
        return None;
    }
    Some(Silhouette {
        id: target.id.clone(),
        bounds: [
            (p.x + t.bounds[0] * p.scale) / unit,
            (p.y + t.bounds[1] * p.scale) / unit,
            t.bounds[2] * p.scale / unit,
            t.bounds[3] * p.scale / unit,
        ],
        paths: t
            .paths
            .iter()
            .map(|path| {
                path.iter()
                    .map(|q| [(p.x + q[0] * p.scale) / unit, (p.y + q[1] * p.scale) / unit])
                    .collect()
            })
            .collect(),
    })
}

/// Every pixel the bounded coarse/refinement search can sample, in screen pixels.
pub(super) fn sample_bounds(target: &VisualTarget, unit: f64) -> Option<[f64; 4]> {
    let action = target.id.strip_prefix("button-").unwrap_or(&target.id);
    let base = unit / 100. * target.w / 2.25;
    if !(0.25..=6.).contains(&base) {
        return None;
    }
    let mut bounds = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for t in templates()
        .iter()
        .filter(|t| t.actions.iter().any(|a| a == action))
    {
        let x = target.x * unit - (t.bounds[0] + t.bounds[2] / 2.) * base;
        let y = target.y * unit + 0.40 * unit - t.height * base;
        // Search translation plus both refinement stages; 2px covers bilinear reads.
        let dx = unit * (13. / 30. + 3. / 120. + 3. / 480.) + 2.;
        let dy = unit * (10. / 30. + 3. / 120. + 3. / 480.) + 2.;
        let scale = base * (1.15 + 2. / 60. + 2. / 300.);
        bounds[0] = bounds[0].min(x - dx);
        bounds[1] = bounds[1].min(y - dy);
        bounds[2] = bounds[2].max(x + dx + t.width * scale);
        bounds[3] = bounds[3].max(y + dy + t.height * scale);
    }
    bounds[0].is_finite().then_some(bounds)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_supported_operation_has_an_original_template() {
        for action in [
            "ron",
            "tsumo",
            "pon",
            "chi",
            "ankan",
            "kakan",
            "daiminkan",
            "reach",
            "pass",
            "kita",
            "ryukyoku",
        ] {
            assert!(
                templates()
                    .iter()
                    .any(|t| t.actions.iter().any(|a| a == action)),
                "{action}"
            );
        }
        for t in templates() {
            assert_eq!(t.samples.len(), 256);
            assert!(t.paths[0].len() > 20);
            assert!(t
                .samples
                .iter()
                .all(|p| p[0] >= 0. && p[0] < t.width && p[1] >= 0. && p[1] < t.height));
        }
    }
}
