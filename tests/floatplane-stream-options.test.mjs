import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFloatplaneStreamCacheKey,
  parseFloatplaneStreamOptions,
} from "../lib/floatplane-stream-options.ts";

test("Floatplane stream query overrides are allowlisted", () => {
  assert.deepEqual(
    parseFloatplaneStreamOptions(
      new URLSearchParams(
        "mode=hls&outputKind=hls.fmp4&maxHeight=1080&preferredCodec=vp9"
      )
    ),
    {
      playbackMode: "hls",
      outputKind: "hls.fmp4",
      maxHeight: 1080,
    }
  );

  assert.deepEqual(
    parseFloatplaneStreamOptions(
      new URLSearchParams("mode=dash&outputKind=unsafe&maxHeight=-1")
    ),
    {}
  );
});

test("Floatplane MP4 and HLS streams use separate cache keys", () => {
  const base = {
    playbackMode: "mp4",
    outputKind: "hls.mpegts",
    preferredCodec: "h264",
    maxHeight: 1080,
  };
  const mp4 = buildFloatplaneStreamCacheKey("video:123", base);

  assert.notEqual(
    mp4,
    buildFloatplaneStreamCacheKey("video:123", {
      ...base,
      playbackMode: "hls",
    })
  );
  assert.notEqual(
    mp4,
    buildFloatplaneStreamCacheKey("video:123", {
      ...base,
      outputKind: "hls.fmp4",
    })
  );
  assert.notEqual(
    mp4,
    buildFloatplaneStreamCacheKey("video:123", {
      ...base,
      preferredCodec: "hevc",
    })
  );
  assert.notEqual(
    mp4,
    buildFloatplaneStreamCacheKey("video:123", {
      ...base,
      maxHeight: 2160,
    })
  );
});
