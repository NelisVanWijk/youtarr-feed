import { getChannels, isYoutarrConfigured } from "../../../../lib/youtarr";

export const dynamic = "force-dynamic";

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function channelUrl(channelId: string, url: string) {
  const normalized = url.trim();
  if (normalized) return normalized;
  return `https://www.youtube.com/channel/${channelId}`;
}

export async function GET() {
  if (!isYoutarrConfigured()) {
    return Response.json(
      { error: "Exporting channels requires a connected Youtarr instance" },
      { status: 400 }
    );
  }

  try {
    const channels = await getChannels();
    const rows = [
      ["Channel Id", "Channel Url", "Channel Title"],
      ...channels.map((channel) => [
        channel.id,
        channelUrl(channel.id, channel.url),
        channel.name,
      ]),
    ];
    const csv = `${rows
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")}\r\n`;

    return new Response(csv, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="youtarr-subscriptions.csv"',
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not export channels",
      },
      { status: 502 }
    );
  }
}
