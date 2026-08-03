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
  if (!(await isFloatplaneConfigured())) {
    return NextResponse.json(
      { error: "Floatplane is not configured" },
      { status: 404 }
    );
  }

  try {
    let stream = await getFloatplaneStreamUrl(id);
    const searchParams = new URL(request.url).searchParams;
    if (
      searchParams.get("redirect") === "1" ||
      searchParams.get("direct") === "1"
    ) {
      return NextResponse.redirect(stream.url, 307);
    }

    if (stream.playbackMode !== "hls") {
      const requestHeaders: Record<string, string> = {
        Accept: request.headers.get("accept") || "*/*",
        "User-Agent": request.headers.get("user-agent") || "YoutarrFeed/0.1.0",
      };
      const range = request.headers.get("range");
      if (range) requestHeaders.Range = range;

      let upstream = await fetch(stream.url, {
        headers: requestHeaders,
        cache: "no-store",
      });
      if (upstream.status === 401 || upstream.status === 403) {
        stream = await getFloatplaneStreamUrl(id, { refresh: true });
        upstream = await fetch(stream.url, {
          headers: requestHeaders,
          cache: "no-store",
        });
      }
      if (!upstream.ok && upstream.status !== 206) {
        throw new Error(`Floatplane MP4 stream failed (${upstream.status})`);
      }

      const responseHeaders = new Headers();
      [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "cache-control",
      ].forEach((name) => {
        const value = upstream.headers.get(name);
        if (value) responseHeaders.set(name, value);
      });
      if (!responseHeaders.has("content-type")) {
        responseHeaders.set("Content-Type", stream.mimeType || "video/mp4");
      }
      responseHeaders.set("Content-Disposition", "inline");
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("X-Content-Type-Options", "nosniff");
      if (!responseHeaders.has("Cache-Control")) {
        responseHeaders.set("Cache-Control", "no-store");
      }

      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });
    }

    let upstream = await fetch(stream.url, {
      headers: {
        Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*",
        "User-Agent": request.headers.get("user-agent") || "YoutarrFeed/0.1.0",
      },
      cache: "no-store",
    });
    if (upstream.status === 401 || upstream.status === 403) {
      stream = await getFloatplaneStreamUrl(id, { refresh: true });
      upstream = await fetch(stream.url, {
        headers: {
          Accept: "application/vnd.apple.mpegurl, application/x-mpegURL, */*",
          "User-Agent": request.headers.get("user-agent") || "YoutarrFeed/0.1.0",
        },
        cache: "no-store",
      });
    }
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
