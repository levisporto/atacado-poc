# Bebêtenkitê Atacado — POC

Portal de pedidos para compradores de atacado. O catálogo vem do estoque do TOTVS Moda
(API V2), o comprador monta o pedido pela grade (cor × tamanho) e, ao enviar, o pedido
chega para a Gleice no WhatsApp.

```
atacado-poc/
├── backend/            FastAPI: proxy do TOTVS + validação e envio do pedido
│   ├── main.py         rotas /api/config, /api/catalogo, /api/pedido e serve o front
│   ├── totvs.py        token OAuth2 + /product/v2/balances/search + /prices/search
│   ├── catalog.py      agrupa SKUs em referência → cor → tamanho; sync incremental + snapshot em disco
│   ├── orders.py       re-confere saldo/preço, regras do atacado, monta e envia a mensagem
│   ├── mock_data.py    estoque fictício (modo demonstração)
│   ├── config.py       tudo vem do .env
│   └── .env.example
├── frontend/           HTML/CSS/JS puro (sem build)
├── build_demo.py       gera dist/atacado-demo.html (página única com dados fictícios)
└── dist/atacado-demo.html
```

## Rodar

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # sem credenciais TOTVS → sobe em modo demonstração
uvicorn main:app --reload
# abrir http://localhost:8000
```

## Fluxo

1. `GET /api/catalogo` → backend autentica no TOTVS, busca saldos da filial do atacado
   (só produto acabado e ativo), busca o preço do código de preço do atacado e agrupa por
   referência. SKUs sem saldo ou sem preço de atacado não aparecem.
   O catálogo fica pronto em memória e o comprador nunca espera o TOTVS:
   - um loop em segundo plano pede ao TOTVS **só os SKUs alterados** (filtro `change` do
     `/balances/search`) a cada `CATALOG_SYNC_SECONDS` (60 s, ~1–2 s por rodada);
   - carga completa (~2–4 min, 30 mil SKUs) a cada `CATALOG_FULL_REFRESH_HOURS` (6 h);
   - cada sincronização grava `backend/cache/catalog.json`; ao reiniciar o servidor o
     catálogo sai desse arquivo na hora. Só a primeiríssima subida espera a carga completa.
   - `?refresh=true` (botão "atualizar") roda a sincronização incremental na hora.
2. Comprador preenche a grade. O front já avisa: estoque excedido, mínimo de peças por
   referência e pedido mínimo.
3. `POST /api/pedido` → o backend **reconsulta saldo e preço só dos SKUs do carrinho, sem
   cache**, e ignora qualquer preço vindo do navegador. Se algo mudou, devolve 409 com a lista
   de problemas e o front recarrega o catálogo.
4. Pedido válido → mensagem formatada para WhatsApp e entrega para a Gleice:
   - **Evolution API** configurada → envio automático (`/message/sendText/{instância}`)
   - **N8N_WEBHOOK_URL** configurado → POST com o JSON do pedido + mensagem pronta
     (bom para também gravar numa planilha, mandar e-mail etc.)
   - nenhum dos dois → o comprador recebe um link `wa.me` pré-preenchido.

## Configurar para o TOTVS real

| Variável | O que é |
|---|---|
| `TOTVS_CLIENT_ID/SECRET/USERNAME/PASSWORD` | o mesmo usuário de API que você já usa |
| `TOTVS_BRANCH_CODE` | filial cujo estoque abastece o atacado |
| `TOTVS_STOCK_CODES` | tipos de saldo considerados (padrão `1`) |
| `TOTVS_PRICE_CODE_ATACADO` | **código de preço do atacado** — confirmar no TOTVS |
| `TOTVS_SUBTRACT_SALES_ORDERS` | desconta o que já está reservado em pedidos de venda |
| `MIN_ORDER_VALUE`, `MIN_QTY_PER_REF` | regras comerciais (padrão R$ 500 e 6 peças/ref.) |
| `GLEICE_WHATSAPP` | número da Gleice, só dígitos com 55 + DDD |

Primeiro teste sugerido: suba com as credenciais, abra `http://localhost:8000/api/catalogo`
e confira se os nomes de campo do seu ambiente batem com os usados em
`catalog.normalize_sku` (`referenceCode`, `referenceName`, `colorName`, `sizeName`,
`balances[0].stock/salesOrder`). É o único ponto que depende do formato exato da resposta.

## Próximos passos (fora do POC)

- Login do comprador (lista de CNPJs liberados) e tabela de preço por cliente
- Fotos dos produtos via `/api/totvsmoda/image/v2`, com cache em disco/CDN
- Gravar o pedido como pedido de venda no TOTVS (`/sales-order/v2`) em vez de só avisar
- Reserva temporária de estoque entre o envio e a confirmação da Gleice
- Hospedagem (Render/Hostinger VPS) com HTTPS e `ALLOWED_ORIGINS` restrito
