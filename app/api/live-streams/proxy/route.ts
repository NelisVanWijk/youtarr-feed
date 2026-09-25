import { NextResponse } from "next/server";
import {
  fetchYouTubeMedia,
  isAllowedYouTubeMediaUrl,
  isHlsPlaylist,
  rewriteYouTubeM3u8,
  youtubeMediaRequestHeaders,
  youtubeMediaResponseHeaders,
} from "../../../../lib/youtube-live-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const targetUrl = new URL(request.url).searchParams.get("url") || "";
  if (!isAllowedYouTubeMediaUrl(targetUrl)) {
    return NextResponse.json(
      { error: "Invalid YouTube media URL" },
      { status: 400 }
    );
  }

  try {
    const { response: upstream, finalUrl } = await fetchYouTubeMedia(
      targetUrl,
      youtubeMediaRequestHeaders(request)
    );
    if (!upstream.ok && upstream.status !== 206) {
      throw new Error(`YouTube media request failed (${upstream.status})`);
    }
    if (isHlsPlaylist(upstream.headers.get("content-type"), finalUrl)) {
      const content = await upstream.text();
      return new Response(rewriteYouTubeM3u8(content, finalUrl, request), {
        status: upstream.status,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: youtubeMediaResponseHeaders(upstream),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "YouTube live proxy failed",
      },
      { status: 502 }
    );
  }
}
