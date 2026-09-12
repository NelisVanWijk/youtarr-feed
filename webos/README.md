# MyTube for LG webOS

The package is a small hosted-app launcher. The TV interface lives in MyTube at
`/tv` (redirecting to `/tv/index.html`), separately from the mobile interface.
Deploy/rebuild MyTube with these source changes before using the launcher.
The TV and MyTube server must be able to reach each other on your network.
No Youtarr password or API key belongs in this package.

On first launch, enter your MyTube address and select Open MyTube. The launcher
remembers it. Subsequent launches open the saved server automatically after
2.5 seconds. Press any key or choose Adres wijzigen during that interval to
cancel automatic opening and edit the address. Close and relaunch the app
to recover from an unreachable hosted page.
This uses LG's hosted-app redirect pattern, not an iframe.
Version 1.2.0 replaces the temporary PC-preview launcher with this editable
startup screen. In the hosted interface, **Serveradres** can also switch servers
for the current session. Change the startup screen's address to remember a new
default across app launches. Fully close/relaunch the app to recover if a server
is unreachable.

## Package and install

Using the LG webOS CLI from the MyTube folder:

```powershell
ares-package --check ./webos
ares-package ./webos -e README.md -o ./webos-dist
ares-install -d mytv ./webos-dist/nl.vossenwijk.mytube_1.2.0_all.ipk
ares-launch -d mytv nl.vossenwijk.mytube
```

The TV needs Developer Mode and an existing CLI pairing (`mytv` is an example
device name). This app has its own ID and does not replace SUB/WAVE.

## Controls and playback

- D-pad moves between navigation, cards, and player buttons; OK selects.
- Pointer selection works too. The icon-only left menu expands when focused.
  Zoeken searches the YouTube feed; Home shows the feed; Abonnementen has a
  second rail of subscribed channels; Bibliotheek shows downloaded files with
  Continue Watching and Unwatched filters.
- Back closes playback and restores card focus; from the library it asks to exit.
- Play, Pause, Stop, Rewind, and Fast Forward remote keys are supported.
- Player controls hide after five seconds while playing. OK reveals them;
  left/right while hidden seek ten seconds. Visible controls have seek buttons.
- Progress saves every ten seconds, on pause, and on leaving playback. The same
  MyTube progress store is used on mobile and TV. Hiding the app pauses playback.
- Feed shows the regular chronological subscription feed, including undownloaded
  and missing videos, channel avatars, duration, dates, and Direct/Youtarr badges.
  Metadata uses relative Dutch upload dates. Thumbnails occupy a fixed 16:9
  region; source and duration badges overlay the image without affecting layout.
- Select an undownloaded/missing video, then Download. The app queues the existing
  Youtarr download action (including configured secondary instances). It polls
  global Youtarr activity and confirms this video's availability separately,
  then offers Play now. Closing the dialog leaves the download running.
  Download quality follows the existing Youtarr settings; set 2160p there for 4K.
- Play/Pause is the default focused control on opening and revealing the player.
  The TV interface uses Apple-inspired glass navigation and dialogs, compact
  SVG controls, and reduced-motion/transparency/high-contrast fallbacks.
- Floatplane has a separate creator/channel rail and paginated feeds per scope.
  It streams through the existing Floatplane endpoint, using the TV's native
  MP4/HLS playback, with shared watch progress. Youtarr codec profiles and download
  actions do not apply to Floatplane. Subscription/session administration stays
  in the regular interface. The phone/desktop UI is unchanged.
- Demo YouTube videos cannot play or download; a configured Floatplane account
  works independently of YouTube demo mode.

Playback uses the existing same-origin Range streaming endpoint. No new
transcoding is added. Container, video codec, audio codec, and resolution must
be supported by the actual TV. H.264/AAC MP4 is a useful compatibility target;
The TV player prefers a configured AV1 instance, otherwise the primary original
file, bypassing global phone/tablet profile defaults. On this installation the
inspected primary file is AV1/AAC MP4. If additional AV1/VP9 instances are
configured, the player offers a Version selector and tries untried backups on
media errors, retaining the playback position. Each version retains its original
resolution; nothing in the TV player caps output at 1080p. The resolution label
reports the video's decoded dimensions, including `4K · 3840 × 2160` for UHD.
You must have a 2160p download in the selected instance. The 1920×1080 webOS
app manifest specifies the UI canvas, not a video resolution cap.
LG documents up to 2160p60 for HEVC, VP9, and AV1 on supported UHD models:
[webOS 23 media specifications](https://webostv.developer.lge.com/develop/specifications/video-audio-230).
4K, HDR, HEVC, AV1, and audio support must still be tested on the target model.
Do not interpret desktop browser testing as hardware playback certification.

Reference: [LG hosted app sample](https://webostv.developer.lge.com/develop/samples)
and [Back handling](https://webostv.developer.lge.com/develop/guides/back-button).
The layout takes cues from [YouTube's TV experience](https://blog.youtube/news-and-events/designing-a-richer-youtube-experience-for-your-tvs/):
left navigation, large thumbnails, clear focus, and unobtrusive playback controls.

The default is chosen for this installation, not a universal LG codec preference.
LG lists AV1/AAC in MP4. The inspected VP9 backup is also MP4, a pairing not
explicitly listed by LG; retain it as a backup but verify on the TV.
