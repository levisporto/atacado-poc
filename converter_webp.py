"""Troca as fotos .png de imagens_ecommerce por .webp (bem menores, mesma aparência) e gera as miniaturas.

Uso: python converter_webp.py [pasta] [--qualidade 90] [--manter-png] [--miniatura 360]

Cada {ref}_{cor}_{n}.png vira {ref}_{cor}_{n}.webp na mesma pasta e o .png é apagado
(a menos que --manter-png). Depois, cada foto ganha ao lado uma {ref}_{cor}_{n}.thumb.webp
de 360 px, que a vitrine usa nos cards (a foto inteira fica para a página do produto).
O backend aceita .webp, então basta reiniciar o servidor.
Rodar de novo é seguro: só converte o que ainda está em .png e só refaz a miniatura
que falta ou que ficou mais velha que a foto.
"""
from __future__ import annotations

import argparse
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
THUMB = ".thumb"  # mesmo sufixo que backend/images.py procura


def convert(png: Path, quality: int, keep: bool) -> tuple[int, int]:
    webp = png.with_suffix(".webp")
    with Image.open(png) as im:
        im.load()
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            if im.getchannel("A").getextrema()[0] == 255:  # alfa todo opaco: não precisa guardar
                im = im.convert("RGB")
        elif im.mode != "RGB":
            im = im.convert("RGB")
        tmp = webp.with_suffix(".tmp")
        im.save(tmp, "WEBP", quality=quality, method=6)
    os.replace(tmp, webp)  # só aparece o .webp completo
    before, after = png.stat().st_size, webp.stat().st_size
    if not keep:
        png.unlink()
    return before, after


def thumb_path(photo: Path) -> Path:
    return photo.with_name(photo.stem + THUMB + ".webp")


def make_thumb(photo: Path, size: int) -> tuple[int, int]:
    out = thumb_path(photo)
    with Image.open(photo) as im:
        im.load()
        im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
        im.thumbnail((size, size), Image.Resampling.LANCZOS)  # mantém a proporção
        tmp = out.with_suffix(".tmp")
        im.save(tmp, "WEBP", quality=82, method=6)  # em 360 px a qualidade menor não aparece
    os.replace(tmp, out)
    return photo.stat().st_size, out.stat().st_size


def run(label: str, fn, items: list[Path], *args) -> tuple[int, int]:
    total_in = total_out = 0
    with ProcessPoolExecutor() as pool:
        futures = [pool.submit(fn, p, *args) for p in items]
        for i, (p, fut) in enumerate(zip(items, futures), 1):
            try:
                b, a = fut.result()
            except Exception as e:
                print(f"ERRO {p}: {e}")
                continue
            total_in += b
            total_out += a
            if i % 100 == 0 or i == len(items):
                print(f"{label}: {i}/{len(items)}")
    return total_in, total_out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("pasta", nargs="?", default=ROOT / "imagens_ecommerce", type=Path)
    ap.add_argument("--qualidade", type=int, default=90, help="0-100 (padrão 90: sem perda visível)")
    ap.add_argument("--manter-png", action="store_true", help="não apaga os .png originais")
    ap.add_argument("--miniatura", type=int, default=360, help="lado da miniatura em px (0 = não gerar)")
    args = ap.parse_args()
    mb = 1024 * 1024

    pngs = sorted(p for p in args.pasta.glob("*/*") if p.suffix.lower() == ".png")
    if pngs:
        b, a = run("webp", convert, pngs, args.qualidade, args.manter_png)
        print(f"ok: {b / mb:.0f} MB em PNG -> {a / mb:.0f} MB em WebP ({100 * (1 - a / max(b, 1)):.0f}% menor)")
    else:
        print("Nenhum .png para converter.")

    if args.miniatura <= 0:
        return
    photos = sorted(p for p in args.pasta.glob("*/*")
                    if p.suffix.lower() in (".webp", ".jpg", ".jpeg") and not p.stem.endswith(THUMB))
    todo = [p for p in photos
            if not thumb_path(p).exists() or thumb_path(p).stat().st_mtime < p.stat().st_mtime]
    if not todo:
        print("Miniaturas em dia.")
        return
    b, a = run("miniaturas", make_thumb, todo, args.miniatura)
    print(f"ok: {len(todo)} miniaturas, {a / mb:.1f} MB ({100 * a / max(b, 1):.0f}% do tamanho das fotos)")


if __name__ == "__main__":
    main()
