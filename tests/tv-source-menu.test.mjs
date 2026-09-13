import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/tv/tv.js', import.meta.url), 'utf8');
test('source dialog keeps player controls visible while playback continues', () => {
  let scheduled = false, cleared = false;
  const nodes = { 'source-dialog': { open: true }, controls: { classList: { remove() {} } } };
  const context = vm.createContext({ $: id => nodes[id], video: { paused: false }, hideTimer: 1,
    clearTimeout() { cleared = true; }, setTimeout() { scheduled = true; } });
  vm.runInContext(source.slice(source.indexOf('  function showControls()'), source.indexOf('  function play()')), context);
  context.showControls(); assert.equal(cleared, true); assert.equal(scheduled, false);
  nodes['source-dialog'].open = false; context.showControls(); assert.equal(scheduled, true);
});

test('manual source selection preserves position, validates choice and does not reload the same source', () => {
  let loads = 0, closes = 0, saves = 0, pauses = 0;
  const nodes = { source: { value: 'primary' }, 'player-status': {} };
  const context = vm.createContext({ $: id => nodes[id], active: { provider: 'youtube' },
    playbackProfiles: [{ id: 'primary' }, { id: 'vp9' }], resumeAt: 0, attemptedProfiles: ['primary', 'vp9'],
    video: { currentTime: 123, pause() { pauses++; } }, save() { saves++; },
    closeSources() { closes++; }, startSource() { loads++; } });
  vm.runInContext(source.slice(source.indexOf('  function chooseSource('), source.indexOf("  $('source').onclick")), context);
  context.chooseSource('primary'); assert.equal(loads, 0); assert.equal(closes, 1);
  context.chooseSource('unknown'); assert.equal(loads, 0);
  context.chooseSource('vp9'); assert.equal(loads, 1); assert.equal(saves, 1); assert.equal(pauses, 1);
  assert.equal(context.resumeAt, 123); assert.equal(nodes.source.value, 'vp9'); assert.equal(context.attemptedProfiles.length, 0);
  context.active.provider = 'floatplane'; context.chooseSource('primary'); assert.equal(loads, 1);
});
