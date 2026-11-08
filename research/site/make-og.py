"""Build the social link-preview cards: site/og-image.jpg (English) and site/og-image-ar.jpg (PF-0080).

1200x630, under 300 KB (WhatsApp and most chat apps skip larger previews). Left: the logo, the
tagline and real numbers. Right: a real console screen (the DmagAI Flow board).

Usage: python3 research/site/make-og.py <real-flow screenshot (en)> <real-flow screenshot (ar)>
Needs Pillow with libraqm (Arabic shaping) and the Noto fonts.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(HERE, '..', '..', 'site')
W, H = 1200, 630
NAVY = (10, 17, 31)
TEAL = (78, 208, 165)
BLUE = (100, 133, 206)
WHITE = (232, 238, 245)
MUTED = (154, 171, 189)
NOTO = '/usr/share/fonts/truetype/noto/'

COPY = {
    'en': {
        'font': (NOTO + 'NotoSans-Bold.ttf', NOTO + 'NotoSans-Regular.ttf'),
        'kicker': 'YallaFlow 1.4.1',
        'title': ['Give AI your project,', 'not just your prompt.'],
        'line': 'Memory, workflow and proof for your coding agent',
        'stats': [('64', 'work items'), ('216', 'verifications'), ('61', 'done')],
        'proof': 'From a real project run on it since October',
        'rtl': False,
    },
    'ar': {
        'font': (NOTO + 'NotoSansArabic-Bold.ttf', NOTO + 'NotoSansArabic-Regular.ttf'),
        'kicker': 'YallaFlow 1.4.1',
        'title': ['ادّي الذكاء الاصطناعي', 'مشروعك، مش بس طلبك.'],
        'line': 'ذاكرة وطريقة شغل وإثبات لوكلاء البرمجة',
        'stats': [('64', 'شغلانة'), ('216', 'عملية تحقّق'), ('61', 'خلصت')],
        'proof': 'من مشروع حقيقي شغّال بيه من أكتوبر',
        'rtl': True,
    },
}


def card(lang, screen_path):
    c = COPY[lang]
    bold = lambda size: ImageFont.truetype(c['font'][0], size)
    regular = lambda size: ImageFont.truetype(c['font'][1], size)
    mono = ImageFont.truetype(NOTO + 'NotoSans-Bold.ttf', 22)
    img = Image.new('RGB', (W, H), NAVY)
    # Soft brand glow.
    glow = Image.new('RGB', (W, H), NAVY)
    gd = ImageDraw.Draw(glow)
    gd.ellipse((W * 0.45, -200, W * 1.3, H * 0.9), fill=(22, 40, 70))
    gd.ellipse((-200, H * 0.4, W * 0.4, H * 1.4), fill=(14, 48, 46))
    img = Image.blend(img, glow.filter(ImageFilter.GaussianBlur(90)), 0.9)
    draw = ImageDraw.Draw(img)

    # The real screen, framed, on the far side.
    shot = Image.open(screen_path).convert('RGB')
    sw = 500
    shot = shot.resize((sw, round(shot.height * sw / shot.width)), Image.LANCZOS)
    sh = shot.height
    top = (H - sh) // 2
    frame = Image.new('RGB', (sw + 4, sh + 4), BLUE)
    frame.paste(shot, (2, 2))
    x = 40 if c['rtl'] else W - sw - 40
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x + 10, top + 12, x + sw + 14, top + sh + 16), radius=18, fill=(0, 0, 0, 150))
    img.paste(Image.alpha_composite(Image.new('RGBA', (W, H), (0, 0, 0, 0)), shadow.filter(ImageFilter.GaussianBlur(18))), (0, 0), shadow.filter(ImageFilter.GaussianBlur(18)))
    mask = Image.new('L', frame.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, frame.size[0] - 1, frame.size[1] - 1), radius=14, fill=255)
    img.paste(frame, (x, top), mask)
    draw = ImageDraw.Draw(img)

    # Text column.
    left = W - 60 if c['rtl'] else 60
    anchor = 'ra' if c['rtl'] else 'la'
    # Logo mark (>>).
    mx = W - 60 - 52 if c['rtl'] else 60
    for i, colour in enumerate((TEAL, BLUE)):
        ox = mx + i * 24
        draw.line([(ox, 58), (ox + 18, 76), (ox, 94)], fill=colour, width=9, joint='curve')
    draw.text((W - 60 - 66 if c['rtl'] else 132, 60), c['kicker'], font=mono, fill=WHITE, anchor='ra' if c['rtl'] else 'la')
    y = 130
    for line in c['title']:
        draw.text((left, y), line, font=bold(40 if c['rtl'] else 42), fill=WHITE, anchor=anchor)
        y += 58
    draw.text((left, y + 8), c['line'], font=regular(20), fill=MUTED, anchor=anchor)
    # Stat chips.
    y += 64
    cx = left
    for number, label in c['stats']:
        nf, lf = bold(34), regular(17)
        nw = draw.textlength(number, font=nf)
        lw = draw.textlength(label, font=lf)
        bw = max(nw, lw) + 36
        x0, x1 = (cx - bw, cx) if c['rtl'] else (cx, cx + bw)
        draw.rounded_rectangle((x0, y, x1, y + 92), radius=14, fill=(19, 31, 52), outline=(43, 62, 84), width=2)
        draw.text(((x0 + x1) / 2, y + 12), number, font=nf, fill=TEAL, anchor='ma')
        draw.text(((x0 + x1) / 2, y + 58), label, font=lf, fill=MUTED, anchor='ma')
        cx = x0 - 12 if c['rtl'] else x1 + 12
    draw.text((left, y + 116), c['proof'], font=regular(19), fill=TEAL, anchor=anchor)
    draw.text((left, H - 44), 'engmohamedamer.github.io/yallaflow', font=regular(18) if not c['rtl'] else ImageFont.truetype(NOTO + 'NotoSans-Regular.ttf', 18), fill=MUTED, anchor=anchor)
    return img


for lang, path in (('en', sys.argv[1]), ('ar', sys.argv[2])):
    out = os.path.join(SITE, 'og-image.jpg' if lang == 'en' else 'og-image-ar.jpg')
    card(lang, path).save(out, 'JPEG', quality=86, optimize=True, progressive=True)
    print('wrote', os.path.relpath(out), f'{os.path.getsize(out) / 1024:.0f} KB')
