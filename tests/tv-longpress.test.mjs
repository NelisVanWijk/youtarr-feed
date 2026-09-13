import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/tv/tv.js', import.meta.url), 'utf8');
const holdSource = source.slice(source.indexOf('  function cancelHold()'), source.indexOf('  function showVideoMenu(item)'));
function hold() {
  let timer, clicks = 0, menus = 0;
  const card = { isConnected: true, dataset: { id: 'video' }, click() { clicks++; } };
  const context = vm.createContext({
    heldCard: null, holdTimer: null, heldLong: false, suppressCardClick: false, menuBusy: false,
    videos: [{ id: 'video' }], fpVideos: [],
    setTimeout(callback) { timer = callback; return 1; }, clearTimeout() { timer = null; },
    showVideoMenu() { menus++; },
  });
  vm.runInContext(holdSource, context);
  return { card, context, expire() { timer?.(); }, get clicks() { return clicks; }, get menus() { return menus; } };
}
test('short OK plays once on release, long OK opens only the video menu', () => {
  const short = hold(); short.context.beginHold(short.card); short.context.releaseHold();
  assert.equal(short.clicks, 1); assert.equal(short.menus, 0);
  const long = hold(); long.context.beginHold(long.card); long.expire(); long.context.releaseHold();
  assert.equal(long.clicks, 0); assert.equal(long.menus, 1);
});
test('repeat OK does not restart the hold; cancellation never opens or plays', () => {
  const app = hold(); app.context.beginHold(app.card); app.context.beginHold(app.card); app.expire();
  assert.equal(app.menus, 1); app.context.releaseHold(); assert.equal(app.clicks, 0);
  const cancelled = hold(); cancelled.context.beginHold(cancelled.card); cancelled.context.cancelHold(); cancelled.expire(); cancelled.context.releaseHold();
  assert.equal(cancelled.clicks, 0); assert.equal(cancelled.menus, 0);
});
test('removed cards cannot open a stale video menu', () => {
  const app = hold(); app.context.beginHold(app.card); app.card.isConnected = false; app.expire(); app.context.releaseHold();
  assert.equal(app.clicks, 0); assert.equal(app.menus, 0);
});

const actionSource = source.slice(source.indexOf('  function menuAction('), source.indexOf('  function relativeDate('));
test('Floatplane deletion is guarded and YouTube deletion needs a second selection', () => {
  let requests = 0;
  const elements = { 'video-menu-status': {}, 'delete-video': {} };
  const context = vm.createContext({ menuVideo: { id: 'floatplane:abc', provider: 'floatplane' }, menuBusy: false, confirmDelete: false,
    $: id => elements[id], json() { requests++; }, saveQueue: Promise.resolve() });
  vm.runInContext(actionSource, context);
  context.menuAction(true); assert.equal(requests, 0); assert.equal(context.confirmDelete, false);
  context.menuVideo = { id: 'youtube-id', provider: 'youtube' };
  context.menuAction(true); assert.equal(requests, 0); assert.equal(context.confirmDelete, true);
  assert.match(elements['delete-video'].textContent, /definitief/);
});

test('watched menu actions use shared state for Floatplane as well as YouTube', async () => {
  for (const provider of ['floatplane', 'youtube']) {
    for (const state of [true, false]) {
      let request, closed = false;
      const item = { id: provider + '-video', provider, thumbnail: 'thumbnail', watched: !state };
      const elements = { 'video-menu-status': {}, 'video-menu': { open: false, querySelectorAll: () => [] } };
      const context = vm.createContext({ menuVideo: item, menuBusy: false, confirmDelete: false,
        videos: provider === 'youtube' ? [item] : [], fpVideos: provider === 'floatplane' ? [item] : [],
        progress: { [item.id]: { currentTime: 10, duration: 100 } }, watched: [], unwatched: [],
        $: id => elements[id], saveQueue: Promise.resolve(), closeVideoMenu() { closed = true; },
        json(path, options) { request = { path, method: options.method, body: JSON.parse(options.body) }; return Promise.resolve({ progress: {}, watchedVideoIds: state ? [item.id] : [], unwatchedVideoIds: state ? [] : [item.id] }); },
      });
      vm.runInContext(actionSource, context);
      await context.menuAction(false, state);
      assert.equal(request.path, '/api/watch-progress'); assert.equal(request.method, 'PUT');
      assert.equal(request.body.watched, state); assert.equal(item.watched, state);
      assert.equal(context.progress[item.id], undefined); assert.equal(closed, true);
      assert.equal((state ? context.watched : context.unwatched)[0], item.id);
    }
  }
});

test('completed thumbnails are fully red; unwatched overrides clear the full bar', () => {
  const context = vm.createContext({ watched: ['done'], unwatched: ['reset'], progress: { partial: { currentTime: 25, duration: 100 } } });
  vm.runInContext(source.slice(source.indexOf('  function isWatched('), source.indexOf('  function message(')), context);
  assert.equal(context.progressPercent({ id: 'done' }), 100);
  assert.equal(context.progressPercent({ id: 'upstream', watched: true }), 100);
  assert.equal(context.progressPercent({ id: 'reset', watched: true }), 0);
  assert.equal(context.progressPercent({ id: 'partial' }), 25);
  assert.equal(context.progressPercent({ id: 'new' }), 0);
});
