import { NextResponse } from "next/server";
import {
  importPlexWatchProgress,
  setPlexWatchedState,
  syncPlexWatchProgress,
} from "../../../lib/plex";
import {
  clearWatchProgress,
  readWatchProgress,
  readWatchedVideoIds,
  readUnwatchedVideoIds,
  replaceWatchProgress,
  setVideoWatchedState,
  updateWatchProgress,
} from "../../../lib/watch-progress";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    if (!refresh) {
      const [progress, watchedVideoIds, unwatchedVideoIds] = await Promise.all([
        readWatchProgress(),
        readWatchedVideoIds(),
        readUnwatchedVideoIds(),
      ]);
      return NextResponse.json({ progress, watchedVideoIds, unwatchedVideoIds });
    }

    const [current, currentWatched, currentUnwatched, plexImport] = await Promise.all([
      readWatchProgress(),
      readWatchedVideoIds(),
      readUnwatchedVideoIds(),
      importPlexWatchProgress(),
    ]);
    const next = { ...current, ...plexImport.progress };
    const watchedVideoIds = [
      ...new Set([...currentWatched, ...plexImport.watchedVideoIds]),
    ];
    watchedVideoIds.forEach((videoId) => delete next[videoId]);

    return NextResponse.json(
      await replaceWatchProgress(next, watchedVideoIds, currentUnwatched)
    );
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
    thumbnail?: string | null;
  };

  try {
    const result = await updateWatchProgress(body);
    void syncPlexWatchProgress(body).catch(() => undefined);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save watch progress" },
      { status: 400 }
    );
  }
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    videoId?: string;
    watched?: boolean;
    thumbnail?: string | null;
  };

  try {
    const result = await setVideoWatchedState(body.videoId || "", body.watched === true);
    void setPlexWatchedState(body).catch(() => undefined);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update watched state" },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { videoId?: string };

  try {
    return NextResponse.json(await clearWatchProgress(body.videoId || ""));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not clear watch progress" },
      { status: 400 }
    );
  }
}
