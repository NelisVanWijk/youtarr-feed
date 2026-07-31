import { NextResponse } from "next/server";
import {
  addSingleVideo,
  readSingleVideos,
  removeSingleVideo,
} from "../../../lib/single-videos";
import { isYoutarrConfigured } from "../../../lib/youtarr";
import { clearWatchProgress } from "../../../lib/watch-progress";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({
      mode: isYoutarrConfigured() ? "live" : "demo",
      videos: await readSingleVideos(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Losse video's laden mislukte",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { url?: string };

  try {
    const video = await addSingleVideo(body.url || "");
    return NextResponse.json({
      mode: isYoutarrConfigured() ? "live" : "demo",
      video,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Losse video toevoegen mislukte",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: string };

  try {
    const videos = await removeSingleVideo(body.id || "");
    await clearWatchProgress(body.id || "");
    return NextResponse.json({
      mode: isYoutarrConfigured() ? "live" : "demo",
      videos,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Losse video verwijderen mislukte",
      },
      { status: 400 }
    );
  }
}
