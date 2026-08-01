import { NextResponse } from "next/server";
import { getLocalMediaResponse } from "../../../../lib/local-media";
import {
  getStream,
  getYoutarrPlaybackTarget,
  getYoutarrVideoLocation,
} from "../../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return NextResponse.json({ error: "Invalid video" }, { status: 400 });
  }
  const range = request.headers.get("range");
  const searchParams = new URL(request.url).searchParams;
  const direct = searchParams.get("direct") !== "0";
  let expectedFilePath: string | null = null;
  const playbackTarget = getYoutarrPlaybackTarget(
    request.headers.get("user-agent")
  );

  try {
    if (direct) {
      const youtarrLocation = await getYoutarrVideoLocation(
        id,
        playbackTarget.profile
      ).catch(() => null);
      expectedFilePath = youtarrLocation?.filePath || null;
      const localResponse = await getLocalMediaResponse(
        id,
        range,
        request.headers.get("user-agent"),
        expectedFilePath,
        playbackTarget.media
      );
      if (localResponse) return localResponse;
    }

    if (!playbackTarget.configured) {
      return NextResponse.json(
        { error: "Playback is not available in demo mode" },
        { status: 404 }
      );
    }

    const upstream = await getStream(id, range, playbackTarget.profile);
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
      { error: error instanceof Error ? error.message : "Playback failed" },
      { status: 502 }
    );
  }
}
