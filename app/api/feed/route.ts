import { NextResponse } from "next/server";
import { demoChannels, demoVideos } from "../../../lib/demo-data";
import { getCachedVideoList } from "../../../lib/server-cache";
import { getFeed, isYoutarrConfigured } from "../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isYoutarrConfigured()) {
    return NextResponse.json({
      mode: "demo",
      videos: demoVideos,
      channels: demoChannels,
    });
  }

  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const result = await getCachedVideoList("feed", getFeed, { refresh });
    return NextResponse.json(
      { mode: "live", ...result.data },
      {
        headers: {
          "X-Youtarr-Feed-Cache": result.cache,
          ...(result.cachedAt
            ? { "X-Youtarr-Feed-Cached-At": String(result.cachedAt) }
            : {}),
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Feed laden mislukte",
      },
      { status: 502 }
    );
  }
}
