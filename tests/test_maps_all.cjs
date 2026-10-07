const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../static/app.js'), 'utf8');
const section = source.slice(source.indexOf('$("mapa-pendientes-cerrar")'), source.indexOf('function esperandoHoraProgramada'));
const links = source.slice(source.indexOf('function googleMapsRouteLink('), source.indexOf('function openTicket('));

test('all deliveries are in primary Maps link, blocks are secondary and collapsed', () => {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { events: {}, classList: { add() {}, remove() {} }, addEventListener(e, f) { this.events[e] = f; } });
    return elements.get(id);
  };
  const pedidos = Array.from({length: 8}, (_, i) => ({tipo: 'Envío', cliente_direccion: `Calle ${i + 1} 100`}));
  pedidos.push({tipo:'Retira', cliente_direccion:'No incluir 100'});
  const context = { $, state: {pedidos}, _cfgCache:{direccion_local:'Local 100'}, direccionParaMaps:s=>s,
    esperandoHoraProgramada:()=>false, escapeHtml:s=>s, escapeAttr:s=>s, toast(){}, window:{} };
  vm.runInNewContext(links + section, context);
  $('btn-mapa-pendientes').events.click();
  const html = $('mapa-pendientes-contenido').innerHTML;
  assert.match(html, /Ver todos de una en Google Maps/);
  assert.match(html, /<details><summary/);
  assert.doesNotMatch(html, /<details open/);
  const href = html.match(/href="([^"]+)"/)[1];
  const params = new URL(href).searchParams;
  assert.equal(params.get('destination'), 'Calle 8 100');
  assert.equal(params.get('waypoints').split('|').length, 7);
  assert.equal(params.get('origin'), 'Local 100');
  assert.ok(html.indexOf('Ver todos de una') < html.indexOf('Ver por tramos'));
  assert.doesNotMatch(html, /No incluir/);
});
