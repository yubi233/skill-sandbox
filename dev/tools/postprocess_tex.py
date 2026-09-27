#!/usr/bin/env python3
"""AI 生成贴图 → 引擎贴图后处理。

统一约定(与 particles.js 程序化贴图一致):
  RGB = 纯白(技能通过 uColor 染色),结构全部压进 alpha。

处理顺序:
  1. 修复右下角平台水印:用旋转 180° 的左上角补丁覆盖(素材近似径向构图时无痕);
  2. 推导 alpha,自动判底:
     - 素材自带真 alpha → 直接用;
     - 四角接近纯黑 → 亮度键 (lum-floor)/(1-floor),暗底透明、发光结构保留;
     - 其它(白底/花底) → 白键 255-min(r,g,b);
  3. RGB 置白,缩到 512,导出带 alpha 的 PNG。

用法: python3 postprocess_tex.py 输入.png 输出.png [--no-corner-patch]
"""
import sys
import numpy as np
from PIL import Image


def process(src, dst, corner_patch=True, symmetry=0, size=512):
    im = Image.open(src).convert('RGBA')
    w, h = im.size
    arr = np.asarray(im).astype(np.float32)

    # 1) 水印修复:绕画布中心旋转 90° 取同半径带内容贴回右下角(占 30% 边长)。
    #    径向构图的贴花,同半径带比 180° 对角内容更贴合,且水印随旋转转出取样区;
    #    内缘(左/上)羽化消除方形接缝。水印贴着图边,羽化够不到它。
    if corner_patch:
        m = int(min(w, h) * 0.30)
        rot = im.rotate(90, resample=Image.BICUBIC, center=(w / 2, h / 2))
        patch = rot.crop((w - m, h - m, w, h))
        mask = np.ones((m, m), np.float32)
        ramp = max(2, int(m * 0.22))
        for i in range(ramp):
            f = i / ramp
            mask[i, :] = np.minimum(mask[i, :], f)
            mask[:, i] = np.minimum(mask[:, i], f)
        im.paste(patch, (w - m, h - m), Image.fromarray((mask * 255).astype(np.uint8), 'L'))
        arr = np.asarray(im).astype(np.float32)

    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
    lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0
    alpha_band = a.min()

    if alpha_band < 250:                      # 真 alpha
        key = a / 255.0
        mode = 'real-alpha'
    else:
        corners = np.concatenate([lum[:32, :32].ravel(), lum[:32, -32:].ravel(),
                                  lum[-32:, :32].ravel(), lum[-32:, -32:].ravel()])
        floor = float(np.clip(corners.mean(), 0.0, 0.30))
        if corners.mean() < 0.25:             # 黑底 → 亮度键
            key = np.clip((lum - floor) / (1.0 - floor), 0.0, 1.0)
            mode = f'lum-key(floor={floor:.3f})'
        else:                                 # 白底 → 白键
            key = 1.0 - np.minimum(np.minimum(r, g), b) / 255.0
            mode = 'white-key'

    # 只做温和提亮:大幅 gamma 会把暗岩区抬成苍白光盘,反而洗掉裂纹定义
    key = np.power(key, 0.92)
    key = np.clip(key, 0.0, 1.0)

    out_a = (key * 255.0).round().clip(0, 255).astype(np.uint8)
    out = np.dstack([np.full_like(out_a, 255), np.full_like(out_a, 255),
                     np.full_like(out_a, 255), out_a])
    # 旋转对称化(法阵类):在白光+alpha 成品上按 N 等分角度平均。
    # 必须放在这里——对原图旋转平均会把旋转覆盖误判成真 alpha,且会把水印抹进所有象限。
    if symmetry and symmetry >= 2:
        im2 = Image.fromarray(out, 'RGBA')
        acc = np.asarray(im2).astype(np.float32)
        for k in range(1, symmetry):
            acc += np.asarray(im2.rotate(360.0 * k / symmetry, resample=Image.BICUBIC,
                                         fillcolor=(255, 255, 255, 0))).astype(np.float32)
        out = (acc / symmetry).clip(0, 255).astype(np.uint8)
    res = Image.fromarray(out, 'RGBA').resize((size, size), Image.LANCZOS)
    # LANCZOS 的预乘/反算会在低 alpha 边缘把 RGB 压暗;可见像素必须强制回纯白
    ra = np.asarray(res).copy()
    ra[..., :3] = 255
    res = Image.fromarray(ra, 'RGBA')
    res.save(dst, 'PNG', optimize=True)

    aa = np.asarray(res)[..., 3]
    return {'mode': mode, 'coverage': round(float((aa > 16).mean()), 4),
            'mean_alpha': round(float(aa.mean()), 2)}


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    patch = '--no-corner-patch' not in sys.argv
    sym = 0
    for a in sys.argv:
        if a.startswith('--symmetry='):
            sym = int(a.split('=')[1])
    print(process(args[0], args[1], corner_patch=patch, symmetry=sym))
