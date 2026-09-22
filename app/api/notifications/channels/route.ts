import { NextResponse } from "next/server";
import { setChannelNotificationMuted } from "../../../../lib/notifications";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    channelId?: unknown;
    channelName?: unknown;
    muted?: unknown;
  };
  try {
    const mutedChannels = await setChannelNotificationMuted(
      body.channelId,
      body.channelName,
      body.muted
    );
    return NextResponse.json({ success: true, mutedChannels });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not update channel notifications",
      },
      { status: 400 }
    );
  }
}
