import { NextResponse } from "next/server";
import { getPlexPublicConfig } from "../../../lib/plex";
import { getYoutarrPublicConfig } from "../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getYoutarrPublicConfig();
  const plex = getPlexPublicConfig();
  return NextResponse.json({
    mode: config.configured ? "live" : "demo",
    connected: config.configured,
    message: config.configured ? "Connected to Youtarr" : "Demo mode",
    server: config.server,
    plexConfigured: plex.configured,
    plexServer: plex.server,
  });
}
