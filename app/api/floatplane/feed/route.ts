import { NextResponse } from "next/server";
import {
  getFloatplaneFeed,
  isFloatplaneConfigured,
} from "../../../../lib/floatplane";
import { getCachedVideoList } from "../../../../lib/server-cache";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isFloatplaneConfigured())) {
    return NextResponse.json({
      mode: "demo",
      videos: [],
      channels: [],
      warnings: ["Floatplane is not configured"],
    });
  }

  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const result = await getCachedVideoList("floatplane-feed", getFloatplaneFeed, {
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
          error instanceof Error ? error.message : "Could not load Floatplane feed",
      },
      { status: 502 }
    );
  }
}
