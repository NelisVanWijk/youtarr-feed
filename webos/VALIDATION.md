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

- User updates the MyTube Docker image after the GitHub build finishes.
- Global `tsc --noEmit` has existing failures outside the TV changes, in
  FeedApp, local-media, single-videos, youtarr, and Worker binding declarations.
  These did not prevent the production build or API/rendered test suite.

## September 12 refinement

- Added black browsing layout, larger typography, collapsed icon navigation,
  subscription rail, search, relative dates, and fixed thumbnail overlay geometry.
- Live server API checks: one Floatplane creator, 11 channels; creator/channel
  filters return videos and offset pagination returns distinct subsequent videos.
  A sampled stream source reports MP4/H.264 at 1080p. This is source metadata,
  not a new hardware playback test or a cap imposed by the TV interface.
- Launcher tests verify changed addresses, remembered ports/origins, invalid
  addresses, and operation with unavailable local storage.
- Normal launcher 1.1.0 packaged and installed successfully on the LG, replacing
  the temporary PC-preview package. The startup screen allows changing the URL.
- Latest visual refinements and Floatplane playback still require the user's TV
  check after Docker update. Browser automation was unavailable during the final
  refinement pass; the earlier LG playback results above apply to that earlier
  version, not to newly added Floatplane playback.

## Follow-up from television photos

- Focused navigation now has an opaque white background and dark text in one
  rule, including when the item is also selected. The expanded menu is opaque.
- Center-crop YouTube thumbnails so the baked-in letterboxing of 4:3 thumbnail
  files does not appear above the image. Badges remain positioned overlays.
- The video results scroll independently of the heading; changing tabs/channels
  resets the results to the top. Returning to the first row reveals its full top.
- Launcher 1.2.0 opens saved servers automatically after 2.5 seconds. Any remote
  key or editing cancels this, allowing recovery without an extra OK every launch.
  Package validation and installation on the LG succeeded. Auto-open/cancel are
  covered by launcher tests. Browser automation remains unavailable; the latest
  visual and scrolling behavior needs a TV check after the Docker update.

## Long-press actions and watched bars

- Holding OK for 650 ms opens a modal video action menu; short OK opens the
  existing playback/download action. Pointer holds and right-click are supported.
- Watched/unwatched uses the shared PUT watch-progress API for both providers.
  YouTube downloads use the existing delete API after a second selection;
  Floatplane deletion is hidden and blocked in the action handler.
- Watched thumbnails have a full red bar; explicit unwatched state clears it.
- Build, targeted lint, and 24 automated tests passed, including hold/release,
  cancellation, stale cards, delete guarding, shared watched state, and bar values.
  No real user videos were deleted during these tests. Physical remote behavior
  and the new modal still need the user's TV check after Docker update.
