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
  let lastParsedMessage = "";
  let expectedOcrTotal = null;

  const normalize = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim();
  const canonical = (name) => {
    const n = normalize(name);
    // Los nombres compuestos deben ganar sobre sus partes (Wrap Brie ≠ Brie).
    const matches = Object.entries(ALIASES).flatMap(([key, vals]) => vals
      .map(v => normalize(v))
      .filter(v => (` ${n} `).includes(` ${v} `))
      .map(v => ({ key, length: v.length })));
    matches.sort((a,b) => b.length - a.length);
    return matches[0]?.key || null;
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
    lastSplit = null;
    byId("jud-results").classList.add("hidden");
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
    const factRaw = byId("jud-facturar").value.trim();
    const noRaw = byId("jud-no-facturar").value.trim();
    const fact = factRaw === "" ? NaN : Number(factRaw);
    const nof = noRaw === "" ? NaN : Number(noRaw);
    const forcedFact = items.reduce((s,i)=>s+(i.facturarFijo||0),0);
    const forcedNo = items.reduce((s,i)=>s+(i.noFacturarFijo||0),0);
    const impossibleItem = items.find(i => (i.facturarFijo||0) + (i.noFacturarFijo||0) > i.cantidad);
    let msg = total ? `Total detectado: ${total}.` : "Pegá una captura o cargá las cantidades.";
    let error = false;
    if (!total && Number.isInteger(fact) && Number.isInteger(nof)) {
      msg = `Las pasadas suman ${fact + nof}, pero todavía no hay platos cargados. Pegá la planilla completa o ingresá las cantidades en la tabla.`; error = true;
    } else if (expectedOcrTotal !== null && total !== expectedOcrTotal) {
      msg = `La planilla indica ${expectedOcrTotal} platos, pero el OCR detectó ${total}. Corregí la tabla antes de generar.`; error = true;
    } else if ((factRaw !== "" && (!Number.isInteger(fact) || fact < 0)) ||
        (noRaw !== "" && (!Number.isInteger(nof) || nof < 0))) {
      msg = "Las cantidades de cada pasada deben ser números enteros no negativos."; error = true;
    } else if (Number.isFinite(fact) && Number.isFinite(nof) && fact + nof !== total) {
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
    return !error && total > 0 && Number.isInteger(fact) && Number.isInteger(nof);
  }

  function parseMessage(text) {
    if (!text.trim() || text === lastParsedMessage) return;
    // Cada paréntesis pertenece a su pasada, incluso cuando ambas aparecen en una línea.
    const blockRe = /(no\s*facturar|facturar)\s*[:\-]?\s*(\d+)\s*((?:\([^)]*\)\s*)*)/gi;
    const blocks = [...text.matchAll(blockRe)];
    if (!blocks.length) return;
    items.forEach(i => { i.facturarFijo = 0; i.noFacturarFijo = 0; });
    let block;
    for (block of blocks) {
      const bucket = /^no/i.test(block[1]) ? "noFacturarFijo" : "facturarFijo";
      byId(bucket === "facturarFijo" ? "jud-facturar" : "jud-no-facturar").value = +block[2];
      const parens = block[3].match(/\(([^)]+)\)/g) || [];
      for (const p of parens) {
        for (const entry of p.slice(1,-1).split(/[,;+]/)) {
          const m = entry.trim().match(/^(\d+)\s*(.+)$/);
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
    }
    lastParsedMessage = text;
    renderItems();
  }

  function parseOcrText(text) {
    const rawLines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    const summary = rawLines.find(l => /^\W*(?:judiciales|total)\s*[:\-]?\s*\d+\s*\W*$/i.test(l));
    if (summary) expectedOcrTotal = Number(summary.match(/\d+/)[0]);
    let hits = 0;
    for (const line of rawLines) {
      // El cierre menciona platos en los paréntesis, pero no es una fila de pedido.
      if (/\bfacturar\b/i.test(line)) continue;
      const key = canonical(line);
      if (!key) continue;
      const nums = line.match(/\d+/g);
      if (!nums?.length) continue;
      let qty = parseInt(nums[nums.length-1],10);
      if (qty > 200) continue;
      let item = items.find(i => canonical(i.nombre) === key);
      if (!item) {
        item = { nombre:displayName(key), cantidad:0, facturarFijo:0, noFacturarFijo:0 };
        items.push(item);
      }
      item.cantidad = qty;
      item.facturarFijo = Math.min(item.facturarFijo || 0, qty);
      item.noFacturarFijo = Math.min(item.noFacturarFijo || 0, qty);
      hits++;
    }
    renderItems();
    return hits;
  }

  async function ocrImage(file) {
    if (!window.Tesseract) throw new Error("No se pudo cargar el motor OCR. Revisá la conexión a internet.");
    setStatus("Leyendo captura… La primera vez puede tardar unos segundos.", true);
    let source = file;
    if (window.createImageBitmap) {
      const bitmap = await createImageBitmap(file);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width * 3;
        canvas.height = bitmap.height * 3;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        source = canvas;
      } finally { bitmap.close(); }
    }
    const worker = await Tesseract.createWorker("eng", 1, {
      logger: (m) => {
        if (m.status === "recognizing text") setStatus(`Leyendo captura… ${Math.round((m.progress||0)*100)}%`, true);
      }
    });
    let result;
    try {
      await worker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK });
      result = await worker.recognize(source);
    } finally { await worker.terminate(); }
    const text = result?.data?.text || "";
    const hits = parseOcrText(text);
    const cierre = extractClosingLine(text);
    if (cierre) {
      byId("jud-message").value = cierre;
      parseMessage(cierre);
    }
    setStatus(hits ? `OCR listo: ${hits} filas leídas, ${totalItems()} platos. Revisá las cantidades antes de generar.` : "OCR listo. No pude reconocer filas de platos; podés corregirlas manualmente.", true);
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
    // Si el mensaje cambió, leerlo una vez; conservar ajustes manuales posteriores.
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
    items = BASE_NAMES.map(nombre => ({ nombre, cantidad:0, facturarFijo:0, noFacturarFijo:0 }));
    lastSplit = null;
    lastParsedMessage = "";
    expectedOcrTotal = null;
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
    byId("jud-add-row").addEventListener("click", () => { syncItemsFromTable(); items.push({nombre:"",cantidad:0,facturarFijo:0,noFacturarFijo:0}); renderItems(); });
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
