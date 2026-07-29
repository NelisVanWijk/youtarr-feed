import { NextResponse } from "next/server";
import { getStream, isYoutarrConfigured } from "../../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return NextResponse.json({ error: "Ongeldige video" }, { status: 400 });
  }
  if (!isYoutarrConfigured()) {
    return NextResponse.json(
      { error: "Afspelen is niet beschikbaar in de voorbeeldmodus" },
      { status: 404 }
    );
  }

  try {
    const upstream = await getStream(id, request.headers.get("range"));
    const headers = new Headers();
    [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "cache-control",
    ].forEach((name) => {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    });
    if (!headers.has("content-type")) {
      headers.set("Content-Type", "video/mp4");
    }
    headers.set("Content-Disposition", "inline");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "no-store");
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Afspelen mislukte" },
      { status: 502 }
    );
  }
}
