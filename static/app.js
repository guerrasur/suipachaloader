"use strict";

// ------------------------------------------------------------------ helpers
const $ = (id) => document.getElementById(id);
const money = (n) => "$" + (Math.round(n || 0)).toLocaleString("es-AR");

// Calcula el vuelto a partir del texto libre de "paga con" (ej. "40000", "Justo").
// Devuelve null si el texto no permite calcular nada (vacío o sin dígitos ni "justo").
function calcularVuelto(detalle, total) {
  if (!detalle) return null;
  const t = detalle.trim().toLowerCase();
  if (t === "justo" || t === "exacto") return 0;
  const digits = detalle.replace(/\D/g, "");
  if (!digits) return null;
  return parseInt(digits, 10) - total;
}

// Texto " → Vuelto $X" para mostrar junto al detalle de pago en efectivo.
function vueltoSufijo(p) {
  const vuelto = calcularVuelto(p.pago_efectivo_detalle, p.total);
  if (vuelto === null || vuelto <= 0) return "";
  return ` → Vuelto ${money(vuelto)}`;
}
const todayISO = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local

// Aviso no bloqueante abajo a la derecha. tipo: "ok" | "error" | "info".
function toast(msg, tipo = "info") {
  const t = document.createElement("div");
  t.className = "toast " + tipo;
  t.textContent = msg;
  $("toasts").appendChild(t);
  setTimeout(() => {
    t.classList.add("out");
    t.addEventListener("transitionend", () => t.remove(), { once: true });
    setTimeout(() => t.remove(), 600); // por si reduced-motion saltea la transición
  }, tipo === "error" ? 6000 : 3500);
}

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
  repartidoresDia: [],
  platoDia: { definido: false, hay: false, nombre: "", precio_efectivo: 0, precio_lista: 0 },
};

// Precio "de los demás platos" para usar como default del plato del día:
// el precio más frecuente del catálogo (así una bebida suelta no lo desvía).
function precioDefaultPlatos() {
  const platos = platosNormales();
  return { ef: _moda(platos.map((p) => p.precio_efectivo)), li: _moda(platos.map((p) => p.precio_lista)) };
}
function _moda(nums) {
  const cont = {};
  let mejor = 0, mejorN = -1;
  for (const n of nums) {
    if (!n) continue;
    cont[n] = (cont[n] || 0) + 1;
    if (cont[n] > mejorN) { mejorN = cont[n]; mejor = n; }
  }
  return mejor;
}

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
    // Se precarga con el plato del día definido para la fecha (nombre y
    // precio según método), pero nombre y precio quedan editables.
    const d = state.platoDia;
    const ef = d.hay && d.precio_efectivo ? d.precio_efectivo : 0;
    const li = d.hay && d.precio_lista ? d.precio_lista : 0;
    state.items.push({
      plato_id: null,
      nombre: d.hay ? d.nombre : "",
      precio_efectivo: ef,   // se usan para reaplicar precio al cambiar método
      precio_lista: li,
      precio_unitario: $("f-pago").value === "Efectivo" ? ef : li,
      cantidad: 1,
      es_pdd: true,
    });
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
      const normales = platosNormales();
      let opts = normales
        .map((p) => `<option value="${p.id}" ${p.id === it.plato_id ? "selected" : ""}>${escapeHtml(p.nombre)}</option>`)
        .join("");
      // Si el plato del ítem ya no está activo (dado de baja), no aparece en el
      // catálogo: agregamos una opción con su nombre guardado para no perder el
      // dato al editar un pedido viejo.
      if (it.plato_id != null && !normales.some((p) => p.id === it.plato_id)) {
        opts = `<option value="${it.plato_id}" selected>${escapeHtml(it.nombre)} (baja)</option>` + opts;
      }
      selHtml = `<select data-idx="${idx}" class="it-plato">${opts}</select>`;
    }

    line.innerHTML = `
      ${selHtml}
      <input type="number" min="1" data-idx="${idx}" class="it-cant" value="${it.cantidad}" />
      <input type="number" step="100" min="0" data-idx="${idx}" class="it-precio" value="${it.precio_unitario}" />
      <span class="right nowrap">${money(it.cantidad * it.precio_unitario)}</span>
      <button type="button" class="btn ghost sm" data-idx="${idx}" title="Quitar">✕</button>`;
    cont.appendChild(line);
  });

  cont.querySelectorAll(".it-plato").forEach((s) =>
    s.addEventListener("change", (e) => {
      const i = +e.target.dataset.idx;
      const p = state.platos.find((x) => x.id === +e.target.value);
      if (!p) return; // opción "(baja)": no está en el catálogo, no reasignar.
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

// Re-aplicar precio según método a los ítems de catálogo y al plato del día
// (que trae sus dos precios); un plato del día manual sin precios no se toca.
function reapplyPrices() {
  const efectivo = $("f-pago").value === "Efectivo";
  state.items.forEach((it) => {
    if (!it.es_pdd && it.plato_id) {
      const p = state.platos.find((x) => x.id === it.plato_id);
      if (p) it.precio_unitario = precioSegunMetodo(p);
    } else if (it.es_pdd && (it.precio_efectivo || it.precio_lista)) {
      it.precio_unitario = efectivo ? it.precio_efectivo : it.precio_lista;
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
  // Mismos clamps que el backend (totales.py): sin negativos, porcentaje
  // tope 100, y el descuento por monto nunca supera el subtotal.
  const tipo = $("f-desc-tipo").value;
  const val = Math.max(0, +$("f-desc-valor").value || 0);
  if (!tipo || !val) return 0;
  return tipo === "porcentaje" ? sub * Math.min(val, 100) / 100 : Math.min(val, sub);
}
let currentTotal = 0;
function recalc() {
  const sub = subtotalItems();
  currentTotal = Math.max(0, sub + montoEnvio() - montoDescuento(sub));
  $("f-total").textContent = money(currentTotal);
  updateVueltoCalc();
}

function updateVueltoCalc() {
  const hint = $("f-vuelto-calc");
  if ($("f-pago").value !== "Efectivo") { hint.textContent = ""; return; }
  const vuelto = calcularVuelto($("f-vuelto").value, currentTotal);
  if (vuelto === null) { hint.textContent = ""; return; }
  hint.textContent = vuelto < 0
    ? `Falta ${money(-vuelto)}`
    : vuelto === 0
      ? "Sin vuelto (paga justo)"
      : `Vuelto para el repartidor: ${money(vuelto)}`;
  hint.style.color = vuelto < 0 ? "var(--danger)" : "";
}

// ------------------------------------------------------------- form wiring
["f-tipo", "f-no-envio", "f-envio", "f-desc-tipo", "f-desc-valor"].forEach((id) =>
  $(id).addEventListener("input", () => { toggleEnvio(); recalc(); })
);
$("f-vuelto").addEventListener("input", updateVueltoCalc);
$("f-pago").addEventListener("change", () => { toggleVuelto(); reapplyPrices(); recalc(); });
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
    cliente_telefono: $("f-telefono").value.trim(),
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
    const editando = !!state.editId;
    let guardado;
    if (editando) {
      guardado = await api(`/api/pedidos/${state.editId}`, { method: "PATCH", body: JSON.stringify(body) });
    } else {
      guardado = await api("/api/pedidos", { method: "POST", body: JSON.stringify(body) });
    }
    // Guardar/actualizar cliente para autocompletado futuro.
    if (body.cliente_nombre) saveClienteQuiet(body);
    resetForm();
    await loadDay();
    toast(editando ? `Cambios guardados en el pedido N° ${guardado.numero ?? "—"}` : `Pedido N° ${guardado.numero ?? "—"} guardado`, "ok");
  } catch (err) {
    toast("Error al guardar: " + err.message, "error");
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
          telefono: body.cliente_telefono || "",
          indicaciones: body.indicaciones,
          descuento_tipo: body.descuento_tipo, descuento_valor: body.descuento_valor,
        }),
      });
    } else if (body.cliente_telefono && !dup.telefono) {
      // Cliente ya guardado sin teléfono: completarlo para la próxima.
      await api(`/api/clientes/${dup.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...dup, telefono: body.cliente_telefono }),
      });
    }
  } catch (e) { /* no bloquear la carga por esto */ }
}

function resetForm() {
  state.items = []; state.editId = null;
  $("pedido-form").reset();
  $("f-fecha").value = state.fecha;
  $("f-envio").value = _cfgCache ? _cfgCache.costo_envio_default : 3000;
  $("form-title").textContent = "📝 Nuevo pedido";
  $("btn-guardar").textContent = "Guardar pedido";
  fillRepartidorSelect($("f-repartidor"), "");
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
      $("f-telefono").value = c.telefono || "";
      $("f-indicaciones").value = c.indicaciones || "";
      if (c.descuento_tipo) {
        $("f-desc-tipo").value = c.descuento_tipo;
        $("f-desc-valor").value = c.descuento_valor;
      }
      recalc();
    },
  }));
});

// ------------------------------------------------------ repartidores del día
async function loadRepartidoresDia() {
  const r = await api("/api/repartidores-dia?fecha=" + state.fecha);
  state.repartidoresDia = r.nombres;
  fillRepartidorSelect($("f-repartidor"), $("f-repartidor").value);
  const lbl = $("rep-dia-label");
  lbl.textContent = r.nombres.length ? r.nombres.join(" / ") : "Repartidores";
}

// Llena un <select> con "(sin asignar)" + repartidores del día. Si el valor
// actual no está en la lista (ej. un pedido viejo), se agrega para no perderlo.
function fillRepartidorSelect(sel, actual) {
  const nombres = [...state.repartidoresDia];
  if (actual && !nombres.includes(actual)) nombres.push(actual);
  sel.innerHTML =
    `<option value="">(sin asignar)</option>` +
    nombres.map((n) => `<option value="${escapeAttr(n)}">${escapeHtml(n)}</option>`).join("");
  sel.value = actual || "";
}

// Callback opcional para encadenar preguntas de inicio del día.
let onRepModalClosed = null;
function fireRepClosed() {
  if (typeof onRepModalClosed === "function") { const cb = onRepModalClosed; onRepModalClosed = null; cb(); }
}

$("btn-repartidores").addEventListener("click", openRepModal);
$("rep-cancel").addEventListener("click", () => { $("modal-rep").classList.remove("show"); fireRepClosed(); });
$("rep-save").addEventListener("click", async () => {
  const nombres = [$("rep-1").value.trim(), $("rep-2").value.trim()].filter(Boolean);
  await api("/api/repartidores-dia?fecha=" + state.fecha, {
    method: "PUT", body: JSON.stringify({ nombres }),
  });
  $("modal-rep").classList.remove("show");
  await loadRepartidoresDia();
  renderTabla();
  fireRepClosed();
});

async function openRepModal() {
  $("rep-modal-fecha").textContent = state.fecha === todayISO()
    ? "Hoy — " + fmtFecha(state.fecha) : fmtFecha(state.fecha);
  $("rep-1").value = state.repartidoresDia[0] || "";
  $("rep-2").value = state.repartidoresDia[1] || "";
  try {
    const hist = await api("/api/pedidos/repartidores");
    $("rep-historial").innerHTML = hist.map((h) => `<option value="${escapeAttr(h)}">`).join("");
  } catch (e) {}
  $("modal-rep").classList.add("show");
}

// ---------------------------------------------------------- rutas optimizadas
$("btn-rutas").addEventListener("click", openRutasModal);
$("rutas-cerrar").addEventListener("click", () => $("modal-rutas").classList.remove("show"));

async function openRutasModal() {
  $("rutas-fecha").textContent = state.fecha === todayISO()
    ? "Hoy — " + fmtFecha(state.fecha) : fmtFecha(state.fecha);
  $("rutas-contenido").innerHTML = `<p class="muted">Calculando…</p>`;
  $("modal-rutas").classList.add("show");
  try {
    const r = await api("/api/rutas?fecha=" + state.fecha);
    renderRutas(r);
  } catch (e) {
    $("rutas-contenido").innerHTML = `<p class="banner warn">${escapeHtml(e.message)}</p>`;
  }
}

function rutasSelectHtml(gi, nombres, seleccionado) {
  const opts = `<option value="">(sin asignar)</option>` +
    nombres.map((n) => `<option value="${escapeAttr(n)}" ${n === seleccionado ? "selected" : ""}>${escapeHtml(n)}</option>`).join("");
  return `<select class="inline rutas-select" data-gi="${gi}">${opts}</select>`;
}

// Evita que dos grupos queden asignados al mismo repartidor por accidente:
// al elegir un nombre en un select, lo saca de cualquier otro que lo tuviera.
function evitarSeleccionDuplicada(cont) {
  cont.querySelectorAll(".rutas-select").forEach((sel) => {
    sel.addEventListener("change", () => {
      if (!sel.value) return;
      cont.querySelectorAll(".rutas-select").forEach((otro) => {
        if (otro !== sel && otro.value === sel.value) otro.value = "";
      });
    });
  });
}

function renderRutas(r) {
  const cont = $("rutas-contenido");
  if (!r.grupos.length && !r.sin_geocodificar.length) {
    cont.innerHTML = `<p class="muted">No hay envíos pendientes de salir para este día.</p>`;
    return;
  }
  const nombres = r.repartidores_dia || [];
  let html = "";
  r.grupos.forEach((g, gi) => {
    const paradas = g.pedidos.map((p, i) =>
      `<li>${i + 1}. ${escapeHtml(p.cliente_nombre || "(sin nombre)")} — ${escapeHtml(p.cliente_direccion)}${p.numero != null ? ` (N° ${p.numero})` : ""}</li>`
    ).join("");
    const preseleccion = nombres[gi] || "";
    html += `
      <div class="card" style="margin-top:.8rem;">
        <h3 style="margin:0 0 .4rem;">🛵 Repartidor ${escapeHtml(g.etiqueta)} — ${g.pedidos.length} parada${g.pedidos.length === 1 ? "" : "s"}</h3>
        <ol style="margin:.2rem 0 .8rem 1.2rem;padding:0;">${paradas}</ol>
        <div class="row" style="flex-wrap:wrap;align-items:center;">
          <a class="btn secondary sm" href="${g.maps_link}" target="_blank" rel="noopener">🗺️ Abrir ruta en Google Maps</a>
          <label class="muted" style="margin-left:.4rem;">Asignar a:</label>
          ${rutasSelectHtml(gi, nombres, preseleccion)}
        </div>
      </div>`;
  });
  if (r.sin_geocodificar.length) {
    const items = r.sin_geocodificar.map((p) =>
      `<li>${escapeHtml(p.cliente_nombre || "(sin nombre)")} — ${escapeHtml(p.cliente_direccion)}${p.numero != null ? ` (N° ${p.numero})` : ""}</li>`
    ).join("");
    html += `
      <div class="card" style="margin-top:.8rem;">
        <h3 style="margin:0 0 .4rem;">⚠ No se pudieron ubicar en el mapa</h3>
        <p class="muted" style="font-size:.85rem;">Revisá estas direcciones y asignalas a mano en la tabla.</p>
        <ul style="margin:.2rem 0 0 1.2rem;padding:0;">${items}</ul>
      </div>`;
  }
  if (r.grupos.length) {
    html += `
      <div class="row" style="justify-content:flex-end;margin-top:1rem;">
        <button type="button" class="btn" id="rutas-confirmar">✅ Confirmar y asignar todo</button>
      </div>`;
  }
  cont.innerHTML = html;
  evitarSeleccionDuplicada(cont);

  $("rutas-confirmar")?.addEventListener("click", async () => {
    const btn = $("rutas-confirmar");
    const asignaciones = r.grupos.map((g, gi) => ({
      g, repartidor: cont.querySelector(`.rutas-select[data-gi="${gi}"]`).value,
    })).filter((a) => a.repartidor);

    if (!asignaciones.length) {
      toast("Elegí al menos un repartidor para alguno de los grupos.", "error");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Asignando…";
    try {
      for (const { g, repartidor } of asignaciones) {
        for (const p of g.pedidos) {
          await api(`/api/pedidos/${p.id}`, { method: "PATCH", body: JSON.stringify({ repartidor }) });
        }
      }
      btn.textContent = "✅ Asignado";
      await loadDay();
    } catch (e) {
      toast("Error: " + e.message, "error");
      btn.disabled = false;
      btn.textContent = "✅ Confirmar y asignar todo";
    }
  });
}

// -------------------------------------------------------- plato del día (día)
async function loadPlatoDia() {
  const d = await api("/api/plato-del-dia?fecha=" + state.fecha);
  state.platoDia = d;
  const lbl = $("pdd-dia-label");
  if (d.definido && d.hay) lbl.textContent = d.nombre || "Plato del día";
  else if (d.definido && !d.hay) lbl.textContent = "Sin plato del día";
  else lbl.textContent = "Plato del día";
  // El botón "+ Plato del día" del formulario refleja el del día.
  $("add-pdd").textContent = (d.definido && d.hay && d.nombre)
    ? `+ ${d.nombre}` : "+ Plato del día";
}

$("btn-plato-dia").addEventListener("click", openPddModal);
$("pdd-hay").addEventListener("change", () => {
  $("pdd-campos").style.display = $("pdd-hay").checked ? "" : "none";
});
$("pdd-igualar").addEventListener("click", () => {
  const def = precioDefaultPlatos();
  $("pdd-ef").value = def.ef;
  $("pdd-li").value = def.li;
});
$("pdd-save").addEventListener("click", async () => {
  const hay = $("pdd-hay").checked;
  const body = {
    hay,
    nombre: hay ? $("pdd-nombre").value.trim() : "",
    precio_efectivo: hay ? (+$("pdd-ef").value || 0) : 0,
    precio_lista: hay ? (+$("pdd-li").value || 0) : 0,
  };
  if (hay && !body.nombre) return toast("Poné el nombre del plato del día (o destildá \"Hoy hay plato del día\").", "error");
  await api("/api/plato-del-dia?fecha=" + state.fecha, { method: "PUT", body: JSON.stringify(body) });
  $("modal-pdd").classList.remove("show");
  await loadPlatoDia();
  if (typeof onPddModalClosed === "function") { const cb = onPddModalClosed; onPddModalClosed = null; cb(); }
});

function openPddModal() {
  $("pdd-modal-fecha").textContent = state.fecha === todayISO()
    ? "Hoy — " + fmtFecha(state.fecha) : fmtFecha(state.fecha);
  const d = state.platoDia;
  const def = precioDefaultPlatos();
  $("pdd-hay").checked = d.definido ? d.hay : true;
  $("pdd-campos").style.display = $("pdd-hay").checked ? "" : "none";
  $("pdd-nombre").value = d.nombre || "";
  $("pdd-ef").value = d.hay && d.precio_efectivo ? d.precio_efectivo : def.ef;
  $("pdd-li").value = d.hay && d.precio_lista ? d.precio_lista : def.li;
  $("modal-pdd").classList.add("show");
}

// Callback opcional para encadenar el modal de plato del día al inicio del día.
let onPddModalClosed = null;
$("pdd-cancel").addEventListener("click", () => {
  $("modal-pdd").classList.remove("show");
  if (typeof onPddModalClosed === "function") { const cb = onPddModalClosed; onPddModalClosed = null; cb(); }
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
  await loadRepartidoresDia();
  await loadPlatoDia();
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
    case "takeaway": return p.tipo === "Take away";
    case "reserva": return p.tipo === "Reserva";
    default: return true;
  }
}

function repartidorSelectHtml(p) {
  const nombres = [...state.repartidoresDia];
  if (p.repartidor && !nombres.includes(p.repartidor)) nombres.push(p.repartidor);
  const opts = `<option value="">(sin asignar)</option>` +
    nombres.map((n) => `<option value="${escapeAttr(n)}" ${n === p.repartidor ? "selected" : ""}>${escapeHtml(n)}</option>`).join("");
  return `<select class="inline r-rep" ${p.anulado ? "disabled" : ""}>${opts}</select>`;
}

function renderTabla() {
  const tb = $("tabla-body");
  tb.innerHTML = "";
  state.pedidos.filter(pasaFiltro).forEach((p) => tb.appendChild(renderRow(p)));
}

function renderRow(p) {
  const tr = document.createElement("tr");
  tr.dataset.id = p.id;
  if (p.anulado) tr.className = "anulado";
  else {
    // Ya salió: fila verde (gana sobre las alertas de color; el badge
    // SIN FACT. en la celda Estado sigue avisando igual).
    if (p.hora_salida) tr.classList.add("salio");
    else {
      if (p.demorado) tr.classList.add("demorado");
      if (p.alerta_sin_facturar) tr.classList.add("sinfact");
    }
  }
  const items = p.items.map((i) => `${i.cantidad}x ${escapeHtml(i.nombre)}`).join("<br>");
  const hs = hhmm(p.hora_salida);
  const hp = hhmm(p.hora_pedido);
  // Todo el estado del pedido (salida, alertas, facturado) vive en una sola
  // celda "Estado" para poder leerlo de un vistazo.
  const badges = (p.demorado ? '<span class="badge demora">DEMORA</span> ' : "") +
                 (p.alerta_sin_facturar ? '<span class="badge sf">SIN FACT.</span> ' : "");
  const salida = p.hora_salida
    ? `<span class="badge salio">🛵 SALIÓ</span> <input class="inline r-sal" type="time" value="${hs}" ${p.anulado ? "disabled" : ""} />`
    : `<button class="btn ok sm r-salio" ${p.anulado ? "disabled" : ""} title="Marcar que el pedido salió ahora">🛵 Salió</button>`;
  tr.innerHTML = `
    <td class="num-pedido">${p.numero ?? "—"}</td>
    <td class="nowrap">${hp}</td>
    <td><span class="tipo-pill">${escapeHtml(p.tipo)}</span></td>
    <td><div>${escapeHtml(p.cliente_nombre)}</div><small class="muted">${escapeHtml(p.cliente_direccion)}</small></td>
    <td class="td-items">${items}</td>
    <td class="right nowrap">${money(p.total)}</td>
    <td class="nowrap"><span class="pago-pill ${pagoClase(p.metodo_pago)}">${escapeHtml(p.metodo_pago)}</span>${p.pago_efectivo_detalle ? "<br><small class='muted'>" + escapeHtml(p.pago_efectivo_detalle) + vueltoSufijo(p) + "</small>" : ""}
      <br><button class="btn sm r-pagado ${p.pagado ? "pagado-si" : "pagado-no"}" ${p.anulado ? "disabled" : ""} title="${p.pagado ? "Marcar como NO pagado" : "Marcar como pagado"}">${p.pagado ? "✔ Pagado" : "$ Sin pagar"}</button></td>
    <td>${repartidorSelectHtml(p)}</td>
    <td class="nowrap td-estado">${badges}${salida}
      <label class="fact-check"><input type="checkbox" class="r-fac" ${p.facturado ? "checked" : ""} ${p.anulado ? "disabled" : ""} /> Fact.</label></td>
    <td><input class="inline r-not" value="${escapeAttr(p.notas)}" ${p.anulado ? "disabled" : ""} /></td>
    <td class="nowrap">
      ${p.anulado ? "" : `<button class="btn ghost sm r-ticket" title="Ticket para el repartidor" aria-label="Ticket para el repartidor">🖼</button>`}
      <button class="btn ghost sm r-edit" title="Editar" aria-label="Editar">✎</button>
      ${p.anulado
        ? `<button class="btn secondary sm r-rest">Restaurar</button> <button class="btn danger sm r-borrar" title="Borrar definitivamente" aria-label="Borrar definitivamente">🗑</button>`
        : `<button class="btn ghost sm r-anular" title="Anular" aria-label="Anular">✕</button>`}
    </td>`;

  // inline handlers
  tr.querySelector(".r-rep")?.addEventListener("change", (e) => patch(p.id, { repartidor: e.target.value }));
  tr.querySelector(".r-sal")?.addEventListener("change", (e) =>
    patch(p.id, { hora_salida: e.target.value ? `${state.fecha}T${e.target.value}:00` : null }));
  tr.querySelector(".r-salio")?.addEventListener("click", () => {
    const ahora = new Date();
    const hhmmAhora = String(ahora.getHours()).padStart(2, "0") + ":" + String(ahora.getMinutes()).padStart(2, "0");
    patch(p.id, { hora_salida: `${state.fecha}T${hhmmAhora}:00` });
  });
  tr.querySelector(".r-pagado")?.addEventListener("click", () => patch(p.id, { pagado: !p.pagado }));
  tr.querySelector(".r-fac")?.addEventListener("change", (e) => patch(p.id, { facturado: e.target.checked }));
  tr.querySelector(".r-not")?.addEventListener("change", (e) => patch(p.id, { notas: e.target.value }));
  tr.querySelector(".r-ticket")?.addEventListener("click", () => openTicket(p));
  tr.querySelector(".r-edit").addEventListener("click", () => editarPedido(p));
  tr.querySelector(".r-anular")?.addEventListener("click", () => anular(p.id));
  tr.querySelector(".r-rest")?.addEventListener("click", () => restaurar(p.id));
  tr.querySelector(".r-borrar")?.addEventListener("click", () => borrarDefinitivo(p));
  return tr;
}

// Reemplaza en la tabla (y en state) sólo el pedido tocado, sin recargar
// todo el día: no hay flicker ni pérdida de foco en las demás filas.
function actualizarPedidoEnTabla(actualizado) {
  const i = state.pedidos.findIndex((p) => p.id === actualizado.id);
  if (i >= 0) state.pedidos[i] = actualizado;
  const tr = $("tabla-body").querySelector(`tr[data-id="${actualizado.id}"]`);
  if (tr) {
    if (pasaFiltro(actualizado)) tr.replaceWith(renderRow(actualizado));
    else tr.remove(); // ej: filtro "pendientes" y el pedido dejó de estarlo
  }
  loadResumen(); // los totales del día pueden haber cambiado
}

async function patch(id, body) {
  try {
    const actualizado = await api(`/api/pedidos/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    actualizarPedidoEnTabla(actualizado);
  } catch (e) { toast("Error: " + e.message, "error"); }
}
async function anular(id) {
  if (!confirm("¿Anular este pedido? Queda visible pero no suma a los totales.")) return;
  try {
    actualizarPedidoEnTabla(await api(`/api/pedidos/${id}/anular`, { method: "POST" }));
  } catch (e) { toast("Error: " + e.message, "error"); }
}
async function restaurar(id) {
  try {
    actualizarPedidoEnTabla(await api(`/api/pedidos/${id}/restaurar`, { method: "POST" }));
  } catch (e) { toast("Error: " + e.message, "error"); }
}
async function borrarDefinitivo(p) {
  if (!confirm(`¿Borrar definitivamente el pedido ${p.numero != null ? "N° " + p.numero : "#" + p.id}? Esta acción no se puede deshacer.`)) return;
  try {
    await api(`/api/pedidos/${p.id}`, { method: "DELETE" });
    state.pedidos = state.pedidos.filter((x) => x.id !== p.id);
    $("tabla-body").querySelector(`tr[data-id="${p.id}"]`)?.remove();
    loadResumen();
  } catch (e) { toast("Error: " + e.message, "error"); }
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
  $("f-telefono").value = p.cliente_telefono || "";
  $("f-indicaciones").value = p.indicaciones;
  $("f-pago").value = p.metodo_pago;
  $("f-vuelto").value = p.pago_efectivo_detalle;
  fillRepartidorSelect($("f-repartidor"), p.repartidor);
  $("f-envio").value = p.costo_envio;
  $("f-no-envio").checked = p.no_cobrar_envio;
  $("f-desc-tipo").value = p.descuento_tipo || "";
  $("f-desc-valor").value = p.descuento_valor;
  $("f-notas").value = p.notas;
  $("form-title").textContent = "✎ Editar pedido N° " + (p.numero ?? p.id);
  $("btn-guardar").textContent = "Guardar cambios";
  renderItems(); toggleEnvio(); toggleVuelto(); toggleVentanilla();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ------------------------------------------------- ticket para el repartidor
let _ticketPedido = null;

function telefonoWa(tel) {
  // Normaliza a formato wa.me: solo dígitos, con 549 (celular AR) adelante.
  let d = (tel || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return "";
  if (!d.startsWith("54")) d = "549" + d;
  return d;
}

function wrapText(ctx, texto, maxWidth) {
  const palabras = texto.split(/\s+/).filter(Boolean);
  const lineas = [];
  let linea = "";
  for (const p of palabras) {
    const prueba = linea ? linea + " " + p : p;
    if (ctx.measureText(prueba).width > maxWidth && linea) {
      lineas.push(linea);
      linea = p;
    } else linea = prueba;
  }
  if (linea) lineas.push(linea);
  return lineas;
}

function drawTicket(p) {
  const W = 640, H = 800, S = 2; // lógico + escala 2x para nitidez
  const cv = $("ticket-canvas");
  cv.width = W * S; cv.height = H * S;
  cv.style.width = "100%";
  const ctx = cv.getContext("2d");
  ctx.scale(S, S);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.textAlign = "center";

  // Número gigante.
  ctx.fillStyle = "#111";
  ctx.font = "900 240px Arial, sans-serif";
  ctx.fillText(p.numero != null ? String(p.numero) : "—", W / 2, 250);

  let y = 320;
  ctx.strokeStyle = "#bbb";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(50, y); ctx.lineTo(W - 50, y); ctx.stroke();
  y += 60;

  // Cliente - dirección (con wrap por si es larga).
  ctx.fillStyle = "#111";
  ctx.font = "bold 36px Arial, sans-serif";
  const linea1 = [p.cliente_nombre, p.cliente_direccion].filter(Boolean).join(" - ") || "(sin datos)";
  for (const l of wrapText(ctx, linea1, W - 100)) {
    ctx.fillText(l, W / 2, y);
    y += 46;
  }
  if (p.indicaciones) {
    ctx.fillStyle = "#555";
    ctx.font = "28px Arial, sans-serif";
    for (const l of wrapText(ctx, p.indicaciones, W - 100)) {
      ctx.fillText(l, W / 2, y);
      y += 36;
    }
  }

  y += 24;
  ctx.strokeStyle = "#bbb";
  ctx.beginPath(); ctx.moveTo(50, y); ctx.lineTo(W - 50, y); ctx.stroke();
  y += 76;

  // Línea de cobro. El vuelto calculado es solo para uso interno (formulario
  // y tabla de pedidos): no se imprime acá, solo el total y con cuánto paga.
  if (p.metodo_pago === "Efectivo") {
    ctx.fillStyle = "#b3261e";
    ctx.font = "900 52px Arial, sans-serif";
    ctx.fillText(`Cobrar: ${money(p.total)}`, W / 2, y);
    y += 60;
    if (p.pago_efectivo_detalle) {
      const digits = p.pago_efectivo_detalle.replace(/\D/g, "");
      const pagaCon = digits ? money(parseInt(digits, 10)) : p.pago_efectivo_detalle;
      ctx.fillStyle = "#111";
      ctx.font = "bold 38px Arial, sans-serif";
      ctx.fillText(`Paga con: ${pagaCon}`, W / 2, y);
      y += 48;
    }
  } else {
    ctx.fillStyle = "#1f8a4c";
    ctx.font = "900 56px Arial, sans-serif";
    ctx.fillText("PAGO ✔", W / 2, y);
    y += 52;
    ctx.fillStyle = "#555";
    ctx.font = "30px Arial, sans-serif";
    ctx.fillText(p.metodo_pago, W / 2, y);
  }
}

function googleMapsSearchLink(direccion) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(direccion || "");
}

function openTicket(p) {
  _ticketPedido = p;
  $("ticket-title").textContent = `Ticket pedido ${p.numero != null ? "N° " + p.numero : "#" + p.id}`;
  drawTicket(p);
  const conTel = !!(p.cliente_telefono || "").trim();
  $("ticket-contacto").style.display = conTel ? "" : "none";
  $("ticket-wa").style.display = conTel ? "" : "none";
  if (conTel) $("ticket-wa").href = "https://wa.me/" + telefonoWa(p.cliente_telefono);
  const conDireccion = !!(p.cliente_direccion || "").trim();
  $("ticket-maps").style.display = conDireccion ? "" : "none";
  if (conDireccion) $("ticket-maps").href = googleMapsSearchLink(p.cliente_direccion);
  $("ticket-copiar").textContent = "📋 Copiar imagen";
  $("ticket-contacto").textContent = "👤 Copiar contacto";
  $("modal-ticket").classList.add("show");
}

function descargarTicket() {
  const p = _ticketPedido;
  const a = document.createElement("a");
  a.download = `pedido-${p && p.numero != null ? p.numero : (p ? p.id : "ticket")}.png`;
  a.href = $("ticket-canvas").toDataURL("image/png");
  a.click();
}

$("ticket-cerrar").addEventListener("click", () => $("modal-ticket").classList.remove("show"));
$("ticket-descargar").addEventListener("click", descargarTicket);

$("ticket-copiar").addEventListener("click", async () => {
  const btn = $("ticket-copiar");
  try {
    const blob = await new Promise((res) => $("ticket-canvas").toBlob(res, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    btn.textContent = "✅ ¡Copiada! Pegala en WhatsApp";
  } catch (e) {
    // Sin Clipboard API (navegador viejo / sin permiso): descargamos.
    descargarTicket();
    btn.textContent = "⬇ Se descargó (no se pudo copiar)";
  }
});

$("ticket-contacto").addEventListener("click", async () => {
  const p = _ticketPedido;
  if (!p) return;
  const texto = [
    p.cliente_nombre,
    "Tel: " + p.cliente_telefono,
    p.cliente_direccion,
    p.cliente_direccion ? googleMapsSearchLink(p.cliente_direccion) : "",
  ].filter(Boolean).join("\n");
  try {
    await navigator.clipboard.writeText(texto);
    $("ticket-contacto").textContent = "✅ Contacto copiado";
  } catch (e) {
    toast("No se pudo copiar el contacto al portapapeles.", "error");
  }
});

// --------------------------------------------------------------- resumen
const resumenDetails = $("resumen-details");
resumenDetails.open = localStorage.getItem("resumenAbierto") === "1";
resumenDetails.addEventListener("toggle", () => {
  localStorage.setItem("resumenAbierto", resumenDetails.open ? "1" : "0");
});

async function loadResumen() {
  const r = await api("/api/resumen?fecha=" + state.fecha);
  const g = $("resumen");
  $("resumen-collapsed-hint").textContent = `— ${money(r.total)} · ${r.cantidad} pedido${r.cantidad === 1 ? "" : "s"}`;
  // Los puntitos de color de cada método repiten el color de las pills de la
  // tabla, para conectar visualmente el resumen con los pedidos.
  g.innerHTML = `
    <div class="summary-grid">
      <div class="stat stat-total"><div class="k">Total del día</div><div class="v">${money(r.total)}</div></div>
      <div class="stat"><div class="k">Pedidos</div><div class="v">${r.cantidad}</div></div>
      <div class="stat"><div class="k"><i class="dot dot-efectivo"></i>Efectivo</div><div class="v">${money(r.por_metodo.Efectivo)}</div></div>
      <div class="stat"><div class="k"><i class="dot dot-transferencia"></i>Transferencia</div><div class="v">${money(r.por_metodo.Transferencia)}</div></div>
      <div class="stat"><div class="k"><i class="dot dot-qr"></i>QR</div><div class="v">${money(r.por_metodo.QR)}</div></div>
      <div class="stat"><div class="k"><i class="dot dot-posnet"></i>Posnet</div><div class="v">${money(r.por_metodo.Posnet)}</div></div>
    </div>
    <div class="summary-actions">
      <button class="btn" id="btn-facturar">🧾 Facturar el día</button>
      <button class="btn ok" id="btn-facturar-todo">✅ Marcar todo como facturado</button>
      <button class="btn secondary" id="btn-export-dia">⬇ Hoja del día</button>
      <span class="export-mes-wrap">
        <input type="month" id="export-mes" class="inline" title="Mes a exportar" />
        <button class="btn" id="btn-export">⬇ Excel del mes</button>
      </span>
    </div>`;
  $("export-mes").value = state.fecha.slice(0, 7); // default: el mes del día visto
  $("btn-export").addEventListener("click", exportar);
  $("btn-export-dia").addEventListener("click", exportarDia);
  $("btn-facturar").addEventListener("click", openFacturacion);
  $("btn-facturar-todo").addEventListener("click", facturarTodo);
}

// Marca todos los pedidos válidos del día como facturados de una sola vez
// (cierre del día al pasar la lista completa a facturación).
async function facturarTodo() {
  const pendientes = state.pedidos.filter((p) => !p.anulado && !p.facturado).length;
  if (!pendientes) return toast("No hay pedidos pendientes de facturar en este día.", "info");
  if (!confirm(`¿Marcar como facturados los ${pendientes} pedido(s) pendientes de este día?`)) return;
  const btn = $("btn-facturar-todo");
  btn.disabled = true; btn.textContent = "Marcando…";
  try {
    const r = await api("/api/pedidos/facturar-dia?fecha=" + state.fecha, { method: "POST" });
    await loadDay();
    toast(`Listo: ${r.facturados} pedido(s) marcados como facturados.`, "ok");
  } catch (e) {
    toast("Error: " + e.message, "error");
    btn.disabled = false; btn.textContent = "✅ Marcar todo como facturado";
  }
}

async function exportarDia() {
  window.location = "/api/export/dia?fecha=" + state.fecha;
}

// ------------------------------------------------------ facturación del día
async function openFacturacion() {
  const r = await api("/api/facturacion?fecha=" + state.fecha);
  $("fact-fecha").textContent = state.fecha === todayISO()
    ? "Hoy — " + fmtFecha(state.fecha) : fmtFecha(state.fecha);
  const cont = $("fact-cols");
  if (!r.metodos.length) {
    cont.innerHTML = `<p class="muted">No hay pedidos para facturar este día.</p>`;
  } else {
    cont.innerHTML = r.metodos.map((m) => {
      const d = r.por_metodo[m];
      const completo = d.pedidos > 0 && d.facturados === d.pedidos;
      const filas = d.items.map((it) =>
        `<li><b>${it.cantidad}</b> ${escapeHtml(it.nombre)}</li>`).join("");
      const envios = d.envios > 0
        ? `<li class="fact-envio"><b>${d.envios}</b> ${d.envios === 1 ? "envío" : "envíos"}</li>` : "";
      return `
        <div class="fact-col ${completo ? "fact-col-done" : ""}">
          <div class="fact-head">${escapeHtml(m)}</div>
          <ul class="fact-list">${filas}${envios}</ul>
          <div class="fact-foot">
            <span>${d.facturados}/${d.pedidos} facturado${d.pedidos === 1 ? "" : "s"}</span>
            <span>${money(d.total)}</span>
          </div>
          <div class="fact-actions">
            <button type="button" class="btn ${completo ? "secondary" : "ok"} sm fact-marcar" data-metodo="${escapeHtml(m)}" ${completo ? "disabled" : ""}>
              ${completo ? "✅ Ya facturado" : "✅ Marcar facturado"}
            </button>
          </div>
        </div>`;
    }).join("");
    cont.querySelectorAll(".fact-marcar").forEach((btn) => {
      btn.addEventListener("click", () => facturarMetodo(btn.dataset.metodo));
    });
  }
  $("modal-fact").classList.add("show");
}
$("fact-cerrar").addEventListener("click", () => $("modal-fact").classList.remove("show"));

// Factura solo los pedidos de un método de pago (no se mezclan efectivo y
// transferencia al pasar la lista al sistema de facturación).
async function facturarMetodo(metodo) {
  try {
    const r = await api(
      "/api/pedidos/facturar-dia?fecha=" + state.fecha + "&metodo_pago=" + encodeURIComponent(metodo),
      { method: "POST" }
    );
    await loadDay();
    await openFacturacion();
    toast(`Listo: ${r.facturados} pedido(s) de ${metodo} marcados como facturados.`, "ok");
  } catch (e) {
    toast("Error: " + e.message, "error");
  }
}

async function exportar() {
  const btn = $("btn-export"); btn.disabled = true; btn.textContent = "Generando…";
  try {
    // input type=month da "YYYY-MM"; si el navegador no lo soporta y el
    // valor no tiene esa forma, se cae al mes del día visto.
    const mesValor = /^\d{4}-\d{2}$/.test($("export-mes")?.value || "")
      ? $("export-mes").value : state.fecha.slice(0, 7);
    const [y, m] = mesValor.split("-");
    const res = await api(`/api/export?anio=${+y}&mes=${+m}`, { method: "POST" });
    window.location = res.url;
    btn.textContent = "⬇ Exportar Excel del mes";
  } catch (e) { toast("Error al exportar: " + e.message, "error"); btn.textContent = "⬇ Exportar Excel del mes"; }
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
  if (!monto) return toast("Ingresá el monto de aumento.", "error");
  if (!confirm(`¿Aumentar TODOS los precios (efectivo y lista) en ${money(monto)}?`)) return;
  const r = await api("/api/platos/aumentar", { method: "POST", body: JSON.stringify({ monto }) });
  $("aumento-monto").value = "";
  await loadCatalog(); loadCarta();
  toast(`Listo: ${r.actualizados} platos actualizados.`, "ok");
});

async function fijarPrecio(campo, inputId, etiqueta) {
  const valor = +$(inputId).value;
  if (!valor && valor !== 0) return toast("Ingresá el precio a fijar.", "error");
  if (!confirm(`¿Poner el precio ${etiqueta} de TODOS los platos en ${money(valor)}?`)) return;
  const r = await api("/api/platos/set-precios", { method: "POST", body: JSON.stringify({ [campo]: valor }) });
  $(inputId).value = "";
  await loadCatalog(); loadCarta();
  toast(`Listo: ${r.actualizados} platos con precio ${etiqueta} = ${money(valor)}.`, "ok");
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
  if (!body.nombre) return toast("El nombre es obligatorio.", "error");
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
  $("c-direccion-local").value = _cfgCache.direccion_local || "";
  $("c-ciudad-default").value = _cfgCache.ciudad_default || "";
}
$("btn-guardar-config").addEventListener("click", async () => {
  const body = {
    minutos_demora_salida: +$("c-demora").value,
    hora_alerta_sin_facturar: $("c-sinfact").value.trim(),
    hora_limite_pedidos: $("c-limite").value.trim(),
    costo_envio_default: +$("c-envio").value,
    direccion_local: $("c-direccion-local").value.trim(),
    ciudad_default: $("c-ciudad-default").value.trim(),
  };
  _cfgCache = await api("/api/config", { method: "PUT", body: JSON.stringify(body) });
  $("config-ok").textContent = "✓ Guardado";
  setTimeout(() => ($("config-ok").textContent = ""), 2000);
});

// ----------------------------------------------------- cierre de modales
// Cada modal cierra por su botón existente (así se preservan los callbacks
// encadenados, ej. repartidores → plato del día al arrancar).
const MODAL_CERRAR = {
  "modal-rep": "rep-cancel",
  "modal-pdd": "pdd-cancel",
  "modal-fact": "fact-cerrar",
  "modal-ticket": "ticket-cerrar",
  "modal-rutas": "rutas-cerrar",
  "modal-plato": "mp-cancel",
};
// Sólo los modales sin campos editables cierran con click afuera (un click
// accidental no puede hacer perder lo tipeado en los de formulario).
const MODALES_SOLO_LECTURA = new Set(["modal-fact", "modal-ticket", "modal-rutas"]);

function cerrarModal(back) { $(MODAL_CERRAR[back.id])?.click(); }

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("ac-cliente").classList.contains("hidden")) return; // lo usa el autocompletado
  const abierto = document.querySelector(".modal-back.show");
  if (abierto) { e.preventDefault(); cerrarModal(abierto); }
});
// mousedown y no click: un drag que empieza dentro del modal y suelta afuera
// dispararía click en el fondo y cerraría sin querer.
document.querySelectorAll(".modal-back").forEach((back) =>
  back.addEventListener("mousedown", (e) => {
    if (e.target === back && MODALES_SOLO_LECTURA.has(back.id)) cerrarModal(back);
  })
);

// -------------------------------------------------------------- utilidades
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }

// Clase CSS de color según el método de pago (efectivo verde, transferencia
// azul, etc.), igual que en la planilla de referencia.
function pagoClase(metodo) {
  return {
    "Efectivo": "pago-efectivo",
    "Transferencia": "pago-transferencia",
    "QR": "pago-qr",
    "Posnet": "pago-posnet",
  }[metodo] || "pago-otro";
}

// HH:MM (24h) desde un ISO "YYYY-MM-DDTHH:MM:SS". El input type=time exige
// ese formato exacto; no sirve toLocaleTimeString (devuelve "09:15 a. m.").
function hhmm(iso) { return iso ? String(iso).slice(11, 16) : ""; }

// ------------------------------------------------------------------- init
(async function init() {
  await loadCatalog();
  await getConfigCached();
  $("f-envio").value = _cfgCache.costo_envio_default;
  resetForm();
  await loadDay();
  await loadPendientes();
  // Al iniciar el día (si es hoy): preguntar los repartidores y el plato del
  // día que todavía no se hayan cargado, uno después del otro.
  if (state.fecha === todayISO()) {
    const necesitaRep = state.repartidoresDia.length === 0;
    const necesitaPdd = !state.platoDia.definido;
    if (necesitaRep) {
      onRepModalClosed = necesitaPdd ? openPddModal : null;
      openRepModal();
    } else if (necesitaPdd) {
      openPddModal();
    }
  }
  // Auto-refresco de alertas cada minuto (recalcula demoras/sin facturar).
  // Se saltea si el usuario está en el medio de algo, para no pisar lo que
  // está tipeando ni cerrar un modal abierto.
  setInterval(() => { if (!estaOcupado()) loadDay(); }, 60000);
  // Versión de la app en el header (no bloquea el arranque si falla).
  api("/api/version").then((r) => {
    if (r.version) $("app-version").textContent = "v" + r.version;
  }).catch(() => {});
})();

// El refresco automático no debe interrumpir al usuario: hay un modal abierto,
// o el foco está dentro de la tabla (edición inline) o del formulario de carga.
function estaOcupado() {
  if (document.querySelector(".modal-back.show")) return true;
  const el = document.activeElement;
  if (el && typeof el.closest === "function" && el.closest("#tabla, #pedido-form")) return true;
  return false;
}
