import { NextResponse } from "next/server";
import {
  addLiveStream,
  readLiveStreams,
  removeLiveStream,
} from "../../../lib/youtube-live";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ videos: await readLiveStreams() });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not load live streams",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { url?: string };
  try {
    return NextResponse.json({ video: await addLiveStream(body.url || "") });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not add live stream",
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: string };
  try {
    return NextResponse.json({ videos: await removeLiveStream(body.id || "") });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not remove live stream",
      },
      { status: 400 }
    );
  }
}
