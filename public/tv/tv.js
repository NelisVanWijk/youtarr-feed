(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var videos = [], progress = {}, watched = [], tab = 'all', active = null, origin = null;
  var video = $('video'), demo = false, hideTimer, lastSave = 0, saveQueue = Promise.resolve(), resumeAt = 0;
  var pendingVideo = null, downloadOrigin = null, jobs = {}, pollTimer, polling = false, pollCount = 0;
  var sources = {}, sourceRequests = {}, feedIds = null, unwatched = [];
  var defaultProfile = 'primary', playbackProfiles = [{ id: 'primary', label: 'Primary' }], attemptedProfiles = [];
  function isWatched(item) { return watched.indexOf(item.id) >= 0 || (unwatched.indexOf(item.id) < 0 && item.watched); }
  function message(text) { $('status').textContent = text; }
  function time(value) {
    value = Math.max(0, Math.floor(Number(value) || 0));
    return (value >= 3600 ? Math.floor(value / 3600) + ':' : '') +
      (value >= 3600 ? String(Math.floor(value / 60) % 60).padStart(2, '0') : Math.floor(value / 60)) + ':' + String(value % 60).padStart(2, '0');
  }
  function json(path, options) {
    var controller = new AbortController(), timeout = setTimeout(function () { controller.abort(); }, 20000);
    return fetch(path, Object.assign({ cache: 'no-store', signal: controller.signal }, options || {})).then(function (response) {
      if (!response.ok) return response.json().catch(function () { return {}; }).then(function (body) { throw new Error(body.error || 'Server returned ' + response.status); });
      return response.json();
    }).finally(function () { clearTimeout(timeout); });
  }
  function render() {
    $('grid').textContent = '';
    var filtered = videos.filter(function (item) {
      return (!$('channel').value || item.channelId === $('channel').value) &&
        ((tab !== 'all' && tab !== 'unwatched') || !feedIds || feedIds.indexOf(item.id) >= 0) &&
        (tab !== 'downloads' || (item.downloaded && !item.missing)) &&
        (tab !== 'continue' || (progress[item.id] && item.downloaded && !item.missing)) &&
        (tab !== 'unwatched' || !isWatched(item));
    });
    if (tab === 'continue') filtered.sort(function (a, b) { return progress[b.id].updatedAt - progress[a.id].updatedAt; });
    $('grid').className = 'grid';
    filtered.forEach(function (item) {
      var button = document.createElement('button'); button.className = 'card'; button.dataset.id = item.id;
      var art = document.createElement('div'); art.className = 'art';
      var img = document.createElement('img'); img.src = item.thumbnail || '/tv/placeholder.svg'; img.alt = ''; img.loading = 'lazy';
      img.onerror = function () { img.onerror = null; img.src = '/tv/placeholder.svg'; }; art.appendChild(img);
      var duration = document.createElement('span'); duration.className = 'duration'; duration.textContent = time(item.duration); art.appendChild(duration);
      var badge = document.createElement('span'); badge.className = 'download-badge'; badge.dataset.sourceId = item.id;
      badge.textContent = item.missing ? 'File missing' : !item.downloaded ? jobs[item.id] ? 'Queued' : 'Not downloaded' : item.sourceLabel || sources[item.id] || 'Downloaded';
      if (item.downloaded && !item.missing) badge.classList.add('available'); art.appendChild(badge);
      if (item.downloaded && !item.missing && !demo && !sources[item.id] && !sourceRequests[item.id]) {
        sourceRequests[item.id] = true;
        json('/api/stream/' + encodeURIComponent(item.id) + '/source?profile=primary').then(function (source) {
          sources[item.id] = source.source === 'local' ? 'Direct' : 'Youtarr';
          document.querySelectorAll('[data-source-id]').forEach(function (label) { if (label.dataset.sourceId === item.id) label.textContent = item.sourceLabel || sources[item.id]; });
        }).catch(function () { delete sourceRequests[item.id]; });
      }
      var entry = progress[item.id];
      if (entry) { var bar = document.createElement('div'); bar.className = 'progress'; bar.style.width = Math.min(100, entry.currentTime / entry.duration * 100) + '%'; art.appendChild(bar); }
      button.appendChild(art);
      var title = document.createElement('strong'); title.textContent = item.title; button.appendChild(title);
      var meta = document.createElement('div'); meta.className = 'card-meta';
      var avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.setAttribute('aria-hidden', 'true');
      var initials = document.createElement('span'); initials.textContent = item.channelName.split(/\s+/).map(function (word) { return word.charAt(0); }).slice(0, 2).join(''); avatar.appendChild(initials);
      var avatarImage = document.createElement('img'); avatarImage.src = item.channelAvatar || '/api/channel-avatar/' + encodeURIComponent(item.channelId); avatarImage.alt = ''; avatarImage.loading = 'lazy';
      avatarImage.onerror = function () { avatarImage.remove(); }; avatar.appendChild(avatarImage); meta.appendChild(avatar);
      var metaCopy = document.createElement('div'); metaCopy.className = 'card-meta-copy';
      var detail = document.createElement('small'); detail.textContent = item.channelName + (entry ? ' · Resume ' + time(entry.currentTime) : isWatched(item) ? ' · Watched' : ''); metaCopy.appendChild(detail);
      if (item.publishedAt) { var published = document.createElement('small'); published.className = 'published'; published.textContent = new Date(item.publishedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); metaCopy.appendChild(published); }
      meta.appendChild(metaCopy); button.appendChild(meta);
      button.onclick = function () { if (item.downloaded && !item.missing) open(item, button); else showDownload(item, button); }; $('grid').appendChild(button);
    });
    message((demo ? 'Demo library — connect Youtarr to download and play videos. ' : '') + (filtered.length ? filtered.length + ' videos' : tab === 'continue' ? 'Nothing to resume yet.' : 'No videos here. Choose another channel or refresh.'));
  }
  function load() {
    message('Loading your library…'); $('refresh').disabled = true;
    return Promise.all([json('/api/local-videos'), json('/api/watch-progress').catch(function () { return null; }), json('/api/feed').catch(function () { return null; })]).then(function (results) {
      demo = results[0].mode === 'demo';
      feedIds = results[2] ? results[2].videos.map(function (item) { return item.id; }) : null;
      var merged = {}; (results[2] ? results[2].videos : []).concat(results[0].videos).forEach(function (item) { merged[item.id] = item; });
      videos = Object.keys(merged).map(function (id) { return merged[id]; }).sort(function (a, b) { return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0); });
      if (results[1]) { progress = results[1].progress; watched = results[1].watchedVideoIds; unwatched = results[1].unwatchedVideoIds || []; }
      var selected = $('channel').value; $('channel').textContent = '';
      var all = document.createElement('option'); all.value = ''; all.textContent = 'All channels'; $('channel').appendChild(all);
      var channels = {}; videos.forEach(function (item) { channels[item.channelId] = item.channelName; });
      Object.keys(channels).sort(function (a, b) { return channels[a].localeCompare(channels[b]); }).forEach(function (id) {
        var option = document.createElement('option'); option.value = id; option.textContent = channels[id]; $('channel').appendChild(option);
      });
      $('channel').value = channels[selected] ? selected : ''; render();
      if (!results[1]) message($('status').textContent + ' Watch progress is unavailable.');
      if (!results[2]) message($('status').textContent + ' The subscription feed is unavailable; showing downloads.');
      if (results[0].warnings && results[0].warnings.length) message($('status').textContent + ' ' + results[0].warnings.join(' '));
    }).catch(function () { message('Could not reach MyTube. Check the server, then choose Refresh.'); }).finally(function () { $('refresh').disabled = false; });
  }
  function restoreCard(id) {
    var target = Array.prototype.find.call(document.querySelectorAll('.card'), function (card) { return card.dataset.id === id; });
    (target || document.querySelector('[data-tab]')).focus();
  }
  function showDownload(item, button) {
    pendingVideo = item; downloadOrigin = button;
    $('download-title').textContent = item.title; $('download-channel').textContent = item.channelName;
    $('download-dialog').showModal(); downloadState();
    ($('download-start').disabled ? $('download-close') : $('download-start')).focus();
  }
  function downloadState(note) {
    if (!pendingVideo) return;
    var ready = pendingVideo.downloaded && !pendingVideo.missing;
    $('download-start').textContent = ready ? 'Play now' : jobs[pendingVideo.id] ? 'Download queued' : 'Download';
    $('download-start').disabled = !!jobs[pendingVideo.id] && !ready;
    $('download-message').textContent = note || (ready ? 'Ready to watch in original quality.' : jobs[pendingVideo.id] ? 'Queued in Youtarr. You can keep browsing while it downloads.' : pendingVideo.missing ? 'The downloaded file is missing. Download it again to watch.' : 'Download this video to your Youtarr library to watch it.');
  }
  function closeDownload() { $('download-dialog').close(); var id = pendingVideo && pendingVideo.id; pendingVideo = null; restoreCard(id); }
  function schedulePoll() { clearTimeout(pollTimer); if (Object.keys(jobs).length) pollTimer = setTimeout(pollDownloads, 5000); }
  function pollDownloads(force) {
    if (polling) return Promise.resolve();
    if (document.hidden) { schedulePoll(); return Promise.resolve(); }
    polling = true; pollCount++;
    return Promise.all([json('/api/activity').catch(function () { return null; }),
      (force || pollCount % 3 === 0) ? json('/api/local-videos?refresh=1') : Promise.resolve(null)
    ]).then(function (results) {
      var activity = results[0], locals = results[1];
      if (locals) {
        var selectedId = document.activeElement && document.activeElement.dataset.id;
        locals.videos.forEach(function (item) {
          if (!item.downloaded || item.missing) return;
          var index = videos.findIndex(function (v) { return v.id === item.id; });
          if (index >= 0) videos[index] = item; else videos.push(item);
          delete jobs[item.id];
          if (pendingVideo && pendingVideo.id === item.id) pendingVideo = item;
        });
        render(); if (selectedId && !active && !$('download-dialog').open) restoreCard(selectedId);
      }
      if (pendingVideo) {
        var ready = pendingVideo.downloaded && !pendingVideo.missing;
        var note = !ready && activity && activity.state === 'active' ? 'Youtarr activity: ' + Math.round(activity.percent || 0) + '%. Waiting for this video to become available.' : undefined;
        if (!ready && activity && activity.state === 'error') note = 'Youtarr reports a download error. Check the job in Youtarr; this video is not ready yet.';
        downloadState(note);
      }
    }).catch(function () { downloadState('Could not check the download. Choose Check status to try again.'); }).finally(function () { polling = false; schedulePoll(); });
  }
  $('download-start').onclick = function () {
    if (!pendingVideo) return;
    if (pendingVideo.downloaded && !pendingVideo.missing) { var item = pendingVideo, button = downloadOrigin; closeDownload(); open(item, button); return; }
    if (demo) { downloadState('Connect Youtarr on the server to download real videos.'); return; }
    var itemToDownload = pendingVideo;
    if (jobs[itemToDownload.id]) return;
    jobs[itemToDownload.id] = true; downloadState('Sending to Youtarr…'); $('download-close').focus();
    json('/api/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: itemToDownload.id, channelId: itemToDownload.channelId, missing: itemToDownload.missing }) }).then(function () {
      if (pendingVideo && pendingVideo.id === itemToDownload.id) downloadState();
      render(); schedulePoll();
    }).catch(function (error) {
      delete jobs[itemToDownload.id];
      if (pendingVideo && pendingVideo.id === itemToDownload.id) downloadState(error.message);
      else message('Download could not be confirmed: ' + error.message);
    });
  };
  $('download-close').onclick = closeDownload;
  $('download-check').onclick = function () { pollDownloads(true); };
  function save() {
    if (!active || demo || !isFinite(video.duration) || video.duration <= 0 || video.readyState < 1) return saveQueue;
    var body = { videoId: active.id, currentTime: video.currentTime, duration: video.duration };
    if (body.currentTime > body.duration - 8) { delete progress[body.videoId]; if (watched.indexOf(body.videoId) < 0) watched.push(body.videoId); }
    else if (body.currentTime >= 5) progress[body.videoId] = Object.assign({ updatedAt: Date.now() }, body);
    else delete progress[body.videoId];
    saveQueue = saveQueue.catch(function () {}).then(function () {
      return json('/api/watch-progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true });
    }).catch(function () { $('player-status').textContent = 'Watch progress could not be saved. Check your connection.'; showControls(); });
    return saveQueue;
  }
  function showControls() {
    clearTimeout(hideTimer); $('controls').classList.remove('concealed');
    if (!video.paused) hideTimer = setTimeout(function () { $('controls').classList.add('concealed'); }, 5000);
  }
  function play() {
    var source = video.src;
    video.play().catch(function () {
      if (!active || video.src !== source) return;
      $('player-status').textContent = 'Press Play to start. If playback still fails, this video format may not be supported by your TV.'; showControls();
    });
  }
  function toggle() { if (video.paused) play(); else video.pause(); showControls(); }
  function playbackButton(paused) {
    $('toggle').setAttribute('aria-label', paused ? 'Play' : 'Pause');
    $('toggle').title = paused ? 'Play' : 'Pause';
    $('toggle-glyph').setAttribute('href', '/tv/icons.svg#' + (paused ? 'play' : 'pause'));
  }
  function seek(delta) { if (isFinite(video.duration)) video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + delta)); showControls(); }
  function open(item, button) {
    if (demo) { message('This is a demo. Configure Youtarr on the MyTube server to play your own downloads.'); return; }
    active = item; origin = button; lastSave = Date.now();
    attemptedProfiles = []; $('source').value = defaultProfile;
    $('library').hidden = true; $('player').hidden = false;
    $('playing-title').textContent = item.title; $('playing-channel').textContent = item.channelName;
    $('player-status').textContent = 'Loading video…'; $('position').style.width = '0%'; $('time').textContent = '0:00 / ' + time(item.duration);
    resumeAt = progress[item.id] ? progress[item.id].currentTime : 0;
    startSource(); $('toggle').focus(); showControls();
  }
  function startSource() {
    $('quality').textContent = 'Original quality · detecting resolution…';
    var profile = $('source').value || 'primary';
    if (attemptedProfiles.indexOf(profile) < 0) attemptedProfiles.push(profile);
    video.src = '/api/stream/' + encodeURIComponent(active.id) + '?profile=' + encodeURIComponent(profile);
    video.load(); play();
  }
  function backupSource() {
    var next = playbackProfiles.find(function (profile) { return attemptedProfiles.indexOf(profile.id) < 0; });
    if (!next) return false;
    if (video.currentTime > 0) resumeAt = video.currentTime;
    $('source').value = next.id;
    $('player-status').textContent = 'Trying backup version: ' + next.label;
    startSource(); $('toggle').focus(); showControls(); return true;
  }
  function close() {
    save(); video.pause(); active = null; video.removeAttribute('src'); video.load(); clearTimeout(hideTimer);
    $('player').hidden = true; $('library').hidden = false;
    var id = origin && origin.dataset.id; render();
    var target = Array.prototype.find.call(document.querySelectorAll('.card'), function (card) { return card.dataset.id === id; });
    (target || document.querySelector('[data-tab]')).focus();
  }
  function back() {
    if ($('download-dialog').open) closeDownload();
    else if ($('exit-dialog').open) { $('exit-dialog').close(); $('exit').focus(); }
    else if (active) close();
    else { $('exit-dialog').showModal(); $('stay').focus(); }
  }
  function move(code) {
    var root = $('download-dialog').open ? $('download-dialog') : $('exit-dialog').open ? $('exit-dialog') : active ? $('controls') : $('library');
    var elements = Array.prototype.filter.call(root.querySelectorAll('button:not(:disabled),select'), function (el) { return el.offsetWidth > 0; });
    var current = document.activeElement;
    if (elements.indexOf(current) < 0) { if (elements[0]) elements[0].focus(); return; }
    var rect = current.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2, best, score = Infinity;
    elements.forEach(function (el) {
      if (el === current) return;
      var r = el.getBoundingClientRect(), dx = r.left + r.width / 2 - x, dy = r.top + r.height / 2 - y;
      var primary = code === 37 ? -dx : code === 39 ? dx : code === 38 ? -dy : dy;
      var secondary = Math.abs(code === 37 || code === 39 ? dy : dx);
      if (primary > 5 && primary + secondary * 3 < score) { score = primary + secondary * 3; best = el; }
    });
    if (best) { best.focus(); best.scrollIntoView({ block: 'nearest' }); }
  }
  document.querySelectorAll('[data-tab]').forEach(function (button) { button.onclick = function () {
    tab = button.dataset.tab; document.querySelectorAll('[data-tab]').forEach(function (el) { el.setAttribute('aria-pressed', String(el === button)); });
    $('heading').textContent = tab === 'all' ? 'Your feed' : tab === 'continue' ? 'Continue watching' : tab === 'downloads' ? 'Downloads' : 'Unwatched'; render();
  }; });
  $('refresh').onclick = load; $('channel').onchange = render; $('exit').onclick = back;
  $('stay').onclick = function () { $('exit-dialog').close(); $('exit').focus(); };
  $('confirm-exit').onclick = function () { window.close(); $('exit-dialog').close(); message('Use Home on your remote to leave MyTube.'); $('exit').focus(); };
  $('back').onclick = close; $('toggle').onclick = toggle; $('rewind').onclick = function () { seek(-10); }; $('forward').onclick = function () { seek(10); };
  $('restart').onclick = function () { video.currentTime = 0; play(); };
  $('source').onchange = function () { if (active) { resumeAt = video.currentTime; save(); startSource(); } };
  function quality() {
    var profile = playbackProfiles.find(function (entry) { return entry.id === $('source').value; });
    if (video.videoHeight) $('quality').textContent = (video.videoHeight >= 2160 ? '4K · ' : '') + video.videoWidth + ' × ' + video.videoHeight + ' · Original quality · ' + (profile ? profile.label : 'Primary') + ($('source').value !== defaultProfile ? ' (backup)' : '');
  }
  video.onloadedmetadata = function () { if (active && resumeAt) video.currentTime = Math.min(resumeAt, Math.max(0, video.duration - 1)); quality(); };
  video.onresize = quality;
  video.onplaying = function () { $('player-status').textContent = ''; playbackButton(false); showControls(); };
  video.onpause = function () { playbackButton(true); save(); showControls(); };
  video.onwaiting = function () { if (active) { $('player-status').textContent = 'Buffering…'; showControls(); } };
  video.onerror = function () { if (active) {
    if (video.error && video.error.code !== 1 && backupSource()) return;
    $('player-status').textContent = 'Unable to play the available versions. Check the server or choose another version. 4K requires a TV-supported codec and a 2160p download; MyTube keeps the original resolution.'; showControls();
  } };
  video.onended = function () { save(); $('player-status').textContent = 'Finished watching'; showControls(); };
  video.ontimeupdate = function () {
    $('time').textContent = time(video.currentTime) + ' / ' + time(video.duration);
    $('position').style.width = (isFinite(video.duration) && video.duration > 0 ? video.currentTime / video.duration * 100 : 0) + '%';
    if (Date.now() - lastSave > 10000) { lastSave = Date.now(); save(); }
  };
  $('player').onmousemove = showControls; video.onclick = function () { showControls(); $('toggle').focus(); };
  document.addEventListener('visibilitychange', function () { if (document.hidden && active) { save(); video.pause(); } });
  window.addEventListener('pagehide', save);
  document.addEventListener('keydown', function (event) {
    var code = event.keyCode;
    if (code === 461 || code === 27 || (code === 8 && document.activeElement.tagName !== 'INPUT')) { event.preventDefault(); back(); return; }
    if (active && [415, 19, 413, 417, 412, 32].indexOf(code) >= 0) {
      event.preventDefault(); if (code === 415) play(); else if (code === 19) video.pause(); else if (code === 413) close(); else if (code === 417 || code === 412) seek(code === 417 ? 10 : -10); else toggle(); return;
    }
    if (active && $('controls').classList.contains('concealed')) {
      if ([13, 37, 38, 39, 40].indexOf(code) >= 0) { event.preventDefault(); showControls(); $('toggle').focus(); if (code === 37 || code === 39) seek(code === 37 ? -10 : 10); return; }
    }
    if (document.activeElement.tagName === 'SELECT' && [13, 38, 40].indexOf(code) >= 0) return;
    if (code >= 37 && code <= 40) { event.preventDefault(); move(code); if (active) showControls(); }
    if (code === 13 && document.activeElement.tagName === 'BUTTON') { event.preventDefault(); if (!event.repeat) document.activeElement.click(); }
  });
  function clock() { $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  json('/api/tv/playback').then(function (result) {
    if (!result.profiles || !result.profiles.length) return;
    playbackProfiles = result.profiles;
    defaultProfile = result.defaultProfile || 'primary';
    var selectedProfile = active ? $('source').value : defaultProfile;
    $('source').textContent = '';
    result.profiles.forEach(function (profile) { var option = document.createElement('option'); option.value = profile.id; option.textContent = profile.label; $('source').appendChild(option); });
    $('source').value = selectedProfile;
    $('source-label').hidden = result.profiles.length < 2;
  }).catch(function () { /* Primary playback works on older MyTube servers too. */ });
  clock(); setInterval(clock, 60000); document.querySelector('[data-tab]').focus(); load();
}());
