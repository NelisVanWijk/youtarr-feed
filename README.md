# Youtarr Feed

Youtarr Feed is a mobile-first web app for [Youtarr](https://github.com/DialmasterOrg/Youtarr).
It is designed to feel good as an iPhone homescreen app: one chronological feed
for your subscriptions, channel views, server-side watch progress, a Continue
Watching tab, a local downloads tab, direct download actions, and local playback
of downloaded videos.

The app talks to Youtarr from the server side. Your Youtarr password, session
token, API key, and optional Plex token are never sent to the browser.

## Features

- Chronological feed of Youtarr channel videos.
- Separate channel view.
- Filters for all, not downloaded, and downloaded videos.
- Add channels from the app.
- Start a Youtarr download by opening a missing video.
- Delete a downloaded video through Youtarr.
- Server-side watch progress stored in `/data/watch-progress.json`.
- Continue Watching tab synced across browsers/devices.
- Local downloads tab with all videos Youtarr currently marks as downloaded.
- Optional Plex library refresh after a download completes.
- Optional direct local file streaming from the mounted Youtarr media folder.
- iPhone/PWA manifest with portrait orientation.

## How Playback Works

By default, playback falls back to Youtarr's own stream endpoint:

```text
browser -> youtarr-feed -> Youtarr -> video file
```

For smoother 4K playback and AirPlay, it is recommended to mount the same
Youtarr output folder into this container as read-only:

```text
browser -> youtarr-feed -> video file
```

When `YOUTARR_MEDIA_DIR` is configured, Youtarr Feed first searches that folder
for a video file whose filename contains the YouTube video ID. If it finds one,
it streams the file directly with HTTP Range support. If it does not find one,
it falls back to Youtarr.

The player shows the active source for downloaded videos:

- `Direct bestand`: streaming from the read-only media mount.
- `Via Youtarr`: local file was not found, so playback uses Youtarr's stream
  endpoint.

Video thumbnails also show a compact `Direct` or `Youtarr` badge for downloaded
items, so you can see the expected playback path before opening the video.

Direct local streaming does not change delete behavior. Deletes still go
through Youtarr, so Youtarr remains the owner of the library.

The Local tab uses Youtarr's downloaded-video state as its source of truth. It
shows all videos Youtarr reports as downloaded and lets you play or delete them
from one overview.

## Recommended Youtarr Mount Layout

Use the same container path in both containers. For example:

```text
Youtarr:
  /mnt/user/Media/Youtarr -> /usr/src/app/data

Youtarr Feed:
  /mnt/user/Media/Youtarr -> /usr/src/app/data:ro
```

Then set:

```env
YOUTARR_MEDIA_DIR=/usr/src/app/data
```

This keeps paths simple and avoids having to translate between different
container paths.

## Unraid Installation

The Unraid template is in:

```text
unraid/youtarr-feed.xml
```

Template URL:

```text
https://raw.githubusercontent.com/NelisVanWijk/youtarr-feed/main/unraid/youtarr-feed.xml
```

Typical Unraid settings:

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
```

The App Data path is important. Watch progress is stored there and survives
container updates:

```text
/mnt/user/appdata/youtarr-feed/watch-progress.json
```

If watch progress disappears after updates, check that `/data` is mapped to a
persistent host path.

### Youtarr Permissions On Unraid

For Youtarr itself, the upstream Unraid documentation recommends running as
Unraid's `nobody:users` user by adding this to Youtarr's Extra Parameters:

```bash
--user 99:100
```

Then repair ownership/modes on the Youtarr output folder:

```bash
chown -R 99:100 /mnt/user/Media/Youtarr
find /mnt/user/Media/Youtarr -type d -exec chmod 775 {} \;
find /mnt/user/Media/Youtarr -type f -exec chmod 664 {} \;
```

Youtarr Feed only needs read access to the media folder.

### Updating On Unraid

The container image is published to GitHub Container Registry:

```text
ghcr.io/nelisvanwijk/youtarr-feed:latest
```

Update the container in Unraid when a new version is published. If PWA manifest
changes such as orientation do not appear on iPhone, remove the homescreen app
and add it again from Safari. iOS can cache manifests aggressively.

## Docker Compose Installation

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env`:

```env
YOUTARR_URL=http://host.docker.internal:3087
YOUTARR_USERNAME=your-username
YOUTARR_PASSWORD=your-password
YOUTARR_FEED_DATA_DIR=/data
YOUTARR_MEDIA_DIR=/usr/src/app/data
```

Edit `docker-compose.yml` so the media mount matches your host:

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

## Docker Run Example

```bash
docker run -d \
  --name youtarr-feed \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 3090:3000 \
  -e YOUTARR_URL=http://host.docker.internal:3087 \
  -e YOUTARR_USERNAME=your-username \
  -e YOUTARR_PASSWORD=your-password \
  -e YOUTARR_FEED_DATA_DIR=/data \
  -e YOUTARR_MEDIA_DIR=/usr/src/app/data \
  -v ./data:/data \
  -v /path/to/youtarr/output:/usr/src/app/data:ro \
  ghcr.io/nelisvanwijk/youtarr-feed:latest
```

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `YOUTARR_URL` | Yes for live mode | URL reachable from the Youtarr Feed container. |
| `YOUTARR_USERNAME` | Usually | Youtarr username. Not needed when using a session token or disabled auth. |
| `YOUTARR_PASSWORD` | Usually | Youtarr password. Kept server-side only. |
| `YOUTARR_SESSION_TOKEN` | Optional | Alternative to username/password. Sessions may expire. |
| `YOUTARR_AUTH_DISABLED` | Optional | Set to `true` only if your Youtarr auth is intentionally disabled. |
| `YOUTARR_API_KEY` | Optional | Optional Youtarr API key for download commands. |
| `YOUTARR_FEED_DATA_DIR` | Recommended | Persistent app data directory. Defaults to `/data` in production. |
| `YOUTARR_MEDIA_DIR` | Recommended | Read-only mount of the Youtarr output folder for direct streaming. |
| `PLEX_URL` | Optional | Plex server URL for refresh requests. |
| `PLEX_TOKEN` | Optional | Plex token. |
| `PLEX_LIBRARY_ID` | Optional | Numeric Plex library section ID. |

## iPhone, AirPlay, And Codecs

Direct local streaming can reduce buffering because it removes the Youtarr
stream proxy from the playback path. It does not fix codec compatibility.

For Apple devices and AirPlay, the safest high-quality target is usually:

```text
MP4 container + HEVC/H.265 video + AAC audio
```

4K is possible on Apple TV with HEVC, but many YouTube 4K files are VP9 or AV1.
Those may show black video, audio-only playback, or unstable AirPlay depending
on the device, browser, and container.

In Youtarr's yt-dlp custom arguments, Apple-friendly examples are:

```bash
-S "res,codec:hevc:h264,acodec:aac" --merge-output-format mp4
```

Stricter compatibility, often lower than 4K:

```bash
-S vcodec:h264,acodec:aac --merge-output-format mp4
```

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
Use HTTPS through a reverse proxy or private access such as Tailscale/WireGuard.

Mount the Youtarr media folder read-only in Youtarr Feed. Let Youtarr handle
downloads and deletes.
