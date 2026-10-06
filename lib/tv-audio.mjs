import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';

const probes = new Map();
let runningProbes = 0;
let runningStreams = 0;
const videoCodecs = new Set(['h264', 'hevc', 'av1', 'vp9', 'vp8', 'mpeg2video', 'mpeg4']);

// Only our own existing media routes are accepted. Never pass request Host,
// arbitrary client URLs, credentials, or filesystem paths to FFmpeg.
export function audioSource(id, profile = 'primary') {
  if (!/^(?:[A-Za-z0-9_-]{11}|floatplane:[A-Za-z0-9_-]+)$/.test(id)) throw new Error('Invalid video');
  if (!['primary', 'av1', 'vp9'].includes(profile)) throw new Error('Invalid profile');
  const origin = new URL(process.env.TV_AUDIO_INTERNAL_ORIGIN || 'http://127.0.0.1:3000');
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('Invalid internal origin');
  const pathname = id.startsWith('floatplane:') ? '/api/floatplane/stream/' : '/api/stream/';
  const source = new URL(pathname + encodeURIComponent(id), origin);
  if (!id.startsWith('floatplane:')) source.searchParams.set('profile', profile);
  return source.href;
}

export function audioPlan(info) {
  const audio = info.streams?.find(stream => stream.codec_type === 'audio');
  const video = info.streams?.find(stream => stream.codec_type === 'video');
  const duration = Number(info.format?.duration || video?.duration || audio?.duration);
  const channels = Number(audio?.channels) || 0;
  const eligible = audio && videoCodecs.has(video?.codec_name) && channels >= 1 && channels <= 2
    && Number.isFinite(duration) && duration > 0 && !audio.codec_name?.startsWith('pcm_');
  return { mode: eligible ? 'pcm' : 'original', channels, duration: Number.isFinite(duration) ? duration : 0 };
}

const inputArgs = source => ['-rw_timeout', '15000000', '-protocol_whitelist', 'http,https,tcp,tls,crypto', '-i', source];

export function probeAudio(source) {
  const cached = probes.get(source);
  if (cached && cached.expires > Date.now()) return cached.promise;
  if (runningProbes >= 4) return Promise.reject(new Error('Audio inspection busy'));
  if (probes.size >= 100) probes.delete(probes.keys().next().value);
  const promise = new Promise((resolve, reject) => {
    runningProbes++;
    const child = spawn(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', ...inputArgs(source),
      '-show_entries', 'stream=codec_type,codec_name,channels,duration:format=duration', '-of', 'json'], { windowsHide: true });
    let output = '', done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true; clearTimeout(timer); runningProbes--; child.kill();
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Audio inspection timed out')), 20000);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 65536) finish(new Error('Invalid audio information'));
    });
    // Do not expose upstream addresses or signed URLs from FFmpeg diagnostics.
    child.stderr.resume();
    child.on('error', () => finish(new Error('Audio inspection unavailable')));
    child.on('close', code => {
      if (code !== 0) return finish(new Error('Audio inspection failed'));
      try { finish(null, audioPlan(JSON.parse(output))); }
      catch { finish(new Error('Invalid audio information')); }
    });
  });
  probes.set(source, { promise, expires: Date.now() + 120000 });
  promise.catch(() => { if (probes.get(source)?.promise === promise) probes.delete(source); });
  return promise;
}

export function pcmArguments(source, start) {
  return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', String(start), ...inputArgs(source),
    '-map', '0:v:0', '-map', '0:a:0', '-sn', '-dn', '-c:v', 'copy',
    '-c:a', 'pcm_s16le', '-ar', '48000', '-threads', '1',
    '-avoid_negative_ts', 'make_zero', '-f', 'matroska', 'pipe:1'];
}

export async function pcmResponse(source, start, signal) {
  const plan = await probeAudio(source);
  if (plan.mode !== 'pcm') return Response.json({ error: 'Use original audio for this video' }, { status: 409 });
  if (!Number.isFinite(start) || start < 0 || start >= plan.duration) return Response.json({ error: 'Invalid playback position' }, { status: 400 });
  if (signal?.aborted) return new Response(null, { status: 499 });
  if (runningStreams >= 3) return Response.json({ error: 'Audio conversion busy' }, { status: 503 });
  runningStreams++;
  const child = spawn(process.env.FFMPEG_PATH || 'ffmpeg', pcmArguments(source, start), { windowsHide: true });
  let released = false;
  const stop = () => {
    if (released) return;
    released = true; runningStreams--; clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    child.kill(); child.stdout.destroy();
  };
  const timer = setTimeout(stop, 8 * 60 * 60 * 1000);
  signal?.addEventListener('abort', stop, { once: true });
  child.stderr.resume();
  child.on('error', () => child.stdout.destroy(new Error('PCM playback unavailable')));
  child.on('exit', code => { if (code && !released) child.stdout.destroy(new Error('PCM playback failed')); });
  child.on('close', stop);
  child.stdout.on('close', stop);
  return new Response(Readable.toWeb(child.stdout), { headers: {
    'Content-Type': 'video/x-matroska', 'Cache-Control': 'no-store',
    'Accept-Ranges': 'none', 'X-Content-Type-Options': 'nosniff',
  } });
}
