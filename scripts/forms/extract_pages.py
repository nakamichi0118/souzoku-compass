"""国税庁の一括印刷用PDFからページ画像を取り出し、白黒PNGで保存する。

usage: python3 -I scripts/forms/extract_pages.py R8set.pdf public/forms/r08
要: poppler-utils (pdfimages), Pillow
"""
import os, subprocess, sys, tempfile
from PIL import Image

PAGES = [  # R8set.pdf のページ順（1始まり）と様式
    ("t01", "第1表"), ("t01c", "第1表（続）"), ("t02", "第2表"), ("t04", "第4表"),
    ("t04_2", "第4表の2"), ("t05", "第5表"), ("t06", "第6表"), ("t07", "第7表"),
    ("t08_8", "第8の8表"), ("t09", "第9表"), ("t10", "第10表"), ("t11", "第11表"),
    ("t11_f1", "第11表の付表1"), ("t11_f2", "第11表の付表2"), ("t11_f3", "第11表の付表3"),
    ("t11_f4", "第11表の付表4"), ("t11_2", "第11の2表"), ("t11_11_2_f1", "第11・11の2表の付表1"),
    ("t11_11_2_f1c", "第11・11の2表の付表1（続）"), ("t11_11_2_f1b1", "第11・11の2表の付表1（別表1）"),
    ("t13", "第13表"), ("t14", "第14表"), ("t15", "第15表"), ("t15c", "第15表（続）"),
]

def main(src, out):
    os.makedirs(out, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdfimages", "-png", src, os.path.join(tmp, "p")], check=True)
        files = sorted(f for f in os.listdir(tmp) if f.endswith(".png"))
        assert len(files) == len(PAGES), f"expected {len(PAGES)} pages, got {len(files)}"
        for f, (key, _) in zip(files, PAGES):
            im = Image.open(os.path.join(tmp, f)).convert("L")
            bw = im.point(lambda v: 255 if v > 160 else 0).convert("1")
            bw.save(os.path.join(out, f"{key}.png"), optimize=True)
            print(key, bw.size)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
