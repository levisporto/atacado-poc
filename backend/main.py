"""POC — Loja de Atacado Bebêtenkitê.

Rodar:  uvicorn main:app --reload   (dentro de backend/)
Abrir:  http://localhost:8000
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import config
from catalog import CatalogService
from orders import OrderIn, TZ, build_message, deliver, validate

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("atacado")

app = FastAPI(title="Bebêtenkitê Atacado — POC")
app.add_middleware(CORSMiddleware, allow_origins=config.ALLOWED_ORIGINS,
                   allow_methods=["GET", "POST"], allow_headers=["*"])
service = CatalogService()
FRONT = Path(__file__).resolve().parent.parent / "frontend"


@app.get("/api/config")
async def get_config():
    return {
        "mock": config.MOCK_MODE,
        "minOrderValue": config.MIN_ORDER_VALUE,
        "minQtyPerRef": config.MIN_QTY_PER_REF,
        "sellerName": config.GLEICE_NAME,
    }


@app.get("/api/catalogo")
async def get_catalog(refresh: bool = False):
    try:
        cat, ts = await service.catalog(force=refresh)
    except Exception as e:  # erro do TOTVS não pode derrubar a página com stacktrace
        log.exception("Falha ao carregar catálogo")
        raise HTTPException(502, f"Não foi possível consultar o estoque agora: {e}") from e
    return {
        "updatedAt": datetime.fromtimestamp(ts, TZ).isoformat(),
        "mock": config.MOCK_MODE,
        "products": cat,
    }


@app.post("/api/pedido")
async def place_order(order: OrderIn):
    codes = sorted({i.productCode for i in order.items})
    try:
        fresh = await service.fresh_skus(codes)
    except Exception as e:
        log.exception("Falha ao reconsultar estoque")
        raise HTTPException(502, "Não foi possível conferir o estoque agora. Tente de novo.") from e

    lines, problems = validate(order, fresh)
    if problems:
        raise HTTPException(409, {"message": "Ajuste o carrinho antes de enviar.", "problems": problems})

    order_id = f"ATC-{datetime.now(TZ):%y%m%d}-{secrets.token_hex(2).upper()}"
    message = build_message(order_id, order.buyer, lines)
    payload = {"orderId": order_id, "buyer": order.buyer.model_dump(), "lines": lines,
               "total": round(sum(l["subtotal"] for l in lines), 2)}
    try:
        result = await deliver(message, payload)
    except Exception as e:
        log.exception("Falha ao enviar pedido para a Gleice")
        raise HTTPException(502, "Pedido conferido, mas o envio falhou. Tente de novo.") from e

    log.info("Pedido %s enviado via %s (%s peças, total %.2f)", order_id, result["channel"],
             sum(l["quantity"] for l in lines), payload["total"])
    return {"orderId": order_id, "total": payload["total"], "message": message, **result}


@app.on_event("startup")
async def _startup():
    service.start()  # snapshot em disco na hora + sincronização com o TOTVS em segundo plano


@app.on_event("shutdown")
async def _shutdown():
    await service.stop()


@app.get("/")
async def index():
    return FileResponse(FRONT / "index.html")

app.mount("/", StaticFiles(directory=FRONT), name="front")
