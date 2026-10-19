"""Painel /admin: cadastros pendentes, clientes e pedidos."""
from __future__ import annotations

import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

import auth
import db
from orders import TZ

router = APIRouter(prefix="/api/admin")


class AdminLogin(BaseModel):
    name: str
    password: str


class Note(BaseModel):
    note: str = Field(default="", max_length=500)


class OrderStatus(BaseModel):
    status: str


@router.post("/login")
async def login(body: AdminLogin, request: Request, response: Response):
    keys = (f"admin:{auth.client_ip(request)}",)
    auth.throttle(*keys)
    if not auth.check_admin(body.name, body.password):
        auth.failed(*keys)
        raise HTTPException(401, "Usuário ou senha incorretos.")
    auth.start_session(response, "admin", body.name.strip().lower())
    return {"name": body.name.strip().lower()}


@router.post("/logout")
async def logout(request: Request, response: Response):
    auth.end_session(request, response, "admin")
    return {"ok": True}


@router.get("/me")
async def me(admin: str = Depends(auth.current_admin)):
    return {"name": admin}


@router.get("/resumo")
async def summary(admin: str = Depends(auth.current_admin)):
    today = datetime.now(TZ).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
    return {
        "pendingClients": db.one("SELECT COUNT(*) n FROM clients WHERE status = 'pending'")["n"],
        "newOrders": db.one("SELECT COUNT(*) n FROM orders WHERE status = 'novo'")["n"],
        "ordersToday": db.one("SELECT COUNT(*) n FROM orders WHERE created_at >= ?", (today,))["n"],
        # wa.me não é falha: o próprio comprador manda; só conta o envio automático que não saiu
        "undelivered": db.one("SELECT COUNT(*) n FROM orders WHERE delivered = 0 AND status != 'cancelado' "
                              "AND COALESCE(delivery_channel, '') != 'wa.me'")["n"],
    }


# ------------------------------------------------------------ clientes
@router.get("/clientes")
async def clients(status: str = "", busca: str = "", admin: str = Depends(auth.current_admin)):
    sql = (f"SELECT {', '.join('c.' + f.strip() for f in db.PUBLIC_CLIENT.split(','))}, "
           "COUNT(o.id) AS orders, COALESCE(SUM(CASE WHEN o.status != 'cancelado' THEN o.total END), 0) AS spent, "
           "MAX(o.created_at) AS last_order "
           "FROM clients c LEFT JOIN orders o ON o.client_id = c.id WHERE 1=1")
    args: list = []
    if status:
        sql += " AND c.status = ?"; args.append(status)
    if busca.strip():
        like = f"%{busca.strip()}%"
        sql += " AND (c.name LIKE ? OR c.company LIKE ? OR c.document LIKE ? OR c.city LIKE ?)"
        args += [like, like, like.replace(".", "").replace("/", "").replace("-", ""), like]
    sql += " GROUP BY c.id ORDER BY c.created_at DESC"
    return db.q(sql, args)


def _review(client_id: int, status: str, note: str, admin: str) -> dict:
    if not db.client(client_id):
        raise HTTPException(404, "Cliente não encontrado.")
    db.run("UPDATE clients SET status = ?, reviewed_at = ?, reviewed_by = ?, admin_note = ? WHERE id = ?",
           (status, time.time(), admin, note.strip(), client_id))
    if status != "approved":
        auth.end_all_sessions("client", str(client_id))  # bloqueado sai na hora
    return db.client(client_id)


@router.post("/clientes/{client_id}/aprovar")
async def approve(client_id: int, body: Note, admin: str = Depends(auth.current_admin)):
    return _review(client_id, "approved", body.note, admin)


@router.post("/clientes/{client_id}/rejeitar")
async def reject(client_id: int, body: Note, admin: str = Depends(auth.current_admin)):
    return _review(client_id, "rejected", body.note, admin)


@router.post("/clientes/{client_id}/bloquear")
async def block(client_id: int, body: Note, admin: str = Depends(auth.current_admin)):
    return _review(client_id, "blocked", body.note, admin)


@router.post("/clientes/{client_id}/senha")
async def reset_password(client_id: int, admin: str = Depends(auth.current_admin)):
    if not db.client(client_id):
        raise HTTPException(404, "Cliente não encontrado.")
    password = auth.temp_password()
    db.run("UPDATE clients SET password_hash = ? WHERE id = ?", (auth.hash_password(password), client_id))
    auth.end_all_sessions("client", str(client_id))
    return {"password": password}  # mostrada uma vez só, para o admin mandar ao cliente


# ------------------------------------------------------------ pedidos
ORDER_LIST = ("SELECT o.id, o.client_id, o.created_at, o.total, o.pieces, o.notes, o.delivery_channel, o.delivered, "
              "o.status, o.status_updated_at, o.status_updated_by, c.name AS client_name, c.company, c.city, c.phone, c.document "
              "FROM orders o JOIN clients c ON c.id = o.client_id")


@router.get("/pedidos")
async def orders(status: str = "", cliente: int | None = None, admin: str = Depends(auth.current_admin)):
    sql, args = ORDER_LIST + " WHERE 1=1", []
    if status:
        sql += " AND o.status = ?"; args.append(status)
    if cliente:
        sql += " AND o.client_id = ?"; args.append(cliente)
    rows = db.q(sql + " ORDER BY o.created_at DESC LIMIT 500", args)
    for r in rows:
        r["delivered"] = bool(r["delivered"])
    return rows


@router.get("/pedidos/{order_id}")
async def order(order_id: str, admin: str = Depends(auth.current_admin)):
    r = db.one("SELECT o.*, c.name AS client_name, c.company, c.city, c.phone, c.document, c.email "
               "FROM orders o JOIN clients c ON c.id = o.client_id WHERE o.id = ?", (order_id,))
    if not r:
        raise HTTPException(404, "Pedido não encontrado.")
    return db.order_row(r)


@router.post("/pedidos/{order_id}/status")
async def set_order_status(order_id: str, body: OrderStatus, admin: str = Depends(auth.current_admin)):
    if body.status not in db.ORDER_STATUSES:
        raise HTTPException(422, "Status inválido.")
    if not db.run("UPDATE orders SET status = ?, status_updated_at = ?, status_updated_by = ? WHERE id = ?",
                  (body.status, time.time(), admin, order_id)):
        raise HTTPException(404, "Pedido não encontrado.")
    return {"ok": True}
