import { NextResponse } from "next/server";
import { demoChannels } from "../../../lib/demo-data";
import { getChannels, isYoutarrConfigured } from "../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isYoutarrConfigured()) {
    return NextResponse.json({ mode: "demo", channels: demoChannels });
  }
  try {
    const channels = await getChannels();
    return NextResponse.json({ mode: "live", channels });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load channels" },
      { status: 502 }
    );
  }
}
