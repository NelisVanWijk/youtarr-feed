import { createReadStream } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const mediaDirectory = process.env.YOUTARR_MEDIA_DIR?.trim() || "";
const allowedExtensions = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv"]);
const mimeTypes = new Map([
  [".mp4", "video/mp4"],
  [".m4v", "video/mp4"],
  [".mov", "video/quicktime"],
  [".webm", "video/webm"],
  [".mkv", "video/x-matroska"],
]);

function isValidVideoId(value: string) {
  return /^[A-Za-z0-9_-]{11}$/.test(value);
}

function isInsideMediaDirectory(filePath: string) {
  const relative = path.relative(mediaDirectory, filePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function findLocalVideoFile(videoId: string) {
  if (!mediaDirectory || !isValidVideoId(videoId)) return null;

  const stack = [mediaDirectory];
  while (stack.length > 0) {
    const directory = stack.pop();
    if (!directory) continue;

    let handle;
    try {
      handle = await opendir(directory);
      for await (const entry of handle) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
          continue;
        }
        if (!entry.isFile() || !entry.name.includes(videoId)) continue;

        const extension = path.extname(entry.name).toLowerCase();
        if (!allowedExtensions.has(extension)) continue;
        if (!isInsideMediaDirectory(entryPath)) continue;
        return entryPath;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function parseRange(range: string | null, fileSize: number) {
  if (!range) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return "invalid" as const;

  const [, startValue, endValue] = match;
  let start = startValue ? Number(startValue) : 0;
  let end = endValue ? Number(endValue) : fileSize - 1;

  if (!startValue && endValue) {
    const suffixLength = Number(endValue);
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    return "invalid" as const;
  }

  return { start, end: Math.min(end, fileSize - 1) };
}

export async function getLocalMediaResponse(videoId: string, range: string | null) {
  const filePath = await findLocalVideoFile(videoId);
  if (!filePath) return null;

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return null;
  }
  const fileSize = fileStat.size;
  const extension = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes.get(extension) || "application/octet-stream";
  const parsedRange = parseRange(range, fileSize);

  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Disposition": "inline",
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });

  if (parsedRange === "invalid") {
    headers.set("Content-Range", `bytes */${fileSize}`);
    return new Response(null, { status: 416, headers });
  }

  if (parsedRange) {
    const { start, end } = parsedRange;
    headers.set("Content-Length", String(end - start + 1));
    headers.set("Content-Range", `bytes ${start}-${end}/${fileSize}`);
    return new Response(
      Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream,
      { status: 206, headers }
    );
  }

  headers.set("Content-Length", String(fileSize));
  return new Response(
    Readable.toWeb(createReadStream(filePath)) as ReadableStream,
    { status: 200, headers }
  );
}
