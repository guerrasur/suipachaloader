"use strict";

// ------------------------------------------------------------------ helpers
const $ = (id) => document.getElementById(id);
const money = (n) => "$" + (Math.round(n || 0)).toLocaleString("es-AR");
const todayISO = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local

async function api(url, opts) {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch (e) {}
    throw new Error(msg);
  }
  return r.status === 204 ? null : r.json();
}

// -------------------------------------------------------------------- state
const state = {
  fecha: todayISO(),
  platos: [],
  items: [],          // {plato_id, nombre, precio_unitario, cantidad, es_pdd}
  editId: null,
  filtro: "todos",
  pedidos: [],
};

// --------------------------------------------------------------------- tabs
document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => switchTab(b.dataset.tab))
);
function switchTab(tab) {
  document.querySelectorAll(".tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab)
  );
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  $("view-" + tab).classList.add("active");
  if (tab === "carta") loadCarta();
  if (tab === "config") loadConfig();
}

// ------------------------------------------------------------ catalog cache
async function loadCatalog() {
  state.platos = await api("/api/platos");
}
const platosNormales = () => state.platos.filter((p) => !p.es_plato_del_dia);
const platoDelDia = () => state.platos.find((p) => p.es_plato_del_dia);

// ------------------------------------------------------------- items editor
function precioSegunMetodo(plato) {
  return $("f-pago").value === "Efectivo" ? plato.precio_efectivo : plato.precio_lista;
}

function addItem(pdd = false) {
  if (pdd) {
    const p = platoDelDia();
    state.items.push({ plato_id: p ? p.id : null, nombre: "", precio_unitario: 0, cantidad: 1, es_pdd: true });
  } else {
    const first = platosNormales()[0];
    state.items.push({
      plato_id: first ? first.id : null,
      nombre: first ? first.nombre : "",
      precio_unitario: first ? precioSegunMetodo(first) : 0,
      cantidad: 1,
      es_pdd: false,
    });
  }
  renderItems();
}

function renderItems() {
  const cont = $("items-list");
  cont.innerHTML = "";
  state.items.forEach((it, idx) => {
    const line = document.createElement("div");
    line.className = "item-line";

    let selHtml;
    if (it.es_pdd) {
      selHtml = `<input data-idx="${idx}" class="it-nombre" placeholder="Plato del día (nombre)" value="${escapeAttr(it.nombre)}" />`;
    } else {
      const opts = platosNormales()
        .map((p) => `<option value="${p.id}" ${p.id === it.plato_id ? "selected" : ""}>${escapeHtml(p.nombre)}</option>`)
        .join("");
      selHtml = `<select data-idx="${idx}" class="it-plato">${opts}</select>`;
    }

    line.innerHTML = `
      ${selHtml}
      <input type="number" min="1" data-idx="${idx}" class="it-cant" value="${it.cantidad}" />
      <input type="number" step="100" data-idx="${idx}" class="it-precio" value="${it.precio_unitario}" />
      <span class="right nowrap">${money(it.cantidad * it.precio_unitario)}</span>
      <button type="button" class="btn ghost sm" data-idx="${idx}" title="Quitar">✕</button>`;
    cont.appendChild(line);
  });

  cont.querySelectorAll(".it-plato").forEach((s) =>
    s.addEventListener("change", (e) => {
      const i = +e.target.dataset.idx;
      const p = state.platos.find((x) => x.id === +e.target.value);
      state.items[i].plato_id = p.id;
      state.items[i].nombre = p.nombre;
      state.items[i].precio_unitario = precioSegunMetodo(p);
      renderItems(); recalc();
    })
  );
  cont.querySelectorAll(".it-nombre").forEach((s) =>
    s.addEventListener("input", (e) => { state.items[+e.target.dataset.idx].nombre = e.target.value; })
  );
  cont.querySelectorAll(".it-cant").forEach((s) =>
    s.addEventListener("input", (e) => { state.items[+e.target.dataset.idx].cantidad = Math.max(1, +e.target.value || 1); renderItems(); recalc(); })
  );
  cont.querySelectorAll(".it-precio").forEach((s) =>
    s.addEventListener("input", (e) => { state.items[+e.target.dataset.idx].precio_unitario = +e.target.value || 0; renderItems(); recalc(); })
  );
  cont.querySelectorAll("button[data-idx]").forEach((b) =>
    b.addEventListener("click", (e) => { state.items.splice(+e.currentTarget.dataset.idx, 1); renderItems(); recalc(); })
  );
  recalc();
}

// Re-aplicar precio según método a los ítems de catálogo (no al plato del día)
function reapplyPrices() {
  state.items.forEach((it) => {
    if (!it.es_pdd && it.plato_id) {
      const p = state.platos.find((x) => x.id === it.plato_id);
      if (p) it.precio_unitario = precioSegunMetodo(p);
    }
  });
  renderItems();
}

function subtotalItems() {
  return state.items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
}
function montoEnvio() {
  if ($("f-tipo").value !== "Envío" || $("f-no-envio").checked) return 0;
  return +$("f-envio").value || 0;
}
function montoDescuento(sub) {
  const tipo = $("f-desc-tipo").value;
  const val = +$("f-desc-valor").value || 0;
  if (!tipo || !val) return 0;
  return tipo === "porcentaje" ? sub * val / 100 : val;
}
function recalc() {
  const sub = subtotalItems();
  const total = Math.max(0, sub + montoEnvio() - montoDescuento(sub));
  $("f-total").textContent = money(total);
}

// ------------------------------------------------------------- form wiring
["f-tipo", "f-no-envio", "f-envio", "f-desc-tipo", "f-desc-valor"].forEach((id) =>
  $(id).addEventListener("input", () => { toggleEnvio(); recalc(); })
);
$("f-pago").addEventListener("change", () => { toggleVuelto(); reapplyPrices(); });
$("add-item").addEventListener("click", () => addItem(false));
$("add-pdd").addEventListener("click", () => addItem(true));
$("btn-cancelar").addEventListener("click", resetForm);

function toggleEnvio() {
  $("row-envio").querySelector("#f-envio").disabled = $("f-tipo").value !== "Envío";
}
function toggleVuelto() {
  $("wrap-vuelto").style.display = $("f-pago").value === "Efectivo" ? "" : "none";
}
function toggleVentanilla() {
  // Ventanilla: sin dirección/indicaciones/repartidor.
  const v = $("f-tipo").value === "Ventanilla";
  $("f-direccion").closest(".field").style.display = v ? "none" : "";
  $("f-indicaciones").closest(".field").style.display = v ? "none" : "";
  $("wrap-repartidor").style.display = v ? "none" : "";
}
$("f-tipo").addEventListener("change", () => { toggleEnvio(); toggleVentanilla(); checkHoraLimite(); });

async function checkHoraLimite() {
  const b = $("banner-hora");
  b.classList.remove("show");
  if ($("f-fecha").value !== todayISO()) return;
  const cfg = await getConfigCached();
  const [h, m] = (cfg.hora_limite_pedidos || "13:40").split(":").map(Number);
  const now = new Date();
  if (now.getHours() > h || (now.getHours() === h && now.getMinutes() > m)) {
    b.textContent = `⚠ Estás cargando un pedido para hoy después de las ${cfg.hora_limite_pedidos} (hora límite de toma de pedidos).`;
    b.classList.add("show");
  }
}

let _cfgCache = null;
async function getConfigCached() {
  if (!_cfgCache) _cfgCache = await api("/api/config");
  return _cfgCache;
}

// ---------------------------------------------------------- save pedido
$("pedido-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    fecha: $("f-fecha").value || null,
    tipo: $("f-tipo").value,
    cliente_nombre: $("f-cliente").value.trim(),
    cliente_direccion: $("f-direccion").value.trim(),
    indicaciones: $("f-indicaciones").value.trim(),
    items: state.items.map((i) => ({
      plato_id: i.es_pdd ? null : i.plato_id,
      nombre: i.nombre,
      cantidad: i.cantidad,
      precio_unitario: i.precio_unitario,
    })),
    costo_envio: +$("f-envio").value || 0,
    no_cobrar_envio: $("f-no-envio").checked,
    descuento_tipo: $("f-desc-tipo").value || null,
    descuento_valor: +$("f-desc-valor").value || 0,
    metodo_pago: $("f-pago").value,
    pago_efectivo_detalle: $("f-pago").value === "Efectivo" ? $("f-vuelto").value.trim() : "",
    repartidor: $("f-repartidor").value.trim(),
    notas: $("f-notas").value.trim(),
  };
  try {
    if (state.editId) {
      await api(`/api/pedidos/${state.editId}`, { method: "PATCH", body: JSON.stringify(body) });
    } else {
      await api("/api/pedidos", { method: "POST", body: JSON.stringify(body) });
    }
    // Guardar/actualizar cliente para autocompletado futuro.
    if (body.cliente_nombre) saveClienteQuiet(body);
    resetForm();
    await loadDay();
  } catch (err) {
    alert("Error al guardar: " + err.message);
  }
});

async function saveClienteQuiet(body) {
  try {
    const existentes = await api("/api/clientes?q=" + encodeURIComponent(body.cliente_nombre));
    const dup = existentes.find((c) => c.nombre === body.cliente_nombre && c.direccion === body.cliente_direccion);
    if (!dup) {
      await api("/api/clientes", {
        method: "POST",
        body: JSON.stringify({
          nombre: body.cliente_nombre, direccion: body.cliente_direccion,
          indicaciones: body.indicaciones,
          descuento_tipo: body.descuento_tipo, descuento_valor: body.descuento_valor,
        }),
      });
    }
  } catch (e) { /* no bloquear la carga por esto */ }
}

function resetForm() {
  state.items = []; state.editId = null;
  $("pedido-form").reset();
  $("f-fecha").value = state.fecha;
  $("f-envio").value = _cfgCache ? _cfgCache.costo_envio_default : 3000;
  $("form-title").textContent = "Nuevo pedido";
  $("btn-guardar").textContent = "Guardar pedido";
  renderItems(); toggleEnvio(); toggleVuelto(); toggleVentanilla(); checkHoraLimite();
}

// ------------------------------------------------------- cliente autocomplete
setupAutocomplete("f-cliente", "ac-cliente", async (q) => {
  if (!q) return [];
  const cs = await api("/api/clientes?q=" + encodeURIComponent(q));
  return cs.map((c) => ({
    label: `${c.nombre} — ${c.direccion || "sin dirección"}`,
    onPick: () => {
      $("f-cliente").value = c.nombre;
      $("f-direccion").value = c.direccion || "";
      $("f-indicaciones").value = c.indicaciones || "";
      if (c.descuento_tipo) {
        $("f-desc-tipo").value = c.descuento_tipo;
        $("f-desc-valor").value = c.descuento_valor;
      }
      recalc();
    },
  }));
});

setupAutocomplete("f-repartidor", "ac-repartidor", async (q) => {
  const rs = await api("/api/pedidos/repartidores");
  return rs.filter((r) => r.toLowerCase().includes(q.toLowerCase()))
    .map((r) => ({ label: r, onPick: () => { $("f-repartidor").value = r; } }));
});

function setupAutocomplete(inputId, listId, fetcher) {
  const input = $(inputId), list = $(listId);
  let items = [], active = -1;
  const close = () => { list.classList.add("hidden"); active = -1; };
  input.addEventListener("input", async () => {
    const opts = await fetcher(input.value.trim());
    items = opts;
    if (!opts.length) return close();
    list.innerHTML = opts.map((o, i) => `<div data-i="${i}">${escapeHtml(o.label)}</div>`).join("");
    list.classList.remove("hidden");
    list.querySelectorAll("div").forEach((d) =>
      d.addEventListener("mousedown", (e) => { e.preventDefault(); opts[+d.dataset.i].onPick(); close(); })
    );
  });
  input.addEventListener("keydown", (e) => {
    if (list.classList.contains("hidden")) return;
    const divs = list.querySelectorAll("div");
    if (e.key === "ArrowDown") { active = Math.min(active + 1, divs.length - 1); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); e.preventDefault(); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); items[active].onPick(); close(); return; }
    else if (e.key === "Escape") { return close(); }
    divs.forEach((d, i) => d.classList.toggle("active", i === active));
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
}

// --------------------------------------------------------------- load day
$("day-prev").addEventListener("click", () => shiftDay(-1));
$("day-next").addEventListener("click", () => shiftDay(1));
$("day-today").addEventListener("click", () => { state.fecha = todayISO(); loadDay(); });
function shiftDay(d) {
  const dt = new Date(state.fecha + "T00:00:00");
  dt.setDate(dt.getDate() + d);
  state.fecha = dt.toLocaleDateString("en-CA");
  loadDay();
}

async function loadDay() {
  $("f-fecha").value = state.fecha;
  const label = state.fecha === todayISO() ? "Hoy — " + fmtFecha(state.fecha) : fmtFecha(state.fecha);
  $("day-label").textContent = label;
  state.pedidos = await api("/api/pedidos?fecha=" + state.fecha);
  renderTabla();
  loadResumen();
  checkHoraLimite();
}

function fmtFecha(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

// filtros
$("filters").querySelectorAll(".chip").forEach((c) =>
  c.addEventListener("click", () => {
    $("filters").querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
    c.classList.add("active");
    state.filtro = c.dataset.f;
    renderTabla();
  })
);

function pasaFiltro(p) {
  switch (state.filtro) {
    case "pend-salir": return p.tipo === "Envío" && !p.hora_salida && !p.anulado;
    case "pend-facturar": return !p.facturado && !p.anulado;
    case "ventanilla": return p.tipo === "Ventanilla";
    case "envio": return p.tipo === "Envío";
    default: return true;
  }
}

function renderTabla() {
  const tb = $("tabla-body");
  tb.innerHTML = "";
  state.pedidos.filter(pasaFiltro).forEach((p) => {
    const tr = document.createElement("tr");
    if (p.anulado) tr.className = "anulado";
    else {
      if (p.demorado) tr.classList.add("demorado");
      if (p.alerta_sin_facturar) tr.classList.add("sinfact");
    }
    const items = p.items.map((i) => `${i.cantidad}x ${escapeHtml(i.nombre)}`).join("<br>");
    const badges = (p.demorado ? '<span class="badge demora">DEMORA</span> ' : "") +
                   (p.alerta_sin_facturar ? '<span class="badge sf">SIN FACT.</span>' : "");
    const hs = p.hora_salida ? new Date(p.hora_salida).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "";
    const hp = new Date(p.hora_pedido).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    tr.innerHTML = `
      <td class="nowrap">${hp} ${badges}</td>
      <td>${p.tipo}</td>
      <td>${escapeHtml(p.cliente_nombre)}</td>
      <td>${escapeHtml(p.cliente_direccion)}</td>
      <td>${items}</td>
      <td class="right nowrap">${money(p.total)}</td>
      <td class="nowrap">${p.metodo_pago}${p.pago_efectivo_detalle ? "<br><small class='muted'>" + escapeHtml(p.pago_efectivo_detalle) + "</small>" : ""}</td>
      <td><input class="inline r-rep" value="${escapeAttr(p.repartidor)}" ${p.anulado ? "disabled" : ""} /></td>
      <td><input class="inline r-sal" type="time" value="${hs}" ${p.anulado ? "disabled" : ""} /></td>
      <td class="right"><input type="checkbox" class="r-fac" ${p.facturado ? "checked" : ""} ${p.anulado ? "disabled" : ""} /></td>
      <td><input class="inline r-not" value="${escapeAttr(p.notas)}" ${p.anulado ? "disabled" : ""} /></td>
      <td class="nowrap">
        <button class="btn ghost sm r-edit">✎</button>
        ${p.anulado
          ? `<button class="btn secondary sm r-rest">Restaurar</button>`
          : `<button class="btn ghost sm r-anular" title="Anular">✕</button>`}
      </td>`;

    // inline handlers
    tr.querySelector(".r-rep")?.addEventListener("change", (e) => patch(p.id, { repartidor: e.target.value }));
    tr.querySelector(".r-sal")?.addEventListener("change", (e) =>
      patch(p.id, { hora_salida: e.target.value ? `${state.fecha}T${e.target.value}:00` : null }));
    tr.querySelector(".r-fac")?.addEventListener("change", (e) => patch(p.id, { facturado: e.target.checked }));
    tr.querySelector(".r-not")?.addEventListener("change", (e) => patch(p.id, { notas: e.target.value }));
    tr.querySelector(".r-edit").addEventListener("click", () => editarPedido(p));
    tr.querySelector(".r-anular")?.addEventListener("click", () => anular(p.id));
    tr.querySelector(".r-rest")?.addEventListener("click", () => restaurar(p.id));
    tb.appendChild(tr);
  });
}

async function patch(id, body) {
  try { await api(`/api/pedidos/${id}`, { method: "PATCH", body: JSON.stringify(body) }); await loadDay(); }
  catch (e) { alert("Error: " + e.message); }
}
async function anular(id) {
  if (!confirm("¿Anular este pedido? Queda visible pero no suma a los totales.")) return;
  await api(`/api/pedidos/${id}/anular`, { method: "POST" }); await loadDay();
}
async function restaurar(id) {
  await api(`/api/pedidos/${id}/restaurar`, { method: "POST" }); await loadDay();
}

function editarPedido(p) {
  state.editId = p.id;
  state.items = p.items.map((i) => ({
    plato_id: i.plato_id, nombre: i.nombre,
    precio_unitario: i.precio_unitario, cantidad: i.cantidad,
    es_pdd: i.plato_id == null,
  }));
  $("f-fecha").value = p.fecha;
  $("f-tipo").value = p.tipo;
  $("f-cliente").value = p.cliente_nombre;
  $("f-direccion").value = p.cliente_direccion;
  $("f-indicaciones").value = p.indicaciones;
  $("f-pago").value = p.metodo_pago;
  $("f-vuelto").value = p.pago_efectivo_detalle;
  $("f-repartidor").value = p.repartidor;
  $("f-envio").value = p.costo_envio;
  $("f-no-envio").checked = p.no_cobrar_envio;
  $("f-desc-tipo").value = p.descuento_tipo || "";
  $("f-desc-valor").value = p.descuento_valor;
  $("f-notas").value = p.notas;
  $("form-title").textContent = "Editar pedido #" + p.id;
  $("btn-guardar").textContent = "Guardar cambios";
  renderItems(); toggleEnvio(); toggleVuelto(); toggleVentanilla();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// --------------------------------------------------------------- resumen
async function loadResumen() {
  const r = await api("/api/resumen?fecha=" + state.fecha);
  const g = $("resumen");
  g.innerHTML = `
    <div class="stat"><div class="k">Total del día</div><div class="v">${money(r.total)}</div></div>
    <div class="stat"><div class="k">Pedidos</div><div class="v">${r.cantidad}</div></div>
    <div class="stat"><div class="k">Efectivo</div><div class="v">${money(r.por_metodo.Efectivo)}</div></div>
    <div class="stat"><div class="k">Transferencia</div><div class="v">${money(r.por_metodo.Transferencia)}</div></div>
    <div class="stat"><div class="k">QR</div><div class="v">${money(r.por_metodo.QR)}</div></div>
    <div class="stat"><div class="k">Posnet</div><div class="v">${money(r.por_metodo.Posnet)}</div></div>
    <div class="stat" style="grid-column:span 2;display:flex;align-items:center;justify-content:center;">
      <button class="btn" id="btn-export">⬇ Exportar Excel del mes</button>
    </div>`;
  $("btn-export").addEventListener("click", exportar);
}

async function exportar() {
  const btn = $("btn-export"); btn.disabled = true; btn.textContent = "Generando…";
  try {
    const [y, m] = state.fecha.split("-");
    const res = await api(`/api/export?anio=${+y}&mes=${+m}`, { method: "POST" });
    window.location = res.url;
    btn.textContent = "⬇ Exportar Excel del mes";
  } catch (e) { alert("Error al exportar: " + e.message); btn.textContent = "⬇ Exportar Excel del mes"; }
  btn.disabled = false;
}

// -------------------------------------------------------------- pendientes
async function loadPendientes() {
  const p = await api("/api/pendientes");
  const b = $("banner-pendientes");
  const partes = [];
  if (p.sin_facturar_anteriores > 0)
    partes.push(`⚠ Hay <b>${p.sin_facturar_anteriores}</b> pedido(s) de días anteriores sin facturar (${p.fechas_anteriores.join(", ")}).`);
  if (p.pedidos_futuros > 0)
    partes.push(`📅 <b>${p.pedidos_futuros}</b> pedido(s) cargados para días futuros.`);
  if (partes.length) { b.innerHTML = partes.join(" &nbsp; "); b.classList.add("show"); }
  else b.classList.remove("show");
}

// ------------------------------------------------------------------ carta
async function loadCarta() {
  const platos = await api("/api/platos?incluir_inactivos=true");
  const tb = $("carta-body");
  tb.innerHTML = "";
  platos.forEach((p) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(p.nombre)}${p.es_plato_del_dia ? ' <span class="badge sf">especial</span>' : ""}</td>
      <td>${escapeHtml(p.categoria)}</td>
      <td class="right">${money(p.precio_efectivo)}</td>
      <td class="right">${money(p.precio_lista)}</td>
      <td>${p.activo ? "Sí" : "No"}</td>
      <td class="nowrap">
        <button class="btn ghost sm c-edit">✎</button>
        ${p.activo ? '<button class="btn ghost sm c-baja">Baja</button>' : ""}
      </td>`;
    tr.querySelector(".c-edit").addEventListener("click", () => openPlatoModal(p));
    tr.querySelector(".c-baja")?.addEventListener("click", async () => {
      if (confirm("¿Dar de baja este plato? Se oculta pero no se borra el historial.")) {
        await api(`/api/platos/${p.id}`, { method: "DELETE" }); loadCarta();
      }
    });
    tb.appendChild(tr);
  });
}

$("btn-nuevo-plato").addEventListener("click", () => openPlatoModal(null));
$("btn-aumentar").addEventListener("click", async () => {
  const monto = +$("aumento-monto").value;
  if (!monto) return alert("Ingresá el monto de aumento.");
  if (!confirm(`¿Aumentar TODOS los precios (efectivo y lista) en ${money(monto)}?`)) return;
  const r = await api("/api/platos/aumentar", { method: "POST", body: JSON.stringify({ monto }) });
  $("aumento-monto").value = "";
  await loadCatalog(); loadCarta();
  alert(`Listo: ${r.actualizados} platos actualizados.`);
});

async function fijarPrecio(campo, inputId, etiqueta) {
  const valor = +$(inputId).value;
  if (!valor && valor !== 0) return alert("Ingresá el precio a fijar.");
  if (!confirm(`¿Poner el precio ${etiqueta} de TODOS los platos en ${money(valor)}?`)) return;
  const r = await api("/api/platos/set-precios", { method: "POST", body: JSON.stringify({ [campo]: valor }) });
  $(inputId).value = "";
  await loadCatalog(); loadCarta();
  alert(`Listo: ${r.actualizados} platos con precio ${etiqueta} = ${money(valor)}.`);
}
$("btn-set-efectivo").addEventListener("click", () => fijarPrecio("precio_efectivo", "set-efectivo", "efectivo"));
$("btn-set-lista").addEventListener("click", () => fijarPrecio("precio_lista", "set-lista", "de lista"));

function openPlatoModal(p) {
  $("modal-plato-title").textContent = p ? "Editar plato" : "Nuevo plato";
  $("mp-id").value = p ? p.id : "";
  $("mp-nombre").value = p ? p.nombre : "";
  $("mp-categoria").value = p ? p.categoria : "";
  $("mp-ef").value = p ? p.precio_efectivo : 0;
  $("mp-li").value = p ? p.precio_lista : 0;
  $("mp-activo").checked = p ? p.activo : true;
  $("modal-plato").classList.add("show");
}
$("mp-cancel").addEventListener("click", () => $("modal-plato").classList.remove("show"));
$("mp-save").addEventListener("click", async () => {
  const id = $("mp-id").value;
  const body = {
    nombre: $("mp-nombre").value.trim(),
    categoria: $("mp-categoria").value.trim(),
    precio_efectivo: +$("mp-ef").value || 0,
    precio_lista: +$("mp-li").value || 0,
    activo: $("mp-activo").checked,
  };
  if (!body.nombre) return alert("El nombre es obligatorio.");
  if (id) await api(`/api/platos/${id}`, { method: "PUT", body: JSON.stringify(body) });
  else await api("/api/platos", { method: "POST", body: JSON.stringify(body) });
  $("modal-plato").classList.remove("show");
  await loadCatalog(); loadCarta();
});

// ------------------------------------------------------------------ config
async function loadConfig() {
  _cfgCache = await api("/api/config");
  $("c-demora").value = _cfgCache.minutos_demora_salida;
  $("c-sinfact").value = _cfgCache.hora_alerta_sin_facturar;
  $("c-limite").value = _cfgCache.hora_limite_pedidos;
  $("c-envio").value = _cfgCache.costo_envio_default;
}
$("btn-guardar-config").addEventListener("click", async () => {
  const body = {
    minutos_demora_salida: +$("c-demora").value,
    hora_alerta_sin_facturar: $("c-sinfact").value.trim(),
    hora_limite_pedidos: $("c-limite").value.trim(),
    costo_envio_default: +$("c-envio").value,
  };
  _cfgCache = await api("/api/config", { method: "PUT", body: JSON.stringify(body) });
  $("config-ok").textContent = "✓ Guardado";
  setTimeout(() => ($("config-ok").textContent = ""), 2000);
});

// -------------------------------------------------------------- utilidades
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }

// ------------------------------------------------------------------- init
(async function init() {
  await loadCatalog();
  await getConfigCached();
  $("f-envio").value = _cfgCache.costo_envio_default;
  resetForm();
  await loadDay();
  await loadPendientes();
  // Auto-refresco de alertas cada minuto (recalcula demoras/sin facturar).
  setInterval(loadDay, 60000);
})();
