"""Convert the existing MAKA sprite into Windows application/shortcut icons.

Uses the original sprite unchanged apart from resampling and file conversion.
Requires Pillow; run from any working directory.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "frontend/public/maka/common/maka_match_analysis_button_open.png"
OUTPUT = ROOT / "icons"


def main():
    source = Image.open(SOURCE).convert("RGBA")
    for filename, size in [
        ("icon.png", 512),
        ("32x32.png", 32),
        ("64x64.png", 64),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
    ]:
        source.resize((size, size), Image.Resampling.LANCZOS).save(OUTPUT / filename)
    source.resize((256, 256), Image.Resampling.LANCZOS).save(
        OUTPUT / "icon.ico",
        sizes=[(n, n) for n in (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)],
    )
    print("Updated MAKA Windows icons, including 10 ICO resolutions.")


if __name__ == "__main__":
    main()
