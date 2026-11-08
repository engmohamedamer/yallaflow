"""Build docs/images/tour/hero.gif, the README's animated hero (PF-0076).

Four real console screens from the tour (captured by capture.mjs), each with a caption band:
a request moving, an item at work, an item done and proven, and the project running.

Usage: python3 research/docs-tour/make-hero.py   (needs Pillow and the Noto Sans fonts)
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
TOUR = os.path.join(HERE, '..', '..', 'docs', 'images', 'tour')
WIDTH = 960
BAND = 72
NAVY = (10, 17, 31)
TEAL = (78, 208, 165)
BLUE = (100, 133, 206)
WHITE = (232, 238, 245)
MUTED = (154, 171, 189)
FONT_DIR = '/usr/share/fonts/truetype/noto'
BOLD = ImageFont.truetype(os.path.join(FONT_DIR, 'NotoSans-Bold.ttf'), 24)
REGULAR = ImageFont.truetype(os.path.join(FONT_DIR, 'NotoSans-Regular.ttf'), 18)

FRAMES = [
    ('03-work-board-en', '1', 'Describe it in your words', 'Your agent picks it up. Every request moves, % from evidence.'),
    ('04-item-in-progress-en', '2', 'Understand → Decide → Change → Verify', 'Each station hands off what it learned; the next step is always named.'),
    ('05-item-done-en', '3', 'Done means proven', 'Verified with evidence, then remembered for the next session.'),
    ('09-setup-running-en', '4', 'Press Start project', 'The agent proposed how it runs; you trusted it once. One page to run it.'),
]


def frame(name, step, title, line):
    shot = Image.open(os.path.join(TOUR, name + '.webp')).convert('RGB')
    shot = shot.resize((WIDTH, round(shot.height * WIDTH / shot.width)), Image.LANCZOS)
    shot = shot.crop((0, 0, WIDTH, 540))  # the top of each screen carries the story
    canvas = Image.new('RGB', (WIDTH, BAND + shot.height), NAVY)
    canvas.paste(shot, (0, BAND))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((20, 18, 56, 54), radius=9, fill=TEAL)
    draw.text((38, 36), step, font=BOLD, fill=NAVY, anchor='mm')
    draw.text((72, 9), title, font=BOLD, fill=WHITE)
    draw.text((72, 42), line, font=REGULAR, fill=MUTED)
    for i in range(4):  # progress dots
        x = WIDTH - 30 - (3 - i) * 22
        draw.ellipse((x - 6, 30, x + 6, 42), fill=TEAL if i <= int(step) - 1 else (43, 62, 84))
    draw.line((0, BAND - 1, WIDTH, BAND - 1), fill=BLUE, width=2)
    return canvas


frames = [frame(*spec) for spec in FRAMES]
palette = [f.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f in frames]
out = os.path.join(TOUR, 'hero.gif')
palette[0].save(out, save_all=True, append_images=palette[1:], duration=[2600, 2600, 2600, 3200], loop=0, optimize=True, disposal=1)
print('wrote', os.path.relpath(out), f'{os.path.getsize(out) / 1024:.0f} KB')
