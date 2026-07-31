import { NextResponse } from "next/server";
import {
  deleteTranscode,
  getAppleTranscodeDecision,
  getTranscodeStatus,
  startTranscode,
} from "../../../../lib/transcode";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return NextResponse.json({ error: "Invalid video" }, { status: 400 });
  }

  const userAgent = request.headers.get("user-agent");
  const [status, appleDecision] = await Promise.all([
    getTranscodeStatus(id),
    getAppleTranscodeDecision(id, userAgent),
  ]);
  return NextResponse.json({ ...status, appleDecision });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return NextResponse.json({ error: "Invalid video" }, { status: 400 });
  }

  let startTime = 0;
  try {
    const body = (await request.json()) as { startTime?: number };
    startTime = Number(body.startTime) || 0;
  } catch {
    startTime = 0;
  }

  const status = await startTranscode(id, startTime);
  return NextResponse.json(status, {
    status: status.error && !status.running && !status.ready ? 409 : 202,
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
    return NextResponse.json({ error: "Invalid video" }, { status: 400 });
  }

  await deleteTranscode(id);
  return NextResponse.json({ ok: true });
}
