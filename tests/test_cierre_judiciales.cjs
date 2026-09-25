// UI regression checks without a build step or browser dependency.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function fixture() {
  const elements = new Map();
  class Element {
    constructor(id) {
      this.id = id;
      this._value = '';
      this._textContent = '';
      this.events = {};
      this.classList = { add() {}, remove() {}, toggle() {}, contains() { return true; } };
    }
    set value(v) { this._value = String(v); }
    get value() { return this._value; }
    set textContent(v) { this._textContent = String(v); }
    get textContent() { return this._textContent; }
    addEventListener(type, fn) { this.events[type] = fn; }
    fire(type) { return this.events[type]?.({ target: this, files: [] }); }
    set innerHTML(html) {
      this.html = html;
      if (this.id !== 'jud-items') return;
      this.rows = [...html.matchAll(/<tr data-i="(\d+)">([\s\S]*?)<\/tr>/g)].map(([, i, row]) => {
        const fields = [...row.matchAll(/<input class="([^"]+)"[^>]*value="([^"]*)"/g)];
        const inputs = Object.fromEntries(fields.map(([, cls, value]) => [cls, { value }]));
        return { dataset: { i }, querySelector(selector) { return inputs[selector.slice(1)]; } };
      });
    }
    get innerHTML() { return this.html || ''; }
    appendChild() {}
  }
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  const document = {
    getElementById: get,
    addEventListener(type, fn) { this.events[type] = fn; },
    events: {},
    querySelectorAll(selector) { assert.equal(selector, '#jud-items tr'); return get('jud-items').rows; },
    querySelector() { return get('jud-drop'); },
    createElement(tag) {
      if (tag === 'canvas') return { getContext() { return { fillRect() {}, drawImage() {} }; } };
      return new Element(tag);
    },
  };
  const context = { document, window: {}, console, Math, URL, navigator: { clipboard: { writeText: async () => {} } },
    fetch: async () => ({ ok: true, json: async () => [] }) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/cierre-judiciales.js'), 'utf8'), context);
  document.events.DOMContentLoaded();
  const row = name => get('jud-items').rows.find(r => r.querySelector('.jud-name').value === name);
  const setQty = (name, value) => { row(name).querySelector('.jud-qty').value = String(value); get('jud-items').fire('input'); };
  return { get, row, setQty, context };
}

test('separates Cobb constraints by pass and preserves manually edited values', () => {
  const { get, row, setQty } = fixture();
  setQty('Cobb', 3);
  setQty('Caesar', 15);
  get('jud-message').value = 'Facturar 10 (1 Cobb) No facturar 8 (2 Cobb)';
  get('jud-message').fire('change');
  assert.equal(row('Cobb').querySelector('.jud-force-fact').value, '1');
  assert.equal(row('Cobb').querySelector('.jud-force-no').value, '2');
  get('jud-generate').fire('click');
  assert.equal(get('jud-res-fact-total').textContent, '10');
  assert.equal(get('jud-res-no-total').textContent, '8');
  assert.match(get('jud-res-fact').innerHTML, /Cobb<\/span><strong>1<\/strong>/);
  assert.match(get('jud-res-no').innerHTML, /Cobb<\/span><strong>2<\/strong>/);
  row('Cobb').querySelector('.jud-force-fact').value = '0';
  row('Cobb').querySelector('.jud-force-no').value = '3';
  get('jud-items').fire('input');
  get('jud-reroll').fire('click');
  assert.equal(row('Cobb').querySelector('.jud-force-no').value, '3');
  assert.match(get('jud-res-no').innerHTML, /Cobb<\/span><strong>3<\/strong>/);
});

test('editing numeric fields does not erase them; invalid totals and impossible constraints block results', () => {
  const { get, row, setQty } = fixture();
  setQty('Cobb', 3);
  setQty('Caesar', 15);
  get('jud-facturar').value = '10';
  get('jud-facturar').fire('input');
  assert.equal(get('jud-no-facturar').value, '8');
  get('jud-generate').fire('click');
  assert.equal(get('jud-res-fact-total').textContent, '10');
  get('jud-no-facturar').value = '7';
  get('jud-no-facturar').fire('input');
  assert.equal(get('jud-no-facturar').value, '7');
  get('jud-generate').fire('click');
  assert.match(get('jud-validation').textContent, /debe dar 18/);
  get('jud-no-facturar').value = '8';
  row('Cobb').querySelector('.jud-force-fact').value = '2';
  row('Cobb').querySelector('.jud-force-no').value = '2';
  get('jud-items').fire('input');
  get('jud-generate').fire('click');
  assert.match(get('jud-validation').textContent, /sólo hay 3/);
});

test('reset clears all fields and a fresh message can be entered', () => {
  const { get, row, setQty } = fixture();
  setQty('Cobb', 3);
  get('jud-message').value = 'Facturar 1 (1 Cobb) No facturar 2 (2 Cobb)';
  get('jud-message').fire('change');
  get('jud-reset').fire('click');
  assert.equal(get('jud-facturar').value, '');
  assert.equal(row('Cobb').querySelector('.jud-force-no').value, '0');
  setQty('Cobb', 3);
  get('jud-message').value = 'Facturar 1 (1 Cobb) No facturar 2 (2 Cobb)';
  get('jud-message').fire('change');
  get('jud-generate').fire('click');
  assert.equal(get('jud-res-no-total').textContent, '2');
});

test('compound dish names stay separate from Brie and Atun', () => {
  const { get, row, setQty } = fixture();
  setQty('Brie', 1);
  setQty('Wrap Brie', 2);
  setQty('Atun', 1);
  setQty('Wrap Atun', 1);
  get('jud-message').value = 'Facturar 2 (1 Wrap Brie) No facturar 3 (1 Brie)';
  get('jud-message').fire('change');
  assert.equal(row('Wrap Brie').querySelector('.jud-force-fact').value, '1');
  assert.equal(row('Brie').querySelector('.jud-force-fact').value, '0');
  assert.equal(row('Brie').querySelector('.jud-force-no').value, '1');
  get('jud-generate').fire('click');
  assert.equal(get('jud-res-fact-total').textContent, '2');
  assert.equal(get('jud-res-no-total').textContent, '3');
});

test('OCR on the original sheet fills 27 dishes; a message image preserves the sheet total', async () => {
  const { get, row, context } = fixture();
  const texts = [
    `Caesar 11500 12500 3\nBrie 11500 12500 2\nClasica 11500 12500 4\nAtun 11500 12500 3\nPorto 11500 12500 1\nFalafel 11500 12500 1\nCala 11500 12500 5\nWrap Brie 11500 12500 6\nCobb 12500 13500 2\nJudiciales 27`,
    'Facturar 16\nNo facturar 11(2cobb)',
  ];
  context.window.createImageBitmap = context.createImageBitmap = async () => ({ width: 294, height: 595, close() {} });
  const modes = [];
  context.window.Tesseract = context.Tesseract = {
    PSM: { SINGLE_BLOCK: '6' },
    async createWorker() { return {
      async setParameters(params) { modes.push(params.tessedit_pageseg_mode); },
      async recognize() { return { data: { text: texts.shift() } }; },
      async terminate() {},
    }; },
  };
  const file = new Blob(['image'], { type: 'image/png' });
  const input = get('jud-file').events.change;
  input({ target: { files: [file] } });
  await new Promise(setImmediate);
  assert.equal(get('jud-total').textContent, '27');
  assert.equal(row('Cobb').querySelector('.jud-qty').value, '2');
  input({ target: { files: [file] } });
  await new Promise(setImmediate);
  assert.equal(get('jud-facturar').value, '16');
  assert.equal(get('jud-no-facturar').value, '11');
  get('jud-generate').fire('click');
  assert.match(get('jud-validation').textContent, /Cobb: pedís 0 en Facturar \+ 2 en No facturar, pero sólo hay 2|Total detectado: 27/);
  assert.equal(get('jud-res-fact-total').textContent, '16');
  assert.equal(get('jud-res-no-total').textContent, '11');
  assert.deepEqual(modes, ['6', '6']);
});
