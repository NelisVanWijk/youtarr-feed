import { audioSource, probeAudio } from '../../../../../lib/tv-audio.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const profile = new URL(request.url).searchParams.get('profile') || 'primary';
    // Floatplane is a remote MP4/HLS delivery. Keeping its native stream lets
    // webOS use Range/segment buffering; piping it through FFmpeg PCM causes
    // repeated stalls and can let video run ahead of its audio.
    if (id.startsWith('floatplane:')) {
      return Response.json({ mode: 'original', channels: 2, duration: 0 }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const plan = await probeAudio(audioSource(id, profile));
    return Response.json(plan, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // Old installations and unsupported media keep their working native route.
    return Response.json({ mode: 'original', channels: 0, duration: 0 }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
