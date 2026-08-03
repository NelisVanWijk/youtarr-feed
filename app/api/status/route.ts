import { NextResponse } from "next/server";
import { getFloatplaneDiagnostics } from "../../../lib/floatplane";
import { getPlexDiagnostics, getPlexPublicConfig } from "../../../lib/plex";
import {
  getYoutarrDiagnostics,
  getYoutarrPublicConfig,
} from "../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const checkConnections = new URL(request.url).searchParams.get("check") === "1";
  const config = getYoutarrPublicConfig();
  const plex = getPlexPublicConfig();
  const [youtarrDiagnostics, plexDiagnostics, floatplaneDiagnostics] = await Promise.all([
    getYoutarrDiagnostics(),
    getPlexDiagnostics(),
    getFloatplaneDiagnostics({ checkConnection: checkConnections }),
  ]);
  return NextResponse.json({
    mode: config.configured ? "live" : "demo",
    connected: config.configured,
    message: config.configured ? "Connected to Youtarr" : "Demo mode",
    server: config.server,
    plexConfigured: plex.configured,
    plexServer: plex.server,
    diagnostics: {
      youtarr: youtarrDiagnostics,
      plex: plexDiagnostics,
      floatplane: floatplaneDiagnostics,
    },
  });
}
