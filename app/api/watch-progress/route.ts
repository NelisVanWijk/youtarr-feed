import { NextResponse } from "next/server";
import { importPlexWatchProgress, syncPlexWatchProgress } from "../../../lib/plex";
import {
  clearWatchProgress,
  readWatchProgress,
  replaceWatchProgress,
  updateWatchProgress,
} from "../../../lib/watch-progress";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    if (!refresh) {
      return NextResponse.json({ progress: await readWatchProgress() });
    }

    const [current, plexImport] = await Promise.all([
      readWatchProgress(),
      importPlexWatchProgress(),
    ]);
    const next = { ...current, ...plexImport.progress };
    plexImport.watchedVideoIds.forEach((videoId) => delete next[videoId]);

    return NextResponse.json({ progress: await replaceWatchProgress(next) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load watch progress" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    videoId?: string;
    currentTime?: number;
    duration?: number;
  };

  try {
    const progress = await updateWatchProgress(body);
    void syncPlexWatchProgress(body).catch(() => undefined);
    return NextResponse.json({
      progress,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save watch progress" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { videoId?: string };

  try {
    return NextResponse.json({
      progress: await clearWatchProgress(body.videoId || ""),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not clear watch progress" },
      { status: 400 }
    );
  }
}
