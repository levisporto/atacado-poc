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
    cart: new Map(), cat: "Todos", q: "", step: "cart",
    view: "home", ref: null, color: null, draft: new Map(), homeScroll: 0, fromApp: false, routed: false,
    buyer: { name: "", company: "", document: "", phone: "", city: "", notes: "" },
    problems: [], result: null, sending: false,
    firstPaint: true,
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
  // fundo do ícone da peça: a primeira cor reconhecida misturada ao creme
  const tintFor = name => `color-mix(in srgb, ${colorsIn(name)[0] || NEUTRAL} 34%, var(--tile))`;

  // silhuetas em traço, escolhidas pelo nome da referência
  const ICONS = {
    body: '<path d="M8.5 3.5h7l4 3-1.8 3.2-2.2-1.2V14c0 1-.5 1.9-1.3 2.4L13 20.5h-2l-1.2-4.1C9 15.9 8.5 15 8.5 14V8.5L6.3 9.7 4.5 6.5z"/><path d="M10 3.5a2 2 0 0 0 4 0"/>',
    dress: '<path d="M9.5 3v3.5L7.8 9.2 4.5 20h15l-3.3-10.8-1.7-2.7V3"/><path d="M9.5 6.5h5"/><path d="M7.8 9.2c1.4.8 2.8 1.2 4.2 1.2s2.8-.4 4.2-1.2"/>',
    tee: '<path d="M9 3.5 4 6l1.8 4.2 2.4-1V20.5h7.6V9.2l2.4 1L20 6l-5-2.5c-.4 1.3-1.6 2.2-3 2.2s-2.6-.9-3-2.2z"/>',
    shorts: '<path d="M5.5 4.5h13l1 14.5h-6L12 11l-1.5 8h-6z"/><path d="M5.5 7.5h13"/>',
    pants: '<path d="M7 3.5h10l1.5 17h-4.6L12 10.5l-1.9 10H5.5z"/><path d="M7 6.5h10"/>',
    jacket: '<path d="M9 3.5 5 5.5 3.5 20.5h4.5V12M15 3.5l4 2 1.5 15H16V12"/><path d="M9 3.5 12 7l3-3.5M12 7v13.5M8 20.5h8"/>',
    set: '<path d="M8.5 3 5 4.8l1.2 2.8 1.6-.6V12h8.4V7l1.6.6L19 4.8 15.5 3c-.4 1-1.9 1.6-3.5 1.6S8.9 4 8.5 3z"/><path d="M7.5 14h9l.7 7h-3.7L12 17.5 10.5 21H6.8z"/>',
    shoe: '<path d="M3.5 16.5v-7c2 0 3.5-.8 4.5-2.5l2.5 1.5c1 3 4 4 7.5 4.5 1.5.2 2.5 1.2 2.5 2.5v1z"/><path d="M3.5 16.5h17v2.5h-17z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
    blanket: '<rect x="4" y="4.5" width="16" height="15" rx="2.5"/><path d="M4 9h16"/><path d="M8 13.5h.01M12 13.5h.01M16 13.5h.01M10 16.5h.01M14 16.5h.01" stroke-width="2.4"/>',
    hat: '<path d="M5 16a7 7 0 0 1 14 0"/><rect x="4" y="16" width="16" height="3.5" rx="1.75"/><circle cx="12" cy="4.5" r="1.5"/>',
    box: '<path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z"/><path d="M3.5 7.5 12 11.5l8.5-4M12 11.5v9"/><path d="m7.8 5.5 8.5 4v3"/>',
    overall: '<path d="M8 3.5v5M16 3.5v5"/><path d="M6.5 8.5h11l1 12h-5L12 14l-1.5 6.5h-5z"/><rect x="9.5" y="9.5" width="5" height="3" rx="1"/>',
    more: '<circle cx="6" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18" cy="12" r="1.3"/>',
  };
  const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const BAG = svg('<path d="M5 8h14l-1.2 11.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>');
  const ALL = svg('<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>');
  const plain = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // Categorias da vitrine, tiradas do nome da referência. A ordem importa: a primeira que casar vence
  // ("Bermuda Moletom" é bermuda, não casaco; "Saída de Praia" é moda praia; "Calçados" não é calça).
  const CATEGORIES = [
    { name: "Moda Praia", icon: "sun", re: /biquini|maio\b|sunga|praia|\buv\b|piscina/ },
    { name: "Conjunto", icon: "set", re: /conjunto|pijama/ },
    { name: "Macacão", icon: "overall", re: /macacao|macaquinho|jardineira|banho de sol/ },
    { name: "Body", icon: "body", re: /\bbody\b|bodies/ },
    { name: "Vestido", icon: "dress", re: /vestido|saia|salopete/ },
    { name: "Bermuda", icon: "shorts", re: /bermuda|short/ },
    { name: "Calçado", icon: "shoe", re: /calcado|sapat|tenis|all ?star|sandalia|\bbotas?\b|botinha|chinelo|pantufa|crocs/ },
    { name: "Calça", icon: "pants", re: /\bcalcas?\b|legging|culote|mijao|jogger/ },
    { name: "Casaco", icon: "jacket", re: /casaco|jaqueta|moletom|cardigan|colete|blusao|sueter|corta.?vento|japona|parka/ },
    { name: "Camisa", icon: "tee", re: /camis|blusa|regata|polo|bata\b|cropped|\btop\b/ },
    { name: "Acessórios", icon: "hat", re: /touca|gorro|chapeu|bone\b|luva|meia|laco|tiara|faixa|babador|prendedor|naninha|bolsa|mochila/ },
  ];
  const OTHER = { name: "Outros", icon: "more" };
  // ordem em que aparecem na faixa (a de cima é só a ordem de busca)
  const CAT_ORDER = ["Camisa", "Macacão", "Bermuda", "Calça", "Body", "Vestido", "Casaco", "Conjunto", "Calçado", "Moda Praia", "Acessórios"]
    .map(n => CATEGORIES.find(c => c.name === n));
  const catCache = new Map();
  function categoryOf(name) {
    if (!catCache.has(name)) catCache.set(name, CATEGORIES.find(c => c.re.test(plain(name))) || OTHER);
    return catCache.get(name);
  }
  function iconFor(name) {
    const n = plain(name), cat = categoryOf(name);
    const k = /embalage|caixa|sacola|saquinho/.test(n) ? "box" : /manta|cueiro|toalha|saida de maternidade/.test(n) ? "blanket"
      : cat === OTHER ? "tee" : cat.icon;
    return svg(ICONS[k]);
  }
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

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

  // ---------- render: início ----------
  function renderHello() {
    const first = (S.buyer.name || "").trim().split(/\s+/)[0];
    $("#hi").textContent = first ? `Olá, ${first}` : "Olá, lojista";
    $("#avatar").textContent = (first || S.buyer.company || "B")[0].toUpperCase();
  }
  function renderRules() {
    $("#demoTag").hidden = !(S.config.mock || DEMO);
    $("#heroRules").textContent = `Pedido mínimo de ${brl(S.config.minOrderValue)} e ${S.config.minQtyPerRef} peças por referência. ` +
      "Monte a grade de cada peça e envie pelo WhatsApp.";
  }
  // três peças do catálogo, inclinadas, como vitrine do destaque
  function renderHeroArt() {
    const picks = [];
    for (const p of S.products) {
      if (!picks.some(x => iconFor(x.name) === iconFor(p.name))) picks.push(p);
      if (picks.length === 3) break;
    }
    $("#heroArt").innerHTML = picks.map(p =>
      `<span style="background:color-mix(in srgb, ${colorsIn(p.colors[0].color)[0] || NEUTRAL} 45%, #fffaf2)">${iconFor(p.name)}</span>`).join("");
  }
  // "Todos" e as categorias fixas; as que não têm peça no estoque de hoje ficam apagadas
  function renderGroups() {
    const used = new Set(S.products.map(p => categoryOf(p.name).name));
    $("#groups").innerHTML = [{ name: "Todos" }, ...CAT_ORDER, OTHER].map(c => {
      const empty = c.name !== "Todos" && !used.has(c.name);
      return `<button type="button" aria-pressed="${c.name === S.cat}" data-group="${esc(c.name)}"${empty ? ' disabled title="Sem peças em estoque agora"' : ""}>
        <span class="ico">${c.name === "Todos" ? ALL : svg(ICONS[c.icon])}</span>${esc(c.name)}</button>`;
    }).join("");
  }
  function renderStamp() {
    if (!S.updatedAt) return;
    const d = new Date(S.updatedAt);
    $("#stamp").innerHTML = `${S.products.length} referências · estoque das ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` +
      (DEMO ? "" : ` <button type="button" id="refresh">atualizar</button>`);
  }

  function visibleProducts() {
    const q = S.q.trim().toLowerCase();
    return S.products.filter(p =>
      (S.cat === "Todos" || categoryOf(p.name).name === S.cat) &&
      (!q || p.name.toLowerCase().includes(q) || p.reference.toLowerCase().includes(q)));
  }
  const priceOf = p => p.minPrice === p.maxPrice ? brl(p.minPrice) : `${brl(p.minPrice)} – ${brl(p.maxPrice)}`;
  const refPieces = ref => sum(cartLines().filter(l => l.reference === ref), l => l.quantity);

  function productCard(p, i) {
    const q = refPieces(p.reference);
    return `<a class="card${S.firstPaint ? " enter" : ""}" style="--i:${Math.min(i, 10)}" href="#/p/${encodeURIComponent(p.reference)}" data-ref="${esc(p.reference)}">
      <span class="card-art" style="background:${tintFor(p.colors[0].color)}">${iconFor(p.name)}
        <span class="in-cart">${q ? `${q} no pedido` : ""}</span></span>
      <span class="card-body">
        <span class="card-name">${esc(p.name)}</span>
        <span class="card-price">${priceOf(p)} <small>/ peça</small></span>
        <span class="card-meta"><span class="dots">${p.colors.slice(0, 5).map(c => `<span class="sw" title="${esc(c.color)}" style="background:${swatchBg(c.color)}"></span>`).join("")}${p.colors.length > 5 ? `<span class="more">+${p.colors.length - 5}</span>` : ""}</span>
          <span class="${p.totalAvailable < 40 ? "low" : ""}">${p.totalAvailable} em estoque</span></span>
      </span></a>`;
  }
  function renderList() {
    const items = visibleProducts();
    $("#list").innerHTML = items.length ? items.map(productCard).join("")
      : `<div class="empty">Nenhuma referência encontrada para essa busca.</div>`;
    if (items.length) S.firstPaint = false; // a entrada em cascata só toca na primeira vez
  }
  function renderTabs() {
    const pieces = sum(cartLines(), l => l.quantity);
    const count = $("#cartCount");
    if (pieces && count.textContent !== String(pieces)) { count.classList.remove("bump"); void count.offsetWidth; count.classList.add("bump"); }
    count.textContent = pieces;
    count.toggleAttribute("data-zero", !pieces);
    document.querySelectorAll(".tabbar a").forEach(a =>
      a.dataset.tab === S.view ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  }

  // ---------- render: produto ----------
  // a grade é preenchida num rascunho; só vai para o pedido no botão "Adicionar ao pedido"
  const productBy = ref => S.products.find(p => p.reference === ref);
  const skusOf = p => p.colors.flatMap(c => c.skus);
  const draftDirty = p => skusOf(p).some(s => (S.draft.get(s.productCode) || 0) !== (S.cart.get(s.productCode) || 0));

  function openProduct(p) {
    if (S.ref !== p.reference || !S.draft.size) {
      S.ref = p.reference;
      S.draft = new Map(skusOf(p).map(s => [s.productCode, S.cart.get(s.productCode) || 0]));
      const withQty = p.colors.find(c => c.skus.some(s => S.draft.get(s.productCode)));
      S.color = (withQty || p.colors[0]).color;
    }
    renderProduct();
  }
  function renderProduct() {
    const p = productBy(S.ref); if (!p) return;
    const c = p.colors.find(x => x.color === S.color) || p.colors[0];
    $("#pdTitle").textContent = `ref. ${p.reference}`;
    const sizes = p.sizes.length > 1 ? `${p.sizes[0]} a ${p.sizes[p.sizes.length - 1]}` : p.sizes[0];
    $("#pd").innerHTML = `
      <div class="pd-art" id="pdArt" style="background:${tintFor(c.color)}">${iconFor(p.name)}
        <span class="stock ${p.totalAvailable < 40 ? "low" : ""}">${p.totalAvailable} em estoque</span>
        <span class="mark">Bebêtenkitê</span></div>
      <div class="pd-info">
        <h1>${esc(p.name)}</h1>
        <span class="pd-price">${priceOf(p)} <small>/ peça</small></span>
        <p class="pd-desc">${esc(p.group || "Linha")} em ${p.colors.length} ${p.colors.length > 1 ? "cores" : "cor"}, tamanhos ${esc(sizes)}.
          Escolha a cor e preencha quantas peças quer de cada tamanho; o mínimo é de ${S.config.minQtyPerRef} peças nesta referência.</p>
      </div>
      <div>
        <h3 class="sec-title">Cor <span id="colorName">${esc(c.color)}</span></h3>
        <div class="colors" id="colors" role="group" aria-label="Cores"></div>
      </div>
      <div class="sizes-box">
        <div class="sizes-head"><b>Tamanhos</b>
          <button type="button" class="mini" id="plusGrade" title="Soma 1 peça em cada tamanho disponível desta cor">+1 grade</button></div>
        <div class="sizes" id="sizes"></div>
      </div>
      <div class="pd-sum" id="pdSum"></div>`;
    renderColors(); renderSizes(false); renderCommit();
  }
  function renderColors() {
    const p = productBy(S.ref);
    $("#colors").innerHTML = p.colors.map(c => {
      const q = sum(c.skus, s => S.draft.get(s.productCode) || 0);
      return `<button type="button" aria-pressed="${c.color === S.color}" data-color="${esc(c.color)}" title="${esc(c.color)}" aria-label="${esc(c.color)}${q ? `, ${q} peças` : ""}">
        <span class="dot" style="background:${swatchBg(c.color)}">${q ? `<span class="count">${q}</span>` : ""}</span>
        <span class="lbl">${esc(c.color)}</span></button>`;
    }).join("");
  }
  function qtyClass(q, available) { return q ? (q > available ? "qty over" : "qty has") : "qty"; }
  function renderSizes(animate = true) {
    const p = productBy(S.ref), c = p.colors.find(x => x.color === S.color);
    const bySize = new Map(c.skus.map(s => [s.size, s]));
    const el = $("#sizes");
    el.innerHTML = p.sizes.map(size => {
      const s = bySize.get(size);
      if (!s) return `<div class="cell na"><span class="sz">${esc(size)}</span>
        <input class="qty" type="text" value="—" disabled aria-label="Tamanho ${esc(size)}: sem estoque"><span class="avail">esgotado</span></div>`;
      const q = S.draft.get(s.productCode) || "";
      return `<div class="cell"><label class="sz" for="q-${s.productCode}">${esc(size)}</label>
        <input class="${qtyClass(q, s.available)}" id="q-${s.productCode}" type="number" inputmode="numeric" min="0" max="${s.available}"
          step="1" value="${q}" placeholder="0" data-code="${s.productCode}" aria-label="${esc(c.color)} tamanho ${esc(size)}">
        <span class="avail">${s.available} disp.</span></div>`;
    }).join("");
    if (animate && !reduced()) { el.classList.remove("swap"); void el.offsetWidth; el.classList.add("swap"); }
  }
  function draftTotals(p) {
    const skus = skusOf(p);
    return {
      q: sum(skus, s => S.draft.get(s.productCode) || 0),
      v: sum(skus, s => (S.draft.get(s.productCode) || 0) * s.price),
      over: skus.some(s => (S.draft.get(s.productCode) || 0) > s.available),
    };
  }
  function renderCommit() {
    const p = productBy(S.ref); if (!p) return;
    const t = draftTotals(p), inCart = refPieces(p.reference) > 0, dirty = draftDirty(p);
    const min = S.config.minQtyPerRef;
    $("#pdSum").innerHTML = t.q
      ? `<span><b>${t.q}</b> ${t.q === 1 ? "peça" : "peças"} · <b>${brl(t.v)}</b></span>` +
        (t.over ? `<span class="warnline">Há tamanhos acima do estoque</span>` : t.q < min ? `<span class="warnline">Faltam ${min - t.q} para o mínimo de ${min}</span>` : "")
      : "";
    const btn = $("#commit");
    btn.disabled = t.over || (!t.q && !inCart);
    btn.dataset.mode = !dirty && inCart ? "view" : "save";
    btn.innerHTML = !dirty && inCart ? `${BAG} Ver pedido`
      : !t.q && inCart ? `Remover do pedido`
      : !t.q ? `${BAG} Preencha a grade`
      : `${BAG} ${inCart ? "Atualizar pedido" : "Adicionar ao pedido"} <span class="sub">· ${brl(t.v)}</span>`;
  }
  function setDraft(code, qty) {
    qty = Math.max(0, Math.floor(Number(qty) || 0));
    S.draft.set(code, qty);
    const input = document.getElementById(`q-${code}`), sku = S.index.get(code);
    if (input && sku) {
      if (document.activeElement !== input) input.value = qty || "";
      input.className = qtyClass(qty, sku.available);
    }
    renderColors(); renderCommit();
  }
  function commitDraft() {
    const p = productBy(S.ref); if (!p) return;
    const before = refPieces(p.reference);
    for (const s of skusOf(p)) {
      const q = S.draft.get(s.productCode) || 0;
      if (q) S.cart.set(s.productCode, q); else S.cart.delete(s.productCode);
    }
    store.set("atc-cart", [...S.cart]);
    const after = refPieces(p.reference);
    toast(!after ? "Referência removida do pedido" : before ? `Pedido atualizado: ${after} peças de ${p.name}` : `${after} peças adicionadas ao pedido`);
    renderTabs(); updateCardBadge(p.reference);
    leaveProduct();
  }
  function updateCardBadge(ref) {
    const b = document.querySelector(`.card[data-ref="${CSS.escape(ref)}"] .in-cart`);
    if (b) { const q = refPieces(ref); b.textContent = q ? `${q} no pedido` : ""; }
  }
  function leaveProduct() {
    S.draft = new Map();
    if (S.fromApp) history.back(); else location.hash = "#/";
  }

  // ---------- render: pedido ----------
  function groupLines(lines) {
    const m = new Map();
    for (const l of lines) {
      const k = `${l.reference}|${l.color}`;
      if (!m.has(k)) m.set(k, { reference: l.reference, name: l.name, color: l.color, items: [] });
      m.get(k).items.push(l);
    }
    return [...m.values()];
  }
  const field = (b, id, label, attrs = "") => `<div class="field"><label for="b-${id}">${label}</label>
    <input id="b-${id}" name="${id}" value="${esc(b[id] || "")}" ${attrs}><span class="err" data-err="${id}"></span></div>`;
  const buyerFields = b => `${field(b, "name", "Seu nome", 'autocomplete="name" required')}
    ${field(b, "company", "Loja / razão social", 'autocomplete="organization" required')}
    <div class="row2">${field(b, "document", "CNPJ ou CPF", 'inputmode="numeric" required')}
    ${field(b, "phone", "WhatsApp com DDD", 'inputmode="tel" autocomplete="tel" required')}</div>
    ${field(b, "city", "Cidade / UF", 'autocomplete="address-level2" required')}`;

  function renderCart() {
    const order = ["cart", "buyer", "done"];
    document.querySelectorAll(".steps li").forEach(s => {
      const d = order.indexOf(s.dataset.step) - order.indexOf(S.step);
      s.classList.toggle("past", d < 0);
      if (d === 0) s.setAttribute("aria-current", "step"); else s.removeAttribute("aria-current");
    });
    const body = $("#cartBody"), foot = $("#cartFoot");
    const lines = cartLines();
    const total = sum(lines, l => l.subtotal), pieces = sum(lines, l => l.quantity);
    const probs = cartProblems(lines);

    if (S.step === "cart") {
      $("#cartTitle").textContent = "Seu pedido";
      if (!lines.length) {
        body.innerHTML = `<div class="empty-cart"><span class="ico">${BAG}</span>
          <p class="note">Seu pedido está vazio. Abra uma referência, preencha a grade e toque em “Adicionar ao pedido”.</p>
          <a class="primary" href="#/">Ver referências</a></div>`;
        foot.innerHTML = "";
        return;
      }
      body.innerHTML = groupLines(lines).map(g => {
        const sub = sum(g.items, l => l.subtotal);
        const grade = g.items.map(i => `${i.size}×${i.quantity}`).join(" · ");
        return `<div class="line"><span class="art" style="background:${tintFor(g.color)}">${iconFor(g.name)}</span>
          <b>${esc(g.name)} · ${esc(g.color)}</b><span class="v">${brl(sub)}</span>
          <span class="g">${esc(grade)}</span>
          <span class="acts"><a href="#/p/${encodeURIComponent(g.reference)}">editar</a>
            <button class="rm" type="button" data-remove="${esc(g.reference)}|${esc(g.color)}">remover</button></span></div>`;
      }).join("") + (probs.length ? `<div class="problems"><b>Antes de continuar:</b><ul>${probs.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : "");
      const pct = Math.min(100, (total / S.config.minOrderValue) * 100);
      foot.innerHTML = `<div class="totals"><div><span>${pieces} peças · ${lines.length} SKUs</span><span>mínimo ${brl(S.config.minOrderValue)}</span></div>
        <div class="big"><span>Total</span><span>${brl(total)}</span></div></div>
        <div class="meter" role="progressbar" aria-label="Progresso até o pedido mínimo" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><i class="${pct >= 100 ? "full" : ""}" style="width:${pct}%"></i></div>
        <button class="primary" type="button" id="toBuyer" ${probs.length ? "disabled" : ""}>Continuar para seus dados</button>`;
      return;
    }

    if (S.step === "buyer") {
      $("#cartTitle").textContent = "Seus dados";
      const b = S.buyer;
      body.innerHTML = `<form class="buyer" id="buyerForm" novalidate>
        ${buyerFields(b)}
        <div class="field"><label for="b-notes">Observações (opcional)</label>
          <textarea id="b-notes" name="notes" placeholder="Prazo, transportadora preferida, forma de pagamento…">${esc(b.notes)}</textarea></div>
        ${S.problems.length ? `<div class="problems"><b>O estoque mudou:</b><ul>${S.problems.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>` : ""}
      </form>`;
      foot.innerHTML = `<div class="totals"><div class="big"><span>${pieces} peças</span><span>${brl(total)}</span></div></div>
        <button class="primary" type="submit" form="buyerForm" id="send" ${S.sending ? "disabled" : ""}>${S.sending ? `<span class="spin" aria-hidden="true"></span>Conferindo estoque…` : `Enviar pedido para ${esc(S.config.sellerName)}`}</button>
        <button class="ghost" type="button" id="backCart">Voltar aos itens</button>`;
      return;
    }

    const r = S.result;
    $("#cartTitle").textContent = "Pedido pronto";
    body.innerHTML = `<div class="done"><div class="tick" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <h3>${r.sent ? `Pedido enviado para ${esc(S.config.sellerName)}` : "Falta só um toque"}</h3>
      <p class="note">${esc(r.orderId)} · ${brl(r.total)}</p>
      <p class="note">${r.sent
        ? `${esc(S.config.sellerName)} recebeu o pedido no WhatsApp e vai falar com você para confirmar frete e pagamento.`
        : `Abra o WhatsApp pelo botão abaixo e envie a mensagem que já vai preenchida para ${esc(S.config.sellerName)}. Se o botão não abrir, copie o texto e mande para <b>${esc(r.sellerPhone || "")}</b>.`}</p>
      <pre class="msg" id="msg">${esc(r.message)}</pre></div>`;
    foot.innerHTML = (r.whatsappUrl ? `<a class="wa" href="${esc(r.whatsappUrl)}" target="_blank" rel="noopener">Abrir WhatsApp com o pedido</a>` : "") +
      `<button class="ghost" type="button" id="copyMsg">Copiar mensagem</button>
       <button class="ghost" type="button" id="newOrder">Fazer outro pedido</button>`;
  }

  // ---------- render: perfil ----------
  function renderProfile() {
    $("#profile").innerHTML = `<form class="buyer" id="profileForm" novalidate>${buyerFields(S.buyer)}
        <button class="primary" type="submit">Salvar dados</button></form>
      <div class="facts">
        <div><span>Pedido mínimo</span><b>${brl(S.config.minOrderValue)}</b></div>
        <div><span>Mínimo por referência</span><b>${S.config.minQtyPerRef} peças</b></div>
        <div><span>Atendimento</span><b>WhatsApp</b></div>
      </div>`;
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

  // ---------- navegação ----------
  function parseHash() {
    const h = location.hash.slice(1) || "/";
    if (h.startsWith("/p/")) return { view: "product", ref: decodeURIComponent(h.slice(3)) };
    if (h === "/pedido") return { view: "cart" };
    if (h === "/perfil") return { view: "profile" };
    return { view: "home" };
  }
  function route() {
    if (!S.products.length) return;
    const r = parseHash(), prev = S.view;
    if (r.view === "product" && !productBy(r.ref)) { location.replace("#/"); return; }
    if (prev === "home") S.homeScroll = scrollY;
    if (prev === "cart" && S.step === "done" && r.view !== "cart") { S.step = "cart"; S.result = null; }
    if (r.view === "product") S.fromApp = S.routed; // aberto por link direto: voltar leva ao início
    S.routed = true;
    if (prev === "product" && r.view !== "product") S.draft = new Map();

    const swap = () => {
      if (r.view === "product") openProduct(productBy(r.ref));
      if (r.view === "cart") renderCart();
      if (r.view === "profile") renderProfile();
      document.querySelectorAll(".view").forEach(v => (v.hidden = v.dataset.view !== r.view));
      document.body.dataset.view = S.view = r.view;
      renderTabs();
      scrollTo(0, r.view === "home" ? S.homeScroll : 0);
    };
    // cartão ↔ produto: o quadro da peça cresce até a tela do produto e volta ao lugar
    const pair = (prev === "home" && r.view === "product") || (prev === "product" && r.view === "home");
    if (pair && document.startViewTransition && !reduced()) {
      const ref = r.view === "product" ? r.ref : S.ref;
      const art = document.querySelector(`.card[data-ref="${CSS.escape(ref)}"] .card-art`);
      if (art) art.style.viewTransitionName = "art";
      document.startViewTransition(swap).finished.finally(() => { if (art) art.style.viewTransitionName = ""; });
      return;
    }
    swap();
    if (prev !== r.view && !reduced()) {
      const v = document.querySelector(`.view[data-view="${r.view}"]`);
      v.classList.remove("in", "in-r"); void v.offsetWidth; v.classList.add(r.view === "product" ? "in-r" : "in");
    }
  }

  // ---------- ações ----------
  function setQty(code, qty) {
    qty = Math.max(0, Math.floor(Number(qty) || 0));
    if (qty) S.cart.set(code, qty); else S.cart.delete(code);
    store.set("atc-cart", [...S.cart]);
    const sku = S.index.get(code); if (sku) updateCardBadge(sku.reference);
    renderTabs();
  }
  function goCart(step) { S.step = step; if (S.view === "cart") renderCart(); else location.hash = "#/pedido"; scrollTo(0, 0); }

  function validateBuyer(form, keys = ["name", "company", "document", "phone", "city"]) {
    const b = Object.fromEntries(new FormData(form)); const errs = {};
    if ((b.name || "").trim().length < 2) errs.name = "Informe seu nome.";
    if ((b.company || "").trim().length < 2) errs.company = "Informe o nome da loja.";
    if (![11, 14].includes(digits(b.document).length)) errs.document = "CNPJ com 14 dígitos ou CPF com 11.";
    if (digits(b.phone).length < 10) errs.phone = "WhatsApp com DDD.";
    if ((b.city || "").trim().length < 2) errs.city = "Informe a cidade.";
    for (const k of keys) {
      const e = form.querySelector(`[data-err="${k}"]`); if (e) e.textContent = errs[k] || "";
      const i = form.querySelector(`[name="${k}"]`); if (i) i.setAttribute("aria-invalid", errs[k] ? "true" : "false");
    }
    const first = form.querySelector('[aria-invalid="true"]'); if (first) first.focus();
    return { b, ok: !Object.keys(errs).length };
  }

  async function submitOrder(form) {
    const { b, ok } = validateBuyer(form);
    S.buyer = { ...S.buyer, ...b }; store.set("atc-buyer", S.buyer); renderHello();
    if (!ok || S.sending) return;
    S.sending = true; S.problems = []; renderCart();
    try {
      const payload = {
        buyer: { ...S.buyer, document: digits(S.buyer.document), phone: digits(S.buyer.phone) },
        items: [...S.cart].map(([productCode, quantity]) => ({ productCode, quantity })),
      };
      const res = await api.order(payload);
      if (res.problems) { S.problems = res.problems; await reloadCatalog(true); }
      else {
        S.result = { ...res, sellerPhone: DEMO ? DEMO.config.sellerPhone : "" };
        S.cart.clear(); store.set("atc-cart", []); renderList(); renderTabs(); S.step = "done";
      }
    } catch (e) { toast(e.message || "Não foi possível enviar. Tente de novo."); }
    finally { S.sending = false; renderCart(); }
  }

  async function reloadCatalog(refresh = false) {
    const data = await api.catalog(refresh);
    // mais estoque primeiro; empate por nome
    S.products = [...data.products].sort((a, b) =>
      b.totalAvailable - a.totalAvailable || a.name.localeCompare(b.name, "pt-BR"));
    S.updatedAt = data.updatedAt; indexProducts(S.products);
    for (const code of [...S.cart.keys()]) if (!S.index.has(code)) S.cart.delete(code);
    renderGroups(); renderStamp(); renderHeroArt(); renderList(); renderTabs();
  }

  // ---------- eventos ----------
  document.addEventListener("input", e => {
    if (e.target.matches(".qty")) setDraft(Number(e.target.dataset.code), e.target.value);
    if (e.target.id === "search") { S.q = e.target.value; renderList(); }
  });
  document.addEventListener("click", e => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.group) {
      S.cat = t.dataset.group;
      document.querySelectorAll("#groups button").forEach(b => b.setAttribute("aria-pressed", b === t));
      renderList();
    }
    else if (t.dataset.color) {
      S.color = t.dataset.color;
      $("#colorName").textContent = S.color;
      $("#pdArt").style.background = tintFor(S.color);
      document.querySelectorAll("#colors button").forEach(b => b.setAttribute("aria-pressed", b === t));
      renderSizes();
    }
    else if (t.id === "plusGrade") {
      const c = productBy(S.ref).colors.find(x => x.color === S.color);
      let capped = false;
      for (const s of c.skus) { const cur = S.draft.get(s.productCode) || 0; if (cur < s.available) setDraft(s.productCode, cur + 1); else capped = true; }
      if (capped) toast("Alguns tamanhos já estão no limite do estoque.");
    }
    else if (t.id === "commit") { if (t.dataset.mode === "view") location.hash = "#/pedido"; else commitDraft(); }
    else if (t.id === "back") {
      const p = productBy(S.ref);
      if (p && draftDirty(p) && !confirm("Sair sem adicionar a grade ao pedido?")) return;
      leaveProduct();
    }
    else if (t.id === "toList") $("#listHead").scrollIntoView({ behavior: reduced() ? "auto" : "smooth" });
    else if (t.id === "toBuyer") { S.problems = []; goCart("buyer"); }
    else if (t.id === "backCart") goCart("cart");
    else if (t.id === "refresh") reloadCatalog(true).then(() => toast("Estoque atualizado"));
    else if (t.dataset.remove) {
      const [ref, color] = t.dataset.remove.split("|");
      t.closest(".line").classList.add("leaving");
      setTimeout(() => {
        for (const l of cartLines()) if (l.reference === ref && l.color === color) setQty(l.productCode, 0);
        renderCart();
      }, reduced() ? 0 : 200);
    }
    else if (t.id === "copyMsg") {
      const text = S.result?.message || "";
      navigator.clipboard?.writeText(text).then(() => toast("Mensagem copiada"), () => {
        const r = document.createRange(); r.selectNodeContents($("#msg"));
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast("Texto selecionado: copie com Ctrl+C");
      });
    }
    else if (t.id === "newOrder") { S.step = "cart"; S.result = null; location.hash = "#/"; }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && S.view === "product") $("#back").click(); });
  document.addEventListener("submit", e => {
    e.preventDefault();
    if (e.target.id === "buyerForm") submitOrder(e.target);
    if (e.target.id === "profileForm") {
      const { b, ok } = validateBuyer(e.target);
      if (!ok) return;
      S.buyer = { ...S.buyer, ...b }; store.set("atc-buyer", S.buyer); renderHello();
      toast("Dados salvos: vão preencher seus próximos pedidos");
    }
  });
  addEventListener("hashchange", route);

  // ---------- início ----------
  (async () => {
    S.cart = new Map(store.get("atc-cart", []));
    S.buyer = { ...S.buyer, ...store.get("atc-buyer", {}) };
    renderHello();
    try {
      S.config = { ...S.config, ...(await api.config()) };
      renderRules();
      await reloadCatalog();
      route();
    } catch (e) {
      $("#stamp").textContent = "";
      $("#list").innerHTML = `<div class="empty">Não foi possível carregar o estoque agora. ${esc(e.message || "")}<br>Recarregue a página em alguns minutos.</div>`;
    }
  })();
})();
