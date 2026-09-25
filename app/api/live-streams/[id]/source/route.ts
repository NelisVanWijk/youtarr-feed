import { NextResponse } from "next/server";
import { getLivePlayback } from "../../../../../lib/youtube-live";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return NextResponse.json({ error: "Invalid live stream" }, { status: 400 });
  }
  try {
    const stream = await getLivePlayback(id);
    return NextResponse.json({
      source: "live",
      playbackLabel: stream.label,
      stream,
      youtarrConfigured: true,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "YouTube live source failed",
      },
      { status: 502 }
    );
  }
}
