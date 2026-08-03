import { NextResponse } from "next/server";
import {
  getFloatplaneStreamUrl,
  isFloatplaneConfigured,
} from "../../../../../../lib/floatplane";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!/^floatplane:[A-Za-z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: "Invalid Floatplane video" }, { status: 400 });
  }
  if (!isFloatplaneConfigured()) {
    return NextResponse.json(
      { error: "Floatplane is not configured" },
      { status: 404 }
    );
  }

  try {
    const stream = await getFloatplaneStreamUrl(id);
    return NextResponse.json({
      source: "floatplane",
      playbackLabel: "Floatplane",
      stream,
      youtarrConfigured: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Floatplane source failed" },
      { status: 502 }
    );
  }
}
