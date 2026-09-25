const allowedMediaHosts = [
  "googlevideo.com",
  "youtube.com",
  "youtube-nocookie.com",
  "googleusercontent.com",
  "gvt1.com",
];

export function isAllowedYouTubeMediaUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase();
    return allowedMediaHosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

function proxiedMediaUrl(request: Request, url: string) {
  const proxyUrl = new URL("/api/live-streams/proxy", request.url);
  proxyUrl.searchParams.set("url", url);
  return proxyUrl.toString();
}

export function rewriteYouTubeM3u8(
  content: string,
  baseUrl: string,
  request: Request
) {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
          const absoluteUrl = new URL(uri, baseUrl).toString();
          if (!isAllowedYouTubeMediaUrl(absoluteUrl)) return `URI="${uri}"`;
          return `URI="${proxiedMediaUrl(request, absoluteUrl)}"`;
        });
      }
      const absoluteUrl = new URL(trimmed, baseUrl).toString();
      return isAllowedYouTubeMediaUrl(absoluteUrl)
        ? proxiedMediaUrl(request, absoluteUrl)
        : line;
    })
    .join("\n");
}

export function isHlsPlaylist(contentType: string | null, url: string) {
  const normalized = (contentType || "").toLowerCase();
  return (
    normalized.includes("mpegurl") ||
    normalized.includes("vnd.apple") ||
    new URL(url).pathname.toLowerCase().endsWith(".m3u8")
  );
}

export async function fetchYouTubeMedia(
  targetUrl: string,
  headers: Record<string, string>,
  redirectsRemaining = 4
): Promise<{ response: Response; finalUrl: string }> {
  if (!isAllowedYouTubeMediaUrl(targetUrl)) {
    throw new Error("YouTube returned an unsupported media address");
  }
  const response = await fetch(targetUrl, {
    headers,
    cache: "no-store",
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location || redirectsRemaining <= 0) {
      throw new Error("YouTube media redirected too many times");
    }
    return fetchYouTubeMedia(
      new URL(location, targetUrl).toString(),
      headers,
      redirectsRemaining - 1
    );
  }
  return { response, finalUrl: targetUrl };
}

export function youtubeMediaRequestHeaders(request: Request) {
  const headers: Record<string, string> = {
    Accept: request.headers.get("accept") || "*/*",
    "User-Agent":
      request.headers.get("user-agent") ||
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
  };
  const range = request.headers.get("range");
  if (range) headers.Range = range;
  return headers;
}

export function youtubeMediaResponseHeaders(upstream: Response) {
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
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("X-Content-Type-Options", "nosniff");
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return headers;
}
