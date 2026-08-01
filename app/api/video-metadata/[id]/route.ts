import { NextResponse } from "next/server";
import {
  getYoutarrVideoMetadata,
  isYoutarrConfigured,
} from "../../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return NextResponse.json({ error: "Invalid video" }, { status: 400 });
  }
  if (!isYoutarrConfigured()) {
    return NextResponse.json({ description: null });
  }

  try {
    const metadata = await getYoutarrVideoMetadata(id);
    return NextResponse.json({
      description: metadata.description || null,
      webpageUrl: metadata.webpageUrl || null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load metadata" },
      { status: 502 }
    );
  }
}
