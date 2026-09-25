"use strict";

(() => {
  const byId = (id) => document.getElementById(id);
  const BASE_NAMES = [
    "Caesar","Brie","Clasica","Atun","Porto","Falafel","Cala","Veggie","Risotto",
    "Wrap Hummus","Wraps","Wrap Atun","Wrap Toscano","Wrap Brie","Cobb",
    "Bowl del Dia","Ravioles","Chaufa","Plato del dia"
  ];
  const ALIASES = {
    "caesar":["caesar","cesar","césar"], "brie":["brie"], "clasica":["clasica","clásica","clas1ca"],
    "atun":["atun","atún"], "porto":["porto"], "falafel":["falafel"], "cala":["cala"],
    "veggie":["veggie","vegie","veggi"], "risotto":["risotto"], "wrap hummus":["wrap hummus","wrp hummus","hummus"],
    "wraps":["wraps"], "wrap atun":["wrap atun","wrp atun","wrap atún"], "wrap toscano":["wrap toscano","wrp toscano"],
    "wrap brie":["wrap brie","wrp brie"], "cobb":["cobb"], "bowl del dia":["bowl del dia","bowl del día"],
    "ravioles":["ravioles"], "chaufa":["chaufa"], "plato del dia":["plato del dia","plato del día"]
  };
  let items = [];
  let lastSplit = null;
  let ocrBusy = false;

  const normalize = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim();
  const canonical = (name) => {
    const n = normalize(name);
    for (const [key, vals] of Object.entries(ALIASES)) {
      if (vals.some(v => n.includes(normalize(v)))) return key;
    }
    return null;
  };
  const displayName = (key) => {
    const found = BASE_NAMES.find(n => canonical(n) === key);
    return found || key.replace(/\b\w/g, c => c.toUpperCase());
  };

  function ensureBaseRows() {
    if (items.length) return;
    items = BASE_NAMES.map(nombre => ({ nombre, cantidad:0, facturarFijo:0, noFacturarFijo:0 }));
    renderItems();
  }

  async function loadCartaNames() {
    try {
      const r = await fetch("/api/platos");
      if (!r.ok) return;
      const platos = await r.json();
      const names = platos.filter(p => p.activo !== false).map(p => p.nombre).filter(Boolean);
      for (const nombre of names) {
        if (!items.some(i => canonical(i.nombre) === canonical(nombre) || normalize(i.nombre) === normalize(nombre))) {
          items.push({ nombre, cantidad:0, facturarFijo:0, noFacturarFijo:0 });
        }
      }
      renderItems();
    } catch (_) {}
  }

  function renderItems() {
    const tbody = byId("jud-items");
    if (!tbody) return;
    tbody.innerHTML = items.map((it, idx) => `
      <tr data-i="${idx}">
        <td><input class="jud-name" value="${escapeAttr(it.nombre)}" aria-label="Plato" /></td>
        <td class="right"><input class="jud-qty" type="number" min="0" step="1" value="${it.cantidad}" aria-label="Pedidas" /></td>
        <td class="right"><input class="jud-force-fact" type="number" min="0" max="${it.cantidad}" step="1" value="${it.facturarFijo || 0}" aria-label="Cantidad obligatoria en facturar" /></td>
        <td class="right"><input class="jud-force-no" type="number" min="0" max="${it.cantidad}" step="1" value="${it.noFacturarFijo || 0}" aria-label="Cantidad obligatoria en no facturar" /></td>
        <td><button type="button" class="btn ghost sm jud-remove" title="Quitar">×</button></td>
      </tr>`).join("");
    recalc();
  }

  function syncItemsFromTable() {
    document.querySelectorAll("#jud-items tr").forEach((tr) => {
      const i = +tr.dataset.i;
      if (!items[i]) return;
      items[i].nombre = tr.querySelector(".jud-name").value.trim() || "Sin nombre";
      items[i].cantidad = Math.max(0, parseInt(tr.querySelector(".jud-qty").value || "0",10) || 0);
      items[i].facturarFijo = Math.max(0, parseInt(tr.querySelector(".jud-force-fact").value || "0",10) || 0);
      items[i].noFacturarFijo = Math.max(0, parseInt(tr.querySelector(".jud-force-no").value || "0",10) || 0);
    });
  }

  function totalItems() { return items.reduce((s,i)=>s+(+i.cantidad||0),0); }

  function recalc(changed) {
    syncItemsFromTable();
    const total = totalItems();
    byId("jud-total").textContent = total;
    const factRaw = byId("jud-facturar").value.trim();
    const noRaw = byId("jud-no-facturar").value.trim();
    const fact = parseInt(factRaw,10);
    const nof = parseInt(noRaw,10);
    if (total > 0 && changed === "fact" && Number.isFinite(fact) && noRaw === "") {
      byId("jud-no-facturar").value = Math.max(0,total-fact);
    }
    if (total > 0 && changed === "no" && Number.isFinite(nof) && factRaw === "") {
      byId("jud-facturar").value = Math.max(0,total-nof);
    }
    validate();
  }

  function validate() {
    const box = byId("jud-validation");
    const total = totalItems();
    const fact = parseInt(byId("jud-facturar").value,10);
    const nof = parseInt(byId("jud-no-facturar").value,10);
    const forcedFact = items.reduce((s,i)=>s+(i.facturarFijo||0),0);
    const forcedNo = items.reduce((s,i)=>s+(i.noFacturarFijo||0),0);
    const impossibleItem = items.find(i => (i.facturarFijo||0) + (i.noFacturarFijo||0) > i.cantidad);
    let msg = total ? `Total detectado: ${total}.` : "Pegá una captura o cargá las cantidades.";
    let error = false;
    if (Number.isFinite(fact) && Number.isFinite(nof) && fact + nof !== total) {
      msg = `Facturar (${fact}) + No facturar (${nof}) debe dar ${total}.`; error = true;
    } else if (impossibleItem) {
      msg = `${impossibleItem.nombre}: pedís ${(impossibleItem.facturarFijo||0)} en Facturar + ${(impossibleItem.noFacturarFijo||0)} en No facturar, pero sólo hay ${impossibleItem.cantidad}.`; error = true;
    } else if (Number.isFinite(fact) && forcedFact > fact) {
      msg = `Las cantidades obligatorias de Facturar suman ${forcedFact}, pero el objetivo es ${fact}.`; error = true;
    } else if (Number.isFinite(nof) && forcedNo > nof) {
      msg = `Las cantidades obligatorias de No facturar suman ${forcedNo}, pero el objetivo es ${nof}.`; error = true;
    }
    box.textContent = msg;
    box.classList.toggle("error", error);
    return !error && total > 0 && Number.isFinite(fact) && Number.isFinite(nof);
  }

  function parseMessage(text) {
    const n = normalize(text);

    // Leer "no facturar" primero y retirarlo antes de buscar "facturar".
    const noMatch = n.match(/no\s*facturar\s*[:\-]?\s*(\d+)/i);
    const factSource = n.replace(/no\s*facturar\s*[:\-]?\s*\d+(?:\s*\([^)]*\))?/gi, " ");
    const factMatch = factSource.match(/(?:^|[^a-z])facturar\s*[:\-]?\s*(\d+)/i);
    if (factMatch) byId("jud-facturar").value = +factMatch[1];
    if (noMatch) byId("jud-no-facturar").value = +noMatch[1];

    // Limpiar sólo las restricciones derivadas del mensaje. Las cantidades detectadas no se tocan.
    items.forEach(i => { i.facturarFijo = 0; i.noFacturarFijo = 0; });

    // Cada paréntesis pertenece al bloque que lo precede:
    // "Facturar 10 (1 Cobb) No facturar 8 (2 Cobb)" => Cobb 1/2.
    const blockRe = /(no\s+facturar|facturar)\s*[:\-]?\s*\d+\s*((?:\([^)]*\)\s*)*)/gi;
    let block;
    while ((block = blockRe.exec(text)) !== null) {
      const bucket = /^no/i.test(block[1]) ? "noFacturarFijo" : "facturarFijo";
      const parens = block[2].match(/\(([^)]+)\)/g) || [];
      for (const p of parens) {
        const m = p.match(/(\d+)\s*([A-Za-zÁÉÍÓÚÜáéíóúüñÑ ]+)/);
        if (!m) continue;
        const qty = +m[1];
        const key = canonical(m[2]);
        if (!key) continue;
        let item = items.find(i => canonical(i.nombre) === key);
        if (!item) {
          item = { nombre:displayName(key), cantidad:0, facturarFijo:0, noFacturarFijo:0 };
          items.push(item);
        }
        item[bucket] += qty;
      }
    }
    renderItems();
  }

  function generateSplit() {
    syncItemsFromTable();
    // Parsear una vez antes de generar, sin tocar las cantidades pedidas.
    if (byId("jud-message").value.trim()) parseMessage(byId("jud-message").value);
    syncItemsFromTable();
    if (!validate()) return;

    const factTarget = +byId("jud-facturar").value;
    const noTarget = +byId("jud-no-facturar").value;
    const factMap = new Map(), noMap = new Map();
    let assignedFact = 0, assignedNo = 0;
    const pool = [];

    items.forEach((it, idx) => {
      const ff = Math.max(0, it.facturarFijo || 0);
      const nf = Math.max(0, it.noFacturarFijo || 0);
      if (ff) factMap.set(idx, ff);
      if (nf) noMap.set(idx, nf);
      assignedFact += ff;
      assignedNo += nf;
      for (let n = ff + nf; n < it.cantidad; n++) pool.push(idx);
    });

    const needFact = factTarget - assignedFact;
    const needNo = noTarget - assignedNo;
    if (needFact < 0 || needNo < 0 || needFact + needNo !== pool.length) {
      byId("jud-validation").textContent = "No existe un reparto válido con las cantidades y restricciones actuales.";
      byId("jud-validation").classList.add("error");
      return;
    }

    shuffle(pool);
    pool.slice(0, needFact).forEach(idx => factMap.set(idx, (factMap.get(idx)||0)+1));
    pool.slice(needFact).forEach(idx => noMap.set(idx, (noMap.get(idx)||0)+1));

    lastSplit = { noMap, factMap };
    renderSplit();
  }
