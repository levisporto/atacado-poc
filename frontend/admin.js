/* Painel do atacado: cadastros pendentes, clientes e pedidos (vanilla JS, fala com /api/admin). */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const brl = v => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const when = t => t ? new Date(t * 1000).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
  const fmtDoc = d => d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5")
    : d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  const wa = phone => `https://wa.me/55${String(phone).replace(/^55(?=\d{10,11}$)/, "")}`;

  const CLIENT_LABEL = { pending: "Aguardando", approved: "Liberado", rejected: "Recusado", blocked: "Bloqueado" };
  const ORDER_LABEL = { novo: "Novo", separando: "Em separação", faturado: "Faturado", cancelado: "Cancelado" };

  const S = { admin: null, tab: "cadastros", clientStatus: "", search: "", orderStatus: "", orderClient: null, summary: {} };

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3000);
  }

  async function call(path, body) {
    const r = await fetch(`/api/admin${path}`, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== "/login") { S.admin = null; renderLogin(); throw new Error("Sessão expirada"); }
    if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Falha na operação");
    return data;
  }

  // ---------- login ----------
  function renderLogin(msg = "") {
    $("#app").innerHTML = `<form class="login buyer" id="loginForm">
      <h1>Painel do Atacado</h1>
      <div class="field"><label for="u">Usuário</label><input id="u" name="name" autocomplete="username" required></div>
      <div class="field"><label for="p">Senha</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
      <span class="note" style="color:var(--danger)">${esc(msg)}</span>
      <button class="primary" type="submit">Entrar</button></form>`;
    $("#u").focus();
  }

  // ---------- casca ----------
  function renderShell() {
    const s = S.summary;
    $("#app").innerHTML = `<header class="adm-head"><h1>Painel do Atacado</h1>
        <span class="who">${esc(S.admin)}</span><button class="ghost" type="button" id="logout">Sair</button></header>
      <nav class="adm-tabs" role="tablist">
        ${tab("cadastros", "Cadastros", s.pendingClients)}${tab("clientes", "Clientes")}${tab("pedidos", "Pedidos", s.newOrders)}
      </nav>
      <section id="pane"></section>`;
    renderPane();
  }
  const tab = (id, label, n) => `<button type="button" role="tab" data-tab="${id}" aria-selected="${S.tab === id}">${label}<span class="badge">${n || ""}</span></button>`;

  async function refreshSummary() {
    if (!S.admin) return;
    const before = S.summary;
    S.summary = await call("/resumo").catch(() => before);
    document.querySelectorAll(".adm-tabs button").forEach(b => {
      const n = b.dataset.tab === "cadastros" ? S.summary.pendingClients : b.dataset.tab === "pedidos" ? S.summary.newOrders : 0;
      b.querySelector(".badge").textContent = n || "";
    });
    const alerts = (S.summary.pendingClients || 0) + (S.summary.newOrders || 0);
    document.title = alerts ? `(${alerts}) Painel do Atacado` : "Painel do Atacado";
    if (before.pendingClients !== undefined) {
      if (S.summary.pendingClients > before.pendingClients) toast("Novo cadastro aguardando aprovação");
      else if (S.summary.newOrders > before.newOrders) toast("Novo pedido recebido");
      if (S.summary.pendingClients !== before.pendingClients || S.summary.newOrders !== before.newOrders) renderPane();
    }
  }

  async function renderPane() {
    const pane = $("#pane"); if (!pane) return;
    try {
      if (S.tab === "cadastros") pane.innerHTML = await paneSignups();
      if (S.tab === "clientes") pane.innerHTML = await paneClients();
      if (S.tab === "pedidos") pane.innerHTML = await paneOrders();
    } catch (e) { pane.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }

  // ---------- cadastros pendentes ----------
  async function paneSignups() {
    const rows = await call("/clientes?status=pending");
    if (!rows.length) return `<div class="empty">Nenhum cadastro aguardando aprovação.</div>`;
    return `<div class="list">${rows.map(c => `<div class="row">
      <div class="row-top"><b>${esc(c.company)}</b><span class="pill pending">Aguardando</span><span class="right note">${when(c.created_at)}</span></div>
      <div class="meta"><span>${esc(c.name)}</span><span>${fmtDoc(c.document)}</span><span>${esc(c.city)}</span>
        <a href="${wa(c.phone)}" target="_blank" rel="noopener">WhatsApp ${esc(c.phone)}</a>${c.email ? `<span>${esc(c.email)}</span>` : ""}</div>
      <div class="acts"><button class="ok" type="button" data-act="aprovar" data-id="${c.id}">Aprovar</button>
        <button class="bad" type="button" data-act="rejeitar" data-id="${c.id}">Recusar</button></div></div>`).join("")}</div>`;
  }

  // ---------- clientes ----------
  async function paneClients() {
    const qs = new URLSearchParams({ status: S.clientStatus, busca: S.search });
    const rows = await call(`/clientes?${qs}`);
    const chips = [["", "Todos"], ...Object.entries(CLIENT_LABEL)].map(([k, l]) =>
      `<button type="button" data-cstatus="${k}" aria-pressed="${S.clientStatus === k}">${l}</button>`).join("");
    return `<div class="tools"><input type="search" id="search" placeholder="Buscar por loja, nome, CNPJ ou cidade" value="${esc(S.search)}">
        <div class="chips">${chips}</div></div>
      <div class="list">${rows.length ? rows.map(c => `<div class="row">
        <div class="row-top"><b>${esc(c.company)}</b><span class="pill ${c.status}">${CLIENT_LABEL[c.status]}</span>
          <span class="right">${c.orders ? `${c.orders} pedido${c.orders > 1 ? "s" : ""} · ${brl(c.spent)}` : '<span class="note">sem pedidos</span>'}</span></div>
        <div class="meta"><span>${esc(c.name)}</span><span>${fmtDoc(c.document)}</span><span>${esc(c.city)}</span>
          <a href="${wa(c.phone)}" target="_blank" rel="noopener">WhatsApp ${esc(c.phone)}</a>
          ${c.last_order ? `<span>último pedido ${when(c.last_order)}</span>` : ""}
          ${c.reviewed_by ? `<span>${CLIENT_LABEL[c.status].toLowerCase()} por ${esc(c.reviewed_by)}</span>` : ""}</div>
        ${c.admin_note ? `<div class="note">Obs.: ${esc(c.admin_note)}</div>` : ""}
        <div class="acts">
          ${c.status !== "approved" ? `<button class="ok" type="button" data-act="aprovar" data-id="${c.id}">Liberar</button>` : ""}
          ${c.status === "approved" ? `<button class="bad" type="button" data-act="bloquear" data-id="${c.id}">Bloquear</button>` : ""}
          <button type="button" data-act="senha" data-id="${c.id}" data-name="${esc(c.company)}">Nova senha</button>
          ${c.orders ? `<button type="button" data-client-orders="${c.id}" data-name="${esc(c.company)}">Ver pedidos</button>` : ""}
        </div></div>`).join("") : `<div class="empty">Nenhum cliente encontrado.</div>`}</div>`;
  }

  // ---------- pedidos ----------
  async function paneOrders() {
    const qs = new URLSearchParams({ status: S.orderStatus, ...(S.orderClient ? { cliente: S.orderClient.id } : {}) });
    const rows = await call(`/pedidos?${qs}`);
    const chips = [["", "Todos"], ...Object.entries(ORDER_LABEL)].map(([k, l]) =>
      `<button type="button" data-ostatus="${k}" aria-pressed="${S.orderStatus === k}">${l}</button>`).join("");
    return `<div class="tools"><div class="chips">${chips}</div>
        ${S.orderClient ? `<div class="chips"><button type="button" aria-pressed="true" id="clearClient">${esc(S.orderClient.name)} ✕</button></div>` : ""}</div>
      <div class="list">${rows.length ? rows.map(o => `<div class="row click" data-order="${esc(o.id)}" tabindex="0" role="button">
        <div class="row-top"><b>${esc(o.company)}</b><span class="pill ${o.status}">${ORDER_LABEL[o.status]}</span>
          ${o.delivered || o.delivery_channel === "wa.me" ? "" : `<span class="pill fail" title="O aviso no WhatsApp não saiu">sem aviso no WhatsApp</span>`}
          <span class="right">${brl(o.total)}</span></div>
        <div class="meta"><span>${esc(o.id)}</span><span>${when(o.created_at)}</span><span>${o.pieces} peças</span>
          <span>${esc(o.city)}</span>${o.notes ? "<span>com observação</span>" : ""}</div></div>`).join("")
        : `<div class="empty">Nenhum pedido ${S.orderStatus ? `com status “${ORDER_LABEL[S.orderStatus]}”` : "ainda"}.</div>`}</div>`;
  }

  async function openOrder(id) {
    const o = await call(`/pedidos/${encodeURIComponent(id)}`);
    const groups = new Map();
    for (const l of [...o.lines].sort((a, b) => (a.name + a.color).localeCompare(b.name + b.color))) {
      const k = `${l.reference}|${l.color}`;
      if (!groups.has(k)) groups.set(k, { ...l, items: [] });
      groups.get(k).items.push(l);
    }
    const dlg = $("#dlg");
    dlg.innerHTML = `<div class="dlg"><button class="x" type="button" data-close aria-label="Fechar">×</button>
      <h2>${esc(o.company)}</h2>
      <div class="meta"><span>${esc(o.id)}</span><span>${when(o.created_at)}</span><span>${esc(o.client_name)}</span>
        <span>${fmtDoc(o.document)}</span><span>${esc(o.city)}</span>
        <a href="${wa(o.phone)}" target="_blank" rel="noopener">WhatsApp ${esc(o.phone)}</a></div>
      ${o.notes ? `<div class="notes"><b>Observações:</b> ${esc(o.notes)}</div>` : ""}
      <table class="grade"><thead><tr><th>Peça / cor</th><th>Grade</th><th>Subtotal</th></tr></thead><tbody>
        ${[...groups.values()].map(g => `<tr><td>${esc(g.name)}<div class="ref">ref. ${esc(g.reference)} · ${esc(g.color)}</div></td>
          <td>${g.items.map(i => `${esc(i.size)}×${i.quantity}`).join(" · ")}</td>
          <td>${brl(g.items.reduce((a, i) => a + i.subtotal, 0))}</td></tr>`).join("")}
      </tbody></table>
      <div class="totline"><span>${o.pieces} peças</span><span>${brl(o.total)}</span></div>
      <div class="status-pick"><span class="note">Status:</span>${Object.entries(ORDER_LABEL).map(([k, l]) =>
        `<button type="button" class="chips-btn" data-set-status="${k}" data-id="${esc(o.id)}" aria-pressed="${o.status === k}">${l}</button>`).join("")}</div>
      ${o.status_updated_by ? `<p class="note">Última mudança por ${esc(o.status_updated_by)} em ${when(o.status_updated_at)}</p>` : ""}
      <div class="dlg-acts"><button class="primary" type="button" id="pdfOrder">Exportar PDF</button>
        <button class="ghost" type="button" id="copyMsg">Copiar mensagem do pedido</button></div></div>`;
    dlg.querySelector(".status-pick").classList.add("chips");
    dlg._message = o.message;
    dlg._order = { ...o, groups: [...groups.values()] };
    dlg.showModal();
  }

  // ---------- PDF do pedido (jsPDF carregado só no primeiro clique) ----------
  let jsPdfLoading;
  function loadJsPdf() {
    if (window.jspdf) return Promise.resolve(window.jspdf);
    return jsPdfLoading ||= new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = () => ok(window.jspdf);
      s.onerror = () => { jsPdfLoading = null; fail(new Error("Não foi possível carregar o gerador de PDF. Confira a internet.")); };
      document.head.append(s);
    });
  }

  async function exportPdf(o) {
    const { jsPDF } = await loadJsPdf();
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const L = 15, R = 195, BOTTOM = 280;
    const COL = { name: L, grade: 100, unit: 172, sub: R };
    const gray = () => doc.setTextColor(110, 102, 91), ink = () => doc.setTextColor(31, 27, 23);
    let y = 18;

    // cabeçalho
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); gray();
    doc.text("PEDIDO DE ATACADO · BEBÊTENKITÊ", L, y);
    doc.text(`${o.id} · ${when(o.created_at)}`, R, y, { align: "right" });
    y += 9; doc.setFontSize(18); ink(); doc.text(o.company, L, y);
    y += 7; doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const contact = [o.client_name, `CNPJ/CPF ${fmtDoc(o.document)}`, o.city, `WhatsApp ${o.phone}`, o.email].filter(Boolean).join("  ·  ");
    for (const line of doc.splitTextToSize(contact, R - L)) { doc.text(line, L, y); y += 5; }
    gray(); doc.text(`Status: ${ORDER_LABEL[o.status]}`, L, y); y += 4;

    if (o.notes) {
      y += 3; ink(); doc.setFontSize(10);
      const lines = doc.splitTextToSize(`Observações: ${o.notes}`, R - L - 8);
      doc.setFillColor(249, 234, 212); doc.roundedRect(L, y, R - L, lines.length * 5 + 5, 2, 2, "F");
      doc.text(lines, L + 4, y + 6); y += lines.length * 5 + 5;
    }

    // tabela
    const head = () => {
      y += 8; doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); gray();
      doc.text("PEÇA / COR", COL.name, y); doc.text("GRADE", COL.grade, y);
      doc.text("PREÇO UN.", COL.unit, y, { align: "right" }); doc.text("SUBTOTAL", COL.sub, y, { align: "right" });
      y += 2.5; doc.setDrawColor(226, 216, 200); doc.line(L, y, R, y); y += 5;
    };
    head();
    for (const g of o.groups) {
      doc.setFontSize(10);
      const name = doc.splitTextToSize(g.name, COL.grade - COL.name - 4);
      const grade = doc.splitTextToSize(g.items.map(i => `${i.size}×${i.quantity}`).join("  ·  "), COL.unit - 22 - COL.grade);
      const h = Math.max(name.length * 4.6 + 4.5, grade.length * 4.6) + 3;
      if (y + h > BOTTOM) { doc.addPage(); y = 12; head(); doc.setFontSize(10); }
      const prices = [...new Set(g.items.map(i => i.price))];
      const unit = prices.length === 1 ? brl(prices[0]) : `${brl(Math.min(...prices))}+`;
      doc.setFont("helvetica", "bold"); ink(); doc.text(name, COL.name, y);
      doc.setFont("helvetica", "normal"); doc.text(grade, COL.grade, y);
      doc.text(unit, COL.unit, y, { align: "right" });
      doc.text(brl(g.items.reduce((a, i) => a + i.subtotal, 0)), COL.sub, y, { align: "right" });
      doc.setFontSize(8.5); gray(); doc.text(`ref. ${g.reference} · ${g.color}`, COL.name, y + name.length * 4.6);
      y += h; doc.setDrawColor(236, 228, 216); doc.line(L, y - 3.5, R, y - 3.5);
    }

    // total
    if (y + 16 > BOTTOM) { doc.addPage(); y = 20; }
    y += 3; doc.setFont("helvetica", "bold"); doc.setFontSize(12); ink();
    doc.text(`${o.pieces} peças`, L, y); doc.text(brl(o.total), R, y, { align: "right" });

    // rodapé em todas as páginas
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(8); gray();
      doc.text("Preços e saldos conferidos no TOTVS no momento do envio.", L, 290);
      doc.text(`${o.id} · página ${p} de ${pages}`, R, 290, { align: "right" });
    }
    doc.save(`${o.id}.pdf`);
  }

  function showPassword(company, pw) {
    const dlg = $("#dlg");
    dlg.innerHTML = `<div class="dlg"><button class="x" type="button" data-close aria-label="Fechar">×</button>
      <h2>Nova senha de ${esc(company)}</h2>
      <p class="note">Mande para o cliente pelo WhatsApp. Ela não aparece de novo depois que você fechar esta janela.</p>
      <div class="pw">${esc(pw)}</div>
      <button class="primary" type="button" data-close>Pronto</button></div>`;
    dlg.showModal();
  }

  // ---------- eventos ----------
  document.addEventListener("submit", async e => {
    if (e.target.id !== "loginForm") return;
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { S.admin = (await call("/login", f)).name; await start(); }
    catch (err) { renderLogin(err.message); }
  });
  let searchT;
  document.addEventListener("input", e => {
    if (e.target.id !== "search") return;
    S.search = e.target.value;
    clearTimeout(searchT);
    searchT = setTimeout(async () => {
      const pos = e.target.selectionStart;
      await renderPane();
      const s = $("#search"); if (s) { s.focus(); s.setSelectionRange(pos, pos); }
    }, 250);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.dataset && e.target.dataset.order) openOrder(e.target.dataset.order);
  });
  document.addEventListener("click", async e => {
    const row = e.target.closest("[data-order]");
    if (row && !e.target.closest("a")) return openOrder(row.dataset.order).catch(err => toast(err.message));
    const t = e.target.closest("button"); if (!t) return;
    try {
      if (t.dataset.tab) { S.tab = t.dataset.tab; renderShell(); }
      else if (t.id === "logout") { await call("/logout", {}); S.admin = null; renderLogin(); }
      else if (t.dataset.cstatus !== undefined) { S.clientStatus = t.dataset.cstatus; renderPane(); }
      else if (t.dataset.ostatus !== undefined) { S.orderStatus = t.dataset.ostatus; renderPane(); }
      else if (t.id === "clearClient") { S.orderClient = null; renderPane(); }
      else if (t.dataset.clientOrders) { S.orderClient = { id: t.dataset.clientOrders, name: t.dataset.name }; S.orderStatus = ""; S.tab = "pedidos"; renderShell(); }
      else if (t.dataset.act === "senha") {
        if (!confirm(`Gerar uma nova senha para ${t.dataset.name}? A senha atual deixa de funcionar.`)) return;
        showPassword(t.dataset.name, (await call(`/clientes/${t.dataset.id}/senha`, {})).password);
      }
      else if (t.dataset.act) {
        const act = t.dataset.act;
        let note = "";
        if (act !== "aprovar") {
          note = prompt(act === "rejeitar" ? "Motivo da recusa (opcional, só para o painel):" : "Motivo do bloqueio (opcional):");
          if (note === null) return;
        }
        await call(`/clientes/${t.dataset.id}/${act}`, { note });
        toast(act === "aprovar" ? "Cliente liberado: já pode entrar e fazer pedidos" : act === "rejeitar" ? "Cadastro recusado" : "Cliente bloqueado");
        await refreshSummary(); renderPane();
      }
      else if (t.dataset.setStatus) {
        await call(`/pedidos/${encodeURIComponent(t.dataset.id)}/status`, { status: t.dataset.setStatus });
        $("#dlg").querySelectorAll("[data-set-status]").forEach(b => b.setAttribute("aria-pressed", b === t));
        toast(`Pedido marcado como “${ORDER_LABEL[t.dataset.setStatus]}”`);
        await refreshSummary(); renderPane();
      }
      else if (t.id === "pdfOrder") {
        t.disabled = true; t.textContent = "Gerando PDF…";
        try { await exportPdf($("#dlg")._order); } finally { t.disabled = false; t.textContent = "Exportar PDF"; }
      }
      else if (t.id === "copyMsg") {
        await navigator.clipboard.writeText($("#dlg")._message || "");
        toast("Mensagem copiada");
      }
      else if (t.hasAttribute("data-close")) $("#dlg").close();
    } catch (err) { toast(err.message); }
  });
  $("#dlg").addEventListener("click", e => { if (e.target.id === "dlg") e.target.close(); }); // clique fora fecha

  async function start() {
    await refreshSummary();
    S.tab = S.summary.pendingClients ? "cadastros" : "pedidos";
    renderShell();
  }
  setInterval(refreshSummary, 60000);

  (async () => {
    try { S.admin = (await call("/me")).name; await start(); }
    catch { renderLogin(); }
  })();
})();
