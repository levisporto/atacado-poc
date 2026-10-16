"""Fotos dos produtos: uma pasta por referência em IMAGES_DIR.

Arquivo = {referência}_{código da cor}_{n}.jpg (ex.: 001-BB-ACE547/001-BB-ACE547_005_2.jpg),
os mesmos referenceCode e colorCode do TOTVS. A pasta é lida uma vez na subida; para
incluir fotos novas basta reiniciar o servidor.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from urllib.parse import quote

import config

log = logging.getLogger("atacado.images")

URL_PREFIX = "/img"
EXTS = {".jpg", ".jpeg", ".png", ".webp"}
_NAME = re.compile(r"^(?P<ref>.+)_(?P<color>[^_]*)_(?P<n>\d*)$")

# referência -> código da cor -> URLs em ordem (_1, _2, ...)
_index: dict[str, dict[str, list[str]]] = {}


def _ref_key(ref: str) -> str:
    # mesma limpeza do baixar_imagens_produtos.py: "005 BB MCF196" no TOTVS vira a pasta "005-BB-MCF196"
    return re.sub(r"[^A-Za-z0-9._-]+", "-", ref.strip()).strip("-.").upper()


def _color_key(code: str) -> str:
    # alguns arquivos vieram com a letra O no lugar do zero ("O27"); "5" e "005" são a mesma cor
    return code.strip().upper().replace("O", "0").lstrip("0")


def load() -> None:
    root = Path(config.IMAGES_DIR)
    if not root.is_dir():
        log.warning("Pasta de fotos não encontrada (%s): vitrine segue com ícones", root)
        return
    found: dict[str, dict[str, list[tuple[int, str]]]] = {}
    for f in root.glob("*/*"):
        m = _NAME.match(f.stem)
        if f.suffix.lower() not in EXTS or not m:
            continue
        url = f"{URL_PREFIX}/{quote(f.parent.name)}/{quote(f.name)}"
        found.setdefault(_ref_key(f.parent.name), {}).setdefault(_color_key(m["color"]), []).append((int(m["n"] or 0), url))
    _index.clear()
    for ref, colors in found.items():
        _index[ref] = {c: [u for _, u in sorted(v)] for c, v in sorted(colors.items())}
    log.info("Fotos: %d referências, %d arquivos", len(_index),
             sum(len(v) for c in _index.values() for v in c.values()))


def for_color(reference: str, color_code: str) -> list[str]:
    """Fotos daquela cor (pode vir vazio: o front usa a capa da referência)."""
    return _index.get(_ref_key(reference), {}).get(_color_key(color_code), [])


def cover(reference: str) -> str | None:
    """Primeira foto da referência, de qualquer cor."""
    colors = _index.get(_ref_key(reference))
    return next(iter(colors.values()))[0] if colors else None
