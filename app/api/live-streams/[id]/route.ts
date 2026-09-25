import { NextResponse } from "next/server";
import { getLivePlayback } from "../../../../lib/youtube-live";
import {
  fetchYouTubeMedia,
  rewriteYouTubeM3u8,
  youtubeMediaRequestHeaders,
} from "../../../../lib/youtube-live-proxy";

export const dynamic = "force-dynamic";

async function fetchManifest(request: Request, id: string, refresh = false) {
  const playback = await getLivePlayback(id, { refresh });
  if (playback.playbackMode !== "hls") {
    throw new Error("This live stream is using the YouTube player fallback");
  }
  const upstream = await fetchYouTubeMedia(
    playback.url,
    youtubeMediaRequestHeaders(request)
  );
  return { playback, ...upstream };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return NextResponse.json({ error: "Invalid live stream" }, { status: 400 });
  }

  try {
    let result = await fetchManifest(request, id);
    if (result.response.status === 401 || result.response.status === 403) {
      result = await fetchManifest(request, id, true);
    }
    if (!result.response.ok) {
      throw new Error(`YouTube live manifest failed (${result.response.status})`);
    }
    const content = await result.response.text();
    return new Response(
      rewriteYouTubeM3u8(content, result.finalUrl, request),
      {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "YouTube live playback failed",
      },
      { status: 502 }
    );
  }
}
