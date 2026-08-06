import { NextResponse } from "next/server";
import { demoChannels, demoVideos } from "../../../lib/demo-data";
import { ensureFeedCacheWarmer } from "../../../lib/feed-cache-warmer";
import { getCachedVideoList } from "../../../lib/server-cache";
import {
  clearAllYoutarrVideoLocationCache,
  getFeed,
  isYoutarrConfigured,
} from "../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  ensureFeedCacheWarmer();
  if (!isYoutarrConfigured()) {
    return NextResponse.json({
      mode: "demo",
      videos: demoVideos,
      channels: demoChannels,
    });
  }

  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    if (refresh) {
      clearAllYoutarrVideoLocationCache();
    }
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
        error: error instanceof Error ? error.message : "Could not load feed",
      },
      { status: 502 }
    );
  }
}
