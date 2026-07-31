import { createReadStream } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const mediaDirectory = process.env.YOUTARR_MEDIA_DIR?.trim() || "";
const sourceMediaDirectory =
  process.env.YOUTARR_SOURCE_MEDIA_DIR?.trim() || "/usr/src/app/data";
const allowedExtensions = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv"]);
const appleFriendlyExtensions = new Set([".mp4", ".m4v", ".mov"]);
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

export function isLikelyAppleClient(userAgent?: string | null) {
  if (!userAgent) return false;
  return /\b(iPhone|iPad|iPod)\b/i.test(userAgent) || (
    /\bMacintosh\b/i.test(userAgent) &&
    /\bSafari\b/i.test(userAgent) &&
    !/\b(Chrome|Chromium|Edg|OPR|Firefox)\b/i.test(userAgent)
  );
}

function isInsideMediaDirectory(filePath: string) {
  const relative = path.relative(mediaDirectory, filePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function pathStatus(filePath: string) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

function pathInsideDirectory(directory: string, filePath: string) {
  const relative = path.relative(directory, filePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function mappedExpectedPaths(expectedFilePath?: string | null) {
  if (!mediaDirectory || !expectedFilePath) return [];

  const candidates = new Set<string>();
  candidates.add(expectedFilePath);

  if (sourceMediaDirectory && pathInsideDirectory(sourceMediaDirectory, expectedFilePath)) {
    candidates.add(
      path.join(mediaDirectory, path.relative(sourceMediaDirectory, expectedFilePath))
    );
  }

  return [...candidates].filter((candidate) => {
    return isInsideMediaDirectory(candidate);
  });
}

async function findFirstMediaInDirectory(directory: string, videoId?: string) {
  const stack = [directory];
  let fallback: string | null = null;
  while (stack.length > 0) {
    const currentDirectory = stack.pop();
    if (!currentDirectory) continue;

    try {
      const handle = await opendir(currentDirectory);
      for await (const entry of handle) {
        const entryPath = path.join(currentDirectory, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
          continue;
        }
        if (!entry.isFile()) continue;

        const extension = path.extname(entry.name).toLowerCase();
        if (!allowedExtensions.has(extension)) continue;
        if (!isInsideMediaDirectory(entryPath)) continue;
        if (videoId && entry.name.includes(videoId)) return entryPath;
        fallback ||= entryPath;
      }
    } catch {
      continue;
    }
  }

  return fallback;
}

async function findByBasename(expectedFilePath?: string | null, videoId?: string) {
  if (!mediaDirectory || !expectedFilePath) return null;
  const expectedName = path.basename(expectedFilePath).toLowerCase();
  if (!expectedName) return null;

  const stack = [mediaDirectory];
  while (stack.length > 0) {
    const directory = stack.pop();
    if (!directory) continue;

    try {
      const handle = await opendir(directory);
      for await (const entry of handle) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.toLowerCase() === expectedName) {
            const directoryMatch = await findFirstMediaInDirectory(entryPath, videoId);
            if (directoryMatch) return directoryMatch;
          }
          stack.push(entryPath);
          continue;
        }
        if (!entry.isFile() || entry.name.toLowerCase() !== expectedName) continue;

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

async function findExpectedLocalVideoFile(
  expectedFilePath?: string | null,
  videoId?: string
) {
  for (const candidate of mappedExpectedPaths(expectedFilePath)) {
    const candidateStatus = await pathStatus(candidate);
    if (candidateStatus?.isFile()) {
      const extension = path.extname(candidate).toLowerCase();
      if (allowedExtensions.has(extension)) return candidate;
    }
    if (candidateStatus?.isDirectory()) {
      const directoryMatch = await findFirstMediaInDirectory(candidate, videoId);
      if (directoryMatch) return directoryMatch;
    }
  }
  return findByBasename(expectedFilePath, videoId);
}

async function findLocalVideoFile(videoId: string, expectedFilePath?: string | null) {
  if (!mediaDirectory || !isValidVideoId(videoId)) return null;

  const expectedMatch = await findExpectedLocalVideoFile(expectedFilePath, videoId);
  if (expectedMatch) return expectedMatch;

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

export async function getLocalMediaFile(videoId: string, expectedFilePath?: string | null) {
  const filePath = await findLocalVideoFile(videoId, expectedFilePath);
  if (!filePath) return null;

  try {
    const fileStat = await stat(filePath);
    return {
      filePath,
      fileName: path.basename(filePath),
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      extension: path.extname(filePath).toLowerCase(),
    };
  } catch {
    return null;
  }
}

async function getLocalMediaLookup(
  videoId: string,
  userAgent?: string | null,
  expectedFilePath?: string | null
) {
  if (!mediaDirectory) {
    return {
      configured: false,
      available: false,
      source: "youtarr" as const,
    };
  }

  const localFile = await getLocalMediaFile(videoId, expectedFilePath);
  if (!localFile) {
    return {
      configured: true,
      available: false,
      source: "youtarr" as const,
    };
  }

  const playable = !isLikelyAppleClient(userAgent) ||
    appleFriendlyExtensions.has(localFile.extension);
  return {
    configured: true,
    available: playable,
    source: playable ? "local" as const : "youtarr" as const,
    filePath: localFile.filePath,
    fileName: localFile.fileName,
    size: localFile.size,
    extension: localFile.extension,
    playable,
  };
}

export async function getLocalMediaStatus(
  videoId: string,
  userAgent?: string | null,
  expectedFilePath?: string | null
) {
  const status = await getLocalMediaLookup(videoId, userAgent, expectedFilePath);
  if ("filePath" in status) {
    delete status.filePath;
  }
  return status;
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

export async function getLocalMediaResponse(
  videoId: string,
  range: string | null,
  userAgent?: string | null,
  expectedFilePath?: string | null
) {
  const status = await getLocalMediaLookup(videoId, userAgent, expectedFilePath);
  if (!status.available) return null;

  const filePath = status.filePath;

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
