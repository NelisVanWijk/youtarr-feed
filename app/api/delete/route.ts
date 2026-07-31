import { NextResponse } from "next/server";
import { deleteLocalMediaFiles } from "../../../lib/local-media";
import { invalidateVideoListCache } from "../../../lib/server-cache";
import { deleteTranscode } from "../../../lib/transcode";
import { deleteDownload, isYoutarrConfigured } from "../../../lib/youtarr";
import { clearWatchProgress } from "../../../lib/watch-progress";

export const dynamic = "force-dynamic";

const deleteLocalFiles = process.env.YOUTARR_FEED_DELETE_LOCAL_FILES === "true";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: string };
  if (!body.id || !/^[A-Za-z0-9_-]{11}$/.test(body.id)) {
    return NextResponse.json({ error: "Invalid video" }, { status: 400 });
  }

  if (!isYoutarrConfigured()) {
    await clearWatchProgress(body.id);
    await deleteTranscode(body.id);
    return NextResponse.json({ success: true, demo: true });
  }

  try {
    const result = await deleteDownload(body.id);
    const localDeleteResult = deleteLocalFiles
      ? await deleteLocalMediaFiles(body.id)
      : undefined;
    await clearWatchProgress(body.id);
    await deleteTranscode(body.id);
    await invalidateVideoListCache("feed", "local-videos");
    return NextResponse.json({ success: true, ...result, localDelete: localDeleteResult });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete download" },
      { status: 502 }
    );
  }
}
