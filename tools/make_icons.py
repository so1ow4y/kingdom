"""Генерирует PNG-иконки приложения без сторонних библиотек.

Запуск из корня проекта:  python tools/make_icons.py
Результат: icons/icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png, favicon-32.png
Нужен только при смене дизайна иконки — готовые файлы лежат в репозитории.
"""

import math
import os
import struct
import sys
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icons")

# 0.12 — Kingdom: золотая корона на багровом квадрате (0.11 — серп луны, раньше — галочка на индиго)
BG = (122, 18, 34)  # #7A1222
FG = (242, 196, 92)  # золото
# Корона: зубцы (многоугольник), обруч под ними и шарики на вершинах зубцов
CROWN = [(0.25, 0.64), (0.22, 0.35), (0.37, 0.49), (0.5, 0.29), (0.63, 0.49), (0.78, 0.35), (0.75, 0.64)]
BAND = [(0.25, 0.68), (0.75, 0.68), (0.75, 0.75), (0.25, 0.75)]
DOTS = [((0.22, 0.33), 0.045), ((0.5, 0.27), 0.05), ((0.78, 0.33), 0.045)]


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def rrect_sdf(px, py, half, radius):
    # Скруглённый квадрат с центром (0.5, 0.5).
    qx = abs(px - 0.5) - (half - radius)
    qy = abs(py - 0.5) - (half - radius)
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - radius


def poly_sdf(px, py, pts):
    # Знаковое расстояние до многоугольника: снаружи > 0, внутри < 0.
    d = min(seg_dist(px, py, *pts[i], *pts[(i + 1) % len(pts)]) for i in range(len(pts)))
    inside = False
    j = len(pts) - 1
    for i in range(len(pts)):
        (xi, yi), (xj, yj) = pts[i], pts[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return -d if inside else d


def crown_sdf(u, v):
    d = min(poly_sdf(u, v, CROWN), poly_sdf(u, v, BAND))
    for (cx, cy), r in DOTS:
        d = min(d, math.hypot(u - cx, v - cy) - r)
    return d


def render(size, maskable):
    px_unit = 1.0 / size
    rows = []
    scale = 0.78 if maskable else 1.0  # для maskable корона — в безопасной зоне
    for y in range(size):
        row = bytearray([0])  # фильтр строки PNG: none
        for x in range(size):
            u = (x + 0.5) * px_unit
            v = (y + 0.5) * px_unit
            if maskable:
                bg_a = 1.0
            else:
                d = rrect_sdf(u, v, 0.47, 0.11)
                bg_a = max(0.0, min(1.0, 0.5 - d / px_unit))
            cu = (u - 0.5) / scale + 0.5
            cv = (v - 0.5) / scale + 0.5
            d1 = crown_sdf(cu, cv)
            fg_a = max(0.0, min(1.0, 0.5 - d1 / (px_unit / scale)))
            fg_a *= bg_a
            r = BG[0] * (1 - fg_a) + FG[0] * fg_a
            g = BG[1] * (1 - fg_a) + FG[1] * fg_a
            b = BG[2] * (1 - fg_a) + FG[2] * fg_a
            row += bytes((int(r + 0.5), int(g + 0.5), int(b + 0.5), int(bg_a * 255 + 0.5)))
        rows.append(bytes(row))
    return b"".join(rows)


def png(size, raw):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("maskable-512.png", 512, True),
        ("apple-touch-icon.png", 180, True),
        ("favicon-32.png", 32, False),
    ]
    for name, size, maskable in jobs:
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(png(size, render(size, maskable)))
        print("icons/" + name)


if __name__ == "__main__":
    main()
