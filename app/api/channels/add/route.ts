import { NextResponse } from "next/server";
import { addChannel, isYoutarrConfigured } from "../../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { url?: string };
  const url = body.url?.trim() || "";
  if (!url) {
    return NextResponse.json({ error: "Kanaal-URL ontbreekt" }, { status: 400 });
  }

  if (!isYoutarrConfigured()) {
    return NextResponse.json(
      { error: "Kanaal toevoegen werkt pas wanneer Youtarr gekoppeld is" },
      { status: 400 }
    );
  }

  try {
    const channel = await addChannel(url);
    return NextResponse.json({ success: true, channel });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kanaal toevoegen mislukte" },
      { status: 502 }
    );
  }
}
