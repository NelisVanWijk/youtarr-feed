import { NextResponse } from "next/server";
import { demoChannels, demoVideos } from "../../../lib/demo-data";
import { getDownloadedVideos, isYoutarrConfigured } from "../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isYoutarrConfigured()) {
    return NextResponse.json({
      mode: "demo",
      channels: demoChannels,
      videos: demoVideos.filter((video) => video.downloaded),
      warnings: [],
    });
  }

  try {
    const result = await getDownloadedVideos();
    return NextResponse.json({ mode: "live", ...result });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Lokale video's laden mislukte",
      },
      { status: 502 }
    );
  }
}
