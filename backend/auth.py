"""Senhas, sessões por cookie e quem pode fazer o quê (cliente aprovado / admin)."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, Response

import config
import db

CLIENT_COOKIE = "atc_session"
ADMIN_COOKIE = "atc_admin"


# ------------------------------------------------------------ senhas (scrypt, sal por usuário)
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1)
    return f"scrypt${salt.hex()}${h.hex()}"


def check_password(password: str, stored: str) -> bool:
    try:
        _, salt, h = stored.split("$")
        got = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2 ** 14, r=8, p=1)
        return hmac.compare_digest(got.hex(), h)
    except ValueError:
        return False


def temp_password() -> str:
    """Senha provisória fácil de ditar no WhatsApp (sem 0/O, 1/l)."""
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


# ------------------------------------------------------------ sessões
def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def start_session(response: Response, kind: str, subject: str) -> None:
    token = secrets.token_urlsafe(32)
    db.run("INSERT INTO sessions (token_hash, kind, subject, expires_at) VALUES (?, ?, ?, ?)",
           (_token_hash(token), kind, subject, time.time() + config.SESSION_DAYS * 86400))
    response.set_cookie(CLIENT_COOKIE if kind == "client" else ADMIN_COOKIE, token,
                        max_age=config.SESSION_DAYS * 86400, httponly=True, samesite="lax",
                        secure=config.COOKIE_SECURE, path="/")


def end_session(request: Request, response: Response, kind: str) -> None:
    name = CLIENT_COOKIE if kind == "client" else ADMIN_COOKIE
    if token := request.cookies.get(name):
        db.run("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
    response.delete_cookie(name, path="/")


def end_all_sessions(kind: str, subject: str) -> None:
    db.run("DELETE FROM sessions WHERE kind = ? AND subject = ?", (kind, subject))


def _subject(request: Request, kind: str) -> str | None:
    token = request.cookies.get(CLIENT_COOKIE if kind == "client" else ADMIN_COOKIE)
    if not token:
        return None
    s = db.one("SELECT subject, expires_at FROM sessions WHERE token_hash = ? AND kind = ?", (_token_hash(token), kind))
    return s["subject"] if s and s["expires_at"] > time.time() else None


# ------------------------------------------------------------ dependências do FastAPI
def optional_client(request: Request) -> dict | None:
    sub = _subject(request, "client")
    c = db.client(int(sub)) if sub else None
    return c if c and c["status"] == "approved" else None


def current_client(request: Request) -> dict:
    c = optional_client(request)
    if not c:
        raise HTTPException(401, "Entre com seu CNPJ/CPF e senha para enviar pedidos.")
    return c


def current_admin(request: Request) -> str:
    name = _subject(request, "admin")
    if not name or name not in config.ADMIN_USERS:  # admin removido do .env perde o acesso na hora
        raise HTTPException(401, "Sessão de administrador expirada.")
    return name


def check_admin(name: str, password: str) -> bool:
    expected = config.ADMIN_USERS.get(name.strip().lower())
    return bool(expected) and hmac.compare_digest(expected.encode(), password.encode())


# ------------------------------------------------------------ limite de tentativas de login
# Por conta (CNPJ ou admin): 5 erros em 10 min. As chaves "todos" somam qualquer conta, para quem
# tenta muitas contas ou troca de IP a cada tentativa. IP não é chave confiável: o X-Forwarded-For
# vem do próprio visitante, então ele só soma, nunca é a única proteção.
_fails: dict[str, deque] = defaultdict(deque)
WINDOW, MAX_FAILS = 600, 5
LIMITS = {"admin-all": 20, "client-all": 200}


def throttle(*keys: str) -> None:
    now = time.time()
    for k in keys:
        d = _fails[k]
        while d and d[0] < now - WINDOW:
            d.popleft()
        if len(d) >= LIMITS.get(k, MAX_FAILS):
            raise HTTPException(429, "Muitas tentativas. Espere alguns minutos e tente de novo.")


def failed(*keys: str) -> None:
    for k in keys:
        _fails[k].append(time.time())


def client_ip(request: Request) -> str:
    # no Render o IP vem no X-Forwarded-For, que o visitante pode forjar: serve só como chave extra
    return (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "")).split(",")[0].strip()
