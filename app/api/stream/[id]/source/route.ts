import { NextResponse } from "next/server";
import {
  type LocalMediaQuality,
  getLocalMediaStatus,
} from "../../../../../lib/local-media";
import { getTranscodeStatus } from "../../../../../lib/transcode";
import { isYoutarrConfigured } from "../../../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return NextResponse.json({ error: "Invalid video" }, { status: 400 });
  }

  const requestedQuality = new URL(request.url).searchParams.get("quality");
  const quality: LocalMediaQuality =
    requestedQuality === "original" || requestedQuality === "1080"
      ? requestedQuality
      : "auto";

  const [local, transcode] = await Promise.all([
    getLocalMediaStatus(id, request.headers.get("user-agent"), quality),
    getTranscodeStatus(id),
  ]);
  return NextResponse.json({
    source: local.available ? "local" : "youtarr",
    local,
    transcode,
    youtarrConfigured: isYoutarrConfigured(),
  });
}
