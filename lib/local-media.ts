import { createReadStream } from "node:fs";
import { opendir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const mediaDirectory = process.env.YOUTARR_MEDIA_DIR?.trim() || "";
const secondaryQualitySubfolder =
  process.env.YOUTARR_SECONDARY_DOWNLOAD_SUBFOLDER?.trim().toLowerCase() ||
  "__1080p";
const allowedExtensions = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv"]);
const appleFriendlyExtensions = new Set([".mp4", ".m4v", ".mov"]);
const mimeTypes = new Map([
  [".mp4", "video/mp4"],
  [".m4v", "video/mp4"],
  [".mov", "video/quicktime"],
  [".webm", "video/webm"],
  [".mkv", "video/x-matroska"],
]);

export type LocalMediaQuality = "auto" | "original" | "1080";

export type LocalMediaVariant = {
  quality: "original" | "1080";
  label: string;
  fileName: string;
  size: number;
  extension: string;
  compatible: boolean;
  height?: number;
};

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

function inferHeight(filePath: string) {
  const normalized = filePath.toLowerCase();
  if (/\b4k\b/.test(normalized)) return 2160;
  const match = /(?:^|[^\d])(2160|1440|1080|720|480)p?(?:[^\d]|$)/.exec(
    normalized
  );
  return match ? Number(match[1]) : undefined;
}

function variantLabel(height?: number) {
  if (!height) return "Original";
  if (height >= 2160) return "4K";
  return `${height}p`;
}

function isSecondaryQualityPath(filePath: string) {
  if (!mediaDirectory || !secondaryQualitySubfolder) return false;
  const relative = path.relative(mediaDirectory, filePath).toLowerCase();
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  return relative
    .split(/[\\/]+/)
    .some((segment) => segment === secondaryQualitySubfolder);
}

function inferVariantQuality(filePath: string): "original" | "1080" {
  if (isSecondaryQualityPath(filePath)) return "1080";
  return inferHeight(filePath) === 1080 ? "1080" : "original";
}

async function findLocalVideoFiles(videoId: string) {
  if (!mediaDirectory || !isValidVideoId(videoId)) return null;

  const stack = [mediaDirectory];
  const matches: string[] = [];
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
        matches.push(entryPath);
      }
    } catch {
      continue;
    }
  }

  return matches.sort((left, right) => {
    const leftExtension = path.extname(left).toLowerCase();
    const rightExtension = path.extname(right).toLowerCase();
    const leftHeight = inferHeight(left) || 0;
    const rightHeight = inferHeight(right) || 0;
    if (leftHeight !== rightHeight) return rightHeight - leftHeight;
    const leftFriendly = appleFriendlyExtensions.has(leftExtension) ? 0 : 1;
    const rightFriendly = appleFriendlyExtensions.has(rightExtension) ? 0 : 1;
    if (leftFriendly !== rightFriendly) return leftFriendly - rightFriendly;
    return left.localeCompare(right);
  });
}

export async function deleteLocalMediaFiles(videoId: string) {
  const files = await findLocalVideoFiles(videoId);
  if (!files?.length) return { deleted: 0, files: [] as string[] };

  const deletedFiles: string[] = [];
  const failures: string[] = [];
  for (const filePath of files) {
    try {
      await unlink(filePath);
      deletedFiles.push(path.basename(filePath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      failures.push(path.basename(filePath));
    }
  }

  if (failures.length > 0) {
    throw new Error(`Could not delete local file(s): ${failures.join(", ")}`);
  }

  return { deleted: deletedFiles.length, files: deletedFiles };
}

async function findLocalVideoFile(videoId: string) {
  const files = await findLocalVideoFiles(videoId);
  if (!files?.length) return null;
  return files.find((file) => inferHeight(file) !== 1080) || files[0];
}

export async function getLocalMediaFile(videoId: string) {
  if (!mediaDirectory || !isValidVideoId(videoId)) return null;

  const filePath = await findLocalVideoFile(videoId);
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

export async function getLocalMediaVariants(videoId: string) {
  const files = await findLocalVideoFiles(videoId);
  if (!files?.length) return [];

  const variants: Array<LocalMediaVariant & { filePath: string }> = [];
  for (const filePath of files) {
    try {
      const fileStat = await stat(filePath);
      const extension = path.extname(filePath).toLowerCase();
      const height = inferHeight(filePath);
      const quality = inferVariantQuality(filePath);
      if (variants.some((variant) => variant.quality === quality)) continue;
      variants.push({
        quality,
        label: quality === "1080" ? "1080p" : variantLabel(height),
        filePath,
        fileName: path.basename(filePath),
        size: fileStat.size,
        extension,
        compatible: appleFriendlyExtensions.has(extension),
        height,
      });
    } catch {
      continue;
    }
  }

  return variants.sort((left, right) => {
    if (left.quality === right.quality) return 0;
    return left.quality === "original" ? -1 : 1;
  });
}

function selectVariant(
  variants: Array<LocalMediaVariant & { filePath: string }>,
  userAgent?: string | null,
  quality: LocalMediaQuality = "auto"
) {
  const original = variants.find((variant) => variant.quality === "original");
  const hd = variants.find((variant) => variant.quality === "1080");
  if (quality === "1080") return hd || null;
  if (quality === "original") return original || null;
  if (isLikelyAppleClient(userAgent) && hd) return hd;
  return original || hd || null;
}

async function getLocalMediaLookup(
  videoId: string,
  userAgent?: string | null,
  quality: LocalMediaQuality = "auto"
) {
  if (!mediaDirectory) {
    return {
      configured: false,
      available: false,
      source: "youtarr" as const,
    };
  }

  const variants = await getLocalMediaVariants(videoId);
  const localFile = selectVariant(variants, userAgent, quality);
  if (!localFile) {
    return {
      configured: true,
      available: false,
      source: "youtarr" as const,
    };
  }

  try {
    const appleCompatible = !isLikelyAppleClient(userAgent) ||
      localFile.compatible;
    return {
      configured: true,
      available: appleCompatible,
      source: appleCompatible ? "local" as const : "youtarr" as const,
      filePath: localFile.filePath,
      fileName: localFile.fileName,
      size: localFile.size,
      extension: localFile.extension,
      compatible: appleCompatible,
      quality: localFile.quality,
      variants: variants.map(({ filePath: _filePath, ...variant }) => variant),
    };
  } catch {
    return {
      configured: true,
      available: false,
      source: "youtarr" as const,
    };
  }
}

export async function getLocalMediaStatus(
  videoId: string,
  userAgent?: string | null,
  quality: LocalMediaQuality = "auto"
) {
  const status = await getLocalMediaLookup(videoId, userAgent, quality);
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
  quality: LocalMediaQuality = "auto"
) {
  const status = await getLocalMediaLookup(videoId, userAgent, quality);
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
    "X-Youtarr-Feed-File": encodeURIComponent(status.fileName),
    "X-Youtarr-Feed-Quality": status.quality || "unknown",
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
