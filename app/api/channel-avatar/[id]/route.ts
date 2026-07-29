import { getChannelAvatar, isYoutarrConfigured } from "../../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!isYoutarrConfigured() || !/^[A-Za-z0-9_-]{3,64}$/.test(id)) {
    return new Response(null, { status: 404 });
  }
  try {
    const upstream = await getChannelAvatar(id);
    if (!upstream.ok) return new Response(null, { status: 404 });
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
