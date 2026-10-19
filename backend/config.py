"""Configuração via variáveis de ambiente (.env)."""
import os
from dotenv import load_dotenv

load_dotenv()


def _list_int(name: str, default: str) -> list[int]:
    return [int(x) for x in os.getenv(name, default).split(",") if x.strip()]


# --- TOTVS Moda ---
TOTVS_BASE_URL = os.getenv("TOTVS_BASE_URL", "https://apitotvsmoda.bhan.com.br").rstrip("/")
TOTVS_CLIENT_ID = os.getenv("TOTVS_CLIENT_ID", "")
TOTVS_CLIENT_SECRET = os.getenv("TOTVS_CLIENT_SECRET", "")
TOTVS_USERNAME = os.getenv("TOTVS_USERNAME", "")
TOTVS_PASSWORD = os.getenv("TOTVS_PASSWORD", "")

BRANCH_CODE = int(os.getenv("TOTVS_BRANCH_CODE", "1"))          # filial do cadastro e da tabela de preço
STOCK_BRANCH_CODES = _list_int("TOTVS_STOCK_BRANCH_CODES", "1,2")  # filiais cujo saldo é somado na vitrine
STOCK_CODES = _list_int("TOTVS_STOCK_CODES", "1")               # tipos de saldo considerados (1 = FISICO)
PRICE_CODE = int(os.getenv("TOTVS_PRICE_CODE_ATACADO", "3"))    # tabela/código de preço do atacado (3 = ATACADO)
RETAIL_PRICE_CODE = int(os.getenv("TOTVS_PRICE_CODE_VAREJO", "1"))  # preço de venda ao consumidor (1 = VAREJO), só exibido
SUBTRACT_SALES_ORDERS = os.getenv("TOTVS_SUBTRACT_SALES_ORDERS", "true").lower() == "true"
CATALOG_SYNC_SECONDS = int(os.getenv("CATALOG_SYNC_SECONDS", "60"))              # busca só o que mudou
CATALOG_FULL_REFRESH_HOURS = float(os.getenv("CATALOG_FULL_REFRESH_HOURS", "6"))  # carga completa de segurança
CATALOG_SNAPSHOT_PATH = os.getenv(  # no Render: apontar para o disco persistente
    "CATALOG_SNAPSHOT_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "catalog.json"))
IMAGES_DIR = os.getenv(  # fotos: {referência}/{referência}_{cor}_{n}.jpg
    "IMAGES_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "imagens_ecommerce"))
TOTVS_CONCURRENCY = int(os.getenv("TOTVS_CONCURRENCY", "4"))   # requisições simultâneas ao TOTVS

# Sem credenciais => modo demonstração com dados fictícios
MOCK_MODE = os.getenv("MOCK_MODE", "").lower() == "true" or not (
    TOTVS_CLIENT_ID and TOTVS_USERNAME and TOTVS_PASSWORD
)

# --- Regras comerciais do atacado ---
MIN_ORDER_VALUE = float(os.getenv("MIN_ORDER_VALUE", "500"))    # pedido mínimo em R$
MIN_QTY_PER_REF = int(os.getenv("MIN_QTY_PER_REF", "6"))        # peças mínimas por referência

# --- Envio do pedido para a equipe do atacado ---
GLEICE_WHATSAPP = os.getenv("GLEICE_WHATSAPP", "5585999999999")  # DDI+DDD+número, só dígitos

# Opção A: Evolution API (envio automático)
EVOLUTION_URL = os.getenv("EVOLUTION_URL", "").rstrip("/")
EVOLUTION_INSTANCE = os.getenv("EVOLUTION_INSTANCE", "")
EVOLUTION_API_KEY = os.getenv("EVOLUTION_API_KEY", "")

# Opção B: webhook do n8n (recebe o JSON do pedido e faz o que quiser)
N8N_WEBHOOK_URL = os.getenv("N8N_WEBHOOK_URL", "")

# Se nenhuma das duas estiver configurada, o backend devolve um link wa.me
# pré-preenchido e o comprador envia pelo próprio WhatsApp.

# --- Cadastro de clientes e painel /admin ---
DB_PATH = os.getenv(  # no Render: apontar para o disco persistente
    "DB_PATH", os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache", "atacado.db"))
# administradores fixos: "admin:senha,levi:senha"
ADMIN_USERS = {n.strip().lower(): p for n, _, p in
               (x.partition(":") for x in os.getenv("ADMIN_USERS", "").split(",") if ":" in x) if n.strip() and p}
SESSION_DAYS = int(os.getenv("SESSION_DAYS", "30"))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true").lower() == "true"  # false só para testar em http fora do localhost
NOTIFY_NEW_SIGNUPS = os.getenv("NOTIFY_NEW_SIGNUPS", "true").lower() == "true"  # avisa a equipe no WhatsApp

ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",")]
