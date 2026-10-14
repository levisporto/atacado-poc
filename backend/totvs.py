"""Cliente mínimo da API V2 do TOTVS Moda: token, saldos e preços.

Endpoints usados:
  POST /api/totvsmoda/authorization/v2/token      (OAuth2 password grant)
  POST /api/totvsmoda/product/v2/balances/search  (saldos por SKU)
  POST /api/totvsmoda/product/v2/prices/search    (preço da tabela do atacado)
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from typing import Any

import httpx

import config

log = logging.getLogger("atacado.totvs")

TOKEN_PATH = "/api/totvsmoda/authorization/v2/token"
PRODUCT = "/api/totvsmoda/product/v2"


class TotvsClient:
    def __init__(self) -> None:
        self._http = httpx.AsyncClient(base_url=config.TOTVS_BASE_URL, timeout=120)
        self._token: str | None = None
        self._exp = 0.0
        self._lock = asyncio.Lock()

    async def _ensure_token(self) -> str:
        if self._token and time.time() < self._exp - 30:
            return self._token
        async with self._lock:
            if self._token and time.time() < self._exp - 30:
                return self._token
            r = await self._http.post(TOKEN_PATH, data={
                "grant_type": "password",
                "client_id": config.TOTVS_CLIENT_ID,
                "client_secret": config.TOTVS_CLIENT_SECRET,
                "username": config.TOTVS_USERNAME,
                "password": config.TOTVS_PASSWORD,
                "scope": "openid",
            })
            if r.status_code != 200:
                raise RuntimeError(f"Falha ao autenticar no TOTVS ({r.status_code}): {r.text[:300]}")
            data = r.json()
            self._token = data["access_token"]
            self._exp = time.time() + int(data.get("expires_in", 3600))
            return self._token

    async def post(self, path: str, body: dict, retries: int = 3) -> dict:
        reauth = False
        for attempt in range(retries + 1):
            token = await self._ensure_token()
            try:
                r = await self._http.post(path, json=body, headers={"Authorization": f"Bearer {token}"})
            except httpx.TransportError as e:  # timeout/conexão: o TOTVS oscila, tenta de novo
                if attempt == retries:
                    raise
                log.warning("TOTVS %s falhou (%s), tentativa %d", path, type(e).__name__, attempt + 1)
                await asyncio.sleep(2 ** attempt)
                continue
            if r.status_code == 401 and not reauth:
                reauth = True
                self._token = None  # token invalidado antes do prazo: renova e tenta de novo
                continue
            if r.status_code >= 500 and attempt < retries:
                log.warning("TOTVS %s respondeu %d, tentativa %d", path, r.status_code, attempt + 1)
                await asyncio.sleep(2 ** attempt)
                continue
            r.raise_for_status()
            return r.json()
        raise RuntimeError("Não autorizado pelo TOTVS")

    async def _all_pages(self, path: str, body: dict, page_size: int = 1000, max_pages: int = 200) -> list[dict]:
        # 1ª página revela totalPages; as demais vão em paralelo (cada página leva ~15 s no TOTVS)
        first = await self.post(path, {**body, "page": 1, "pageSize": page_size})
        items: list[dict] = list(first.get("items", []))
        if not first.get("hasNext"):
            return items
        total = min(int(first.get("totalPages") or max_pages), max_pages)
        sem = asyncio.Semaphore(config.TOTVS_CONCURRENCY)

        async def fetch(page: int) -> list[dict]:
            async with sem:
                resp = await self.post(path, {**body, "page": page, "pageSize": page_size})
                return resp.get("items", [])

        for chunk in await asyncio.gather(*(fetch(p) for p in range(2, total + 1))):
            items.extend(chunk)
        return items

    # ------------------------------------------------------------------ saldos
    async def balances(self, product_codes: list[int] | None = None,
                       changed: tuple[datetime, datetime, str] | None = None) -> list[dict]:
        """changed=(início, fim, "stock"|"price") traz só SKUs alterados na janela.

        O TOTVS ignora fuso (Z, -03:00) e compara a hora "crua"; por isso mandamos sem fuso.
        """
        flt: dict[str, Any] = {
            "branchInfo": {
                "branchCode": config.BRANCH_CODE,
                "isActive": True,
                "isFinishedProduct": True,
                "isRawMaterial": False,
                "isBulkMaterial": False,
            },
        }
        if product_codes:
            flt["productCodeList"] = product_codes
        if changed:
            start, end, kind = changed
            ch: dict[str, Any] = {"startDate": start.strftime("%Y-%m-%dT%H:%M:%S"),
                                  "endDate": end.strftime("%Y-%m-%dT%H:%M:%S")}
            if kind == "stock":
                ch.update(inStock=True, branchStockCodeList=[config.BRANCH_CODE], stockCodeList=config.STOCK_CODES)
            else:
                ch.update(inPrice=True, branchPriceCodeList=[config.BRANCH_CODE], priceCodeList=[config.PRICE_CODE])
            flt["change"] = ch
        balance_opt: dict[str, Any] = {
            "branchCode": config.BRANCH_CODE,
            "stockCodeList": config.STOCK_CODES,
        }
        if config.SUBTRACT_SALES_ORDERS:
            balance_opt["isSalesOrder"] = True  # traz quantidade já comprometida em pedidos
        body = {"filter": flt, "option": {"balances": [balance_opt]}}
        return await self._all_pages(f"{PRODUCT}/balances/search", body)

    # ------------------------------------------------------------------ preços
    async def prices(self, product_codes: list[int]) -> dict[int, float]:
        """Retorna {productCode: preço atacado}. Busca em lotes."""
        out: dict[int, float] = {}
        sem = asyncio.Semaphore(config.TOTVS_CONCURRENCY)

        async def fetch(chunk: list[int]) -> list[dict]:
            body = {
                "filter": {"productCodeList": chunk},
                "option": {"prices": [{
                    "branchCode": config.BRANCH_CODE,
                    "priceCodeList": [config.PRICE_CODE],
                }]},
            }
            async with sem:
                return await self._all_pages(f"{PRODUCT}/prices/search", body, page_size=500)

        chunks = [product_codes[i:i + 500] for i in range(0, len(product_codes), 500)]
        for items in await asyncio.gather(*(fetch(c) for c in chunks)):
            for item in items:
                prices = item.get("prices") or []
                if prices:
                    p = prices[0]
                    value = p.get("promotionalPrice") or p.get("price")
                    if value:
                        out[int(item["productCode"])] = float(value)
        return out

    async def close(self) -> None:
        await self._http.aclose()


def sku_available(item: dict) -> float:
    """Saldo vendável de um item de /balances/search."""
    bal = (item.get("balances") or [{}])[0]
    stock = float(bal.get("stock") or 0)
    if config.SUBTRACT_SALES_ORDERS:
        stock -= float(bal.get("salesOrder") or 0)
    return max(stock, 0)
