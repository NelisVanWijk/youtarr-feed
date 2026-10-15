import { NextResponse } from "next/server";
import {
  clearPushoverConfig,
  getPushoverConfig,
  savePushoverConfig,
  sendTestPushoverNotification,
} from "../../../../lib/pushover";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown, status: number) {
  return NextResponse.json(
    {
      error:
        error instanceof Error ? error.message : "Could not update Pushover",
    },
    { status }
  );
}

export async function GET() {
  try {
    return NextResponse.json(await getPushoverConfig());
  } catch (error) {
    return errorResponse(error, 502);
  }
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return NextResponse.json({
      success: true,
      config: await savePushoverConfig(body),
    });
  } catch (error) {
    return errorResponse(error, 400);
  }
}

export async function POST() {
  try {
    return NextResponse.json(await sendTestPushoverNotification());
  } catch (error) {
    return errorResponse(error, 502);
  }
}

export async function DELETE() {
  try {
    return NextResponse.json({
      success: true,
      config: await clearPushoverConfig(),
    });
  } catch (error) {
    return errorResponse(error, 502);
  }
}
