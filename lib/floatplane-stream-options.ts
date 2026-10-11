export type FloatplanePlaybackMode = "mp4" | "hls";

export type FloatplaneStreamOptions = {
  refresh?: boolean;
  playbackMode?: FloatplanePlaybackMode;
  outputKind?: string;
  preferredCodec?: string;
  maxHeight?: number;
};

export type ResolvedFloatplaneStreamOptions = Required<
  Pick<
    FloatplaneStreamOptions,
    "playbackMode" | "outputKind" | "preferredCodec" | "maxHeight"
  >
>;

export function parseFloatplaneStreamOptions(
  searchParams: URLSearchParams
): FloatplaneStreamOptions {
  const options: FloatplaneStreamOptions = {};
  const mode = searchParams.get("mode");
  const outputKind = searchParams.get("outputKind");
  const maxHeight = searchParams.get("maxHeight");

  if (mode === "hls" || mode === "mp4") {
    options.playbackMode = mode;
  }
  if (outputKind === "hls.fmp4" || outputKind === "hls.mpegts") {
    options.outputKind = outputKind;
  }
  if (maxHeight && /^[1-9]\d*$/.test(maxHeight)) {
    const parsedMaxHeight = Number(maxHeight);
    if (Number.isSafeInteger(parsedMaxHeight)) {
      options.maxHeight = parsedMaxHeight;
    }
  }

  return options;
}

export function buildFloatplaneStreamCacheKey(
  rawId: string,
  options: ResolvedFloatplaneStreamOptions
) {
  return [
    rawId,
    options.playbackMode,
    options.outputKind,
    options.preferredCodec,
    String(options.maxHeight),
  ].join(":");
}
