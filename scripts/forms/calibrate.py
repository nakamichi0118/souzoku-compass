"""入力欄の seed 点から欄の矩形を求め、PDF座標のレイアウトJSONを生成する。

usage: python3 -I scripts/forms/calibrate.py [--preview DIR]
入力: scripts/forms/fields/*.json, public/forms/r08/*.png
出力: src/forms/r08/layout.json
"""
import glob, json, os, sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PX2PT = 72 / 300  # 300dpi画像 → pt
PAGE_H_PT = 842.0


def flood_bbox(img, seed):
    """seed を含む白い連結領域の外接矩形（罫線の内側）"""
    w, h = img.size
    px = img.load()
    sx, sy = seed
    if px[sx, sy] == 0:
        raise ValueError(f"seed {seed} is on a black pixel")
    seen = bytearray(w * h)
    stack = [(sx, sy)]
    x0 = x1 = sx
    y0 = y1 = sy
    count = 0
    while stack:
        x, y = stack.pop()
        i = y * w + x
        if seen[i]:
            continue
        # 走査線で左右に広げる
        lx = x
        while lx > 0 and px[lx - 1, y] != 0 and not seen[y * w + lx - 1]:
            lx -= 1
        rx = x
        while rx < w - 1 and px[rx + 1, y] != 0 and not seen[y * w + rx + 1]:
            rx += 1
        for xx in range(lx, rx + 1):
            seen[y * w + xx] = 1
        count += rx - lx + 1
        if count > 1_500_000:
            raise ValueError(f"seed {seed} leaked outside a cell")
        x0, x1 = min(x0, lx), max(x1, rx)
        y0, y1 = min(y0, y), max(y1, y)
        for ny in (y - 1, y + 1):
            if 0 <= ny < h:
                xx = lx
                while xx <= rx:
                    if px[xx, ny] != 0 and not seen[ny * w + xx]:
                        stack.append((xx, ny))
                        # 同じ白区間はまとめて1点だけ積む
                        while xx <= rx and px[xx, ny] != 0:
                            xx += 1
                    xx += 1
    return [x0, y0, x1 + 1, y1 + 1]


def preprinted_left(img, box):
    """欄の右側に印字済みの「000」「00」などがある場合、その左端x"""
    x0, y0, x1, y1 = box
    px = img.load()
    start = x0 + int((x1 - x0) * 0.6)
    xs = [x for x in range(start, x1 - 2) for y in range(y0 + 3, y1 - 3) if px[x, y] == 0]
    return min(xs) if xs else x1


def main():
    preview = None
    if "--preview" in sys.argv:
        preview = sys.argv[sys.argv.index("--preview") + 1]
        os.makedirs(preview, exist_ok=True)
    layout = {}
    for spec_path in sorted(glob.glob(os.path.join(ROOT, "scripts/forms/fields/*.json"))):
        spec = json.load(open(spec_path, encoding="utf-8"))
        page = spec["page"]
        img = Image.open(os.path.join(ROOT, f"public/forms/r08/{page}.png")).convert("L").point(lambda v: 255 if v > 128 else 0)
        fields = {}
        dbg = img.convert("RGB") if preview else None
        d = ImageDraw.Draw(dbg) if dbg else None
        for f in spec["fields"]:
            box = f.get("box") or flood_bbox(img, tuple(f["seed"]))
            if f.get("suffix"):
                box = [box[0], box[1], preprinted_left(img, box) - 2, box[3]]
            if "clipX" in f:
                box = [max(box[0], f["clipX"][0]), box[1], min(box[2], f["clipX"][1]), box[3]]
            parts = []
            if "splits" in f:
                edges = [box[0]] + f["splits"] + [box[2]]
                for i in range(len(edges) - 1):
                    parts.append((f"{f['id']}.{i}", [edges[i] + (18 if i else 0), box[1], edges[i + 1] - (18 if i < len(edges) - 2 else 0), box[3]]))
            else:
                parts.append((f["id"], box))
            for fid, box in parts:
              x0, y0, x1, y1 = box
              fields[fid] = {
                "x": round(x0 * PX2PT, 2),
                "y": round(PAGE_H_PT - y1 * PX2PT, 2),
                "w": round((x1 - x0) * PX2PT, 2),
                "h": round((y1 - y0) * PX2PT, 2),
                "align": f.get("align", "left") if not f.get("splits") else ("right" if fid.endswith(".0") else "center"),
                "size": f.get("size", 10),
                **({"lines": f["lines"]} if "lines" in f else {}),
              }
              if d:
                d.rectangle(box, outline=(255, 0, 0), width=3)
                d.text((x0 + 4, y0 + 2), fid, fill=(0, 140, 0))
        layout[page] = {"title": spec.get("title", page), "fields": fields}
        if dbg:
            dbg.resize((dbg.width // 2, dbg.height // 2)).save(os.path.join(preview, f"{page}.png"))
        print(page, len(fields), "fields")
    out = os.path.join(ROOT, "src/forms/r08/layout.json")
    json.dump(layout, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("wrote", out)


if __name__ == "__main__":
    main()
