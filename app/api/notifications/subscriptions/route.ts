import { NextResponse } from "next/server";
import {
  removePushSubscription,
  savePushSubscription,
} from "../../../../lib/notifications";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    subscription?: unknown;
  };
  try {
    const subscriberCount = await savePushSubscription(
      body.subscription,
      request.headers.get("user-agent")
    );
    return NextResponse.json({ success: true, subscriberCount });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not save subscription",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    endpoint?: unknown;
  };
  try {
    const subscriberCount = await removePushSubscription(body.endpoint);
    return NextResponse.json({ success: true, subscriberCount });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not remove subscription",
      },
      { status: 400 }
    );
  }
}
