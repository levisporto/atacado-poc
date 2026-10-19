"""Gera dist/atacado-demo.html: página única com CSS, JS e catálogo fictício embutidos.

Uso: python build_demo.py
"""
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "backend"))

import config  # noqa: E402
from catalog import group_catalog  # noqa: E402
from mock_data import mock_skus  # noqa: E402

front = ROOT / "frontend"
html = (front / "index.html").read_text(encoding="utf-8")
app_markup = re.search(r"<!--APP-->(.*)<!--/APP-->", html, re.S).group(1)
fonts = re.search(r'<link rel="stylesheet" href="(https://fonts[^"]+)">', html).group(1)

demo = {
    "config": {
        "mock": True, "minOrderValue": config.MIN_ORDER_VALUE, "minQtyPerRef": config.MIN_QTY_PER_REF,
        "sellerPhone": config.GLEICE_WHATSAPP,
    },
    "updatedAt": datetime.now(ZoneInfo("America/Fortaleza")).isoformat(),
    "products": group_catalog(mock_skus()),
}

page = f"""<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Bebêtenkitê Atacado</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="{fonts}">
<style>
{(front / "styles.css").read_text(encoding="utf-8")}
</style>
{app_markup}
<script>window.ATACADO_DEMO = {json.dumps(demo, ensure_ascii=False)};</script>
<script>
{(front / "app.js").read_text(encoding="utf-8")}
</script>
"""
out = ROOT / "dist" / "atacado-demo.html"
out.parent.mkdir(exist_ok=True)
out.write_text(page, encoding="utf-8")
print(f"ok: {out} ({out.stat().st_size // 1024} KB)")
