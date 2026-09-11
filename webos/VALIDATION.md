# TV implementation verification

The TV interface is hosted in `public/tv`; `/tv` redirects there. The package
only opens the server address, so normal MyTube releases carry TV updates.

## Verified locally

- Production build and rendered/API tests, including the new TV entry/config.
- ESLint for TV scripts and routes; LG package validation and IPK creation.
- Real server at `http://192.168.100.43:3090`: 160 feed videos and five downloads
  at verification time. Feed includes missing/undownloaded items, Direct badges,
  and channel avatars. The first nine visible avatars loaded successfully.
- Real primary playback of `9otJfSbgj9U`: 3840 x 2160, advancing playback,
  pause, 10-second seek, Back, and resume. The inspected MP4 header contains
  AV1 (`av01`) and AAC (`mp4a`) sample entries.
- Injected primary stream failure: player switched to VP9 backup, displayed
  3840 x 2160, and retained Play/Pause focus. VP9 backup MP4 header contains
  `vp09` and `mp4a` entries.
- Simulated download: Download -> queued -> readiness check -> Play now.
  Simulation did not submit a real download job. Preview progress was isolated
  from the real server's progress store.
- Television-sized layout inspected at 1920 x 1080; compact glass player,
  entire TV glass design, channel avatars, source badges, and remote focus.

## Verified on the LG G3

- Installed and launched on OLED65G36LA, SDK 11.2.0, firmware 43.21.71.
  WebAppManager reports Chromium 132. The TV rendered the complete 1920x1080
  feed with channel avatars and source badges; the user confirmed it looked good.
- AV1 primary: hardware page reported 3840x2160, advancing currentTime,
  paused=false, error=null, and focused element `toggle`.
- Pause keycode 19 paused at 41.126 seconds; +10 advanced to 51.126.
- VP9 backup MP4 also played on this specific TV at 3840x2160, continuing
  from the previous position (64.049 seconds at verification), error=null.
- Back keycode 461 returned to the library and restored focus to `9otJfSbgj9U`.
  Remote keycodes were dispatched through the live TV inspector; physical
  remote behavior and long-duration/HDR testing still benefit from user testing.
- The test package uses the PC's temporary same-origin proxy at
  `http://192.168.100.97:5175`. It must be replaced by the normal launcher after
  the user updates Docker. The MyTube server was not modified during testing.

## Remaining deployment checks

- User updates the MyTube Docker image after the GitHub build finishes; then
  reinstall the normal launcher targeting `http://192.168.100.43:3090`.
- Global `tsc --noEmit` has existing failures outside the TV changes, in
  FeedApp, local-media, single-videos, youtarr, and Worker binding declarations.
  These did not prevent the production build or API/rendered test suite.
