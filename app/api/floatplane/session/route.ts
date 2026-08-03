import { NextResponse } from "next/server";
import {
  getFloatplaneDiagnostics,
  saveFloatplaneSessionToken,
} from "../../../../lib/floatplane";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      token?: string;
    };
    await saveFloatplaneSessionToken(body.token || "");
    const diagnostic = await getFloatplaneDiagnostics({ checkConnection: true });
    if (!diagnostic.connection.ok) {
      return NextResponse.json(
        {
          success: false,
          diagnostic,
          error: diagnostic.connection.message,
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true, diagnostic });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not save Floatplane session token",
      },
      { status: 400 }
    );
  }
}
