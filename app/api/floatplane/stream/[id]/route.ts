import { NextResponse } from "next/server";
import {
  getFloatplaneStreamUrl,
  isFloatplaneConfigured,
} from "../../../../../lib/floatplane";

export const dynamic = "force-dynamic";

function rewriteM3u8(content: string, baseUrl: string) {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
          if (/^https?:\/\//i.test(uri)) return `URI="${uri}"`;
          return `URI="${new URL(uri, baseUrl).toString()}"`;
        });
      }
      if (/^https?:\/\//i.test(trimmed)) return line;
      return new URL(trimmed, baseUrl).toString();
    })
    .join("\n");
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!/^floatplane:[A-Za-z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: "Invalid Floatplane video" }, { status: 400 });
  }
  if (!isFloatplaneConfigured()) {
    return NextResponse.json(
      { error: "Floatplane is not configured" },
      { status: 404 }
    );
  }

  try {
    const stream = await getFloatplaneStreamUrl(id);
    const searchParams = new URL(request.url).searchParams;
    if (searchParams.get("redirect") === "1") {
      return NextResponse.redirect(stream.url, 307);
    }

    const upstream = await fetch(stream.url, {
      headers: {
        Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*",
        "User-Agent": request.headers.get("user-agent") || "YoutarrFeed/0.1.0",
      },
      cache: "no-store",
    });
    if (!upstream.ok) {
      throw new Error(`Floatplane manifest failed (${upstream.status})`);
    }

    const content = await upstream.text();
    return new Response(rewriteM3u8(content, stream.url), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Floatplane playback failed" },
      { status: 502 }
    );
  }
}
