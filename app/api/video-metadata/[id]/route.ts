import { NextResponse } from "next/server";
import {
  getFloatplaneVideoMetadata,
  isFloatplaneConfigured,
} from "../../../../lib/floatplane";
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
  if (/^floatplane:[A-Za-z0-9_-]+$/.test(id)) {
    if (!(await isFloatplaneConfigured())) {
      return NextResponse.json({ description: null });
    }
    try {
      return NextResponse.json(await getFloatplaneVideoMetadata(id));
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not load Floatplane metadata",
        },
        { status: 502 }
      );
    }
  }

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
      likeCount:
        typeof metadata.likeCount === "number" && Number.isFinite(metadata.likeCount)
          ? metadata.likeCount
          : null,
      webpageUrl: metadata.webpageUrl || null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load metadata" },
      { status: 502 }
    );
  }
}
