import { NextResponse } from "next/server";
import {
  PushDeliveryError,
  sendTestPushNotification,
} from "../../../../lib/notifications";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    subscription?: unknown;
  };
  try {
    return NextResponse.json({
      success: true,
      ...(await sendTestPushNotification(body.subscription)),
    });
  } catch (error) {
    if (error instanceof PushDeliveryError) {
      return NextResponse.json(
        {
          error: error.message,
          ...error.result,
        },
        { status: 502 }
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not send test notification",
      },
      { status: 502 }
    );
  }
}
