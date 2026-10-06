import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { audioSource, audioPlan, pcmArguments } from '../lib/tv-audio.mjs';

test('PCM eligibility preserves surround, unknown layouts, live media and unsupported codecs', () => {
  function media(channels, video = 'av1', duration = '900', codec = 'aac') {
    return { streams: [{ codec_type: 'video', codec_name: video }, { codec_type: 'audio', codec_name: codec, channels }], format: { duration } };
  }
  assert.equal(audioPlan(media(2)).mode, 'pcm');
  assert.equal(audioPlan(media(1)).mode, 'pcm');
  for (const channels of [0, undefined, 6, 8]) assert.equal(audioPlan(media(channels)).mode, 'original');
  assert.equal(audioPlan(media(2, 'unknown')).mode, 'original');
  assert.equal(audioPlan(media(2, 'av1', 'N/A')).mode, 'original');
  assert.equal(audioPlan(media(2, 'av1', '900', 'pcm_s16le')).mode, 'original');
});

test('media source validation cannot select arbitrary URLs, paths or FFmpeg options', () => {
  const old = process.env.TV_AUDIO_INTERNAL_ORIGIN;
  delete process.env.TV_AUDIO_INTERNAL_ORIGIN;
  try {
    assert.equal(audioSource('123456789ab', 'vp9'), 'http://127.0.0.1:3000/api/stream/123456789ab?profile=vp9');
    assert.equal(audioSource('floatplane:abc'), 'http://127.0.0.1:3000/api/floatplane/stream/floatplane%3Aabc');
    for (const id of ['http://example.com', '../secret', '-i', 'floatplane:../abc']) assert.throws(() => audioSource(id));
    assert.throws(() => audioSource('123456789ab', '-i'));
    const args = pcmArguments(audioSource('123456789ab'), 42);
    assert.equal(args[args.indexOf('-c:v') + 1], 'copy');
    assert.equal(args[args.indexOf('-c:a') + 1], 'pcm_s16le');
    assert.equal(args[args.indexOf('-ss') + 1], '42');
    assert.equal(args[args.indexOf('-max_interleave_delta') + 1], '0');
    assert.equal(args[args.indexOf('-cluster_time_limit') + 1], '1000');
    assert.equal(args[args.indexOf('-reconnect_streamed') + 1], '1');
    assert.equal(args.includes('-ac'), false);
    assert.equal(args.includes('-vf'), false);
  } finally { if (old === undefined) delete process.env.TV_AUDIO_INTERNAL_ORIGIN; else process.env.TV_AUDIO_INTERNAL_ORIGIN = old; }
});

const source = readFileSync(new URL('../public/tv/audio.js', import.meta.url), 'utf8');
function adapter(fetcher, userAgent = 'Web0S') {
  const timers = new Set(), stored = new Map();
  const video = { src: '', currentTime: 0, duration: 100, paused: false, pause() { this.paused = true; }, load() { this.currentTime = 0; }, removeAttribute() { this.src = ''; } };
  const context = vm.createContext({ window: {}, navigator: { userAgent }, AbortController, fetch: fetcher,
    localStorage: { getItem(k) { return stored.get(k); }, setItem(k,v) { stored.set(k,v); } },
    setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); } });
  vm.runInContext(source, context);
  const instance = new context.window.MyTubeAudio(video, () => { video.paused = false; }, () => {}, () => {});
  return { instance, video, timers, stored };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const pcm = async () => ({ ok: true, json: async () => ({ mode: 'pcm', channels: 2, duration: 200 }) });

test('resumed PCM and repeated seeks preserve the full timeline, including paused seeking', async () => {
  const { instance: a, video } = adapter(pcm);
  a.start('/original', '123456789ab', 'primary', 40);
  await tick(); assert.match(video.src, /start=40$/);
  a.metadata(); a.playing(); video.currentTime = 12;
  assert.equal(a.position(), 52); assert.equal(a.length(), 200);
  a.seek(62); a.seek(a.position() + 10); await tick();
  assert.match(video.src, /start=72$/); a.metadata(); a.playing();
  video.paused = true; a.seek(82); await tick(); a.metadata();
  assert.equal(a.position(), 82); assert.equal(video.paused, true);
});

test('closing or switching a video ignores stale asynchronous inspection', async () => {
  let resolve;
  const { instance: a, video } = adapter(() => new Promise(r => { resolve = r; }));
  a.start('/old', '123456789ab', 'primary', 0); a.stop();
  resolve(await pcm()); await tick(); assert.equal(video.src, '');
});

test('surround media, disabled PCM and failed PCM use original audio with the correct resume position', async () => {
  const surround = adapter(async () => ({ok:true,json:async()=>({mode:'original',channels:6,duration:200})}));
  surround.instance.start('/surround', '123456789ab', 'primary', 20); await tick();
  assert.equal(surround.video.src, '/surround'); surround.instance.metadata(); assert.equal(surround.video.currentTime, 20);
  const { instance: a, video, stored } = adapter(pcm);
  a.start('/original', '123456789ab', 'primary', 40); await tick(); a.metadata(); video.currentTime = 15;
  assert.equal(a.fallback(), true); assert.equal(video.src, '/original'); a.metadata();
  assert.equal(video.currentTime, 55); assert.equal(a.fallback(), false);
  a.toggle(); assert.equal(stored.get('mytube-tv-audio'), 'original'); assert.equal(video.src, '/original');
  const desktop = adapter(() => { throw new Error('Should not probe'); }, 'Chrome');
  desktop.instance.start('/original', '123456789ab', 'primary', 0); assert.equal(desktop.video.src, '/original');
});

test('inspection failure and startup timeout restore native playback without leaving stale requests active', async () => {
  const failed = adapter(async () => { throw new Error('Unavailable'); });
  failed.instance.start('/original', '123456789ab', 'primary', 30); await tick();
  assert.equal(failed.video.src, '/original'); assert.equal(failed.instance.failed, true);
  let resolve;
  const { instance: a, video, timers } = adapter(() => new Promise(r => { resolve = r; }));
  a.start('/original', '123456789ab', 'primary', 40);
  [...timers][0](); assert.equal(video.src, '/original');
  resolve(await pcm()); await tick(); assert.equal(video.src, '/original');
});

test('loading and a transient PCM end keep the last position and recover without completing playback', async () => {
  const { instance: a, video } = adapter(pcm);
  a.start('/original', '123456789ab', 'primary', 40); await tick(); a.metadata(); a.playing();
  video.currentTime = 12; assert.equal(a.snapshot().currentTime, 52);
  assert.equal(a.recover(), true); assert.equal(a.position(), 52); await tick();
  assert.match(video.src, /start=52$/); a.metadata(); a.playing();
  assert.equal(a.isComplete(), false);
});
