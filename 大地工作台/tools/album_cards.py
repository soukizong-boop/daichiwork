#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ALA 相册卡片生成器（工作台工具，给「ALA 商品页」模版用）。
用法：python3 tools/album_cards.py spec.json 输出文件夹
spec.json：{"cards":[ ... ]}，每张卡一个对象，按顺序输出 01.jpg、02.jpg…（也可给 "name"）。
卡片类型：
  main    {"type":"main","img":路径,"mode":"cover|contain","fx":0.5,"fy":0.5,"crop":[x0,y0,x1,y1],"dark":false}
  point   {"type":"point","n":1,"title":"…","sub":"…","img":路径,"mode":"cover|contain","fx":0.5,"fy":0.5,"crop":[...]}
  triple  {"type":"triple","n":4,"title":"…","sub":"…","imgs":[路径,路径,路径]}
  grid    {"type":"grid","n":7,"title":"…","sub":"…","imgs":[6 张],"rows":2,"cols":3}
  spec    {"type":"spec","title":"仕様","sub":"…","img":路径,"tiles":[["重さ","35g",""],["サイズ","86×55×3.3","mm"]],"mode":"contain"}
  setcard {"type":"setcard","title":"セット内容","img":路径,"lines":["① 本体","② …"],"note":"※ …"}
版式＝20261106 定稿的金样：1200×1200、奶油底 (251,247,240)、POINT 0n 酒红、标题 W6 50、副标 W3 26、照片框 1104×876 圆角 28、右下 Ala&Co 字标 112px。
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(HERE, '..', 'assets', 'alaco-logo-wine.png')
BG = (251, 247, 240); TX = (42, 36, 34); SUB = (109, 97, 88); WINE = (138, 68, 76)
PX, PY, PW, PH = 48, 236, 1104, 876

def font(w, s):
    cands = [f'/System/Library/Fonts/ヒラギノ角ゴシック {w}.ttc', '/System/Library/Fonts/Hiragino Sans GB.ttc', '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc']
    for p in cands:
        try:
            return ImageFont.truetype(p, s)
        except Exception:
            continue
    return ImageFont.load_default()

def logo():
    try:
        l = Image.open(LOGO).convert('RGBA'); l = l.crop(l.getbbox())
        return l.resize((112, round(l.size[1] * 112 / l.size[0])), Image.LANCZOS)
    except Exception:
        return None

LW = logo()

def fit(im, w, h, mode='cover', fx=0.5, fy=0.5):
    im = im.convert('RGB'); iw, ih = im.size
    if mode == 'contain':
        sc = min(w / iw, h / ih); nw, nh = round(iw * sc), round(ih * sc)
        r = im.resize((nw, nh), Image.LANCZOS)
        bg = im.getpixel((2, 2))
        c = Image.new('RGB', (w, h), bg); c.paste(r, ((w - nw) // 2, (h - nh) // 2)); return c
    sc = max(w / iw, h / ih); nw, nh = round(iw * sc), round(ih * sc)
    r = im.resize((nw, nh), Image.LANCZOS)
    x = round((nw - w) * fx); y = round((nh - h) * fy)
    return r.crop((x, y, x + w, y + h))

def rounded(im, r=28):
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, im.size[0] - 1, im.size[1] - 1), r, fill=255)
    return m

def stamp(c, dark=False):
    if LW is not None:
        c.paste(LW, (1200 - 112 - 48, 1200 - LW.size[1] - 40), LW)
    return c

def head(c, n, title, sub):
    d = ImageDraw.Draw(c)
    if n:
        d.text((64, 56), f'POINT {int(n):02d}', font=font('W6', 22), fill=WINE)
    f = font('W6', 50)
    while d.textlength(title, font=f) > 1080 and f.size > 36:
        f = font('W6', f.size - 2)
    d.text((64, 92 if n else 70), title, font=f, fill=TX)
    if sub:
        fs = font('W3', 26)
        while d.textlength(sub, font=fs) > 1080 and fs.size > 20:
            fs = font('W3', fs.size - 1)
        d.text((66, 166 if n else 146), sub, font=fs, fill=SUB)

def load(p, crop=None):
    im = Image.open(p)
    try:
        im.seek(0)
    except Exception:
        pass
    if im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info):   # 透明底的 PNG：垫白底，不然透明处会变黑
        im = im.convert('RGBA'); bg = Image.new('RGBA', im.size, (255, 255, 255, 255)); bg.alpha_composite(im); im = bg
    im = im.convert('RGB')
    if crop:
        im = im.crop(tuple(crop))
    return im

def card_main(s):
    im = load(s['img'], s.get('crop'))
    c = fit(im, 1200, 1200, s.get('mode', 'cover'), s.get('fx', 0.5), s.get('fy', 0.5))
    return stamp(c, s.get('dark', False))

def card_point(s):
    c = Image.new('RGB', (1200, 1200), BG); head(c, s.get('n'), s['title'], s.get('sub', ''))
    p = fit(load(s['img'], s.get('crop')), PW, PH, s.get('mode', 'cover'), s.get('fx', 0.5), s.get('fy', 0.5))
    c.paste(p, (PX, PY), rounded(p)); return stamp(c)

def card_triple(s):
    c = Image.new('RGB', (1200, 1200), BG); head(c, s.get('n'), s['title'], s.get('sub', ''))
    w = (PW - 16 * 2) // 3
    for i, it in enumerate(s['imgs'][:3]):
        p = it if isinstance(it, str) else it.get('img'); crop = None if isinstance(it, str) else it.get('crop')
        t = fit(load(p, crop), w, PH, 'cover'); c.paste(t, (PX + i * (w + 16), PY), rounded(t, 22))
    return stamp(c)

def card_grid(s):
    rows, cols = int(s.get('rows', 2)), int(s.get('cols', 3))
    c = Image.new('RGB', (1200, 1200), BG); head(c, s.get('n'), s['title'], s.get('sub', ''))
    gw, gh = (PW - 14 * (cols - 1)) // cols, (PH - 14 * (rows - 1)) // rows
    for i, p in enumerate(s['imgs'][:rows * cols]):
        t = fit(load(p), gw, gh, 'cover'); c.paste(t, (PX + (i % cols) * (gw + 14), PY + (i // cols) * (gh + 14)), rounded(t, 18))
    return stamp(c)

def tile(d, x, y, w, h, label, val, unit):
    d.rounded_rectangle((x, y, x + w, y + h), 18, fill=(246, 242, 234))
    d.text((x + 24, y + 16), label, font=font('W6', 22), fill=SUB)
    fv = font('W7', 40); fu = font('W6', 22)
    while d.textlength(val, font=fv) > w - 48 - (d.textlength(unit, font=fu) + 12 if unit else 0) and fv.size > 26:
        fv = font('W7', fv.size - 2)
    d.text((x + 24, y + 50), val, font=fv, fill=TX)
    if unit:
        d.text((x + 24 + d.textlength(val, font=fv) + 12, y + 66), unit, font=fu, fill=SUB)

def card_spec(s):
    c = Image.new('RGB', (1200, 1200), BG); head(c, None, s.get('title', '仕様'), s.get('sub', '')); d = ImageDraw.Draw(c)
    imgw = int(s.get('imgw', 480))
    p = fit(load(s['img'], s.get('crop')), imgw, PH, s.get('mode', 'contain')); c.paste(p, (PX, PY), rounded(p))
    gx = PX + imgw + 24; gw = PX + PW - gx; tiles = s['tiles']; n = max(1, len(tiles)); th = (PH - 14 * (n - 1)) // n
    for i, t in enumerate(tiles):
        l, v, u = (list(t) + ['', '', ''])[:3]
        tile(d, gx, PY + i * (th + 14), gw, th, l, v, u)
    return stamp(c)

def card_setcard(s):
    imgh = int(s.get('imgh', 560))
    c = Image.new('RGB', (1200, 1200), BG); head(c, None, s.get('title', 'セット内容'), s.get('sub', '')); d = ImageDraw.Draw(c)
    p = fit(load(s['img'], s.get('crop')), PW, imgh, 'contain'); c.paste(p, (PX, PY), rounded(p))
    y = PY + imgh + 36
    for ln in s.get('lines', []):
        d.text((72, y), ln, font=font('W6', 36), fill=TX); y += 56
    if s.get('note'):
        d.text((72, 1200 - 40 - 30), s['note'], font=font('W3', 24), fill=SUB)
    return stamp(c)

MAKERS = {'main': card_main, 'point': card_point, 'triple': card_triple, 'grid': card_grid, 'spec': card_spec, 'setcard': card_setcard}

def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(2)
    spec = json.load(open(sys.argv[1], encoding='utf-8')); out = sys.argv[2]
    os.makedirs(out, exist_ok=True)
    made = []
    for i, s in enumerate(spec['cards']):
        t = s.get('type')
        if t not in MAKERS:
            raise SystemExit(f'第 {i + 1} 张：不认识的类型 {t}')
        img = MAKERS[t](s)
        name = s.get('name') or f'{i + 1:02d}'
        p = os.path.join(out, name if name.lower().endswith('.jpg') else name + '.jpg')
        img.save(p, quality=90); made.append(p)
    print(json.dumps({'ok': True, 'count': len(made), 'files': made}, ensure_ascii=False))

if __name__ == '__main__':
    main()
