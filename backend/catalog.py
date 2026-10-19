"""Monta o catálogo do atacado a partir dos SKUs do TOTVS (ou dos dados fictícios).

Um SKU no TOTVS = referência + cor + tamanho. O comprador de atacado pensa em
"referência com grade", então agrupamos: referência -> cores -> tamanhos.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections import OrderedDict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import config
import images
from mock_data import mock_skus
from orders import TZ
from totvs import TotvsClient, sku_available

log = logging.getLogger("atacado.catalog")

# Último catálogo bom em disco: sobrevive a restart/reload, então ninguém espera o TOTVS.
# Pode estar velho; não tem problema porque /api/pedido reconfere saldo e preço ao vivo.
SNAPSHOT = Path(config.CATALOG_SNAPSHOT_PATH)

SIZE_ORDER = ["RN", "PP", "P", "M", "G", "GG", "XG",
              "0-3M", "3-6M", "6-9M", "9-12M", "12-18M", "18-24M",
              "1", "2", "3", "4", "5", "6", "8", "10", "12", "14", "16"]


# Referência com menos que isso no total (somando cores e tamanhos) fica fora da vitrine.
MIN_REF_AVAILABLE = 2


def size_key(s: str) -> tuple[int, str]:
    s = (s or "").strip().upper()
    return (SIZE_ORDER.index(s), s) if s in SIZE_ORDER else (len(SIZE_ORDER), s)


def normalize_sku(item: dict, prices: dict[int, float]) -> dict[str, Any]:
    """Converte um item do /balances/search no formato interno."""
    return {
        "productCode": int(item["productCode"]),
        "reference": str(item.get("referenceCode") or item.get("productName") or item["productCode"]),
        "name": (item.get("referenceName") or item.get("productName") or "").strip(),
        "color": (item.get("colorName") or "Única").strip().title(),
        "colorCode": str(item.get("colorCode") or ""),
        "size": (item.get("sizeName") or item.get("productSize") or "U").strip().upper(),
        "available": sku_available(item),
        "price": prices.get(config.PRICE_CODE),
        "retailPrice": prices.get(config.RETAIL_PRICE_CODE),
        "group": (item.get("groupName") or item.get("classificationName") or "").strip(),
    }


def group_catalog(skus: list[dict]) -> list[dict]:
    refs: "OrderedDict[str, dict]" = OrderedDict()
    for s in skus:
        if s["price"] is None or s["available"] <= 0:
            continue  # sem preço de atacado ou sem saldo: não aparece na vitrine
        ref = refs.setdefault(s["reference"], {
            "reference": s["reference"], "name": s["name"], "group": s["group"],
            "colors": OrderedDict(), "colorCodes": {}, "sizes": set(), "minPrice": s["price"], "maxPrice": s["price"],
            "totalAvailable": 0, "retailPrices": [],
        })
        ref["minPrice"] = min(ref["minPrice"], s["price"])
        ref["maxPrice"] = max(ref["maxPrice"], s["price"])
        if s.get("retailPrice"):
            ref["retailPrices"].append(s["retailPrice"])
        ref["totalAvailable"] += s["available"]
        ref["sizes"].add(s["size"])
        ref["colorCodes"].setdefault(s["color"], s.get("colorCode", ""))
        ref["colors"].setdefault(s["color"], []).append({
            "productCode": s["productCode"], "size": s["size"],
            "available": int(s["available"]), "price": s["price"], "retailPrice": s.get("retailPrice"),
        })

    out = []
    for ref in refs.values():
        if ref["totalAvailable"] < MIN_REF_AVAILABLE:
            continue  # sobra de uma peça só não vale vitrine de atacado
        sizes = sorted(ref["sizes"], key=size_key)
        colors = []
        for color, items in ref["colors"].items():
            items.sort(key=lambda x: size_key(x["size"]))
            colors.append({"color": color, "skus": items,
                           "images": images.for_color(ref["reference"], ref["colorCodes"][color])})
        retail = ref["retailPrices"]
        out.append({**{k: v for k, v in ref.items() if k not in ("colorCodes", "retailPrices")},
                    "sizes": sizes, "colors": colors,
                    "minRetailPrice": min(retail, default=None), "maxRetailPrice": max(retail, default=None),
                    "image": next((c["images"][0] for c in colors if c["images"]), None) or images.cover(ref["reference"]),
                    "totalAvailable": int(ref["totalAvailable"])})
    out.sort(key=lambda r: (r["group"], r["name"]))
    return out


class CatalogService:
    """Catálogo sempre pronto em memória, mantido por um loop em segundo plano.

    - Subida: lê o snapshot em disco na hora (se houver) e só sincroniza o que mudou desde ele.
    - A cada CATALOG_SYNC_SECONDS: pede ao TOTVS só os SKUs com saldo/preço alterado (~1 s).
    - A cada CATALOG_FULL_REFRESH_HOURS: carga completa (~2-4 min), rede de segurança
      para o que o filtro de alteração não pega (ex.: reservas em pedido de venda).
    Comprador nunca espera o TOTVS, exceto na primeiríssima carga sem snapshot.
    """

    def __init__(self) -> None:
        self.client = None if config.MOCK_MODE else TotvsClient()
        self._skus: dict[int, dict] = {}       # só SKUs com saldo
        self._catalog: list[dict] = []
        self._updated_at = 0.0                 # última sincronização bem-sucedida (epoch)
        self._synced_at: datetime | None = None  # hora local (TOTVS) em que ela começou
        self._full_at = 0.0                    # última carga completa (epoch)
        self._ready = asyncio.Event()
        self._lock = asyncio.Lock()
        self._loop: asyncio.Task | None = None

    # ------------------------------------------------------------ TOTVS
    async def _load_skus(self, product_codes: list[int] | None = None,
                         changed: tuple[datetime, datetime, str] | None = None) -> list[dict]:
        if config.MOCK_MODE:
            skus = mock_skus()
            if product_codes:
                skus = [s for s in skus if s["productCode"] in product_codes]
            return skus
        raw = await self.client.balances(product_codes, changed)
        if product_codes is None and changed is None:
            raw = [i for i in raw if sku_available(i) > 0]  # sem saldo não vai pra vitrine: nem busca preço
        live = [int(i["productCode"]) for i in raw if sku_available(i) > 0]
        prices = await self.client.prices(live) if live else {}
        return [normalize_sku(i, prices.get(int(i["productCode"]), {})) for i in raw]

    async def _full_load(self) -> None:
        started = _totvs_now()
        t = time.time()
        skus = await self._load_skus()
        self._skus = {s["productCode"]: s for s in skus}
        self._synced_at, self._full_at = started, time.time()
        log.info("Carga completa: %d SKUs com saldo em %.1fs", len(skus), time.time() - t)

    async def _sync_changes(self) -> None:
        started = _totvs_now()
        # Janela larga de propósito: o TOTVS compara hora sem fuso e não sabemos se o relógio
        # dele é UTC ou local. Recuar 4 h e ir até amanhã cobre os dois; reprocessar alguns
        # SKUs a mais é barato (dezenas por dia).
        window = (self._synced_at - timedelta(hours=4), started + timedelta(days=1))
        changed: dict[int, dict] = {}
        for kind in ("stock", "price"):
            for s in await self._load_skus(changed=(*window, kind)):
                changed[s["productCode"]] = s
        for code, s in changed.items():
            if s["available"] > 0:
                self._skus[code] = s
            else:
                self._skus.pop(code, None)
        self._synced_at = started
        log.info("Sincronização: %d SKUs alterados", len(changed))

    async def _sync(self, full: bool = False) -> None:
        async with self._lock:
            if config.MOCK_MODE or full or self._synced_at is None:
                await (self._full_load() if not config.MOCK_MODE else self._mock_load())
            else:
                await self._sync_changes()
            self._catalog = group_catalog(list(self._skus.values()))
            self._updated_at = time.time()
            self._ready.set()
            if not config.MOCK_MODE:
                self._save_snapshot()

    async def _mock_load(self) -> None:
        self._skus = {s["productCode"]: s for s in mock_skus()}
        self._synced_at, self._full_at = _totvs_now(), time.time()

    async def _run(self) -> None:
        while True:
            full_due = time.time() - self._full_at >= config.CATALOG_FULL_REFRESH_HOURS * 3600
            try:
                await self._sync(full=full_due)
            except Exception as e:
                log.error("Falha ao atualizar catálogo (segue servindo o anterior): %s: %s", type(e).__name__, e)
            await asyncio.sleep(config.CATALOG_SYNC_SECONDS)

    # ------------------------------------------------------------ snapshot
    def _save_snapshot(self) -> None:
        SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        tmp = SNAPSHOT.with_suffix(".tmp")
        tmp.write_text(json.dumps({
            "updatedAt": self._updated_at, "fullAt": self._full_at,
            "syncedAt": self._synced_at.isoformat(), "skus": list(self._skus.values()),
        }, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, SNAPSHOT)  # troca atômica: quem lê nunca pega arquivo pela metade

    def _load_snapshot(self) -> None:
        try:
            data = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
            self._skus = {s["productCode"]: s for s in data["skus"]}
            self._updated_at, self._full_at = float(data["updatedAt"]), float(data["fullAt"])
            self._synced_at = datetime.fromisoformat(data["syncedAt"])
            if any("retailPrice" not in s for s in self._skus.values()):
                self._full_at = 0.0  # snapshot anterior ao preço de varejo: recarrega tudo já
        except FileNotFoundError:
            return
        except Exception as e:
            log.warning("Snapshot do catálogo ilegível, ignorando: %s", e)
            self._skus, self._synced_at, self._full_at = {}, None, 0.0
            return
        self._catalog = group_catalog(list(self._skus.values()))
        self._ready.set()
        log.info("Catálogo servido do snapshot (%d referências, %.0f min de idade)",
                 len(self._catalog), (time.time() - self._updated_at) / 60)

    # ------------------------------------------------------------ API
    def start(self) -> None:
        """Na subida: serve o snapshot na hora e liga o loop de sincronização."""
        if not config.MOCK_MODE:
            self._load_snapshot()
        self._loop = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._loop:
            self._loop.cancel()
        if self.client:
            await self.client.close()

    async def catalog(self, force: bool = False) -> tuple[list[dict], float]:
        if force and self._ready.is_set():
            await self._sync()  # botão "atualizar": puxa o que mudou agora (~1 s)
        elif not self._ready.is_set():
            # primeira carga sem snapshot: espera o loop terminar a carga completa
            try:
                await asyncio.wait_for(self._ready.wait(), timeout=300)
            except asyncio.TimeoutError:
                raise RuntimeError("o catálogo ainda está sendo carregado do TOTVS, tente em instantes")
        return self._catalog, self._updated_at

    async def fresh_skus(self, product_codes: list[int]) -> dict[int, dict]:
        """Saldo e preço atualizados (sem cache) só dos SKUs do carrinho."""
        return {s["productCode"]: s for s in await self._load_skus(product_codes)}


def _totvs_now() -> datetime:
    """Hora local sem fuso, no formato que o filtro de alteração do TOTVS compara."""
    return datetime.now(TZ).replace(tzinfo=None, microsecond=0)
