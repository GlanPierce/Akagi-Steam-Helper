"""Inspect legacy LiaosheSelect clips; these are NOT the active menu motion.

The current prefab's Animator is disabled. The menu uses Lua UIBase tweens;
frontend nativeMenuMotion.json records the verified runtime parameters instead.
Diagnostic output uses a legacy prefix so it cannot overwrite the live tracks.
"""
import argparse
import hashlib
import json
import math
import struct
import sys
import warnings
from pathlib import Path

BUNDLE = '$0qqs7$z0kyy08ol$h_779kibqvljddfjxtykkmc_657e2ad311900e2bf5a2.majset'


def decode_stream(words):
    raw = struct.pack('<' + 'I' * len(words), *words)
    curves = {}
    offset = 0
    while offset < len(raw):
        time, count = struct.unpack_from('<fi', raw, offset)
        offset += 8
        for _ in range(count):
            index, *coefficients = struct.unpack_from('<i4f', raw, offset)
            offset += 20
            if math.isfinite(time) and time >= 0:
                curves.setdefault(index, []).append((time, coefficients))
    return curves


def sample(keys, time):
    start, (a, b, c, d) = next(key for key in reversed(keys) if key[0] <= time + 1e-7)
    delta = max(0, time - start)
    return ((a * delta + b) * delta + c) * delta + d


def export(bundles, output):
    import UnityPy
    UnityPy.config.FALLBACK_UNITY_VERSION = '2022.3.62f1'
    source = bundles / BUNDLE
    result = {'source': BUNDLE, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'clips': {}}
    css = ['/* Disabled legacy UI_LiaosheSelect clips, for diagnostics only. */']
    for obj in UnityPy.load(str(source)).objects:
        if obj.type.name != 'AnimationClip':
            continue
        clip = obj.read_typetree()
        phase = 'in' if clip['m_Name'].endswith('_in') else 'out'
        muscle = clip['m_MuscleClip']
        bindings = clip['m_ClipBindingConstant']['genericBindings']
        # CRC32: CanvasGroup.m_Alpha; heads/RectTransform.m_AnchoredPosition.x.
        assert bindings[0]['path'] == 0 and bindings[0]['attribute'] == 1574349066
        assert bindings[1]['path'] == 3792757650 and bindings[1]['attribute'] == 1460864421
        curves = decode_stream(muscle['m_Clip']['data']['m_StreamedClip']['data'])
        duration = muscle['m_StopTime']
        frames = round(duration * clip['m_SampleRate'])
        points = []
        for frame in range(frames + 1):
            time = frame * duration / frames
            points.append({'offset': frame / frames, 'opacity': round(max(0, min(1, sample(curves[0], time))), 6), 'x': round(sample(curves[1], time) + 73, 6)})
        result['clips'][phase] = {'name': clip['m_Name'], 'durationMs': round(duration * 1000, 6), 'points': points}
        for kind in ('fade', 'slide', 'page'):
            css.append(f'@keyframes legacy-menu-{kind}-{phase} {{')
            for point in points:
                props = []
                if kind in ('fade', 'page'):
                    props.append(f"opacity: {point['opacity']}")
                if kind in ('slide', 'page'):
                    props.append(f"translate: {point['x']}px 0")
                css.append(f"  {point['offset'] * 100:.6f}% {{ {'; '.join(props)}; }}")
            css.append('}')
    output.mkdir(parents=True, exist_ok=True)
    (output / 'legacyMenuMotion.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    (output / 'legacyMenuMotion.css').write_text('\n'.join(css) + '\n', encoding='utf-8')
    print({phase: clip['durationMs'] for phase, clip in result['clips'].items()})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundles', type=Path, required=True)
    parser.add_argument('--unitypy-dir', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.unitypy_dir.resolve()))
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        export(args.bundles, args.output)
