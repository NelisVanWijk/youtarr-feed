import { NextResponse } from "next/server";
import { invalidateVideoListCache } from "../../../../lib/server-cache";
import { addChannel, isYoutarrConfigured } from "../../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { url?: string };
  const url = body.url?.trim() || "";
  if (!url) {
    return NextResponse.json({ error: "Channel URL is required" }, { status: 400 });
  }

  if (!isYoutarrConfigured()) {
    return NextResponse.json(
      { error: "Adding channels requires a connected Youtarr instance" },
      { status: 400 }
    );
  }

  try {
    const channel = await addChannel(url);
    await invalidateVideoListCache("feed", "local-videos");
    return NextResponse.json({ success: true, channel });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not add channel" },
      { status: 502 }
    );
  }
}
