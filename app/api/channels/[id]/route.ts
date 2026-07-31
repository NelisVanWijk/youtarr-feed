import { NextResponse } from "next/server";
import { demoChannels, demoVideos } from "../../../../lib/demo-data";
import {
  getVideosForChannel,
  isYoutarrConfigured,
} from "../../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const page = Math.max(
    1,
    Number(new URL(request.url).searchParams.get("page")) || 1
  );

  if (!isYoutarrConfigured()) {
    const channel = demoChannels.find((item) => item.id === id);
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    return NextResponse.json({
      mode: "demo",
      channel,
      videos: demoVideos.filter((video) => video.channelId === id),
    });
  }

  try {
    const result = await getVideosForChannel(id, page);
    return NextResponse.json({ mode: "live", ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load channel" },
      { status: 502 }
    );
  }
}
