import { NextResponse } from "next/server";
import { demoChannels, demoVideos } from "../../../lib/demo-data";
import { getFeed, isYoutarrConfigured } from "../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isYoutarrConfigured()) {
    return NextResponse.json({
      mode: "demo",
      videos: demoVideos,
      channels: demoChannels,
    });
  }

  try {
    const result = await getFeed();
    return NextResponse.json({ mode: "live", ...result });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Feed laden mislukte",
      },
      { status: 502 }
    );
  }
}
