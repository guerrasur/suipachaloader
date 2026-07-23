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
  $("f-pago").className = "select-pago " + pagoClase($("f-pago").value);
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
  // Confirmar si faltan datos críticos (el medio de pago siempre trae un valor
  // en el select, así que no se chequea). Ventanilla/Take away no llevan
  // dirección, por eso la dirección solo es crítica en Envío.
  const faltan = [];
  if (!body.cliente_nombre) faltan.push("nombre");
  if (body.tipo === "Envío" && !body.cliente_direccion) faltan.push("dirección");
  if (!body.items.length) faltan.push("ítems");
  if (faltan.length && !confirm(`Faltan: ${faltan.join(", ")}. ¿Guardar el pedido igual?`)) return;
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

// ------------------------------------------- pegar/parsear mensaje WhatsApp
// Prellena el formulario a partir del texto pegado, con reglas simples contra
// la Carta (sin IA). No pretende acertar el 100%: acierta lo evidente y el
// usuario corrige. Ver parseMensajeWhatsApp (función pura, testeable a mano).

// Normaliza para comparar: minúsculas, sin acentos, sin puntuación.
function _norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Cantidades escritas con palabra (hasta diez alcanza para un pedido).
const _NUM_PALABRA = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, docena: 12, media: 6,
};

// Palabras que sugieren que una línea es la dirección de entrega.
const _PISTAS_DIRECCION = [
  "calle", "av", "avenida", "pasaje", "psje", "piso", "depto", "dpto", "dto",
  "departamento", "timbre", "esquina", "entre", "torre", "block", "manzana",
  "mza", "casa", "lote", "barrio", "altura", "ruta", "km",
];

// Cantidad dentro de un segmento de ítem: primer número (dígitos o palabra).
function _cantidadDe(seg, norm) {
  const m = norm.match(/(?:^|\s)x?\s*(\d{1,2})(?:\s|x|$)/);
  if (m) return Math.min(50, Math.max(1, parseInt(m[1], 10)));
  for (const w of norm.split(" ")) {
    if (_NUM_PALABRA[w]) return _NUM_PALABRA[w];
  }
  return 1;
}

// ¿El plato (por su nombre normalizado) aparece en el segmento? Match por
// substring o por presencia de todas sus palabras significativas (>3 letras).
function _platoEnSegmento(nombreNorm, segNorm, segWords) {
  if (nombreNorm.length < 3) return false;
  if (segNorm.includes(nombreNorm)) return true;
  // Cada palabra significativa (>3 letras) del plato tiene que estar en el
  // segmento, tolerando plural/singular por prefijo ("milanesas"~"milanesa").
  const sig = nombreNorm.split(" ").filter((w) => w.length > 3);
  const casa = (w) => segWords.some(
    (sw) => sw === w || (sw.length > 3 && (sw.startsWith(w) || w.startsWith(sw)))
  );
  return sig.length > 0 && sig.every(casa);
}

function _detectarPago(norm) {
  if (/\btransfer/.test(norm) || /\btransf\b/.test(norm)) return "Transferencia";
  if (/\befectivo\b|\befvo\b|\bcash\b/.test(norm)) return "Efectivo";
  if (/\bqr\b|mercado ?pago|\bmp\b/.test(norm)) return "QR";
  if (/posnet|tarjeta|debito|credito|\bpos\b/.test(norm)) return "Posnet";
  return null;
}

// "paga con 20000", "abona con 20 mil", "vuelto de 5000", "justo".
function _detectarPagaCon(texto, norm) {
  if (/\b(justo|exacto|pago justo)\b/.test(norm)) return "Justo";
  const m = texto.match(/(?:paga|abona|pago)\s+con\s*\$?\s*([\d.]{3,})/i)
    || texto.match(/vuelto\s+(?:de|para|sobre)?\s*\$?\s*([\d.]{3,})/i);
  if (m) return m[1].replace(/\./g, "");
  return null;
}

// Teléfono: preferimos una línea etiquetada; si no, una tira larga de dígitos.
function _detectarTelefono(lineas) {
  for (const l of lineas) {
    if (/\b(tel|telefono|cel|celular|whatsapp|wsp|wpp)\b/i.test(_norm(l))) {
      const d = l.replace(/\D/g, "");
      if (d.length >= 8 && d.length <= 15) return d;
    }
  }
  for (const l of lineas) {
    const m = l.match(/(?:\+?\d[\s\-]?){8,15}/);
    if (m) {
      const d = m[0].replace(/\D/g, "");
      // Evitar confundir un monto ("paga con 20000") con un teléfono.
      if (d.length >= 8 && d.length <= 15 && !/paga|abona|vuelto/i.test(l)) return d;
    }
  }
  return null;
}

// Palabras que marcan una aclaración de entrega (van a Indicaciones, no a la
// dirección). Se dejan afuera "entre"/"esquina" porque ayudan a ubicar la calle.
const _KW_INDIC = /\b(pisos?|depto|dpto|dto|departamento|timbre|portero|porteria|planta baja|pb|fondo|contrafrente|interno)\b/i;

// Separa el domicilio de sus aclaraciones. Devuelve {direccion, indicaciones}.
// Divide por comas y, dentro de una parte sin coma ("Suipacha 1234 piso 3"),
// corta en la primera palabra de aclaración.
function _partirDireccion(linea) {
  const dir = [], ind = [];
  for (const parte of linea.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = parte.match(_KW_INDIC);
    if (!m) { dir.push(parte); continue; }
    if (m.index <= 2) { ind.push(parte); continue; } // toda la parte es aclaración
    dir.push(parte.slice(0, m.index).trim());          // "Suipacha 1234"
    ind.push(parte.slice(m.index).trim());             // "piso 3"
  }
  let direccion = dir.filter(Boolean).join(", ");
  const indicaciones = ind.filter(Boolean).join(", ");
  if (!direccion) direccion = linea; // si todo pareció aclaración, no perder el dato
  return { direccion, indicaciones: direccion === linea ? "" : indicaciones };
}

// Devuelve {resto, valor} si la línea empieza con "etiqueta:" (o "etiqueta -").
function _campoEtiquetado(linea, etiquetas) {
  const m = linea.match(/^\s*([a-záéíóúñ. ]+?)\s*[:\-]\s*(.+)$/i);
  if (!m) return null;
  const clave = _norm(m[1]);
  if (etiquetas.some((e) => clave === e || clave.startsWith(e))) return m[2].trim();
  return null;
}

// Núcleo del parser. `platos` es state.platos (se filtran los del día).
function parseMensajeWhatsApp(texto, platos) {
  const lineas = (texto || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const normTotal = _norm(texto);
  const catalogo = platos
    .filter((p) => !p.es_plato_del_dia)
    .map((p) => ({ p, nombreNorm: _norm(p.nombre) }));

  const res = {
    nombre: null, direccion: null, telefono: null, indicaciones: null,
    metodo_pago: null, paga_con: null, items: [], faltantes: [],
  };

  // Campos etiquetados explícitos (ganan a cualquier heurística).
  const indics = [];
  const lineasLibres = [];
  for (const l of lineas) {
    const nom = _campoEtiquetado(l, ["nombre", "cliente"]);
    const dir = _campoEtiquetado(l, ["direccion", "dir", "domicilio", "direc"]);
    const ind = _campoEtiquetado(l, ["timbre", "piso", "depto", "dpto", "indicaciones", "aclaracion", "aclaraciones", "referencia"]);
    if (nom) { res.nombre = res.nombre || nom; continue; }
    if (dir) { res.direccion = res.direccion || dir; continue; }
    if (ind) { indics.push(ind); continue; }
    lineasLibres.push(l);
  }

  // Ítems: se busca en cada segmento (separado por saltos, comas, "+", "y").
  const porPlato = new Map();
  const segmentos = (texto || "").split(/[\n,+]+|\by\b/i);
  for (const seg of segmentos) {
    const segNorm = _norm(seg);
    if (!segNorm) continue;
    const segWords = segNorm.split(" ");
    let mejor = null;
    for (const c of catalogo) {
      if (_platoEnSegmento(c.nombreNorm, segNorm, segWords)) {
        if (!mejor || c.nombreNorm.length > mejor.nombreNorm.length) mejor = c;
      }
    }
    if (!mejor) continue;
    const cant = _cantidadDe(seg, segNorm);
    const prev = porPlato.get(mejor.p.id);
    if (prev) prev.cantidad += cant;
    else porPlato.set(mejor.p.id, { plato_id: mejor.p.id, nombre: mejor.p.nombre, cantidad: cant });
  }
  res.items = [...porPlato.values()];

  // Pago y "paga con".
  res.metodo_pago = _detectarPago(normTotal);
  res.paga_con = _detectarPagaCon(texto, normTotal);

  // Teléfono.
  res.telefono = _detectarTelefono(lineas);

  // Dirección por heurística si no vino etiquetada: la línea libre con más
  // pistas de dirección (o que tenga calle + número), que no sea el teléfono.
  if (!res.direccion) {
    let mejorDir = null, mejorScore = 0;
    for (const l of lineasLibres) {
      const n = _norm(l);
      if (!n) continue;
      let score = _PISTAS_DIRECCION.reduce((s, k) => s + (new RegExp("\\b" + k + "\\b").test(n) ? 1 : 0), 0);
      // Calle + altura: letras seguidas de un número (típico "Suipacha 1234").
      if (/[a-z]{3,}\s+\d{2,5}/.test(n)) score += 2;
      // Restar si la línea es claramente un ítem del pedido.
      if (catalogo.some((c) => _platoEnSegmento(c.nombreNorm, n, n.split(" ")))) score -= 3;
      if (res.telefono && l.replace(/\D/g, "") === res.telefono) score -= 5;
      if (score > mejorScore) { mejorScore = score; mejorDir = l; }
    }
    if (mejorDir) res.direccion = mejorDir;
  }

  // Nombre por heurística: si no vino etiquetado, la primera línea libre corta,
  // sin dígitos, que no sea la dirección ni un ítem.
  if (!res.nombre) {
    for (const l of lineasLibres) {
      if (l === res.direccion) continue;
      const n = _norm(l);
      if (!n || /\d/.test(l)) continue;
      if (n.split(" ").length > 4) continue;
      if (catalogo.some((c) => _platoEnSegmento(c.nombreNorm, n, n.split(" ")))) continue;
      if (_detectarPago(n)) continue;
      res.nombre = l;
      break;
    }
  }

  // Separar la dirección de sus aclaraciones (piso/depto/timbre → Indicaciones),
  // venga etiquetada o por heurística. Lo extraído se suma a las indicaciones.
  if (res.direccion) {
    const partida = _partirDireccion(res.direccion);
    res.direccion = partida.direccion;
    if (partida.indicaciones) indics.push(partida.indicaciones);
  }
  if (indics.length) res.indicaciones = indics.join(" · ");

  // Chequeo de datos faltantes (idea 3): avisos accionables.
  if (!res.items.length) res.faltantes.push("ítems (no se reconoció ningún plato de la Carta)");
  if (!res.nombre) res.faltantes.push("nombre del cliente");
  if (!res.metodo_pago) res.faltantes.push("medio de pago");
  if (!res.direccion) res.faltantes.push("dirección");
  if (!res.telefono) res.faltantes.push("teléfono (opcional)");
  return res;
}

// Aplica el resultado del parser al formulario y al estado de ítems.
function aplicarParseWA(res) {
  if (res.nombre) $("f-cliente").value = res.nombre;
  if (res.direccion) $("f-direccion").value = res.direccion;
  if (res.telefono) $("f-telefono").value = res.telefono;
  if (res.indicaciones) $("f-indicaciones").value = res.indicaciones;
  if (res.metodo_pago) $("f-pago").value = res.metodo_pago;
  toggleVuelto();
  if (res.paga_con && $("f-pago").value === "Efectivo") $("f-vuelto").value = res.paga_con;

  if (res.items.length) {
    // El precio se toma de la Carta según el método de pago ya fijado arriba.
    state.items = res.items.map((it) => {
      const p = state.platos.find((x) => x.id === it.plato_id);
      return {
        plato_id: it.plato_id,
        nombre: p ? p.nombre : it.nombre,
        precio_unitario: p ? precioSegunMetodo(p) : 0,
        cantidad: it.cantidad,
        es_pdd: false,
      };
    });
  }
  renderItems(); toggleEnvio(); toggleVentanilla(); recalc(); updateVueltoCalc();
}

// Resumen visible de lo detectado y lo que falta.
function renderReporteWA(res) {
  const cont = $("wa-report");
  const filas = [];
  const ok = (t, v) => filas.push(`<div class="wa-line"><span class="wa-ok">✓</span><span>${escapeHtml(t)}</span><span class="wa-val">${escapeHtml(v)}</span></div>`);
  if (res.nombre) ok("Cliente:", res.nombre);
  if (res.direccion) ok("Dirección:", res.direccion);
  if (res.telefono) ok("Teléfono:", res.telefono);
  if (res.items.length) ok("Ítems:", res.items.map((i) => `${i.cantidad}× ${i.nombre}`).join(", "));
  if (res.metodo_pago) ok("Pago:", res.metodo_pago + (res.paga_con ? ` (paga con ${res.paga_con})` : ""));
  if (res.indicaciones) ok("Indicaciones:", res.indicaciones);
  for (const f of res.faltantes) {
    filas.push(`<div class="wa-line"><span class="wa-falta">⚠</span><span class="wa-falta">Falta ${escapeHtml(f)}</span></div>`);
  }
  cont.innerHTML = filas.join("");
  cont.classList.remove("hidden");
}

$("wa-parse").addEventListener("click", () => {
  const texto = $("wa-text").value;
  if (!texto.trim()) { toast("Pegá primero el mensaje del cliente.", "info"); return; }
  const res = parseMensajeWhatsApp(texto, state.platos);
  aplicarParseWA(res);
  renderReporteWA(res);
  const n = res.items.length;
  toast(n ? `Prellenado: ${n} ítem(s) reconocido(s). Revisá y corregí.` : "No se reconocieron platos; completá a mano.", n ? "ok" : "info");
});

$("wa-clear").addEventListener("click", () => {
  $("wa-text").value = "";
  $("wa-report").classList.add("hidden");
  $("wa-report").innerHTML = "";
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
// Opciones <option> de un select de repartidor: "(sin asignar)" + los nombres,
// marcando `seleccionado`. Si `seleccionado` no está en la lista se agrega (un
// repartidor histórico que ya no está entre los del día sigue visible).
function opcionesRepartidor(nombres, seleccionado) {
  const lista = [...nombres];
  if (seleccionado && !lista.includes(seleccionado)) lista.push(seleccionado);
  return `<option value="">(sin asignar)</option>` +
    lista.map((n) => `<option value="${escapeAttr(n)}" ${n === seleccionado ? "selected" : ""}>${escapeHtml(n)}</option>`).join("");
}

function fillRepartidorSelect(sel, actual) {
  sel.innerHTML = opcionesRepartidor(state.repartidoresDia, actual);
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
  return `<select class="inline rutas-select" data-gi="${gi}">${opcionesRepartidor(nombres, seleccionado)}</select>`;
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
          <button type="button" class="btn secondary sm rutas-ticket" data-gi="${gi}">🖼 Ticket del repartidor (${g.pedidos.length})</button>
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

  // Ticket combinado del grupo: se mapean los ids del grupo (recortados por la
  // API de rutas) a los pedidos completos de state.pedidos, en el orden óptimo.
  cont.querySelectorAll(".rutas-ticket").forEach((b) =>
    b.addEventListener("click", () => {
      const g = r.grupos[+b.dataset.gi];
      const peds = g.pedidos.map((gp) => state.pedidos.find((p) => p.id === gp.id)).filter(Boolean);
      openTicketLote(peds, "Repartidor " + g.etiqueta, { maps_link: g.maps_link });
    })
  );

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
  const opts = opcionesRepartidor(state.repartidoresDia, p.repartidor);
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
let _ticketLote = null;   // en modo lote: array de pedidos completos de un repartidor
let _ticketSubtitulo = ""; // repartidor/etiqueta que titula el lote

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
  _ticketLote = null;
  $("ticket-title").textContent = `Ticket pedido ${p.numero != null ? "N° " + p.numero : "#" + p.id}`;
  drawTicket(p);
  const conTel = !!(p.cliente_telefono || "").trim();
  const conNombre = !!(p.cliente_nombre || "").trim();
  const conDireccionTexto = !!(p.cliente_direccion || "").trim();
  $("ticket-contacto").style.display = conTel || conNombre || conDireccionTexto ? "" : "none";
  $("ticket-wa").style.display = conTel ? "" : "none";
  if (conTel) $("ticket-wa").href = "https://wa.me/" + telefonoWa(p.cliente_telefono);
  const conDireccion = !!(p.cliente_direccion || "").trim();
  $("ticket-maps").style.display = conDireccion ? "" : "none";
  if (conDireccion) $("ticket-maps").href = googleMapsSearchLink(p.cliente_direccion);
  const conRepartidor = p.tipo === "Envío" && !!(p.repartidor || "").trim();
  $("ticket-ruta").style.display = conRepartidor ? "" : "none";
  $("ticket-ruta").textContent = "🗺️ Ruta optimizada";
  $("ticket-maps").textContent = "🗺️ Ver dirección en Maps";
  $("ticket-copiar").textContent = "📋 Copiar imagen";
  $("ticket-contacto").textContent = "👤 Copiar contacto";
  $("ticket-hint").textContent = "Copiá la imagen y pegala (Ctrl+V) en el chat de WhatsApp del repartidor. Con \"Copiar contacto\" le pegás también el teléfono del cliente.";
  $("modal-ticket").classList.add("show");
}

function descargarTicket() {
  const a = document.createElement("a");
  if (_ticketLote) {
    a.download = `repartidor-${(_ticketSubtitulo || "lote").replace(/[^a-z0-9]+/gi, "-")}.png`;
  } else {
    const p = _ticketPedido;
    a.download = `pedido-${p && p.numero != null ? p.numero : (p ? p.id : "ticket")}.png`;
  }
  a.href = $("ticket-canvas").toDataURL("image/png");
  a.click();
}

// ---- Ticket combinado: una imagen + un contacto con todos los pedidos que
//      lleva un mismo repartidor. Reusa el modal #modal-ticket en modo lote.

// "Paga con" legible desde el detalle de efectivo (texto libre con dígitos).
function _pagaConTexto(p) {
  if (!p.pago_efectivo_detalle) return "";
  const digits = p.pago_efectivo_detalle.replace(/\D/g, "");
  return digits ? money(parseInt(digits, 10)) : p.pago_efectivo_detalle;
}

function drawTicketLote(pedidos, subtitulo) {
  const W = 640, S = 2, M = 40;               // ancho, escala, margen
  const cv = $("ticket-canvas");
  cv.style.width = "100%";

  // Pasada de medición sobre un canvas offscreen: calcula el alto necesario
  // según cuántas líneas ocupa cada texto con su fuente.
  const mc = document.createElement("canvas").getContext("2d");
  const efectivoTotal = pedidos
    .filter((p) => p.metodo_pago === "Efectivo")
    .reduce((s, p) => s + (p.total || 0), 0);

  // Modelo de bloques (mismas fuentes en medición y dibujo).
  const bloques = pedidos.map((p) => {
    mc.font = "bold 34px Arial, sans-serif";
    const l1 = [p.cliente_nombre, p.cliente_direccion].filter(Boolean).join(" - ") || "(sin datos)";
    const l1w = wrapText(mc, l1, W - 2 * M - 70);
    let indw = [];
    if (p.indicaciones) { mc.font = "26px Arial, sans-serif"; indw = wrapText(mc, p.indicaciones, W - 2 * M - 70); }
    return { p, l1w, indw };
  });

  let H = M + 52 + 34 + 40;                    // encabezado: título + fecha + resumen
  for (const b of bloques) {
    H += 24;                                   // separador
    H += 46;                                   // N°
    H += b.l1w.length * 42;
    H += b.indw.length * 32;
    H += 44;                                   // línea de cobro
    H += 16;
  }
  H += M;

  cv.width = W * S; cv.height = H * S;
  const ctx = cv.getContext("2d");
  ctx.scale(S, S);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#111"; ctx.lineWidth = 6; ctx.strokeRect(3, 3, W - 6, H - 6);

  let y = M + 40;
  ctx.textAlign = "center"; ctx.fillStyle = "#111";
  ctx.font = "900 40px Arial, sans-serif";
  ctx.fillText("🛵 " + (subtitulo || "Repartidor"), W / 2, y);
  y += 34;
  ctx.font = "24px Arial, sans-serif"; ctx.fillStyle = "#555";
  ctx.fillText(fmtFecha(state.fecha), W / 2, y);
  y += 34;
  ctx.font = "bold 26px Arial, sans-serif"; ctx.fillStyle = "#111";
  const resumen = `${pedidos.length} pedido${pedidos.length === 1 ? "" : "s"}`
    + (efectivoTotal > 0 ? ` · Efectivo a cobrar: ${money(efectivoTotal)}` : "");
  ctx.fillText(resumen, W / 2, y);
  y += 20;

  for (const b of bloques) {
    const p = b.p;
    y += 24;
    ctx.strokeStyle = "#bbb"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(M, y - 12); ctx.lineTo(W - M, y - 12); ctx.stroke();

    ctx.textAlign = "left"; ctx.fillStyle = "#111";
    ctx.font = "900 34px Arial, sans-serif";
    ctx.fillText(p.numero != null ? "N° " + p.numero : "#" + p.id, M, y + 24);
    // Cobro alineado a la derecha en la misma fila del número.
    ctx.textAlign = "right";
    if (p.metodo_pago === "Efectivo") {
      ctx.fillStyle = "#b3261e"; ctx.font = "900 30px Arial, sans-serif";
      const pc = _pagaConTexto(p);
      ctx.fillText(`Cobrar ${money(p.total)}${pc ? " · paga " + pc : ""}`, W - M, y + 22);
    } else {
      ctx.fillStyle = "#1f8a4c"; ctx.font = "900 28px Arial, sans-serif";
      ctx.fillText(`PAGO ✔ ${p.metodo_pago}`, W - M, y + 22);
    }
    y += 46;

    ctx.textAlign = "left"; ctx.fillStyle = "#111";
    ctx.font = "bold 34px Arial, sans-serif";
    for (const l of b.l1w) { ctx.fillText(l, M, y + 24); y += 42; }
    if (b.indw.length) {
      ctx.fillStyle = "#555"; ctx.font = "26px Arial, sans-serif";
      for (const l of b.indw) { ctx.fillText(l, M, y + 20); y += 32; }
    }
    y += 16;
  }
}

function contactoLote(pedidos, subtitulo) {
  const cab = `🛵 ${subtitulo || "Repartidor"} — ${fmtFecha(state.fecha)} — ${pedidos.length} pedido${pedidos.length === 1 ? "" : "s"}`;
  const bloques = pedidos.map((p) => {
    const cobro = p.metodo_pago === "Efectivo"
      ? `Cobrar ${money(p.total)}${_pagaConTexto(p) ? " (paga con " + _pagaConTexto(p) + ")" : ""}`
      : `Pagado (${p.metodo_pago})`;
    return [
      `${p.numero != null ? "N° " + p.numero : "#" + p.id} — ${p.cliente_nombre || "(sin nombre)"}`,
      p.cliente_telefono ? "Tel: " + p.cliente_telefono : "",
      p.cliente_direccion || "",
      p.indicaciones ? "(" + p.indicaciones + ")" : "",
      p.cliente_direccion ? googleMapsSearchLink(p.cliente_direccion) : "",
      cobro,
    ].filter(Boolean).join("\n");
  });
  return cab + "\n\n" + bloques.join("\n————————\n");
}

function openTicketLote(pedidos, titulo, opts = {}) {
  if (!pedidos || !pedidos.length) { toast("Ese repartidor no tiene pedidos para el ticket.", "info"); return; }
  _ticketPedido = null;
  _ticketLote = pedidos;
  _ticketSubtitulo = titulo;
  $("ticket-title").textContent = "Ticket — " + titulo;
  drawTicketLote(pedidos, titulo);
  // Botones: en lote no aplican WhatsApp-cliente ni "Ruta optimizada" (son por
  // pedido). Maps se muestra solo si viene el link de la ruta óptima del grupo.
  $("ticket-contacto").style.display = "";
  $("ticket-contacto").textContent = "👤 Copiar contactos";
  $("ticket-copiar").textContent = "📋 Copiar imagen";
  $("ticket-wa").style.display = "none";
  $("ticket-ruta").style.display = "none";
  if (opts.maps_link) {
    $("ticket-maps").style.display = "";
    $("ticket-maps").href = opts.maps_link;
    $("ticket-maps").textContent = "🗺️ Ver ruta en Maps";
  } else {
    $("ticket-maps").style.display = "none";
  }
  $("ticket-hint").textContent = "Copiá la imagen y pegala en el chat del repartidor. \"Copiar contactos\" copia teléfonos y direcciones de todos los pedidos.";
  $("modal-ticket").classList.add("show");
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
  let texto;
  if (_ticketLote) {
    texto = contactoLote(_ticketLote, _ticketSubtitulo);
  } else {
    const p = _ticketPedido;
    if (!p) return;
    texto = [
      p.cliente_nombre,
      p.cliente_telefono ? "Tel: " + p.cliente_telefono : "",
      p.cliente_direccion,
      p.cliente_direccion ? googleMapsSearchLink(p.cliente_direccion) : "",
    ].filter(Boolean).join("\n");
  }
  try {
    await navigator.clipboard.writeText(texto);
    $("ticket-contacto").textContent = _ticketLote ? "✅ Contactos copiados" : "✅ Contacto copiado";
  } catch (e) {
    toast("No se pudo copiar el contacto al portapapeles.", "error");
  }
});

$("ticket-ruta").addEventListener("click", async () => {
  const p = _ticketPedido;
  if (!p || !p.repartidor) return;
  const btn = $("ticket-ruta");
  btn.textContent = "Calculando…";
  try {
    const r = await api(
      `/api/rutas/repartidor?fecha=${state.fecha}&repartidor=${encodeURIComponent(p.repartidor)}`
    );
    await navigator.clipboard.writeText(`Ruta Optimizada: ${r.maps_link}`);
    btn.textContent = "✅ Ruta copiada";
  } catch (e) {
    toast(e.message, "error");
    btn.textContent = "🗺️ Ruta optimizada";
  }
});

// ---- Entrada general del ticket combinado (independiente del mapa) ---------
// Agrupa los envíos pendientes de salir por repartidor asignado.
function pedidosPendientesPorRepartidor() {
  const map = new Map();
  for (const p of state.pedidos) {
    if (p.tipo !== "Envío" || p.anulado || p.hora_salida) continue;
    const rep = (p.repartidor || "").trim();
    if (!rep) continue;
    if (!map.has(rep)) map.set(rep, []);
    map.get(rep).push(p);
  }
  return map;
}

$("btn-ticket-repartidor").addEventListener("click", () => {
  const porRep = pedidosPendientesPorRepartidor();
  if (porRep.size === 0) {
    toast("No hay envíos pendientes con repartidor asignado. Asigná un repartidor primero.", "info");
    return;
  }
  if (porRep.size === 1) {
    const [rep, peds] = [...porRep][0];
    openTicketLote(peds, "Repartidor " + rep);
    return;
  }
  const cont = $("ticket-rep-list");
  cont.innerHTML = "";
  for (const [rep, peds] of porRep) {
    const b = document.createElement("button");
    b.className = "btn secondary";
    b.style.cssText = "display:block;width:100%;text-align:left;margin:.35rem 0;";
    b.textContent = `🛵 ${rep} — ${peds.length} pedido${peds.length === 1 ? "" : "s"}`;
    b.addEventListener("click", () => {
      $("modal-ticket-rep").classList.remove("show");
      openTicketLote(peds, "Repartidor " + rep);
    });
    cont.appendChild(b);
  }
  $("modal-ticket-rep").classList.add("show");
});
$("ticket-rep-cancel").addEventListener("click", () => $("modal-ticket-rep").classList.remove("show"));

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
  $("c-nombre-local").value = _cfgCache.nombre_local || "";
  $("c-demora").value = _cfgCache.minutos_demora_salida;
  $("c-sinfact").value = _cfgCache.hora_alerta_sin_facturar;
  $("c-limite").value = _cfgCache.hora_limite_pedidos;
  $("c-envio").value = _cfgCache.costo_envio_default;
  $("c-direccion-local").value = _cfgCache.direccion_local || "";
  $("c-ciudad-default").value = _cfgCache.ciudad_default || "";
}
$("btn-guardar-config").addEventListener("click", async () => {
  const body = {
    nombre_local: $("c-nombre-local").value.trim(),
    minutos_demora_salida: +$("c-demora").value,
    hora_alerta_sin_facturar: $("c-sinfact").value.trim(),
    hora_limite_pedidos: $("c-limite").value.trim(),
    costo_envio_default: +$("c-envio").value,
    direccion_local: $("c-direccion-local").value.trim(),
    ciudad_default: $("c-ciudad-default").value.trim(),
  };
  _cfgCache = await api("/api/config", { method: "PUT", body: JSON.stringify(body) });
  aplicarNombreLocal(_cfgCache.nombre_local);
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

// ------------------------------------------------------ nombre del local
// Se pregunta una sola vez por instalación y se guarda en la config del
// backend (no en localStorage): así lo usan tanto el título de la app como
// los nombres de archivo/hoja de los Excel exportados, que se generan en el
// servidor y no tienen acceso al localStorage del navegador.
function aplicarNombreLocal(nombre) {
  $("local-name").textContent = nombre ? nombre + " - " : "";
}
function pedirNombreLocalSiFalta() {
  return new Promise((resolve) => {
    if (_cfgCache.nombre_local) return resolve();
    $("modal-local").classList.add("show");
    setTimeout(() => $("input-nombre-local").focus(), 0);
    const onSave = async () => {
      const nombre = $("input-nombre-local").value.trim();
      if (!nombre) return; // obligatorio: no cierra hasta tener un nombre
      _cfgCache = await api("/api/config", { method: "PUT", body: JSON.stringify({ nombre_local: nombre }) });
      aplicarNombreLocal(_cfgCache.nombre_local);
      $("modal-local").classList.remove("show");
      $("local-guardar").removeEventListener("click", onSave);
      $("input-nombre-local").removeEventListener("keydown", onKey);
      resolve();
    };
    const onKey = (e) => { if (e.key === "Enter") onSave(); };
    $("local-guardar").addEventListener("click", onSave);
    $("input-nombre-local").addEventListener("keydown", onKey);
  });
}

// ------------------------------------------------------------------- init
(async function init() {
  await getConfigCached();
  aplicarNombreLocal(_cfgCache.nombre_local);
  await pedirNombreLocalSiFalta();
  await loadCatalog();
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
