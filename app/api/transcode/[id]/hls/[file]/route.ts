import { NextResponse } from "next/server";
import { getTranscodeHlsResponse } from "../../../../../../lib/transcode";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; file: string }> }
) {
  const { id, file } = await context.params;
  const response = await getTranscodeHlsResponse(id, file);
  if (!response) {
    return NextResponse.json({ error: "Transcode not found" }, { status: 404 });
  }
  return response;
}
