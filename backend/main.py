"""POC — Loja de Atacado Bebêtenkitê.

Rodar:  uvicorn main:app --reload   (dentro de backend/)
Abrir:  http://localhost:8000
"""
from __future__ import annotations

import json
import logging
import re
import secrets
import time
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import admin
import auth
import config
import db
import images
from catalog import CatalogService
from orders import Buyer, OrderIn, Signup, TZ, build_message, deliver, signup_message, validate

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("atacado")

app = FastAPI(title="Bebêtenkitê Atacado — POC")
app.add_middleware(CORSMiddleware, allow_origins=config.ALLOWED_ORIGINS,
                   allow_methods=["GET", "POST"], allow_headers=["*"])
app.include_router(admin.router)
service = CatalogService()
FRONT = Path(__file__).resolve().parent.parent / "frontend"


@app.get("/api/config")
async def get_config():
    return {
        "mock": config.MOCK_MODE,
        "minOrderValue": config.MIN_ORDER_VALUE,
        "minQtyPerRef": config.MIN_QTY_PER_REF,
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


# ------------------------------------------------------------ cadastro e login do cliente
class Login(BaseModel):
    document: str
    password: str


def _me(c: dict) -> dict:
    return {k: c[k] for k in ("name", "company", "document", "phone", "city", "email", "status")}


@app.post("/api/cadastro")
async def signup(body: Signup):
    if db.client_by_document(body.document):
        raise HTTPException(409, "Já existe um cadastro com esse CNPJ/CPF. Entre com sua senha ou fale com a gente.")
    db.run("INSERT INTO clients (document, name, company, phone, city, email, password_hash, created_at) "
           "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
           (body.document, body.name.strip(), body.company.strip(), body.phone, body.city.strip(),
            body.email.strip(), auth.hash_password(body.password), time.time()))
    log.info("Novo cadastro: %s (%s)", body.company, body.document)
    # avisa a equipe só se houver envio automático; o link wa.me não serve para isso
    if config.NOTIFY_NEW_SIGNUPS and (config.EVOLUTION_URL or config.N8N_WEBHOOK_URL):
        try:
            await deliver(signup_message(body), {"type": "signup", "client": body.model_dump(exclude={"password"})})
        except Exception:
            log.exception("Falha ao avisar novo cadastro (segue: aparece no painel)")
    return {"status": "pending"}


@app.post("/api/login")
async def login(body: Login, request: Request, response: Response):
    doc = re.sub(r"\D", "", body.document)
    keys = (f"doc:{doc}", "client-all", f"ip:{auth.client_ip(request)}")
    auth.throttle(*keys)
    c = db.client_by_document(doc)
    if not c or not auth.check_password(body.password, c["password_hash"]):
        auth.failed(*keys)
        raise HTTPException(401, "CNPJ/CPF ou senha incorretos.")
    if c["status"] == "pending":
        raise HTTPException(403, "Seu cadastro está em análise. Vamos liberar seu acesso em breve.")
    if c["status"] != "approved":
        raise HTTPException(403, "Seu acesso não está liberado. Fale com a gente pelo WhatsApp.")
    auth.start_session(response, "client", str(c["id"]))
    return _me(c)


@app.post("/api/logout")
async def logout(request: Request, response: Response):
    auth.end_session(request, response, "client")
    return {"ok": True}


@app.get("/api/me")
async def me(client: dict = Depends(auth.current_client)):
    return _me(client)


@app.get("/api/meus-pedidos")
async def my_orders(client: dict = Depends(auth.current_client)):
    rows = db.q("SELECT id, created_at, total, pieces, notes, status, lines_json FROM orders "
                "WHERE client_id = ? ORDER BY created_at DESC LIMIT 100", (client["id"],))
    out = []
    for r in rows:
        lines = json.loads(r.pop("lines_json"))
        # só o que o lojista precisa ver (sem saldo do momento, código interno etc.)
        r["lines"] = [{k: l[k] for k in ("reference", "name", "color", "size", "quantity", "price", "subtotal")} for l in lines]
        out.append(r)
    return out


@app.post("/api/pedido")
async def place_order(order: OrderIn, client: dict = Depends(auth.current_client)):
    codes = sorted({i.productCode for i in order.items})
    try:
        fresh = await service.fresh_skus(codes)
    except Exception as e:
        log.exception("Falha ao reconsultar estoque")
        raise HTTPException(502, "Não foi possível conferir o estoque agora. Tente de novo.") from e

    lines, problems = validate(order, fresh)
    if problems:
        raise HTTPException(409, {"message": "Ajuste o carrinho antes de enviar.", "problems": problems})

    buyer = Buyer(**{k: client[k] for k in ("name", "company", "document", "phone", "city")}, notes=order.notes)
    order_id = f"ATC-{datetime.now(TZ):%y%m%d}-{secrets.token_hex(2).upper()}"
    message = build_message(order_id, buyer, lines)
    total = round(sum(l["subtotal"] for l in lines), 2)
    payload = {"orderId": order_id, "buyer": buyer.model_dump(), "lines": lines, "total": total}
    # grava antes de enviar: se o WhatsApp falhar, o pedido continua no painel
    db.run("INSERT INTO orders (id, client_id, created_at, total, pieces, lines_json, notes, message) "
           "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
           (order_id, client["id"], time.time(), total, sum(l["quantity"] for l in lines),
            json.dumps(lines, ensure_ascii=False), order.notes.strip(), message))
    try:
        result = await deliver(message, payload)
    except Exception:
        # o pedido já está gravado: responder erro faria o comprador mandar de novo (pedido duplicado)
        log.exception("Falha ao avisar a equipe do pedido %s (fica no painel)", order_id)
        result = {"channel": "falhou", "sent": False}
    db.run("UPDATE orders SET delivery_channel = ?, delivered = ? WHERE id = ?",
           (result["channel"], int(result["sent"]), order_id))

    log.info("Pedido %s de %s enviado via %s (%s peças, total %.2f)", order_id, client["company"], result["channel"],
             sum(l["quantity"] for l in lines), total)
    return {"orderId": order_id, "total": total, "message": message, **result}


@app.on_event("startup")
async def _startup():
    images.load()
    db.init()
    if not config.ADMIN_USERS:
        log.warning("ADMIN_USERS vazio: ninguém consegue entrar no painel /admin")
    service.start()  # snapshot em disco na hora + sincronização com o TOTVS em segundo plano


@app.on_event("shutdown")
async def _shutdown():
    await service.stop()
    db.close()


# Página, JS e CSS: o navegador sempre confere com o servidor (304 pelo ETag quando nada mudou).
# Sem isso, depois de um deploy ele podia juntar o index.html novo com um app.js velho do cache e travar.
NO_CACHE = {"Cache-Control": "no-cache"}


@app.get("/")
async def index():
    return FileResponse(FRONT / "index.html", headers=NO_CACHE)


@app.get("/admin")
async def admin_page():
    return FileResponse(FRONT / "admin.html", headers=NO_CACHE)


class FrontFiles(StaticFiles):
    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        if resp.status_code in (200, 304):
            resp.headers.update(NO_CACHE)
        return resp


class CachedImages(StaticFiles):
    """Fotos mudam raramente: o navegador guarda por 1 dia (e revalida pelo ETag depois)."""
    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        if resp.status_code == 200:
            resp.headers["Cache-Control"] = "public, max-age=86400"
        return resp


if Path(config.IMAGES_DIR).is_dir():
    app.mount(images.URL_PREFIX, CachedImages(directory=config.IMAGES_DIR), name="img")
app.mount("/", FrontFiles(directory=FRONT), name="front")
