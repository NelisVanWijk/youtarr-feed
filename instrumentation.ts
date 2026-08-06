export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { ensureFeedCacheWarmer } = await import("./lib/feed-cache-warmer");
  ensureFeedCacheWarmer();
}
