import { NextResponse } from "next/server";
import { demoChannels, demoVideos } from "../../../lib/demo-data";
import { ensureFeedCacheWarmer } from "../../../lib/feed-cache-warmer";
import { getCachedVideoList } from "../../../lib/server-cache";
import { getDownloadedVideos, isYoutarrConfigured } from "../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  ensureFeedCacheWarmer();
  if (!isYoutarrConfigured()) {
    return NextResponse.json({
      mode: "demo",
      channels: demoChannels,
      videos: demoVideos.filter((video) => video.downloaded),
      warnings: [],
    });
  }

  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const result = await getCachedVideoList("local-videos", getDownloadedVideos, {
      refresh,
    });
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
        error:
          error instanceof Error
            ? error.message
            : "Could not load local videos",
      },
      { status: 502 }
    );
  }
}
