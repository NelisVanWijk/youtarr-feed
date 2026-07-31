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
- Re-download videos Youtarr marks as missing after their files were removed.
- Delete a downloaded video through Youtarr.
- Server-side watch progress stored in `/data/watch-progress.json`.
- Server-side feed cache stored in `/data/feed-cache.json` for faster first opens.
- Continue Watching tab synced across browsers/devices.
- Local downloads tab with all videos Youtarr currently marks as downloaded.
- Single Videos tab for one-off YouTube links without subscribing to a channel.
- Language module with English as the default UI language and Dutch as an option.
- Optional Plex library refresh after a download completes.
- Optional direct local file streaming from the mounted Youtarr media folder.
- Stable feed sorting when Youtarr returns date-only publish values.
- Optional YouTube Data API fallback for exact publish timestamps.
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

- `Direct file`: streaming from the read-only media mount.
- `Via Youtarr`: local file was not found, so playback uses Youtarr's stream
  endpoint.
- `Compatible stream`: Apple-friendly HLS generated server-side from the local
  file, used only when enabled and needed for iPhone, iPad, Safari, or AirPlay.

Video thumbnails also show a compact `Direct` or `Youtarr` badge for downloaded
items, so you can see the expected playback path before opening the video.

Direct local streaming does not change delete behavior. Deletes still go
through Youtarr, so Youtarr remains the owner of the library.
Deleting a download also removes its cached compatible transcode.

The Local tab uses Youtarr's downloaded-video state as its source of truth. It
shows all videos Youtarr reports as downloaded and lets you play or delete them
from one overview.

## Feed Ordering

Youtarr Feed sorts by the `publishedAt` value it receives from Youtarr. If
Youtarr returns a full timestamp, that timestamp is used directly. If Youtarr
only returns a date such as `2026-07-30`, or a date converted to a synthetic
whole-hour timestamp such as `2026-07-30T02:00:00.000Z`, videos from the same
date keep a stable Youtarr source order so the feed does not reshuffle on
refresh.

For the most accurate chronological feed, add a YouTube Data API key in
Youtarr's own Configuration page under Integrations. Youtarr uses its
`youtubeApiKey` setting for channel and video metadata.

As a fallback, this app can also use `YOUTUBE_API_KEY`. When set, Youtarr Feed
enriches date-only or missing publish values server-side through the official
YouTube `videos.list` endpoint and then sorts using the returned
`snippet.publishedAt` timestamp. Requests are batched in groups of up to 50
video IDs; `videos.list` costs 1 quota unit per call.

## Server-Side Cache

The feed and Local tab use a small server-side cache so opening the app does not
need to wait for every Youtarr channel request each time. By default cached
results are reused for 300 seconds and stored in the persistent app data
directory:

```text
/data/feed-cache.json
/data/local-videos-cache.json
/data/single-videos.json
```

When a cache entry is older than the TTL, the app returns the old result
immediately and refreshes it in the background. The cache is not discarded just
because it is older than the TTL, so opening the app hours later can still show
the last known feed quickly as long as `/data` is persistent. Manual refreshes,
deletes, downloads, channel adds, and single-video changes invalidate or bypass
the relevant data.

Set `YOUTARR_FEED_CACHE_TTL_SECONDS` to tune this. Higher values make first open
faster for longer, lower values keep the feed closer to Youtarr on every open.

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

The App Data path is important. Watch progress, cached feed data, and single
video links are stored there and survive container updates:

```text
/mnt/user/appdata/youtarr-feed/watch-progress.json
/mnt/user/appdata/youtarr-feed/single-videos.json
```

If watch progress or single videos disappear after updates, check that `/data`
is mapped to a persistent host path.

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

## Native iOS App

An experimental SwiftUI iOS client lives in:

```text
ios/YoutarrFeed/YoutarrFeed.xcodeproj
```

Open that project in Xcode on a Mac, select the `Youtarr Feed` target, choose
your Apple development team under Signing & Capabilities, and run it on an
iPhone or simulator.

The iOS app uses the same Youtarr Feed server API as the web app:

- Feed, Continue Watching, Local, Offline, Channels, and Settings tabs.
- Native `AVPlayer` playback with AirPlay, PiP, and lock screen metadata hooks.
- Server-side watch progress sync through `/api/watch-progress`.
- Offline playback progress is kept locally and synced back when the server is
  reachable.
- Server download and delete actions through Youtarr Feed.
- Offline iPhone downloads stored in the app sandbox through background
  `URLSession` downloads.

On a real iPhone, set the server URL in the app settings to a LAN-reachable
address, for example:

```text
http://192.168.1.50:3090
```

Do not use `localhost` on a real iPhone; that points to the phone itself.

## Docker Run Example

```bash
docker run -d \
  --name youtarr-feed \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  --device=/dev/dri:/dev/dri \
  -p 3090:3000 \
  -e YOUTARR_URL=http://host.docker.internal:3087 \
  -e YOUTARR_USERNAME=your-username \
  -e YOUTARR_PASSWORD=your-password \
  -e YOUTARR_FEED_DATA_DIR=/data \
  -e YOUTARR_MEDIA_DIR=/usr/src/app/data \
  -e YOUTARR_TRANSCODE_ENABLED=true \
  -e YOUTARR_TRANSCODE_ACCEL=vaapi \
  -e YOUTARR_TRANSCODE_DEVICE=/dev/dri/renderD128 \
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
| `YOUTUBE_API_KEY` | Optional | Fallback YouTube Data API key for enriching date-only publish values with exact timestamps. Prefer setting the key in Youtarr first. |
| `YOUTARR_FEED_DATA_DIR` | Recommended | Persistent app data directory. Defaults to `/data` in production. |
| `YOUTARR_FEED_CACHE_TTL_SECONDS` | Optional | Server-side feed/local-video cache duration. Defaults to `300`. |
| `YOUTARR_MEDIA_DIR` | Recommended | Read-only mount of the Youtarr output folder for direct streaming. |
| `YOUTARR_TRANSCODE_ENABLED` | Optional | Set to `true` to enable Apple-compatible transcoding. |
| `YOUTARR_TRANSCODE_ACCEL` | Optional | Use `vaapi` for Intel Quick Sync, or `software`. Defaults to `vaapi` when a device is configured. |
| `YOUTARR_TRANSCODE_DEVICE` | Optional | VAAPI render device, usually `/dev/dri/renderD128` on Unraid/Linux. |
| `YOUTARR_TRANSCODE_DIR` | Optional | Compatible-file cache and temporary transcode working directory. Defaults to `<data dir>/transcodes`. |
| `YOUTARR_TRANSCODE_OUTPUT_MODE` | Optional | Use `file` to create reusable compatible MP4 files, or `hls` for the older temporary HLS mode. Defaults to `file`. |
| `YOUTARR_TRANSCODE_MIN_HEIGHT` | Optional | Only transcode videos at this height or higher. Defaults to `1440`, so 1440p and 4K are prepared while 1080p is skipped. Set `0` to allow all resolutions. |
| `YOUTARR_TRANSCODE_PLAYBACK_MODE` | Optional | HLS-only. Use `vod` to avoid Apple's Live Broadcast label, or `fast` to start while HLS is still growing. Defaults to `vod`. |
| `YOUTARR_TRANSCODE_VIDEO_BITRATE` | Optional | Target video bitrate for compatible output when software transcoding is used. Defaults to `18000k`. |
| `YOUTARR_TRANSCODE_VAAPI_QUALITY` | Optional | VAAPI CQP quality value. Lower is higher quality. Defaults to `20`. |
| `YOUTARR_TRANSCODE_AUDIO_BITRATE` | Optional | Target AAC audio bitrate. Defaults to `160k`. |
| `PLEX_URL` | Optional | Plex server URL for refresh requests. |
| `PLEX_TOKEN` | Optional | Plex token. |
| `PLEX_LIBRARY_ID` | Optional | Numeric Plex library section ID. |

## iPhone, AirPlay, And Codecs

Direct local streaming can reduce buffering because it removes the Youtarr
stream proxy from the playback path. It does not fix codec compatibility by
itself.

When transcoding is enabled, Youtarr Feed checks local video files with
`ffprobe`. By default it only prepares compatible versions for 1440p and 4K
files, because those are the files most likely to be VP9, AV1, HEVC, or otherwise
awkward for Apple playback.

The default `YOUTARR_TRANSCODE_OUTPUT_MODE=file` creates a reusable
Apple-compatible `compatible.mp4` cache file with `ffmpeg`. When a newly queued
download finishes while the web app is open, Youtarr Feed starts that compatible
file in the background. For existing downloaded videos, use the three-dot menu
and choose **Prepare compatible file**.

Apple clients prefer the compatible MP4 when it exists. Other clients keep using
the original direct file, so Windows/Chrome-style playback does not use the
compatible copy. Watch progress is still stored against the original video and
duration. Compatible files are removed when the download is deleted.

The older HLS mode is still available with `YOUTARR_TRANSCODE_OUTPUT_MODE=hls`.
In that mode, `YOUTARR_TRANSCODE_PLAYBACK_MODE=vod` avoids Apple's "Live
Broadcast" label by waiting for a finite playlist, while `fast` starts as soon
as the first segment exists.

For Intel Quick Sync on Unraid, pass the render device into the container:

```text
Extra Parameters: --device=/dev/dri:/dev/dri
```

Recommended transcode variables:

```env
YOUTARR_TRANSCODE_ENABLED=true
YOUTARR_TRANSCODE_ACCEL=vaapi
YOUTARR_TRANSCODE_DEVICE=/dev/dri/renderD128
YOUTARR_TRANSCODE_OUTPUT_MODE=file
YOUTARR_TRANSCODE_MIN_HEIGHT=1440
YOUTARR_TRANSCODE_VAAPI_QUALITY=20
```

After updating the container, VAAPI can be checked from inside the container:

```bash
docker exec -it youtarr-feed vainfo --display drm --device /dev/dri/renderD128
```

For Intel 11th gen and newer, the container uses the `iHD` VAAPI driver.

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
