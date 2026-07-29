import { NextResponse } from "next/server";
import {
  isPlexConfigured,
  refreshPlexLibrary,
} from "../../../../lib/plex";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!isPlexConfigured()) {
    return NextResponse.json({ skipped: true, configured: false });
  }

  try {
    await refreshPlexLibrary();
    return NextResponse.json({ success: true, configured: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Plex verversen mislukte",
      },
      { status: 502 }
    );
  }
}
