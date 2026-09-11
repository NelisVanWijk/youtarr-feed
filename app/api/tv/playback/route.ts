import { getYoutarrPlaybackTarget } from "../../../../lib/youtarr";

export function GET() {
  const profiles = ["primary", "av1", "vp9"].flatMap((profile) => {
    const target = getYoutarrPlaybackTarget(null, profile);
    return target.profile === profile && target.configured
      ? [{ id: profile, label: target.label }]
      : [];
  });
  // Prefer the explicitly configured AV1 instance. The primary instance is the
  // default otherwise (this installation stores AV1/AAC MP4 there).
  const defaultProfile = profiles.some((profile) => profile.id === "av1")
    ? "av1"
    : "primary";
  return Response.json({ profiles, defaultProfile });
}
