import { NextResponse } from "next/server";
import { getPlexDiagnostics, getPlexPublicConfig } from "../../../lib/plex";
import {
  getYoutarrDiagnostics,
  getYoutarrPublicConfig,
} from "../../../lib/youtarr";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getYoutarrPublicConfig();
  const plex = getPlexPublicConfig();
  const [youtarrDiagnostics, plexDiagnostics] = await Promise.all([
    getYoutarrDiagnostics(),
    getPlexDiagnostics(),
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
    },
  });
}
