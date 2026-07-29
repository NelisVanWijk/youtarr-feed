import { NextResponse } from "next/server";
import {
  clearWatchProgress,
  readWatchProgress,
  updateWatchProgress,
} from "../../../lib/watch-progress";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ progress: await readWatchProgress() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kijkvoortgang laden mislukte" },
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
    return NextResponse.json({
      progress: await updateWatchProgress(body),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kijkvoortgang opslaan mislukte" },
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
      { error: error instanceof Error ? error.message : "Kijkvoortgang wissen mislukte" },
      { status: 400 }
    );
  }
}
