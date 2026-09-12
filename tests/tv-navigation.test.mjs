import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/tv/tv.js', import.meta.url), 'utf8');
const moveSource = source.slice(source.indexOf('  function move(code)'), source.indexOf("  document.querySelectorAll('[data-tab]').forEach"));

function navigation() {
  const document = { activeElement: null };
  const nodes = Object.fromEntries(['library', 'navigation', 'channels', 'grid', 'search', 'controls', 'server-dialog', 'download-dialog', 'exit-dialog'].map(id => [id, { hidden: false, open: false }]));
  nodes.search.hidden = true;
  function button(id, rail) {
    return { id, offsetWidth: 60, closest: () => rail, focus() { document.activeElement = this; }, scrollIntoView() {}, getBoundingClientRect() { throw new Error('Rail navigation must not depend on geometry'); } };
  }
  const main = ['search', 'home', 'subscriptions', 'floatplane', 'refresh', 'server', 'exit'].map(id => button(id, nodes.navigation));
  const channels = ['all', 'creator', 'channel'].map(id => button(id, nodes.channels));
  const card = button('video', null);
  nodes.library.querySelectorAll = () => [...main, ...channels, card];
  nodes.navigation.querySelectorAll = () => main;
  nodes.navigation.querySelector = () => main[3];
  nodes.channels.querySelectorAll = () => channels;
  nodes.channels.querySelector = () => channels[1];
  nodes.grid.querySelector = () => card;
  const move = vm.runInNewContext(moveSource + '\nmove;', { document, $: id => nodes[id], active: null });
  return { document, main, channels, nodes, move };
}

test('Down reaches all utility buttons directly from Floatplane and Up returns', () => {
  const app = navigation(); app.main[3].focus();
  for (const id of ['refresh', 'server', 'exit']) { app.move(40); assert.equal(app.document.activeElement.id, id); }
  app.move(40); assert.equal(app.document.activeElement.id, 'exit');
  for (const id of ['server', 'refresh', 'floatplane']) { app.move(38); assert.equal(app.document.activeElement.id, id); }
});

test('channel rail stays vertical and Left returns to the selected main menu item', () => {
  const app = navigation(); app.channels[0].focus();
  app.move(38); assert.equal(app.document.activeElement.id, 'all');
  app.move(40); assert.equal(app.document.activeElement.id, 'creator');
  app.move(37); assert.equal(app.document.activeElement.id, 'floatplane');
  app.move(39); assert.equal(app.document.activeElement.id, 'creator');
});

test('Right enters videos when no channel rail is visible', () => {
  const app = navigation(); app.nodes.channels.hidden = true; app.main[1].focus();
  app.move(39); assert.equal(app.document.activeElement.id, 'video');
});
