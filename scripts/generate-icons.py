#!/usr/bin/env python3
"""
sshk-tools 品牌图标生成器 —— 纯 Python 标准库，零第三方依赖。

设计：深色圆角方底 + 2x2 彩色模块（工具集合）+ 中心连接点 + 右上 AI 星芒。
小尺寸(16px)仍可辨识为四色模块，适合做应用图标 / 桌面图标 / 托盘图标。

产物：
  apps/desktop/build/icon.png      1024x1024  主图标（mac/Linux 源）
  apps/desktop/build/icon.ico      多尺寸     Windows 图标
  apps/desktop/build/tray.png      32x32      托盘图标（透明底）
  apps/desktop/build/tray@2x.png   64x64      托盘图标 @2x
  docs/assets/logo-mark.png        256x256    Logo 图形（文档用）

运行： python scripts/generate-icons.py
"""
from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "apps" / "desktop" / "build"
DOCS = ROOT / "docs" / "assets"

BG_TOP = (26, 31, 54)
BG_BOTTOM = (11, 14, 28)
RIM = (96, 112, 164)
BLOCKS = [
    (34, 211, 238),   # 青
    (79, 140, 255),   # 蓝
    (139, 124, 246),  # 紫
    (255, 159, 67),   # 橙
]
CELLS = [(0.205, 0.205), (0.545, 0.205), (0.205, 0.545), (0.545, 0.545)]
CELL_HALF = 0.125
CELL_RADIUS = 0.052


def clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if v < lo else (hi if v > hi else v)


def mix(a, b, t: float):
    t = clamp(t)
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def sd_round(x, y, cx, cy, hx, hy, r):
    qx = abs(x - cx) - (hx - r)
    qy = abs(y - cy) - (hy - r)
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r


def cover(sd: float, aa: float) -> float:
    return clamp(0.5 - sd / aa)


def star_cover(dx, dy, r, aa):
    # 两条交叉菱形 -> 四角星
    d = min(abs(dx) + abs(dy) * 2.3, abs(dx) * 2.3 + abs(dy))
    return cover(d - r, aa)


def shade(x, y, aa: float, tray: bool):
    if tray:
        col = (0.0, 0.0, 0.0)
        alpha = 0.0
        for bx, by in CELLS:
            sd = sd_round(x, y, bx + CELL_HALF, by + CELL_HALF,
                          CELL_HALF, CELL_HALF, CELL_RADIUS)
            c = cover(sd, aa)
            if c > 0:
                col = mix(col, (236, 243, 255), c)
                alpha = max(alpha, c)
        return col, alpha

    # 背景圆角方形
    sd_bg = sd_round(x, y, 0.5, 0.5, 0.478, 0.478, 0.215)
    a = cover(sd_bg, aa)
    if a <= 0:
        return (0.0, 0.0, 0.0), 0.0

    col = mix(BG_TOP, BG_BOTTOM, y)
    # 内边缘高光细线
    rim = cover(abs(sd_bg + 0.010) - 0.0035, aa)
    col = mix(col, RIM, rim * 0.55)

    for idx, (bx, by) in enumerate(CELLS):
        sd = sd_round(x, y, bx + CELL_HALF, by + CELL_HALF,
                      CELL_HALF, CELL_HALF, CELL_RADIUS)
        c = cover(sd, aa)
        if c > 0:
            hi = clamp((0.055 - (y - by)) / 0.055) * 0.16
            tone = tuple(min(255.0, v + 255.0 * hi) for v in BLOCKS[idx])
            col = mix(col, tone, c)

    # 中心连接点
    d = math.hypot(x - 0.5, y - 0.5)
    col = mix(col, (242, 247, 255), cover(d - 0.036, aa) * 0.92)

    # 右上 AI 星芒
    col = mix(col, (255, 255, 255), star_cover(x - 0.67, y - 0.33, 0.070, aa) * 0.95)
    return col, a


def render(size: int, tray: bool = False) -> bytes:
    aa = 1.0 / size
    buf = bytearray(size * size * 4)
    for j in range(size):
        y = (j + 0.5) / size
        row = j * size * 4
        for i in range(size):
            x = (i + 0.5) / size
            (r, g, b), a = shade(x, y, aa, tray)
            o = row + i * 4
            buf[o] = int(clamp(r / 255.0) * 255)
            buf[o + 1] = int(clamp(g / 255.0) * 255)
            buf[o + 2] = int(clamp(b / 255.0) * 255)
            buf[o + 3] = int(clamp(a) * 255)
    return bytes(buf)


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def png_bytes(size: int, pixels: bytes) -> bytes:
    stride = size * 4
    raw = b"".join(b"\x00" + pixels[y * stride:(y + 1) * stride] for y in range(size))
    return (b"\x89PNG\r\n\x1a\n"
            + png_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + png_chunk(b"IDAT", zlib.compress(raw, 9))
            + png_chunk(b"IEND", b""))


def write_png(path: Path, size: int, tray: bool = False):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = png_bytes(size, render(size, tray))
    path.write_bytes(data)
    return len(data)


def write_ico(path: Path, sizes):
    blobs = [(s, png_bytes(s, render(s))) for s in sizes]
    header = struct.pack("<HHH", 0, 1, len(blobs))
    offset = 6 + 16 * len(blobs)
    entries, body = b"", b""
    for s, data in blobs:
        w = 0 if s >= 256 else s  # ICO 规范：0 表示 256
        entries += struct.pack("<BBBBHHII", w, w, 0, 0, 1, 32, len(data), offset)
        body += data
        offset += len(data)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + entries + body)
    return path.stat().st_size


def main():
    BUILD.mkdir(parents=True, exist_ok=True)
    DOCS.mkdir(parents=True, exist_ok=True)
    made = {
        "icon.png": write_png(BUILD / "icon.png", 1024),
        "logo-mark.png": write_png(DOCS / "logo-mark.png", 256),
        "tray.png": write_png(BUILD / "tray.png", 32, tray=True),
        "tray@2x.png": write_png(BUILD / "tray@2x.png", 64, tray=True),
        "icon.ico": write_ico(BUILD / "icon.ico", [16, 24, 32, 48, 64, 128, 256]),
    }
    print("sshk-tools 图标生成完成（纯标准库，零依赖）")
    for name, size in made.items():
        print(f"  {name:<16} {size:>8,} bytes")
    print(f"  输出目录       : {BUILD}")
    print(f"  文档图形       : {DOCS / 'logo-mark.png'}")


if __name__ == "__main__":
    main()
