import { NextResponse } from "next/server";
import { getLocalMediaStatus } from "../../../../../lib/local-media";
import { isYoutarrConfigured } from "../../../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return NextResponse.json({ error: "Ongeldige video" }, { status: 400 });
  }

  const local = await getLocalMediaStatus(id);
  return NextResponse.json({
    source: local.available ? "local" : "youtarr",
    local,
    youtarrConfigured: isYoutarrConfigured(),
  });
}
