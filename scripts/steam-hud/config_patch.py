"""Prepare a TOML candidate without printing credentials or changing other settings."""
import re
import sys
import tomllib
from pathlib import Path

HEADER = re.compile(r'^\[([^\]\r\n]+)\][^\r\n]*(?:\r?\n|$)', re.M)

def sections(text):
    headers = list(HEADER.finditer(text))
    return [(h.group(1).strip(), h.start(), headers[i + 1].start() if i + 1 < len(headers) else len(text))
            for i, h in enumerate(headers)]

def overlay_sections(text):
    return [(start, end) for name, start, end in sections(text) if name == 'overlay' or name.startswith('overlay.')]

def merge_overlay(text, replacement):
    spans = overlay_sections(text)
    if not spans:
        return text.rstrip() + '\n\n' + replacement
    pieces, cursor = [], 0
    for index, (start, end) in enumerate(spans):
        pieces.append(text[cursor:start])
        if index == 0:
            pieces.append(replacement.rstrip() + '\n\n')
        cursor = end
    return ''.join(pieces) + text[cursor:]

def validate(before_text, after_text):
    before, after = tomllib.loads(before_text), tomllib.loads(after_text)
    before.pop('overlay', None)
    after.pop('overlay', None)
    if before != after:
        raise ValueError('Refusing a change outside the overlay configuration')
    return after_text

def enable(text):
    tomllib.loads(text)
    blocks = ''.join(text[start:end] for start, end in overlay_sections(text))
    if not any(name == 'overlay' for name, _, _ in sections(blocks)):
        blocks = '[overlay]\n' + blocks
    root = next((start, end) for name, start, end in sections(blocks) if name == 'overlay')
    body = blocks[root[0]:root[1]]
    for key in ('enabled', 'immersive', 'show_analysis', 'show_risk'):
        pattern = re.compile(r'^' + key + r'\s*=.*$', re.M)
        if pattern.search(body):
            body = pattern.sub(key + ' = true', body)
        else:
            body = body.rstrip() + '\n' + key + ' = true\n'
    blocks = blocks[:root[0]] + body.rstrip() + '\n' + blocks[root[1]:]
    return validate(text, merge_overlay(text, blocks))

def restore(current, backup):
    tomllib.loads(backup)
    old_overlay = ''.join(backup[start:end] for start, end in overlay_sections(backup))
    return validate(current, merge_overlay(current, old_overlay))

if __name__ == '__main__':
    mode, source, destination, *extra = sys.argv[1:]
    text = Path(source).read_text(encoding='utf-8-sig')
    if mode == 'enable':
        result = enable(text)
    elif mode == 'restore' and len(extra) == 1:
        result = restore(text, Path(extra[0]).read_text(encoding='utf-8-sig'))
    else:
        raise SystemExit('Expected enable INPUT OUTPUT or restore INPUT OUTPUT BACKUP')
    Path(destination).write_text(result, encoding='utf-8', newline='\n')
