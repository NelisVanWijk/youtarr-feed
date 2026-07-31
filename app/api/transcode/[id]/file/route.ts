import { NextResponse } from "next/server";
import { getTranscodeMediaResponse } from "../../../../../lib/transcode";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return NextResponse.json({ error: "Invalid video" }, { status: 400 });
  }

  const response = await getTranscodeMediaResponse(
    id,
    request.headers.get("range")
  );
  if (!response) {
    return NextResponse.json(
      { error: "Compatible file not found" },
      { status: 404 }
    );
  }
  return response;
}
