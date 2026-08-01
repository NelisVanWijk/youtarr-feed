# Youtarr Feed

Youtarr Feed is a mobile-first web app for
[Youtarr](https://github.com/DialmasterOrg/Youtarr). It gives you a YouTube-like
feed for your Youtarr subscriptions, with server-side watch progress, Continue
Watching, local playback, single-video links, download/delete actions, optional
multi-instance playback routing, and optional Plex integration.

The app talks to Youtarr and Plex from the server side. Passwords, session
tokens, API keys, and Plex tokens are never sent to the browser.

## Features

- Chronological feed for Youtarr channels.
- Channel pages and channel export to Youtarr-compatible CSV.
- Add channels from the app.
- Add one-off YouTube videos without subscribing to a channel.
- Start downloads, re-download missing videos, and delete downloads through
  Youtarr.
- Watch page with description, fullscreen/mobile player behavior, mini player,
  and Continue Watching.
- Server-side watch progress stored under `/data`.
- Optional Plex watch-state sync: Youtarr Feed pushes progress to Plex, and the
  refresh button can import Plex progress back into Youtarr Feed.
- Local downloads tab.
- Optional direct local file streaming with HTTP Range support.
- Server-side feed cache for fast app opens.
- Optional YouTube Data API fallback for exact publish timestamps.
- English UI by default, with Dutch available.
- iPhone/PWA manifest with portrait orientation.

## How Playback Works

Without a media mount, playback uses Youtarr's stream endpoint:

```text
browser -> youtarr-feed -> Youtarr -> video file
```

For the best experience, mount the same Youtarr download folder into Youtarr
Feed as read-only:

```text
browser -> youtarr-feed -> video file
```

Youtarr Feed asks Youtarr for the video's stored file path, maps that path from
`YOUTARR_SOURCE_MEDIA_DIR` to `YOUTARR_MEDIA_DIR` when needed, and falls back to
searching the media mount by filename. If a local file is found, it is streamed
directly with Range support. If not, playback falls back to Youtarr.

Downloaded thumbnails show a compact badge:

- `Direct`: streamed from the local media mount.
- `Youtarr`: streamed through Youtarr.

Deletes still go through Youtarr, even when playback is direct. Youtarr remains
the owner of downloads and library state.

## Recommended Mount Layout

Use the same container path in Youtarr and Youtarr Feed:

```text
Youtarr:
  /mnt/user/Media/Youtarr -> /usr/src/app/data

Youtarr Feed:
  /mnt/user/Media/Youtarr -> /usr/src/app/data:ro
```

Then set:

```env
YOUTARR_MEDIA_DIR=/usr/src/app/data
YOUTARR_SOURCE_MEDIA_DIR=/usr/src/app/data
```

If Youtarr stores a different container path in its database, keep
`YOUTARR_MEDIA_DIR` as the Youtarr Feed mount and set
`YOUTARR_SOURCE_MEDIA_DIR` to the path Youtarr stores.

## Unraid Installation

Template URL:

```text
https://raw.githubusercontent.com/NelisVanWijk/youtarr-feed/main/unraid/youtarr-feed.xml
```

Typical settings:

```text
Repository:
  ghcr.io/nelisvanwijk/youtarr-feed:latest

WebUI Port:
  3090

Youtarr URL:
  http://host.docker.internal:3087

App Data:
  /mnt/user/appdata/youtarr-feed -> /data

Youtarr Media Path:
  /mnt/user/Media/Youtarr -> /usr/src/app/data:ro

Data Directory:
  /data

Media Directory:
  /usr/src/app/data

Youtarr Source Media Directory:
  /usr/src/app/data
```

The App Data path is important. Watch progress, cached feeds, and single videos
are stored there and survive container updates:

```text
/mnt/user/appdata/youtarr-feed/watch-progress.json
/mnt/user/appdata/youtarr-feed/feed-cache.json
/mnt/user/appdata/youtarr-feed/local-videos-cache.json
/mnt/user/appdata/youtarr-feed/single-videos.json
```

The template includes:

```text
--add-host=host.docker.internal:host-gateway
```

This lets the container reach other containers on the Unraid host through
`host.docker.internal`.

### Youtarr Permissions On Unraid

Youtarr must be able to create and delete files in its own output folder. A
common Unraid setup is to run Youtarr as `nobody:users`:

```bash
--user 99:100
```

Then repair the media folder permissions:

```bash
chown -R 99:100 /mnt/user/Media/Youtarr
find /mnt/user/Media/Youtarr -type d -exec chmod 775 {} \;
find /mnt/user/Media/Youtarr -type f -exec chmod 664 {} \;
```

Youtarr Feed only needs read access to stream files. Downloading and deleting
still happen through Youtarr.

## Docker Compose Installation

Copy the example environment file:

```bash
cp .env.example .env
```

Minimal `.env`:

```env
YOUTARR_URL=http://host.docker.internal:3087
YOUTARR_USERNAME=your-username
YOUTARR_PASSWORD=your-password
YOUTARR_FEED_DATA_DIR=/data
YOUTARR_MEDIA_DIR=/usr/src/app/data
YOUTARR_SOURCE_MEDIA_DIR=/usr/src/app/data
```

Example `docker-compose.yml`:

```yaml
services:
  youtarr-feed:
    image: ghcr.io/nelisvanwijk/youtarr-feed:latest
    container_name: youtarr-feed
    restart: unless-stopped
    env_file:
      - .env
    extra_hosts:
      - "host.docker.internal:host-gateway"
    ports:
      - "3090:3000"
    volumes:
      - ./data:/data
      - /path/to/youtarr/output:/usr/src/app/data:ro
```

Start it:

```bash
docker compose up -d
```

Open:

```text
http://SERVER-IP:3090
```

On iPhone, open the site in Safari and use Share -> Add to Home Screen.

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `YOUTARR_URL` | Yes for live mode | URL reachable from the Youtarr Feed container. |
| `YOUTARR_USERNAME` | Usually | Youtarr username. Not needed when using a session token or disabled auth. |
| `YOUTARR_PASSWORD` | Usually | Youtarr password. |
| `YOUTARR_SESSION_TOKEN` | Optional | Alternative to username/password. Sessions may expire. |
| `YOUTARR_AUTH_DISABLED` | Optional | Set to `true` only if Youtarr auth is intentionally disabled. |
| `YOUTARR_API_KEY` | Optional | Optional Youtarr API key for download commands. |
| `YOUTARR_FEED_DATA_DIR` | Recommended | Persistent app data directory. Defaults to `/data` in production. |
| `YOUTARR_FEED_CACHE_TTL_SECONDS` | Optional | Feed/local-video cache duration in seconds. Defaults to `300`. |
| `YOUTARR_MEDIA_DIR` | Recommended | Youtarr Feed container path for the mounted Youtarr output folder. |
| `YOUTARR_SOURCE_MEDIA_DIR` | Optional | Path prefix stored by Youtarr. Defaults to `/usr/src/app/data`. |
| `YOUTARR_PLAYBACK_PROFILE` | Optional | Playback routing mode: `auto`, `primary`, `av1`, or `vp9`. Defaults to `auto`. |
| `YOUTUBE_API_KEY` | Optional | Fallback YouTube Data API key for exact publish timestamps. Prefer setting this in Youtarr first. |

### Optional Multi-Youtarr Playback

You can run extra Youtarr instances for codec-specific playback. The main
`YOUTARR_URL` remains the feed and download owner. Optional AV1/VP9 instances
are used for playback routing, channel sync, download queueing, and best-effort
delete sync.

| Variable | Description |
| --- | --- |
| `YOUTARR_VP9_URL` | Optional VP9 playback instance. In `auto` mode, iPad and Mac Safari use it when configured. |
| `YOUTARR_VP9_USERNAME` / `YOUTARR_VP9_PASSWORD` | Optional VP9 credentials. If omitted, main credentials are reused unless only `YOUTARR_VP9_API_KEY` is set. |
| `YOUTARR_VP9_API_KEY` | Optional VP9 API key. |
| `YOUTARR_VP9_SESSION_TOKEN` | Optional VP9 session token. |
| `YOUTARR_VP9_AUTH_DISABLED` | Set to `true` only if auth is disabled on the VP9 instance. |
| `YOUTARR_VP9_MEDIA_DIR` | Youtarr Feed container path for the VP9 media mount, for example `/usr/src/app/data-vp9`. |
| `YOUTARR_VP9_SOURCE_MEDIA_DIR` | Path prefix stored by the VP9 Youtarr instance. Defaults to `/usr/src/app/data`. |
| `YOUTARR_AV1_URL` | Optional explicit AV1 playback instance. |
| `YOUTARR_AV1_USERNAME` / `YOUTARR_AV1_PASSWORD` | Optional AV1 credentials. If omitted, main credentials are reused. |
| `YOUTARR_AV1_API_KEY` | Optional AV1 API key. |
| `YOUTARR_AV1_SESSION_TOKEN` | Optional AV1 session token. |
| `YOUTARR_AV1_AUTH_DISABLED` | Set to `true` only if auth is disabled on the AV1 instance. |
| `YOUTARR_AV1_MEDIA_DIR` | Youtarr Feed container path for the AV1 media mount. |
| `YOUTARR_AV1_SOURCE_MEDIA_DIR` | Path prefix stored by the AV1 Youtarr instance. Defaults to `/usr/src/app/data`. |

If you already have channels in the main instance, open the Channels tab and use
`Export CSV`. The exported `youtarr-subscriptions.csv` can be imported into
another Youtarr instance.

### Optional Plex Integration

| Variable | Description |
| --- | --- |
| `PLEX_URL` | Plex server URL reachable from this container, for example `http://host.docker.internal:32400`. |
| `PLEX_TOKEN` | Plex token. Kept server-side only. |
| `PLEX_LIBRARY_ID` | Numeric Plex library section ID for the Youtarr library. |
| `PLEX_WATCH_SYNC_ENABLED` | Defaults to `true`. When Plex is configured, Youtarr Feed pushes watch progress to Plex and imports Plex progress when refreshing. Set to `false` to only use Plex library scans. |

Youtarr Feed matches Plex items by the YouTube video ID in the Youtarr file or
folder name, for example `[v5Et1hTPlTk]`. No Plex path mapping is required.

## Feed Ordering And Cache

Youtarr Feed sorts by `publishedAt` from Youtarr. If Youtarr only returns a date,
the app keeps a stable source order so videos from the same date do not reshuffle
on every refresh.

For exact ordering, add a YouTube Data API key in Youtarr's own integrations
settings. As a fallback, Youtarr Feed can use `YOUTUBE_API_KEY`.

The feed and Local tab are cached server-side under `/data`. Cached results are
reused for 300 seconds by default. When stale, the old result is returned quickly
and refreshed in the background. Manual refresh bypasses the cache and also
refreshes local playback badges and watch progress.

## iPhone, AirPlay, And Codecs

Direct local streaming can reduce buffering, but it does not change codec
compatibility. Apple devices are most reliable with:

```text
MP4 container + HEVC/H.265 or H.264 video + AAC audio
```

Many YouTube 4K files are VP9 or AV1. Depending on the Apple device, browser,
and AirPlay target, those may show black video, audio-only playback, or fail to
play.

Useful Youtarr yt-dlp examples:

```bash
-S "res,codec:hevc:h264,acodec:aac" --merge-output-format mp4
```

Maximum compatibility, often lower than 4K:

```bash
-S vcodec:h264,acodec:aac --merge-output-format mp4
```

## Updating

The container image is published to GitHub Container Registry:

```text
ghcr.io/nelisvanwijk/youtarr-feed:latest
```

Update the container in Unraid or run:

```bash
docker compose pull
docker compose up -d
```

If iPhone PWA manifest changes such as orientation do not appear, remove the
homescreen app and add it again from Safari. iOS can cache manifests
aggressively.

## Diagnostics

The in-app Settings panel includes backend diagnostics. Use `Check connections`
to verify active environment variables, masked secrets, media mounts, playback
routing, and live connectivity to Youtarr, optional AV1/VP9 instances, and Plex.

## Development

Install dependencies:

```bash
pnpm install
```

Run locally:

```bash
pnpm dev
```

Checks:

```bash
pnpm lint
pnpm test
```

Without Youtarr configuration the app starts in demo mode.

## Security

Do not expose Youtarr or Youtarr Feed directly to the internet over plain HTTP.
Use HTTPS through a reverse proxy or private access such as Tailscale or
WireGuard.

Mount the Youtarr media folder read-only in Youtarr Feed. Let Youtarr handle
downloads and deletes.
