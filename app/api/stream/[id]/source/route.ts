import { NextResponse } from "next/server";
import { getLocalMediaStatus } from "../../../../../lib/local-media";
import { isYoutarrConfigured } from "../../../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return NextResponse.json({ error: "Invalid video" }, { status: 400 });
  }

  const local = await getLocalMediaStatus(id, request.headers.get("user-agent"));
  return NextResponse.json({
    source: local.available ? "local" : "youtarr",
    local,
    youtarrConfigured: isYoutarrConfigured(),
  });
}
