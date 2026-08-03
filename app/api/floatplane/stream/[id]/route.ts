import { NextResponse } from "next/server";
import {
  getFloatplaneStreamUrl,
  isFloatplaneConfigured,
} from "../../../../../lib/floatplane";

export const dynamic = "force-dynamic";

function proxiedMediaUrl(request: Request, url: string) {
  const proxyUrl = new URL("/api/floatplane/proxy", request.url);
  proxyUrl.searchParams.set("url", url);
  return proxyUrl.toString();
}

function rewriteM3u8(content: string, baseUrl: string, request: Request) {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
          const absoluteUrl = /^https?:\/\//i.test(uri)
            ? uri
            : new URL(uri, baseUrl).toString();
          return `URI="${proxiedMediaUrl(request, absoluteUrl)}"`;
        });
      }
      const absoluteUrl = /^https?:\/\//i.test(trimmed)
        ? trimmed
        : new URL(trimmed, baseUrl).toString();
      return proxiedMediaUrl(request, absoluteUrl);
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
    return new Response(rewriteM3u8(content, stream.url, request), {
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
