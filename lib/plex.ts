const plexUrl = process.env.PLEX_URL?.trim().replace(/\/+$/, "") || "";
const plexToken = process.env.PLEX_TOKEN?.trim() || "";
const plexLibraryId = process.env.PLEX_LIBRARY_ID?.trim() || "";

export function isPlexConfigured() {
  return Boolean(plexUrl && plexToken && /^\d+$/.test(plexLibraryId));
}

export function getPlexPublicConfig() {
  return {
    configured: isPlexConfigured(),
    server: plexUrl
      ? plexUrl.replace(/^https?:\/\//, "").split("/")[0]
      : undefined,
  };
}

export async function refreshPlexLibrary() {
  if (!isPlexConfigured()) {
    throw new Error("Plex-koppeling is niet compleet");
  }

  const response = await fetch(
    `${plexUrl}/library/sections/${encodeURIComponent(plexLibraryId)}/refresh`,
    {
      headers: {
        Accept: "application/json",
        "X-Plex-Token": plexToken,
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(`Plex library scan failed (${response.status})`);
  }
}
