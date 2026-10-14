"""Validação do pedido e envio para a Gleice (WhatsApp)."""
from __future__ import annotations

import logging
import re
import urllib.parse
from collections import OrderedDict
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from pydantic import BaseModel, Field, field_validator

import config

log = logging.getLogger("atacado.orders")
TZ = ZoneInfo("America/Fortaleza")


class Buyer(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    company: str = Field(min_length=2, max_length=160)
    document: str = Field(description="CNPJ ou CPF")
    phone: str
    city: str = Field(min_length=2, max_length=120)
    notes: str = Field(default="", max_length=1000)

    @field_validator("document")
    @classmethod
    def doc_digits(cls, v: str) -> str:
        d = re.sub(r"\D", "", v)
        if len(d) not in (11, 14):
            raise ValueError("Informe um CNPJ (14 dígitos) ou CPF (11 dígitos)")
        return d

    @field_validator("phone")
    @classmethod
    def phone_digits(cls, v: str) -> str:
        d = re.sub(r"\D", "", v)
        if len(d) < 10:
            raise ValueError("Telefone com DDD")
        return d


class CartItem(BaseModel):
    productCode: int
    quantity: int = Field(gt=0, le=10000)


class OrderIn(BaseModel):
    buyer: Buyer
    items: list[CartItem] = Field(min_length=1)


def brl(v: float) -> str:
    return f"R$ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def fmt_doc(d: str) -> str:
    if len(d) == 14:
        return f"{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}"
    return f"{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}"


def validate(order: OrderIn, fresh: dict[int, dict]) -> tuple[list[dict], list[str]]:
    """Confere cada item contra saldo/preço atuais. Retorna (linhas, problemas)."""
    qty: dict[int, int] = {}
    for it in order.items:
        qty[it.productCode] = qty.get(it.productCode, 0) + it.quantity

    lines, problems = [], []
    for code, q in qty.items():
        sku = fresh.get(code)
        if not sku or sku["price"] is None:
            problems.append(f"Produto {code} não está mais disponível no atacado.")
            continue
        if q > sku["available"]:
            problems.append(
                f"{sku['name']} {sku['color']} {sku['size']}: pediu {q}, "
                f"disponível {int(sku['available'])}."
            )
            continue
        lines.append({**sku, "quantity": q, "subtotal": round(q * sku["price"], 2)})

    # Regras comerciais
    per_ref: dict[str, int] = {}
    for l in lines:
        per_ref[l["reference"]] = per_ref.get(l["reference"], 0) + l["quantity"]
    for ref, q in per_ref.items():
        if q < config.MIN_QTY_PER_REF:
            name = next(l["name"] for l in lines if l["reference"] == ref)
            problems.append(f"{name} (ref. {ref}): mínimo de {config.MIN_QTY_PER_REF} peças por referência.")
    total = sum(l["subtotal"] for l in lines)
    if lines and total < config.MIN_ORDER_VALUE:
        problems.append(f"Pedido mínimo de {brl(config.MIN_ORDER_VALUE)} (atual: {brl(total)}).")
    return lines, problems


def build_message(order_id: str, buyer: Buyer, lines: list[dict]) -> str:
    total = sum(l["subtotal"] for l in lines)
    pieces = sum(l["quantity"] for l in lines)
    now = datetime.now(TZ).strftime("%d/%m/%Y %H:%M")

    grouped: "OrderedDict[str, list[dict]]" = OrderedDict()
    for l in sorted(lines, key=lambda x: (x["name"], x["color"])):
        grouped.setdefault(f"{l['name']} (ref. {l['reference']})", []).append(l)

    out = [
        f"🛒 *NOVO PEDIDO ATACADO — {order_id}*",
        f"_{now}_",
        "",
        f"*Cliente:* {buyer.name}",
        f"*Empresa:* {buyer.company}",
        f"*CNPJ/CPF:* {fmt_doc(buyer.document)}",
        f"*WhatsApp:* {buyer.phone}",
        f"*Cidade:* {buyer.city}",
        "",
        "*Itens*",
    ]
    for title, items in grouped.items():
        out.append(f"▪️ *{title}*")
        by_color: "OrderedDict[str, list[dict]]" = OrderedDict()
        for i in items:
            by_color.setdefault(i["color"], []).append(i)
        for color, ci in by_color.items():
            grade = " · ".join(f"{i['size']}×{i['quantity']}" for i in ci)
            sub = sum(i["subtotal"] for i in ci)
            out.append(f"   {color}: {grade} — {brl(sub)}")
    out += [
        "",
        f"*Total:* {pieces} peças — *{brl(total)}*",
    ]
    if buyer.notes.strip():
        out += ["", f"*Obs.:* {buyer.notes.strip()}"]
    out += ["", "_Preços e saldos conferidos no TOTVS no momento do envio._"]
    return "\n".join(out)


async def deliver(message: str, order_payload: dict) -> dict:
    """Envia para a Gleice. Retorna como foi entregue."""
    if config.EVOLUTION_URL and config.EVOLUTION_INSTANCE and config.EVOLUTION_API_KEY:
        async with httpx.AsyncClient(timeout=20) as http:
            r = await http.post(
                f"{config.EVOLUTION_URL}/message/sendText/{config.EVOLUTION_INSTANCE}",
                headers={"apikey": config.EVOLUTION_API_KEY},
                json={"number": config.GLEICE_WHATSAPP, "text": message},
            )
            r.raise_for_status()
        return {"channel": "evolution", "sent": True}

    if config.N8N_WEBHOOK_URL:
        async with httpx.AsyncClient(timeout=20) as http:
            r = await http.post(config.N8N_WEBHOOK_URL, json={**order_payload, "message": message})
            r.raise_for_status()
        return {"channel": "n8n", "sent": True}

    # Sem integração: devolve link para o comprador enviar pelo próprio WhatsApp
    link = f"https://wa.me/{config.GLEICE_WHATSAPP}?text={urllib.parse.quote(message)}"
    return {"channel": "wa.me", "sent": False, "whatsappUrl": link}
