"""Cadastro de clientes, sessões e pedidos num SQLite no disco persistente.

~50 clientes e poucas dezenas de pedidos por dia: uma conexão só, protegida por lock, basta.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

import config

_SCHEMA = """
CREATE TABLE IF NOT EXISTS clients (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    document      TEXT NOT NULL UNIQUE,          -- CNPJ/CPF só dígitos
    name          TEXT NOT NULL,
    company       TEXT NOT NULL,
    phone         TEXT NOT NULL,
    city          TEXT NOT NULL,
    email         TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | blocked
    created_at    REAL NOT NULL,
    reviewed_at   REAL,
    reviewed_by   TEXT,
    admin_note    TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,                    -- client | admin
    subject    TEXT NOT NULL,                    -- id do cliente ou nome do admin
    expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
    id                TEXT PRIMARY KEY,          -- ATC-aammdd-XXXX
    client_id         INTEGER NOT NULL REFERENCES clients(id),
    created_at        REAL NOT NULL,
    total             REAL NOT NULL,
    pieces            INTEGER NOT NULL,
    lines_json        TEXT NOT NULL,
    notes             TEXT NOT NULL DEFAULT '',
    message           TEXT NOT NULL,
    delivery_channel  TEXT,
    delivered         INTEGER NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'novo', -- novo | separando | faturado | cancelado
    status_updated_at REAL,
    status_updated_by TEXT
);
CREATE INDEX IF NOT EXISTS orders_client ON orders(client_id);
CREATE INDEX IF NOT EXISTS orders_created ON orders(created_at);
"""

CLIENT_STATUSES = ("pending", "approved", "rejected", "blocked")
ORDER_STATUSES = ("novo", "separando", "faturado", "cancelado")

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def init() -> None:
    global _conn
    Path(config.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    _conn = sqlite3.connect(config.DB_PATH, check_same_thread=False, isolation_level=None)
    _conn.row_factory = sqlite3.Row
    _conn.execute("PRAGMA journal_mode=WAL")
    _conn.execute("PRAGMA foreign_keys=ON")
    _conn.executescript(_SCHEMA)
    _conn.execute("DELETE FROM sessions WHERE expires_at < ?", (time.time(),))


def close() -> None:
    if _conn:
        _conn.close()


def q(sql: str, args: tuple | list = ()) -> list[dict[str, Any]]:
    with _lock:
        return [dict(r) for r in _conn.execute(sql, args).fetchall()]


def one(sql: str, args: tuple | list = ()) -> dict[str, Any] | None:
    rows = q(sql, args)
    return rows[0] if rows else None


def run(sql: str, args: tuple | list = ()) -> int:
    """Executa um INSERT/UPDATE/DELETE; devolve lastrowid (INSERT) ou linhas afetadas."""
    with _lock:
        cur = _conn.execute(sql, args)
        return cur.lastrowid if sql.lstrip().upper().startswith("INSERT") else cur.rowcount


# ------------------------------------------------------------ clientes
PUBLIC_CLIENT = "id, document, name, company, phone, city, email, status, created_at, reviewed_at, reviewed_by, admin_note"


def client_by_document(document: str) -> dict | None:
    return one("SELECT * FROM clients WHERE document = ?", (document,))


def client(client_id: int) -> dict | None:
    return one(f"SELECT {PUBLIC_CLIENT} FROM clients WHERE id = ?", (client_id,))


# ------------------------------------------------------------ pedidos
def order_row(r: dict) -> dict:
    r = dict(r)
    r["lines"] = json.loads(r.pop("lines_json"))
    r["delivered"] = bool(r["delivered"])
    return r
