import { NextResponse } from "next/server";
import {
  getFloatplaneFeed,
  isFloatplaneConfigured,
} from "../../../../lib/floatplane";
import { getCachedVideoList } from "../../../../lib/server-cache";

export const dynamic = "force-dynamic";

const defaultPageSize = 48;
const maxPageSize = 120;

function numberParam(
  searchParams: URLSearchParams,
  key: string,
  fallback: number
) {
  const value = Number(searchParams.get(key));
  if (!Number.isFinite(value)) return fallback;
  return Math.floor(value);
}

export async function GET(request: Request) {
  if (!(await isFloatplaneConfigured())) {
    return NextResponse.json({
      mode: "demo",
      videos: [],
      channels: [],
      warnings: ["Floatplane is not configured"],
      hasMore: false,
      nextOffset: null,
      totalVideos: 0,
    });
  }

  try {
    const searchParams = new URL(request.url).searchParams;
    const refresh = searchParams.get("refresh") === "1";
    const offset = Math.max(0, numberParam(searchParams, "offset", 0));
    const requestedLimit = searchParams.has("limit")
      ? numberParam(searchParams, "limit", defaultPageSize)
      : undefined;
    const limit =
      requestedLimit === undefined
        ? undefined
        : Math.max(1, Math.min(maxPageSize, requestedLimit));
    const result = await getCachedVideoList("floatplane-feed", getFloatplaneFeed, {
      refresh,
    });
    const videos = result.data.videos;
    const pageVideos =
      limit === undefined ? videos : videos.slice(offset, offset + limit);
    const nextOffset = offset + pageVideos.length;
    const hasMore = limit !== undefined && nextOffset < videos.length;

    return NextResponse.json(
      {
        mode: "live",
        ...result.data,
        videos: pageVideos,
        hasMore,
        nextOffset: hasMore ? nextOffset : null,
        totalVideos: videos.length,
      },
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
