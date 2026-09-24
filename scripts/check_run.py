#!/usr/bin/env python3
"""
Check a screenshots run folder produced by screenshot.js / carousel.js.

Lists every PNG with its pixel size and flags the problems that actually happen:
  - width != viewport × scale  → the capture fell back to 1x (blurry in Figma)
  - any side > 4096 px          → Figma will downsample it (expected only for *_full*.png)
  - a "partNofM" / "cardNofM" set with missing members

Usage:
  python3 check_run.py <run-folder> [--scale 2]

Exit code 0 when everything is fine, 1 when something is flagged.
No dependencies: reads the PNG header directly.
"""

import os
import re
import struct
import sys

FIGMA_MAX = 4096


def png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    w, h = struct.unpack(">II", head[16:24])
    return w, h


def main():
    args = sys.argv[1:]
    scale = 2.0
    if "--scale" in args:
        i = args.index("--scale")
        scale = float(args[i + 1])
        del args[i : i + 2]
    if not args:
        print(__doc__)
        sys.exit(2)

    root = args[0]
    if not os.path.isdir(root):
        print(f"not a folder: {root}")
        sys.exit(2)

    pngs = []
    for dirpath, _, files in os.walk(root):
        for f in sorted(files):
            if f.lower().endswith(".png"):
                pngs.append(os.path.join(dirpath, f))
    pngs.sort()

    if not pngs:
        print(f"no PNG files under {root}")
        sys.exit(1)

    problems = []
    sets = {}  # (dir, prefix, total) -> set of indices seen

    print(f"{root}\n")
    for p in pngs:
        rel = os.path.relpath(p, root)
        size = png_size(p)
        if not size:
            print(f"  {rel}: not a PNG")
            problems.append(f"{rel} is not a valid PNG")
            continue
        w, h = size
        mb = os.path.getsize(p) / 1024 / 1024
        flags = []

        m_w = re.search(r"_(\d+)w", os.path.basename(p))
        if m_w:
            expected = int(m_w.group(1)) * scale
            # carousel shots may be cropped narrower (--card-only), so only flag full-width files
            if "card" not in os.path.basename(p) and abs(w - expected) > 2:
                flags.append(f"width {w}px, expected {int(expected)}px ({m_w.group(1)} × {scale:g}) → looks like a 1x capture")
        is_full = "_full" in os.path.basename(p)
        if not is_full and (w > FIGMA_MAX or h > FIGMA_MAX):
            flags.append(f"{max(w, h)}px side exceeds Figma's {FIGMA_MAX}px limit")

        m_set = re.search(r"^(.*?)_(part|card)(\d+)of(\d+)", os.path.basename(p))
        if m_set:
            key = (os.path.dirname(p), m_set.group(1), m_set.group(2), int(m_set.group(4)))
            sets.setdefault(key, set()).add(int(m_set.group(3)))

        line = f"  {rel}: {w}×{h}px, {mb:.1f} MB"
        if is_full:
            line += "  (stitched; for archive — don't place in Figma)"
        print(line + ("  ⚠ " + "; ".join(flags) if flags else ""))
        problems += [f"{rel}: {f}" for f in flags]

    for (d, prefix, kind, total), seen in sets.items():
        missing = sorted(set(range(1, total + 1)) - seen)
        if missing:
            where = os.path.relpath(d, root)
            problems.append(f"{where}/{prefix}: {kind}s missing {missing} of {total}")

    print()
    if problems:
        print("Problems:")
        for pr in problems:
            print(f"  - {pr}")
        sys.exit(1)
    print(f"OK — {len(pngs)} file(s), all at {scale:g}x, slices within Figma's {FIGMA_MAX}px limit, sets complete.")


if __name__ == "__main__":
    main()
