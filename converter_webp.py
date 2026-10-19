"""Troca as fotos .png de imagens_ecommerce por .webp (bem menores, mesma aparência).

Uso: python converter_webp.py [pasta] [--qualidade 90] [--manter-png]

Cada {ref}_{cor}_{n}.png vira {ref}_{cor}_{n}.webp na mesma pasta e o .png é apagado
(a menos que --manter-png). O backend aceita .webp, então basta reiniciar o servidor.
Rodar de novo é seguro: só converte o que ainda está em .png.
"""
from __future__ import annotations

import argparse
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent


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


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("pasta", nargs="?", default=ROOT / "imagens_ecommerce", type=Path)
    ap.add_argument("--qualidade", type=int, default=90, help="0-100 (padrão 90: sem perda visível)")
    ap.add_argument("--manter-png", action="store_true", help="não apaga os .png originais")
    args = ap.parse_args()

    pngs = sorted(p for p in args.pasta.glob("*/*") if p.suffix.lower() == ".png")
    if not pngs:
        print("Nenhum .png para converter.")
        return
    total_in = total_out = 0
    with ProcessPoolExecutor() as pool:
        futures = [pool.submit(convert, p, args.qualidade, args.manter_png) for p in pngs]
        for i, (p, fut) in enumerate(zip(pngs, futures), 1):
            try:
                b, a = fut.result()
            except Exception as e:
                print(f"ERRO {p}: {e}")
                continue
            total_in += b
            total_out += a
            if i % 100 == 0 or i == len(pngs):
                print(f"{i}/{len(pngs)}")
    mb = 1024 * 1024
    print(f"ok: {total_in / mb:.0f} MB em PNG -> {total_out / mb:.0f} MB em WebP "
          f"({100 * (1 - total_out / max(total_in, 1)):.0f}% menor)")


if __name__ == "__main__":
    main()
