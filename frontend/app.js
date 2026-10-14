/* Bebêtenkitê Atacado — front-end (vanilla JS).
 * Modo API: conversa com o backend FastAPI (/api/config, /api/catalogo, /api/pedido).
 * Modo demo: se window.ATACADO_DEMO existir, usa os dados embutidos e monta o pedido no navegador.
 */
(() => {
  "use strict";
  const DEMO = window.ATACADO_DEMO || null;
  const API = window.ATACADO_API_BASE || "";
  const $ = (s, el = document) => el.querySelector(s);

  const S = {
    config: { minOrderValue: 500, minQtyPerRef: 6, sellerName: "Gleice", mock: true },
    products: [], index: new Map(), updatedAt: null,
    cart: new Map(), group: "Todos", q: "", step: "cart",
    buyer: { name: "", company: "", document: "", phone: "", city: "", notes: "" },
    problems: [], result: null, sending: false,
  };

  // ---------- util ----------
  const brl = v => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const digits = s => String(s || "").replace(/\D/g, "");
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem storage: segue sem lembrar */ } },
  };
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
  }

  // Chaves sem acento e em minúsculas. O nome da cor no TOTVS vem com código e ruído
  // ("Vermelho 44990", "Listra Azul Marinho / Branco"), então procuramos as palavras de cor
  // dentro do nome, preferindo a expressão mais longa ("azul marinho" antes de "azul").
  const COLOR_HEX = {
    "branco": "#ffffff", "off white": "#f3efe6", "off": "#f3efe6", "marfim": "#f5f0e1", "cru": "#ece3cf",
    "bege": "#d9c3a5", "areia": "#d8c7a6", "nude": "#e3bfa6", "caqui": "#b9a77c", "capuccino": "#a07856",
    "caramelo": "#b97a45", "terracota": "#c0694a", "marrom": "#7a5232", "marron": "#7a5232",
    "marrom escuro": "#4e3420", "marron escuro": "#4e3420", "bordo": "#7a1f33", "vinho": "#6e1f2e",
    "vermelho": "#d93a3a", "framboesa": "#c2335f", "pink": "#f0479a", "rosa": "#ee9fb0",
    "rosa claro": "#f6c9d3", "rosa bebe": "#f4c6cf", "rosa pink": "#f0479a", "rosa malva": "#c98a9b",
    "rosa fiesta": "#ef5a8a", "rosa neon": "#ff5fa2", "salmao": "#f4a38a", "pessego": "#f8c4a0",
    "laranja": "#f28c38", "amarelo": "#f5d33f", "amarelo manteiga": "#f4e2a1", "neon": "#c6f432",
    "verde": "#4fa36a", "verde claro": "#a8d5a2", "verde escuro": "#2f5e3e", "verde endro": "#8a9a5b",
    "verde salvia": "#a9bfa2", "maca verde": "#8cc63f", "turquesa": "#2bb3b1", "azul turquesa": "#2bb3b1",
    "azul": "#3f7fd0", "azul claro": "#9cc7ec", "azul nevoa": "#b9cfe0", "jeans claro": "#8fb0d3",
    "azul escuro": "#23407a", "dark blue": "#23407a", "azul marinho": "#1f2f57", "marinho": "#1f2f57",
    "lilas": "#c4a8e0", "lavanda": "#c7b6e3", "roxo": "#7b4fa6", "cinza": "#9a9ca3", "mescla": "#b6b8be",
    "cinza mescla": "#a9abb2", "preto": "#262626", "unica": "#cccccc",
  };
  const NEUTRAL = "#d9d3c7";
  // estampas, "diversas", "colorido" e nomes sem cor reconhecível
  const MULTI = "conic-gradient(#f28c38, #f5d33f, #4fa36a, #3f7fd0, #c4a8e0, #ee9fb0, #f28c38)";
  const colorCache = new Map();
  function colorsIn(name) {
    if (colorCache.has(name)) return colorCache.get(name);
    const words = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/[^a-z ]+/g, " ").split(/\s+/).filter(Boolean);
    const found = [];
    for (let i = 0; i < words.length && found.length < 2; i++) {
      for (let n = 3; n >= 1; n--) {
        const hex = COLOR_HEX[words.slice(i, i + n).join(" ")];
        if (hex && i + n <= words.length) {
          if (!found.includes(hex)) found.push(hex);
          i += n - 1;
          break;
        }
      }
    }
    colorCache.set(name, found);
    return found;
  }
  // fundo da bolinha: 1 cor, meio a meio se o nome tiver 2 (listras, "Vermelho Branco"), ou arco-íris
  function swatchBg(name) {
    const [a, b] = colorsIn(name);
    return !a ? MULTI : b ? `linear-gradient(135deg, ${a} 50%, ${b} 50%)` : a;
  }
  const tintFor = name => (colorsIn(name)[0] || NEUTRAL) + "33";

  // ---------- dados ----------
  const api = {
    async config() {
      if (DEMO) return DEMO.config;
      const r = await fetch(`${API}/api/config`); return r.json();
    },
    async catalog(refresh = false) {
      if (DEMO) return { products: DEMO.products, updatedAt: DEMO.updatedAt, mock: true };
      const r = await fetch(`${API}/api/catalogo${refresh ? "?refresh=true" : ""}`);
      if (!r.ok) throw new Error((await r.json()).detail || "Falha ao carregar o estoque");
      return r.json();
    },
    async order(payload) {
      if (DEMO) return demoOrder(payload);
      const r = await fetch(`${API}/api/pedido`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (r.status === 409) return { problems: data.detail.problems };
      if (r.status === 422) return { problems: data.detail.map(d => `${d.loc.slice(-1)[0]}: ${d.msg}`) };
      if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Falha ao enviar o pedido");
      return data;
    },
  };

  function indexProducts(products) {
    S.index.clear();
    for (const p of products) for (const c of p.colors) for (const s of c.skus) {
      S.index.set(s.productCode, { ...s, reference: p.reference, name: p.name, color: c.color });
    }
  }

  // ---------- regras (espelho do backend, só para feedback imediato) ----------
  function cartLines() {
    const lines = [];
    for (const [code, qty] of S.cart) {
      const sku = S.index.get(code);
      if (sku && qty > 0) lines.push({ ...sku, quantity: qty, subtotal: qty * sku.price });
    }
    return lines;
  }
  function cartProblems(lines) {
    const out = [];
    const perRef = new Map();
    for (const l of lines) {
      if (l.quantity > l.available) out.push(`${l.name} ${l.color} ${l.size}: pediu ${l.quantity}, disponível ${l.available}.`);
      perRef.set(l.reference, (perRef.get(l.reference) || { q: 0, name: l.name })); perRef.get(l.reference).q += l.quantity;
    }
    for (const [ref, v] of perRef) if (v.q < S.config.minQtyPerRef)
      out.push(`${v.name} (ref. ${ref}): mínimo de ${S.config.minQtyPerRef} peças por referência.`);
    const total = lines.reduce((a, l) => a + l.subtotal, 0);
    if (lines.length && total < S.config.minOrderValue)
      out.push(`Pedido mínimo de ${brl(S.config.minOrderValue)} (faltam ${brl(S.config.minOrderValue - total)}).`);
    return out;
  }

  // ---------- render: catálogo ----------
  function renderRules() {
    $("#sellerName").textContent = S.config.sellerName;
    $("#rules").innerHTML =
      (S.config.mock || DEMO ? `<span class="pill demo">Demonstração: estoque fictício</span>` : "");
  }
  function renderGroups() {
    const groups = ["Todos", ...new Set(S.products.map(p => p.group).filter(Boolean))];
    $("#groups").innerHTML = groups.map(g =>
      `<button type="button" class="chip" aria-pressed="${g === S.group}" data-group="${esc(g)}">${esc(g)}</button>`).join("");
  }
  function renderStamp() {
    if (!S.updatedAt) return;
    const d = new Date(S.updatedAt);
    $("#stamp").innerHTML = `Estoque consultado às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` +
      ` · ${S.products.length} referências` + (DEMO ? "" : ` <button type="button" id="refresh">atualizar</button>`);
  }

  function visibleProducts() {
    const q = S.q.trim().toLowerCase();
    return S.products.filter(p =>
      (S.group === "Todos" || p.group === S.group) &&
      (!q || p.name.toLowerCase().includes(q) || p.reference.toLowerCase().includes(q)));
  }

  function refCard(p) {
    const priceTxt = p.minPrice === p.maxPrice ? brl(p.minPrice) : `${brl(p.minPrice)} – ${brl(p.maxPrice)}`;
    const head = p.sizes.map(s => `<th scope="col">${esc(s)}</th>`).join("");
    const rows = p.colors.map(c => {
      const bySize = new Map(c.skus.map(s => [s.size, s]));
      const cells = p.sizes.map(size => {
        const s = bySize.get(size);
        if (!s) return `<td><span class="na" title="Sem estoque">—</span></td>`;
        const q = S.cart.get(s.productCode) || "";
        const cls = q ? (q > s.available ? "qty over" : "qty has") : "qty";
        return `<td><div class="cell">
          <input class="${cls}" id="q-${s.productCode}" type="number" inputmode="numeric" min="0" max="${s.available}"
            step="1" value="${q}" data-code="${s.productCode}" aria-label="${esc(p.name)} ${esc(c.color)} tamanho ${esc(size)}">
          <span class="avail">${s.available} disp.</span></div></td>`;
      }).join("");
      return `<tr><th scope="row" class="color"><span class="sw" style="background:${swatchBg(c.color)}"></span>${esc(c.color)}</th>${cells}
        <td class="act"><button type="button" class="mini" data-grade="${esc(p.reference)}|${esc(c.color)}" title="Soma 1 peça em cada tamanho disponível">+1 grade</button></td></tr>`;
    }).join("");
    const stockCls = p.totalAvailable < 40 ? "low" : "ok";
    return `<article class="ref" data-ref="${esc(p.reference)}">
      <div class="ref-art" style="background:${tintFor(p.colors[0].color)}">
        <span class="initial" aria-hidden="true">${esc(p.name[0])}</span>
        <div class="swatches">${p.colors.map(c => `<span class="sw" title="${esc(c.color)}" style="background:${swatchBg(c.color)}"></span>`).join("")}</div>
      </div>
      <div class="ref-body">
        <div class="ref-head">
          <h2>${esc(p.name)}</h2><span class="code mono">ref. ${esc(p.reference)}</span>
          <span class="price">${priceTxt} <small>/ peça</small></span>
        </div>
        <div class="ref-meta"><span>${esc(p.group || "")}</span>
          <span class="${stockCls}">${p.totalAvailable} peças em estoque</span>
          <span>${p.colors.length} ${p.colors.length > 1 ? "cores" : "cor"} · ${p.sizes.join(" ")}</span></div>
        <div class="grid-wrap"><table class="grade"><thead><tr><th></th>${head}<th></th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="ref-foot" id="foot-${esc(p.reference)}"></div>
      </div></article>`;
  }

  function renderRefFoot(ref) {
    const el = document.getElementById(`foot-${ref}`); if (!el) return;
    const lines = cartLines().filter(l => l.reference === ref);
    const q = lines.reduce((a, l) => a + l.quantity, 0);
    if (!q) { el.innerHTML = ""; return; }
    const sub = lines.reduce((a, l) => a + l.subtotal, 0);
    const warn = q < S.config.minQtyPerRef ? `<span class="warnline">Faltam ${S.config.minQtyPerRef - q} peças para o mínimo da referência</span>` : "";
    el.innerHTML = `<span><b>${q}</b> peças no carrinho</span>${warn}<span class="sub">${brl(sub)}</span>`;
  }

  function renderList() {
    const items = visibleProducts();
    $("#list").innerHTML = items.length ? items.map(refCard).join("")
      : `<div class="empty">Nenhuma referência encontrada para essa busca.</div>`;
    items.forEach(p => renderRefFoot(p.reference));
  }

  function renderHeader() {
    const lines = cartLines();
    $("#cartCount").textContent = lines.reduce((a, l) => a + l.quantity, 0);
    $("#cartSum").textContent = brl(lines.reduce((a, l) => a + l.subtotal, 0));
  }

  // ---------- render: gaveta ----------
  function groupLines(lines) {
    const m = new Map();
    for (const l of lines) {
      const k = `${l.reference}|${l.color}`;
      if (!m.has(k)) m.set(k, { reference: l.reference, name: l.name, color: l.color, items: [] });
      m.get(k).items.push(l);
    }
    return [...m.values()];
  }

  function renderDrawer() {
    document.querySelectorAll(".steps span").forEach(s =>
      s.toggleAttribute("aria-current", false) || (s.dataset.step === S.step && s.setAttribute("aria-current", "step")));
    const body = $("#drawerBody"), foot = $("#drawerFoot");
    const lines = cartLines();
    const total = lines.reduce((a, l) => a + l.subtotal, 0);
    const pieces = lines.reduce((a, l) => a + l.quantity, 0);
    const probs = cartProblems(lines);

    if (S.step === "cart") {
      $("#drawerTitle").textContent = "Seu pedido";
      if (!lines.length) {
        body.innerHTML = `<p class="note">O carrinho está vazio. Preencha as quantidades na grade de cada referência.</p>`;
        foot.innerHTML = `<button class="ghost" type="button" data-close>Voltar ao catálogo</button>`;
        return;
      }
      body.innerHTML = groupLines(lines).map(g => {
        const sub = g.items.reduce((a, l) => a + l.subtotal, 0);
        const grade = g.items.map(i => `${i.size}×${i.quantity}`).join(" · ");
        return `<div class="line"><b>${esc(g.name)} · ${esc(g.color)}</b><span class="v">${brl(sub)}</span>
          <span class="g">ref. ${esc(g.reference)} — ${esc(grade)}</span>
          <button class="rm" type="button" data-remove="${esc(g.reference)}|${esc(g.color)}">remover</button></div>`;
      }).join("") + (probs.length ? `<div class="problems"><b>Antes de continuar:</b><ul>${probs.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : "");
      const pct = Math.min(100, (total / S.config.minOrderValue) * 100);
      foot.innerHTML = `<div class="totals"><div><span>${pieces} peças</span><span class="mono">${lines.length} SKUs</span></div>
        <div class="big"><span>Total</span><span>${brl(total)}</span></div></div>
        <div class="meter" aria-label="Progresso até o pedido mínimo"><i style="width:${pct}%"></i></div>
        <button class="primary" type="button" id="toBuyer" ${probs.length ? "disabled" : ""}>Continuar para seus dados</button>`;
      return;
    }

    if (S.step === "buyer") {
      $("#drawerTitle").textContent = "Seus dados";
      const b = S.buyer;
      const f = (id, label, attrs = "") => `<div class="field"><label for="b-${id}">${label}</label>
        <input id="b-${id}" name="${id}" value="${esc(b[id])}" ${attrs}><span class="err" id="e-${id}"></span></div>`;
      body.innerHTML = `<form class="buyer" id="buyerForm" novalidate>
        ${f("name", "Seu nome", 'autocomplete="name" required')}
        ${f("company", "Loja / razão social", 'autocomplete="organization" required')}
        <div class="row2">${f("document", "CNPJ ou CPF", 'inputmode="numeric" required')}
        ${f("phone", "WhatsApp com DDD", 'inputmode="tel" autocomplete="tel" required')}</div>
        ${f("city", "Cidade / UF", 'autocomplete="address-level2" required')}
        <div class="field"><label for="b-notes">Observações (opcional)</label>
          <textarea id="b-notes" name="notes" placeholder="Prazo, transportadora preferida, forma de pagamento…">${esc(b.notes)}</textarea></div>
        ${S.problems.length ? `<div class="problems"><b>O estoque mudou:</b><ul>${S.problems.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}
      </form>`;
      foot.innerHTML = `<div class="totals"><div class="big"><span>${pieces} peças</span><span>${brl(total)}</span></div></div>
        <button class="primary" type="submit" form="buyerForm" id="send" ${S.sending ? "disabled" : ""}>${S.sending ? "Conferindo estoque…" : `Enviar pedido para ${esc(S.config.sellerName)}`}</button>
        <button class="ghost" type="button" id="backCart">Voltar aos itens</button>`;
      return;
    }

    // done
    const r = S.result;
    $("#drawerTitle").textContent = "Pedido pronto";
    body.innerHTML = `<div class="done"><div class="tick" aria-hidden="true">✓</div>
      <h3>${r.sent ? `Pedido enviado para ${esc(S.config.sellerName)}` : "Falta só um toque"}</h3>
      <p class="note"><span class="mono">${esc(r.orderId)}</span> · ${brl(r.total)}</p>
      <p class="note">${r.sent
        ? `${esc(S.config.sellerName)} recebeu o pedido no WhatsApp e vai falar com você para confirmar frete e pagamento.`
        : `Abra o WhatsApp pelo botão abaixo e envie a mensagem que já vai preenchida para ${esc(S.config.sellerName)}. Se o botão não abrir, copie o texto e mande para <b class="mono">${esc(r.sellerPhone || "")}</b>.`}</p>
      <pre class="msg" id="msg">${esc(r.message)}</pre></div>`;
    foot.innerHTML = (r.whatsappUrl ? `<a class="wa" href="${esc(r.whatsappUrl)}" target="_blank" rel="noopener">Abrir WhatsApp com o pedido</a>` : "") +
      `<button class="ghost" type="button" id="copyMsg">Copiar mensagem</button>
       <button class="ghost" type="button" id="newOrder">Fazer outro pedido</button>`;
  }

  // ---------- demo: monta o pedido no navegador ----------
  function buildMessage(orderId, b, lines) {
    const total = lines.reduce((a, l) => a + l.subtotal, 0);
    const pieces = lines.reduce((a, l) => a + l.quantity, 0);
    const doc = b.document.length === 14
      ? b.document.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")
      : b.document.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    const now = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    const out = [`🛒 *NOVO PEDIDO ATACADO — ${orderId}*`, `_${now}_`, "",
      `*Cliente:* ${b.name}`, `*Empresa:* ${b.company}`, `*CNPJ/CPF:* ${doc}`, `*WhatsApp:* ${b.phone}`, `*Cidade:* ${b.city}`, "", "*Itens*"];
    const byRef = new Map();
    for (const l of [...lines].sort((a, c) => (a.name + a.color).localeCompare(c.name + c.color))) {
      const k = `${l.name} (ref. ${l.reference})`;
      if (!byRef.has(k)) byRef.set(k, new Map());
      const bc = byRef.get(k); if (!bc.has(l.color)) bc.set(l.color, []); bc.get(l.color).push(l);
    }
    for (const [title, colors] of byRef) {
      out.push(`▪️ *${title}*`);
      for (const [color, ls] of colors)
        out.push(`   ${color}: ${ls.map(i => `${i.size}×${i.quantity}`).join(" · ")} — ${brl(ls.reduce((a, i) => a + i.subtotal, 0))}`);
    }
    out.push("", `*Total:* ${pieces} peças — *${brl(total)}*`);
    if (b.notes.trim()) out.push("", `*Obs.:* ${b.notes.trim()}`);
    out.push("", "_Preços e saldos conferidos no TOTVS no momento do envio._");
    return out.join("\n");
  }
  async function demoOrder(payload) {
    const lines = cartLines(); const probs = cartProblems(lines);
    if (probs.length) return { problems: probs };
    const d = new Date();
    const id = `ATC-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
    const message = buildMessage(id, payload.buyer, lines);
    return { orderId: id, total: lines.reduce((a, l) => a + l.subtotal, 0), message, sent: false, channel: "wa.me",
      whatsappUrl: `https://wa.me/${DEMO.config.sellerPhone}?text=${encodeURIComponent(message)}` };
  }

  // ---------- ações ----------
  function setQty(code, qty) {
    qty = Math.max(0, Math.floor(Number(qty) || 0));
    if (qty) S.cart.set(code, qty); else S.cart.delete(code);
    store.set("atc-cart", [...S.cart]);
    const input = document.getElementById(`q-${code}`), sku = S.index.get(code);
    if (input && sku) {
      if (document.activeElement !== input) input.value = qty || "";
      input.className = qty ? (qty > sku.available ? "qty over" : "qty has") : "qty";
    }
    if (sku) renderRefFoot(sku.reference);
    renderHeader();
  }
  function openDrawer(step = "cart") { S.step = step; $("#drawer").hidden = false; $("#scrim").hidden = false; renderDrawer(); }
  function closeDrawer() { $("#drawer").hidden = true; $("#scrim").hidden = true; if (S.step === "done") { S.step = "cart"; } }

  function validateBuyer(form) {
    const b = Object.fromEntries(new FormData(form)); const errs = {};
    if ((b.name || "").trim().length < 2) errs.name = "Informe seu nome.";
    if ((b.company || "").trim().length < 2) errs.company = "Informe o nome da loja.";
    if (![11, 14].includes(digits(b.document).length)) errs.document = "CNPJ com 14 dígitos ou CPF com 11.";
    if (digits(b.phone).length < 10) errs.phone = "WhatsApp com DDD.";
    if ((b.city || "").trim().length < 2) errs.city = "Informe a cidade.";
    for (const k of ["name", "company", "document", "phone", "city"]) { const e = $(`#e-${k}`); if (e) e.textContent = errs[k] || ""; }
    return { b, ok: !Object.keys(errs).length };
  }

  async function submitOrder(form) {
    const { b, ok } = validateBuyer(form);
    S.buyer = { ...S.buyer, ...b }; store.set("atc-buyer", S.buyer);
    if (!ok || S.sending) return;
    S.sending = true; S.problems = []; renderDrawer();
    try {
      const payload = {
        buyer: { ...S.buyer, document: digits(S.buyer.document), phone: digits(S.buyer.phone) },
        items: [...S.cart].map(([productCode, quantity]) => ({ productCode, quantity })),
      };
      const res = await api.order(payload);
      if (res.problems) { S.problems = res.problems; await reloadCatalog(true); }
      else {
        S.result = { ...res, sellerPhone: DEMO ? DEMO.config.sellerPhone : "" };
        S.cart.clear(); store.set("atc-cart", []); renderList(); renderHeader(); S.step = "done";
      }
    } catch (e) { toast(e.message || "Não foi possível enviar. Tente de novo."); }
    finally { S.sending = false; renderDrawer(); }
  }

  async function reloadCatalog(refresh = false) {
    const data = await api.catalog(refresh);
    // mais estoque primeiro; empate por nome
    S.products = [...data.products].sort((a, b) =>
      b.totalAvailable - a.totalAvailable || a.name.localeCompare(b.name, "pt-BR"));
    S.updatedAt = data.updatedAt; indexProducts(S.products);
    for (const code of [...S.cart.keys()]) if (!S.index.has(code)) S.cart.delete(code);
    renderGroups(); renderStamp(); renderList(); renderHeader();
  }

  // ---------- eventos ----------
  document.addEventListener("input", e => {
    if (e.target.matches(".qty")) setQty(Number(e.target.dataset.code), e.target.value);
    if (e.target.id === "search") { S.q = e.target.value; renderList(); }
  });
  document.addEventListener("click", e => {
    const t = e.target.closest("button, [data-close]"); if (!t) return;
    if (t.dataset.group) { S.group = t.dataset.group; renderGroups(); renderList(); }
    else if (t.dataset.grade) {
      const [ref, color] = t.dataset.grade.split("|");
      const p = S.products.find(x => x.reference === ref); const c = p.colors.find(x => x.color === color);
      let capped = false;
      for (const s of c.skus) { const cur = S.cart.get(s.productCode) || 0; if (cur < s.available) setQty(s.productCode, cur + 1); else capped = true; }
      if (capped) toast("Alguns tamanhos já estão no limite do estoque.");
    }
    else if (t.id === "openCart") openDrawer("cart");
    else if (t.id === "closeCart" || t.hasAttribute("data-close")) closeDrawer();
    else if (t.id === "toBuyer") { S.problems = []; openDrawer("buyer"); }
    else if (t.id === "backCart") openDrawer("cart");
    else if (t.id === "refresh") reloadCatalog(true).then(() => toast("Estoque atualizado"));
    else if (t.dataset.remove) {
      const [ref, color] = t.dataset.remove.split("|");
      for (const l of cartLines()) if (l.reference === ref && l.color === color) setQty(l.productCode, 0);
      renderDrawer();
    }
    else if (t.id === "copyMsg") {
      const text = S.result?.message || "";
      navigator.clipboard?.writeText(text).then(() => toast("Mensagem copiada"), () => {
        const r = document.createRange(); r.selectNodeContents($("#msg"));
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast("Texto selecionado: copie com Ctrl+C");
      });
    }
    else if (t.id === "newOrder") { closeDrawer(); S.result = null; }
  });
  $("#scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer(); });
  document.addEventListener("submit", e => { if (e.target.id === "buyerForm") { e.preventDefault(); submitOrder(e.target); } });

  // ---------- início ----------
  (async () => {
    S.cart = new Map(store.get("atc-cart", []));
    S.buyer = { ...S.buyer, ...store.get("atc-buyer", {}) };
    try {
      S.config = { ...S.config, ...(await api.config()) };
      renderRules();
      await reloadCatalog();
    } catch (e) {
      $("#stamp").textContent = "";
      $("#list").innerHTML = `<div class="empty">Não foi possível carregar o estoque agora. ${esc(e.message || "")}<br>Recarregue a página em alguns minutos.</div>`;
    }
  })();
})();
