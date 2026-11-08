"""Convert the captured tour PNGs to compact WebP (width 1600) for the docs (PF-0074).

Usage: python3 research/docs-tour/to-webp.py   (needs Pillow)
"""
import glob
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'docs', 'images', 'tour')
for png in sorted(glob.glob(os.path.join(OUT, '*.png'))):
    image = Image.open(png).convert('RGB')
    width, height = image.size
    if width > 1600:
        image = image.resize((1600, round(height * 1600 / width)), Image.LANCZOS)
    image.save(png[:-4] + '.webp', 'WEBP', quality=82, method=6)
    os.remove(png)
    print('wrote', os.path.relpath(png[:-4] + '.webp'))
