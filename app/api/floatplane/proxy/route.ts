import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function isAllowedFloatplaneUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "floatplane.com" || url.hostname.endsWith(".floatplane.com"))
    );
  } catch {
    return false;
  }
}

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

function isPlaylist(contentType: string | null, url: string) {
  const normalized = (contentType || "").toLowerCase();
  return (
    normalized.includes("mpegurl") ||
    normalized.includes("vnd.apple") ||
    new URL(url).pathname.toLowerCase().endsWith(".m3u8")
  );
}

export async function GET(request: Request) {
  const targetUrl = new URL(request.url).searchParams.get("url") || "";
  if (!isAllowedFloatplaneUrl(targetUrl)) {
    return NextResponse.json({ error: "Invalid Floatplane media URL" }, { status: 400 });
  }

  try {
    const headers: Record<string, string> = {
      Accept: request.headers.get("accept") || "*/*",
      "User-Agent": request.headers.get("user-agent") || "YoutarrFeed/0.1.0",
    };
    const range = request.headers.get("range");
    if (range) headers.Range = range;

    const upstream = await fetch(targetUrl, {
      headers,
      cache: "no-store",
    });

    if (!upstream.ok && upstream.status !== 206) {
      throw new Error(`Floatplane media request failed (${upstream.status})`);
    }

    const contentType = upstream.headers.get("content-type");
    if (isPlaylist(contentType, targetUrl)) {
      const content = await upstream.text();
      return new Response(rewriteM3u8(content, targetUrl, request), {
        status: upstream.status,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          "X-Content-Type-Options": "nosniff",
        },
      });
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
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    if (!responseHeaders.has("Cache-Control")) {
      responseHeaders.set("Cache-Control", "no-store");
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Floatplane proxy failed" },
      { status: 502 }
    );
  }
}
