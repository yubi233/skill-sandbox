#!/usr/bin/env python3
"""把 dev/qa/levels/s{id}_l{level}.png 拼成 9 行(技能) × 5 列(等级) 的对比大图。

用法:
    python3 dev/tools/qa_montage.py                 # 全量
    python3 dev/tools/qa_montage.py 3 5 9           # 只拼指定技能行
输出:
    dev/qa/levels-montage.png
"""
import sys, os, glob, re
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, 'dev/qa/levels')
DST = os.path.join(ROOT, 'dev/qa/levels-montage.png')

SKILLS = {
    1: '寒霜之矛', 2: '雷霆之矛', 3: '陨火天降', 4: '星光束', 5: '伏特禁城',
    6: '冰川王冠', 7: '疾风裂空', 8: '岩牙突刺', 9: '王之财宝',
}

CELL_W, CELL_H = 352, 220
LABEL_W = 150          # 左侧行标签宽
HEAD_H = 46            # 顶部列标签高
PAD = 6


def font(size):
    for p in ['/System/Library/Fonts/PingFang.ttc',
              '/System/Library/Fonts/Hiragino Sans GB.ttc',
              '/System/Library/Fonts/Supplemental/Arial Unicode.ttf']:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def main():
    ids = [int(a) for a in sys.argv[1:]] or sorted(SKILLS)
    rows = []
    for sid in ids:
        cells = []
        for lv in range(1, 6):
            p = os.path.join(SRC, f's{sid}_l{lv}.png')
            cells.append(Image.open(p).convert('RGB') if os.path.exists(p) else None)
        if any(c is not None for c in cells):
            rows.append((sid, cells))
    if not rows:
        sys.exit('没有找到截图: ' + SRC)

    W = LABEL_W + 5 * (CELL_W + PAD) + PAD
    H = HEAD_H + len(rows) * (CELL_H + PAD) + PAD
    canvas = Image.new('RGB', (W, H), (10, 13, 18))
    d = ImageDraw.Draw(canvas)
    f_head = font(20)
    f_row = font(21)
    f_cell = font(17)

    # 列标签
    for lv in range(1, 6):
        x = LABEL_W + PAD + (lv - 1) * (CELL_W + PAD)
        d.text((x + CELL_W // 2, 12), f'LV.{lv}', font=f_head, fill=(200, 173, 119), anchor='ma')

    for ri, (sid, cells) in enumerate(rows):
        y = HEAD_H + ri * (CELL_H + PAD)
        d.text((PAD, y + CELL_H // 2), SKILLS[sid], font=f_row, fill=(231, 236, 233), anchor='lm')
        for ci, img in enumerate(cells):
            x = LABEL_W + PAD + ci * (CELL_W + PAD)
            if img is None:
                d.rectangle([x, y, x + CELL_W, y + CELL_H], outline=(60, 66, 72))
                d.text((x + CELL_W // 2, y + CELL_H // 2), 'missing', font=f_cell, fill=(120, 60, 60), anchor='mm')
                continue
            thumb = img.resize((CELL_W, CELL_H), Image.LANCZOS)
            canvas.paste(thumb, (x, y))
            d.rectangle([x, y, x + CELL_W, y + CELL_H], outline=(48, 54, 60))

    canvas.save(DST)
    print(f'{DST}  {W}x{H}  {len(rows)} 行 x 5 列')


if __name__ == '__main__':
    main()
