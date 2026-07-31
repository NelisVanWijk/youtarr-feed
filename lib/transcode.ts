import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { appDataPath } from "./app-data";
import { getLocalMediaFile, isLikelyAppleClient } from "./local-media";

type TranscodeJob = {
  state: "running" | "error";
  startedAt: number;
  startTime: number;
  child?: ChildProcessWithoutNullStreams;
  error?: string;
};

type TranscodeMetadata = {
  videoId: string;
  sourcePath: string;
  sourceSize: number;
  sourceMtimeMs: number;
  startTime: number;
  completedAt: number;
};

export type TranscodeStatus = {
  enabled: boolean;
  configured: boolean;
  available: boolean;
  ready: boolean;
  complete: boolean;
  running: boolean;
  startTime: number;
  playlistUrl?: string;
  error?: string;
};

export type AppleTranscodeDecision = {
  suggested: boolean;
  reason?: string;
  videoCodec?: string;
  audioCodec?: string;
};

const transcodeJobs = new Map<string, TranscodeJob>();
const transcodeRoot = process.env.YOUTARR_TRANSCODE_DIR?.trim() ||
  appDataPath("transcodes");
const transcodeEnabled = process.env.YOUTARR_TRANSCODE_ENABLED === "true";
const transcodeDevice = process.env.YOUTARR_TRANSCODE_DEVICE?.trim() || "";
const transcodeAccel = process.env.YOUTARR_TRANSCODE_ACCEL?.trim() ||
  (transcodeDevice ? "vaapi" : "software");
const transcodeVideoBitrate =
  process.env.YOUTARR_TRANSCODE_VIDEO_BITRATE?.trim() || "18000k";
const transcodeAudioBitrate =
  process.env.YOUTARR_TRANSCODE_AUDIO_BITRATE?.trim() || "160k";
const transcodeVaapiQuality =
  process.env.YOUTARR_TRANSCODE_VAAPI_QUALITY?.trim() || "24";
const hlsFilePattern = /^(index\.m3u8|segment_\d{5}\.ts)$/;

function runProcess(command: string, args: string[], timeoutMs = 12000) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(command, args, { windowsHide: true });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout = `${stdout}${chunk.toString("utf8")}`;
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString("utf8")}`;
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolve({ code, stdout, stderr });
      });
    }
  );
}

function isValidVideoId(value: string) {
  return /^[A-Za-z0-9_-]{11}$/.test(value);
}

function transcodeDirectory(videoId: string) {
  return path.join(transcodeRoot, videoId);
}

function metadataPath(videoId: string) {
  return path.join(transcodeDirectory(videoId), "metadata.json");
}

function playlistPath(videoId: string) {
  return path.join(transcodeDirectory(videoId), "index.m3u8");
}

function playlistUrl(videoId: string) {
  return `/api/transcode/${encodeURIComponent(videoId)}/hls/index.m3u8`;
}

function normalizeStartTime(value?: number) {
  if (!Number.isFinite(value) || !value || value < 10) return 0;
  return Math.max(0, Math.floor(value) - 5);
}

async function readMetadata(videoId: string) {
  try {
    return JSON.parse(await readFile(metadataPath(videoId), "utf8")) as
      TranscodeMetadata;
  } catch {
    return null;
  }
}

async function isReady(videoId: string, startTime?: number) {
  try {
    const localFile = await getLocalMediaFile(videoId);
    if (!localFile) return false;
    const [playlistStat, metadata] = await Promise.all([
      stat(playlistPath(videoId)),
      readMetadata(videoId),
    ]);
    return Boolean(
      playlistStat.isFile() &&
        metadata &&
        metadata.sourcePath === localFile.filePath &&
        metadata.sourceSize === localFile.size &&
        metadata.sourceMtimeMs === localFile.mtimeMs &&
        (startTime === undefined || (metadata.startTime || 0) === startTime)
    );
  } catch {
    return false;
  }
}

async function hasPlayableHls(videoId: string) {
  try {
    const playlistStat = await stat(playlistPath(videoId));
    if (!playlistStat.isFile()) return false;
    const files = await readdir(transcodeDirectory(videoId));
    return files.some((fileName) => /^segment_\d{5}\.ts$/.test(fileName));
  } catch {
    return false;
  }
}

function ffmpegArguments(inputPath: string, outputDirectory: string, startTime: number) {
  const segmentPath = path.join(outputDirectory, "segment_%05d.ts");
  const inputArgs = [
    ...(startTime > 0 ? ["-ss", String(startTime)] : []),
    "-i",
    inputPath,
  ];
  const commonOutput = [
    "-c:a",
    "aac",
    "-ac",
    "2",
    "-b:a",
    transcodeAudioBitrate,
    "-f",
    "hls",
    "-hls_time",
    "4",
    "-hls_list_size",
    "0",
    "-hls_flags",
    "independent_segments",
    "-hls_segment_filename",
    segmentPath,
    path.join(outputDirectory, "index.m3u8"),
  ];

  if (transcodeAccel === "vaapi" && transcodeDevice) {
    return [
      "-hide_banner",
      "-y",
      "-loglevel",
      "warning",
      "-vaapi_device",
      transcodeDevice,
      ...inputArgs,
      "-vf",
      "format=nv12,hwupload",
      "-c:v",
      "h264_vaapi",
      "-rc_mode",
      "CQP",
      "-global_quality",
      transcodeVaapiQuality,
      ...commonOutput,
    ];
  }

  return [
    "-hide_banner",
    "-y",
    "-loglevel",
    "warning",
    ...inputArgs,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    transcodeVideoBitrate,
    "-maxrate",
    transcodeVideoBitrate,
    "-bufsize",
    "36000k",
    ...commonOutput,
  ];
}

export async function getTranscodeStatus(videoId: string): Promise<TranscodeStatus> {
  if (!isValidVideoId(videoId)) {
    return {
      enabled: transcodeEnabled,
      configured: Boolean(transcodeRoot),
      available: false,
      ready: false,
      complete: false,
      running: false,
      startTime: 0,
      error: "Invalid video",
    };
  }

  const localFile = await getLocalMediaFile(videoId);
  const job = transcodeJobs.get(videoId);
  const metadata = await readMetadata(videoId);
  const startTime = job?.startTime ?? metadata?.startTime ?? 0;
  const complete = transcodeEnabled && await isReady(videoId);
  const playable = complete || Boolean(job?.state === "running" && await hasPlayableHls(videoId));
  return {
    enabled: transcodeEnabled,
    configured: Boolean(transcodeRoot),
    available: Boolean(localFile),
    ready: playable,
    complete,
    running: job?.state === "running",
    startTime,
    playlistUrl: playable ? playlistUrl(videoId) : undefined,
    error: job?.state === "error" ? job.error : undefined,
  };
}

export async function getAppleTranscodeDecision(
  videoId: string,
  userAgent?: string | null
): Promise<AppleTranscodeDecision> {
  if (!transcodeEnabled || !isLikelyAppleClient(userAgent)) {
    return { suggested: false };
  }

  const localFile = await getLocalMediaFile(videoId);
  if (!localFile) return { suggested: false };
  if (![".mp4", ".m4v", ".mov"].includes(localFile.extension)) {
    return { suggested: true, reason: "container" };
  }

  try {
    const result = await runProcess("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,codec_name,pix_fmt",
      "-of",
      "json",
      localFile.filePath,
    ]);
    if (result.code !== 0) return { suggested: false, reason: "probe" };

    const parsed = JSON.parse(result.stdout) as {
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        pix_fmt?: string;
      }>;
    };
    const video = parsed.streams?.find((stream) => stream.codec_type === "video");
    const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
    const videoCodec = video?.codec_name?.toLowerCase();
    const audioCodec = audio?.codec_name?.toLowerCase();
    const pixelFormat = video?.pix_fmt?.toLowerCase();
    const videoSafe = videoCodec === "h264" &&
      (!pixelFormat || ["yuv420p", "yuvj420p"].includes(pixelFormat));
    const audioSafe = !audioCodec || audioCodec === "aac";

    return {
      suggested: !(videoSafe && audioSafe),
      reason: videoSafe && audioSafe ? undefined : "codec",
      videoCodec,
      audioCodec,
    };
  } catch {
    return { suggested: false, reason: "probe" };
  }
}

export async function startTranscode(
  videoId: string,
  requestedStartTime?: number
): Promise<TranscodeStatus> {
  const startTime = normalizeStartTime(requestedStartTime);
  if (!transcodeEnabled) {
    return {
      enabled: false,
      configured: Boolean(transcodeRoot),
      available: false,
      ready: false,
      complete: false,
      running: false,
      startTime,
      error: "Transcoding is disabled",
    };
  }
  if (!isValidVideoId(videoId)) {
    return {
      enabled: true,
      configured: Boolean(transcodeRoot),
      available: false,
      ready: false,
      complete: false,
      running: false,
      startTime,
      error: "Invalid video",
    };
  }
  if (await isReady(videoId, startTime)) {
    return getTranscodeStatus(videoId);
  }

  const localFile = await getLocalMediaFile(videoId);
  if (!localFile) {
    return {
      enabled: true,
      configured: Boolean(transcodeRoot),
      available: false,
      ready: false,
      complete: false,
      running: false,
      startTime,
      error: "Local media file not found",
    };
  }

  const existing = transcodeJobs.get(videoId);
  if (existing?.state === "running" && existing.startTime === startTime) {
    return getTranscodeStatus(videoId);
  }
  if (existing?.state === "running") {
    existing.child?.kill("SIGTERM");
    transcodeJobs.delete(videoId);
  }

  const outputDirectory = transcodeDirectory(videoId);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const child = spawn("ffmpeg", ffmpegArguments(localFile.filePath, outputDirectory, startTime), {
    env: {
      ...process.env,
      LIBVA_DRIVER_NAME: process.env.LIBVA_DRIVER_NAME || "iHD",
    },
    windowsHide: true,
  });
  let stderr = "";
  transcodeJobs.set(videoId, {
    state: "running",
    startedAt: Date.now(),
    startTime,
    child,
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000);
  });

  child.on("error", (error) => {
    if (transcodeJobs.get(videoId)?.child !== child) return;
    transcodeJobs.set(videoId, {
      state: "error",
      startedAt: Date.now(),
      startTime,
      error: error.message,
    });
  });

  child.on("close", async (code) => {
    if (transcodeJobs.get(videoId)?.child !== child) return;
    if (code === 0) {
      const currentFile = await getLocalMediaFile(videoId);
      if (currentFile) {
        const metadata: TranscodeMetadata = {
          videoId,
          sourcePath: currentFile.filePath,
          sourceSize: currentFile.size,
          sourceMtimeMs: currentFile.mtimeMs,
          startTime,
          completedAt: Date.now(),
        };
        await writeFile(metadataPath(videoId), JSON.stringify(metadata, null, 2), "utf8");
      }
      transcodeJobs.delete(videoId);
      return;
    }

    transcodeJobs.set(videoId, {
      state: "error",
      startedAt: Date.now(),
      startTime,
      error: stderr.trim() || `ffmpeg exited with code ${code}`,
    });
  });

  return getTranscodeStatus(videoId);
}

export async function getTranscodeHlsResponse(videoId: string, fileName: string) {
  if (!transcodeEnabled || !isValidVideoId(videoId) || !hlsFilePattern.test(fileName)) {
    return null;
  }

  const filePath = path.join(transcodeDirectory(videoId), fileName);
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return null;

    const headers = new Headers({
      "Content-Length": String(fileStat.size),
      "Content-Type": fileName.endsWith(".m3u8")
        ? "application/vnd.apple.mpegurl"
        : "video/mp2t",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    return new Response(
      Readable.toWeb(createReadStream(filePath)) as ReadableStream,
      { headers }
    );
  } catch {
    return null;
  }
}

export async function deleteTranscode(videoId: string) {
  if (!isValidVideoId(videoId)) return;
  const job = transcodeJobs.get(videoId);
  job?.child?.kill("SIGTERM");
  transcodeJobs.delete(videoId);
  await rm(transcodeDirectory(videoId), { recursive: true, force: true });
}
