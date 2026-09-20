import { NextResponse } from "next/server";
import { getPushPublicConfig } from "../../../../lib/notifications";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getPushPublicConfig());
  } catch (error) {
    return NextResponse.json(
      {
        enabled: false,
        publicKey: null,
        subscriberCount: 0,
        error:
          error instanceof Error
            ? error.message
            : "Could not load notification config",
      },
      { status: 502 }
    );
  }
}
