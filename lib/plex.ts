import type { ServiceDiagnostic, SettingValue } from "./types";

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

function secretState(value: string) {
  return value ? "Set" : "Not set";
}

function timeoutSignal(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

async function checkPlexConnection() {
  if (!plexUrl) return { ok: false, message: "URL is not set" };
  if (!plexToken) return { ok: false, message: "Token is not set" };
  if (!/^\d+$/.test(plexLibraryId)) {
    return { ok: false, message: "Library ID is not set" };
  }

  const timeout = timeoutSignal(8000);
  try {
    const response = await fetch(
      `${plexUrl}/library/sections/${encodeURIComponent(plexLibraryId)}`,
      {
        headers: {
          Accept: "application/json",
          "X-Plex-Token": plexToken,
        },
        cache: "no-store",
        signal: timeout.signal,
      }
    );
    return response.ok
      ? { ok: true, status: response.status, message: "Connected" }
      : {
          ok: false,
          status: response.status,
          message: `Connection failed (${response.status})`,
        };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && error.name === "AbortError"
          ? "Connection timed out"
          : error instanceof Error
            ? error.message
            : "Connection failed",
    };
  } finally {
    timeout.clear();
  }
}

export async function getPlexDiagnostics(): Promise<ServiceDiagnostic> {
  const settings: SettingValue[] = [
    { key: "PLEX_URL", label: "URL", value: plexUrl || "Not set" },
    {
      key: "PLEX_TOKEN",
      label: "Token",
      value: secretState(plexToken),
      secret: true,
    },
    {
      key: "PLEX_LIBRARY_ID",
      label: "Library ID",
      value: plexLibraryId || "Not set",
    },
  ];

  return {
    key: "plex",
    label: "Plex",
    configured: isPlexConfigured(),
    connection: await checkPlexConnection(),
    settings,
  };
}
