import { audioSource, pcmResponse } from '../../../../../../lib/tv-audio.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const query = new URL(request.url).searchParams;
    return await pcmResponse(audioSource(id, query.get('profile') || 'primary'), Number(query.get('start') || 0), request.signal);
  } catch {
    return Response.json({ error: 'PCM playback unavailable' }, { status: 502 });
  }
}
