import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { appDataPath } from "./app-data";
import { getLocalMediaFile, isLikelyAppleClient } from "./local-media";

type TranscodeJob = {
  state: "running" | "error";
  startedAt: number;
  child?: ChildProcessWithoutNullStreams;
  error?: string;
};

type TranscodeMetadata = {
  videoId: string;
  sourcePath: string;
  sourceSize: number;
  sourceMtimeMs: number;
  completedAt: number;
};

export type TranscodeStatus = {
  enabled: boolean;
  configured: boolean;
  available: boolean;
  ready: boolean;
  running: boolean;
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

async function readMetadata(videoId: string) {
  try {
    return JSON.parse(await readFile(metadataPath(videoId), "utf8")) as
      TranscodeMetadata;
  } catch {
    return null;
  }
}

async function isReady(videoId: string) {
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
        metadata.sourceMtimeMs === localFile.mtimeMs
    );
  } catch {
    return false;
  }
}

function ffmpegArguments(inputPath: string, outputDirectory: string) {
  const segmentPath = path.join(outputDirectory, "segment_%05d.ts");
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
    "-hls_playlist_type",
    "vod",
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
      "-i",
      inputPath,
      "-vf",
      "format=nv12,hwupload",
      "-c:v",
      "h264_vaapi",
      "-b:v",
      transcodeVideoBitrate,
      "-maxrate",
      transcodeVideoBitrate,
      "-bufsize",
      "36000k",
      ...commonOutput,
    ];
  }

  return [
    "-hide_banner",
    "-y",
    "-loglevel",
    "warning",
    "-i",
    inputPath,
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
      running: false,
      error: "Invalid video",
    };
  }

  const localFile = await getLocalMediaFile(videoId);
  const job = transcodeJobs.get(videoId);
  const ready = transcodeEnabled && await isReady(videoId);
  return {
    enabled: transcodeEnabled,
    configured: Boolean(transcodeRoot),
    available: Boolean(localFile),
    ready,
    running: job?.state === "running",
    playlistUrl: ready ? playlistUrl(videoId) : undefined,
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

export async function startTranscode(videoId: string): Promise<TranscodeStatus> {
  if (!transcodeEnabled) {
    return {
      enabled: false,
      configured: Boolean(transcodeRoot),
      available: false,
      ready: false,
      running: false,
      error: "Transcoding is disabled",
    };
  }
  if (!isValidVideoId(videoId)) {
    return {
      enabled: true,
      configured: Boolean(transcodeRoot),
      available: false,
      ready: false,
      running: false,
      error: "Invalid video",
    };
  }
  if (await isReady(videoId)) {
    return getTranscodeStatus(videoId);
  }

  const localFile = await getLocalMediaFile(videoId);
  if (!localFile) {
    return {
      enabled: true,
      configured: Boolean(transcodeRoot),
      available: false,
      ready: false,
      running: false,
      error: "Local media file not found",
    };
  }

  const existing = transcodeJobs.get(videoId);
  if (existing?.state === "running") return getTranscodeStatus(videoId);

  const outputDirectory = transcodeDirectory(videoId);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const child = spawn("ffmpeg", ffmpegArguments(localFile.filePath, outputDirectory), {
    windowsHide: true,
  });
  let stderr = "";
  transcodeJobs.set(videoId, {
    state: "running",
    startedAt: Date.now(),
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
      error: stderr.trim() || `ffmpeg exited with code ${code}`,
    });
  });

  return getTranscodeStatus(videoId);
}

export async function getTranscodeHlsResponse(videoId: string, fileName: string) {
  if (!transcodeEnabled || !isValidVideoId(videoId) || !hlsFilePattern.test(fileName)) {
    return null;
  }
  if (!await isReady(videoId)) return null;

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
