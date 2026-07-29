import { NextResponse } from "next/server";
import { getDownloadActivity, isYoutarrConfigured } from "../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isYoutarrConfigured()) {
    return NextResponse.json({
      state: "idle",
      label: "Geen actieve download",
      percent: 0,
    });
  }

  try {
    return NextResponse.json(await getDownloadActivity());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Voortgang ophalen mislukte" },
      { status: 502 }
    );
  }
}
