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
    items = BASE_NAMES.map(nombre => ({ nombre, cantidad:0, forzar:0 }));
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
          items.push({ nombre, cantidad:0, forzar:0 });
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
        <td class="right"><input class="jud-force" type="number" min="0" max="${it.cantidad}" step="1" value="${it.forzar}" aria-label="Forzar no facturar" /></td>
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
      items[i].forzar = Math.min(items[i].cantidad, Math.max(0, parseInt(tr.querySelector(".jud-force").value || "0",10) || 0));
    });
  }

  function totalItems() { return items.reduce((s,i)=>s+(+i.cantidad||0),0); }

  function recalc(changed) {
    syncItemsFromTable();
    const total = totalItems();
    byId("jud-total").textContent = total;
    const fact = parseInt(byId("jud-facturar").value,10);
    const nof = parseInt(byId("jud-no-facturar").value,10);
    if (changed === "fact" && Number.isFinite(fact)) byId("jud-no-facturar").value = Math.max(0,total-fact);
    if (changed === "no" && Number.isFinite(nof)) byId("jud-facturar").value = Math.max(0,total-nof);
    validate();
  }

  function validate() {
    const box = byId("jud-validation");
    const total = totalItems();
    const fact = parseInt(byId("jud-facturar").value,10);
    const nof = parseInt(byId("jud-no-facturar").value,10);
    const forced = items.reduce((s,i)=>s+i.forzar,0);
    let msg = total ? `Total detectado: ${total}.` : "Pegá una captura o cargá las cantidades.";
    let error = false;
    if (Number.isFinite(fact) && Number.isFinite(nof) && fact + nof !== total) {
      msg = `Facturar (${fact}) + No facturar (${nof}) debe dar ${total}.`; error = true;
    } else if (Number.isFinite(nof) && forced > nof) {
      msg = `Hay ${forced} unidades forzadas a “No facturar”, pero el objetivo es ${nof}.`; error = true;
    }
    box.textContent = msg;
    box.classList.toggle("error", error);
    return !error && total > 0 && Number.isFinite(fact) && Number.isFinite(nof);
  }

  function parseMessage(text) {
    const n = normalize(text);
    const factMatch = n.match(/facturar\s*[:\-]?\s*(\d+)/i);
    const noMatch = n.match(/no\s*facturar\s*[:\-]?\s*(\d+)/i);
    // Evitar que "facturar" tome el número de "no facturar".
    const factOnly = [...n.matchAll(/(?:^|[^a-z])facturar\s*[:\-]?\s*(\d+)/g)].map(m=>+m[1]);
    if (factOnly.length) byId("jud-facturar").value = factOnly[factOnly.length-1];
    if (noMatch) byId("jud-no-facturar").value = +noMatch[1];

    const parens = text.match(/\(([^)]+)\)/g) || [];
    for (const p of parens) {
      const m = p.match(/(\d+)\s*([A-Za-zÁÉÍÓÚáéíóúñÑ ]+)/);
      if (!m) continue;
      const qty = +m[1], key = canonical(m[2]);
      if (!key) continue;
      const item = items.find(i => canonical(i.nombre) === key);
      if (item) item.forzar = Math.min(item.cantidad || qty, qty);
    }
    renderItems();
    recalc();
  }

  function parseOcrText(text) {
    const rawLines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    let hits = 0;
    for (const line of rawLines) {
      const key = canonical(line);
      if (!key) continue;
      const nums = line.match(/\d+/g);
      if (!nums?.length) continue;
      // En la planilla: nombre | efectivo | transferencia | PEDIDAS. La última cifra es la cantidad.
      let qty = parseInt(nums[nums.length-1],10);
      if (qty > 200) continue;
      let item = items.find(i => canonical(i.nombre) === key);
      if (!item) { item = { nombre:displayName(key), cantidad:0, forzar:0 }; items.push(item); }
      item.cantidad = qty;
      item.forzar = Math.min(item.forzar, qty);
      hits++;
    }
    parseMessage(text);
    renderItems();
    return hits;
  }

  async function ocrImage(file) {
    if (!window.Tesseract) throw new Error("No se pudo cargar el motor OCR. Revisá la conexión a internet.");
    setStatus("Leyendo captura… La primera vez puede tardar unos segundos.", true);
    const result = await Tesseract.recognize(file, "eng", {
      logger: (m) => {
        if (m.status === "recognizing text") setStatus(`Leyendo captura… ${Math.round((m.progress||0)*100)}%`, true);
      }
    });
    const text = result?.data?.text || "";
    const hits = parseOcrText(text);
    byId("jud-message").value = extractClosingLine(text) || byId("jud-message").value;
    if (byId("jud-message").value) parseMessage(byId("jud-message").value);
    setStatus(hits ? `OCR listo: ${hits} platos detectados. Revisá las cantidades antes de generar.` : "OCR listo. No pude reconocer filas de platos; podés corregirlas manualmente.", false);
  }

  function extractClosingLine(text) {
    return text.split(/\r?\n/).filter(l => /facturar/i.test(l)).join(" / ");
  }

  async function handleFiles(files) {
    if (ocrBusy) return;
    const imgs = [...files].filter(f => f.type.startsWith("image/"));
    if (!imgs.length) return;
    ocrBusy = true;
    try {
      for (const file of imgs) {
        addPreview(file);
        await ocrImage(file);
      }
    } catch (err) {
      setStatus(err.message || "No se pudo leer la captura.", false, true);
    } finally { ocrBusy = false; }
  }

  function addPreview(file) {
    const img = document.createElement("img");
    img.className = "jud-preview";
    img.alt = "Captura cargada";
    img.src = URL.createObjectURL(file);
    img.onload = () => URL.revokeObjectURL(img.src);
    byId("jud-previews").appendChild(img);
  }

  function setStatus(msg, visible=true, error=false) {
    const el = byId("jud-ocr-status");
    el.textContent = msg;
    el.classList.toggle("hidden", !visible && !msg);
    el.classList.toggle("warn", !!error);
    el.classList.toggle("info", !error);
  }

  function shuffle(a) {
    for (let i=a.length-1;i>0;i--) {
      const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
  }

  function generateSplit() {
    syncItemsFromTable();
    parseMessage(byId("jud-message").value);
    syncItemsFromTable();
    if (!validate()) return;
    const noTarget = +byId("jud-no-facturar").value;
    const noMap = new Map(), factMap = new Map();
    let assignedNo = 0;
    const pool = [];

    items.forEach((it, idx) => {
      const force = Math.min(it.forzar, it.cantidad);
      if (force) noMap.set(idx, force);
      assignedNo += force;
      for (let n=force;n<it.cantidad;n++) pool.push(idx);
    });
    if (assignedNo > noTarget || pool.length < noTarget-assignedNo) {
      byId("jud-validation").textContent = "No existe un reparto válido con las restricciones actuales.";
      byId("jud-validation").classList.add("error");
      return;
    }
    shuffle(pool);
    for (const idx of pool.slice(0,noTarget-assignedNo)) noMap.set(idx,(noMap.get(idx)||0)+1);
    items.forEach((it,idx) => {
      const no = noMap.get(idx)||0;
      const fact = it.cantidad-no;
      if (fact) factMap.set(idx,fact);
    });
    lastSplit = { noMap, factMap };
    renderSplit();
  }

  function renderSplit() {
    if (!lastSplit) return;
    const renderMap = (map) => [...map.entries()].filter(([,q])=>q>0).map(([idx,q]) =>
      `<div class="jud-result-row"><span>${escapeHtmlLocal(items[idx].nombre)}</span><strong>${q}</strong></div>`
    ).join("") || '<p class="muted">Sin ítems.</p>';
    byId("jud-res-fact").innerHTML = `<div class="jud-result-list">${renderMap(lastSplit.factMap)}</div>`;
    byId("jud-res-no").innerHTML = `<div class="jud-result-list">${renderMap(lastSplit.noMap)}</div>`;
    byId("jud-res-fact-total").textContent = [...lastSplit.factMap.values()].reduce((a,b)=>a+b,0);
    byId("jud-res-no-total").textContent = [...lastSplit.noMap.values()].reduce((a,b)=>a+b,0);
    byId("jud-results").classList.remove("hidden");
  }

  function splitText(which) {
    if (!lastSplit) return "";
    const map = which === "facturar" ? lastSplit.factMap : lastSplit.noMap;
    const total = [...map.values()].reduce((a,b)=>a+b,0);
    const title = which === "facturar" ? "FACTURAR" : "NO FACTURAR";
    return title+" — "+total+"\n"+[...map.entries()].filter(([,q])=>q>0).map(([idx,q])=>items[idx].nombre+": "+q).join("\n");
  }

  async function copySplit(which) {
    const text = splitText(which);
    if (!text) return;
    try { await navigator.clipboard.writeText(text); if (window.toast) toast("Copiado", "ok"); }
    catch (_) { window.prompt("Copiá el texto:", text); }
  }

  function resetAll() {
    items = BASE_NAMES.map(nombre => ({ nombre, cantidad:0, forzar:0 }));
    lastSplit = null;
    byId("jud-facturar").value = "";
    byId("jud-no-facturar").value = "";
    byId("jud-message").value = "";
    byId("jud-previews").innerHTML = "";
    byId("jud-results").classList.add("hidden");
    setStatus("", false);
    renderItems();
  }

  function escapeAttr(s) { return String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function escapeHtmlLocal(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  document.addEventListener("DOMContentLoaded", () => {
    if (!byId("jud-drop")) return;
    ensureBaseRows();
    loadCartaNames();

    byId("jud-drop").addEventListener("click", () => byId("jud-file").click());
    byId("jud-file").addEventListener("change", (e) => handleFiles(e.target.files));
    byId("jud-drop").addEventListener("dragover", (e) => { e.preventDefault(); byId("jud-drop").classList.add("dragover"); });
    byId("jud-drop").addEventListener("dragleave", () => byId("jud-drop").classList.remove("dragover"));
    byId("jud-drop").addEventListener("drop", (e) => { e.preventDefault(); byId("jud-drop").classList.remove("dragover"); handleFiles(e.dataTransfer.files); });

    document.addEventListener("paste", (e) => {
      const tabActive = document.querySelector('[data-tab="judiciales"]')?.classList.contains("active");
      if (!tabActive) return;
      const files = [...(e.clipboardData?.items || [])].filter(i => i.kind === "file" && i.type.startsWith("image/")).map(i=>i.getAsFile()).filter(Boolean);
      if (files.length) { e.preventDefault(); handleFiles(files); }
    });

    byId("jud-items").addEventListener("input", () => recalc());
    byId("jud-items").addEventListener("click", (e) => {
      const btn=e.target.closest(".jud-remove"); if (!btn) return;
      const tr=btn.closest("tr"); items.splice(+tr.dataset.i,1); renderItems();
    });
    byId("jud-add-row").addEventListener("click", () => { syncItemsFromTable(); items.push({nombre:"",cantidad:0,forzar:0}); renderItems(); });
    byId("jud-facturar").addEventListener("input", () => recalc("fact"));
    byId("jud-no-facturar").addEventListener("input", () => recalc("no"));
    byId("jud-message").addEventListener("change", () => parseMessage(byId("jud-message").value));
    byId("jud-generate").addEventListener("click", generateSplit);
    byId("jud-reroll").addEventListener("click", generateSplit);
    byId("jud-reset").addEventListener("click", resetAll);
    byId("jud-results").addEventListener("click", (e) => {
      const btn=e.target.closest("[data-copy]"); if (btn) copySplit(btn.dataset.copy);
    });
  });
})();
