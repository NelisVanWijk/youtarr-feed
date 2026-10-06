import { audioSource, probeAudio } from '../../../../../lib/tv-audio.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const profile = new URL(request.url).searchParams.get('profile') || 'primary';
    const plan = await probeAudio(audioSource(id, profile));
    return Response.json(plan, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // Old installations and unsupported media keep their working native route.
    return Response.json({ mode: 'original', channels: 0, duration: 0 }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
