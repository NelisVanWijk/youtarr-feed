import { NextResponse } from "next/server";
import { invalidateVideoListCache } from "../../../lib/server-cache";
import { isYoutarrConfigured, queueDualQualityDownload } from "../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    missing?: boolean;
    channelId?: string;
  };
  if (!body.id || !/^[A-Za-z0-9_-]{11}$/.test(body.id)) {
    return NextResponse.json({ error: "Invalid video" }, { status: 400 });
  }

  if (!isYoutarrConfigured()) {
    return NextResponse.json({
      success: true,
      demo: true,
      message: "Demo download started",
    });
  }

  try {
    const result = await queueDualQualityDownload(body.id, {
      allowRedownload: body.missing === true,
      channelId: body.channelId,
    });
    await invalidateVideoListCache("feed", "local-videos");
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not start download",
      },
      { status: 502 }
    );
  }
}
