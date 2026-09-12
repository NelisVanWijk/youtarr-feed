(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var videos = [], progress = {}, watched = [], tab = 'all', active = null, origin = null;
  var video = $('video'), demo = false, hideTimer, lastSave = 0, saveQueue = Promise.resolve(), resumeAt = 0;
  var pendingVideo = null, downloadOrigin = null, jobs = {}, pollTimer, polling = false, pollCount = 0;
  var sources = {}, sourceRequests = {}, feedIds = null, unwatched = [];
  var defaultProfile = 'primary', playbackProfiles = [{ id: 'primary', label: 'Primary' }], attemptedProfiles = [];
  var selectedChannel = '', subscriptionChannels = null, libraryFilter = 'downloads', fpVideos = [], fpChannels = [], fpCreators = [];
  var fpScope = '', fpKind = '', fpOffset = null, fpRequest = 0, fpLoading = false, fpLoaded = false, fpError = '';
  function relativeDate(value) {
    var age = Math.max(0, (Date.now() - Date.parse(value)) / 1000);
    if (!isFinite(age)) return '';
    var units = [[31536000, 'jaar', 'jaar'], [2592000, 'maand', 'maanden'], [604800, 'week', 'weken'], [86400, 'dag', 'dagen'], [3600, 'uur', 'uur'], [60, 'minuut', 'minuten']];
    for (var i = 0; i < units.length; i++) if (age >= units[i][0]) { var n = Math.floor(age / units[i][0]); return n + ' ' + units[i][n === 1 ? 1 : 2] + ' geleden'; }
    return 'Zojuist';
  }
  function channelButton(name, image, id, kind, nested) {
    var button = document.createElement('button'); button.className = 'channel-button' + (nested ? ' nested' : '');
    button.dataset.channel = id; button.dataset.kind = kind;
    button.setAttribute('aria-pressed', String(tab === 'floatplane' ? fpScope === id && fpKind === kind : selectedChannel === id));
    var avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = name.slice(0, 1);
    if (image) { var img = document.createElement('img'); img.src = image; img.alt = ''; img.loading = 'lazy'; img.onerror = function () { img.remove(); }; avatar.appendChild(img); }
    button.appendChild(avatar); var label = document.createElement('span'); label.textContent = name; button.appendChild(label);
    button.onclick = function () {
      if (tab === 'floatplane') { fpScope = id; fpKind = kind; loadFloatplane(false); }
      else { selectedChannel = id; render(); }
      $('results').scrollTop = 0;
      $('channels').querySelectorAll('button').forEach(function (el) { el.setAttribute('aria-pressed', String(el === button)); });
    };
    $('channels').appendChild(button);
  }
  function renderChannels() {
    var old = document.activeElement, focused = old && old.closest('#channels'), id = old && old.dataset.channel, kind = old && old.dataset.kind;
    $('channels').textContent = '';
    if (tab === 'floatplane') {
      channelButton('Alles', '', '', '', false);
      fpCreators.forEach(function (creator) {
        channelButton(creator.name, creator.avatar, creator.id, 'creator', false);
        fpChannels.filter(function (channel) { return channel.parentId === creator.id; }).forEach(function (channel) { channelButton(channel.name, channel.avatar, channel.id, 'channel', true); });
      });
    } else {
      channelButton('Alles', '', '', '', false);
      var channels = {}; videos.forEach(function (item) { channels[item.channelId] = { id: item.channelId, name: item.channelName, avatar: item.channelAvatar }; });
      (subscriptionChannels || Object.keys(channels).map(function (id) { return channels[id]; })).slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (item) {
        channelButton(item.name, item.avatar || '/api/channel-avatar/' + encodeURIComponent(item.id), item.id, '', false);
      });
    }
    if (focused) { var replacement = Array.prototype.find.call($('channels').querySelectorAll('button'), function (el) { return el.dataset.channel === id && el.dataset.kind === kind; }); if (replacement) replacement.focus(); }
  }
  function loadFloatplane(append) {
    var request = ++fpRequest; fpLoading = true; fpError = '';
    if (!append) { fpVideos = []; fpOffset = null; }
    render();
    return json('/api/floatplane/feed?limit=48&offset=' + (append ? fpOffset || 0 : 0) + (fpScope ? '&' + fpKind + '=' + encodeURIComponent(fpScope) : '')).then(function (result) {
      if (request !== fpRequest) return;
      fpLoaded = true; fpVideos = append ? fpVideos.concat(result.videos.filter(function (item) { return !fpVideos.some(function (existing) { return existing.id === item.id; }); })) : result.videos;
      if (result.creators && result.creators.length) fpCreators = result.creators;
      if (result.channels && result.channels.length) fpChannels = result.channels;
      fpOffset = result.hasMore ? result.nextOffset : null;
      fpError = (result.warnings || []).join(' ');
    }).catch(function (error) { if (request === fpRequest) fpError = 'Floatplane kon niet laden: ' + error.message; }).finally(function () {
      if (request !== fpRequest) return; fpLoading = false;
      if (tab === 'floatplane') { var moreFocused = document.activeElement === $('load-more'); renderChannels(); render(); if (moreFocused && $('load-more').hidden) { var cards = $('grid').querySelectorAll('.card'); if (cards.length) cards[cards.length - 1].focus(); } }
    });
  }
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
    var focusedCard = document.activeElement && document.activeElement.closest('.card');
    var focusedId = focusedCard && focusedCard.dataset.id;
    $('grid').textContent = '';
    var filter = tab === 'downloads' ? libraryFilter : tab;
    var query = $('search').value.trim().toLocaleLowerCase();
    var filtered = (tab === 'floatplane' ? fpVideos : videos).filter(function (item) {
      return (tab !== 'subscriptions' || !selectedChannel || item.channelId === selectedChannel) &&
        (['all', 'subscriptions', 'search'].indexOf(tab) < 0 || !feedIds || feedIds.indexOf(item.id) >= 0) &&
        (tab !== 'downloads' || (item.downloaded && !item.missing)) &&
        (filter !== 'continue' || progress[item.id]) && (filter !== 'unwatched' || !isWatched(item)) &&
        (tab !== 'search' || !query || (item.title + ' ' + item.channelName).toLocaleLowerCase().indexOf(query) >= 0);
    });
    if (filter === 'continue') filtered.sort(function (a, b) { return progress[b.id].updatedAt - progress[a.id].updatedAt; });
    $('load-more').hidden = tab !== 'floatplane' || fpOffset === null;
    $('load-more').disabled = fpLoading;
    $('grid').className = 'grid';
    filtered.forEach(function (item) {
      var button = document.createElement('button'); button.className = 'card'; button.dataset.id = item.id;
      var art = document.createElement('div'); art.className = 'art';
      var img = document.createElement('img'); img.src = item.thumbnail || '/tv/placeholder.svg'; img.alt = ''; img.loading = 'lazy';
      img.onerror = function () { img.onerror = null; img.src = '/tv/placeholder.svg'; }; art.appendChild(img);
      var duration = document.createElement('span'); duration.className = 'duration'; duration.textContent = time(item.duration); art.appendChild(duration);
      var badge = document.createElement('span'); badge.className = 'download-badge'; badge.dataset.sourceId = item.id;
      badge.textContent = item.provider === 'floatplane' ? 'Floatplane' : item.missing ? 'Opnieuw downloaden' : !item.downloaded ? jobs[item.id] ? 'Queued' : 'Not downloaded' : item.sourceLabel || sources[item.id] || 'Downloaded';
      if (item.downloaded && !item.missing) badge.classList.add('available'); art.appendChild(badge);
      if (item.provider !== 'floatplane' && item.downloaded && !item.missing && !demo && !sources[item.id] && !sourceRequests[item.id]) {
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
      var detail = document.createElement('small'); detail.textContent = item.channelName + (entry ? ' · Verder kijken op ' + time(entry.currentTime) : isWatched(item) ? ' · Bekeken' : ''); metaCopy.appendChild(detail);
      if (item.publishedAt) { var published = document.createElement('small'); published.className = 'published'; published.textContent = relativeDate(item.publishedAt); metaCopy.appendChild(published); }
      meta.appendChild(metaCopy); button.appendChild(meta);
      button.onclick = function () { if (item.provider === 'floatplane' || (item.downloaded && !item.missing)) open(item, button); else showDownload(item, button); }; $('grid').appendChild(button);
    });
    if (focusedId && !active) restoreCard(focusedId);
    if (tab === 'floatplane') { message(fpLoading ? 'Floatplane laden…' : fpError || filtered.length + ' video’s'); return; }
    message((demo ? 'Demo library — connect Youtarr to download and play videos. ' : '') + (filtered.length ? filtered.length + ' videos' : tab === 'continue' ? 'Nothing to resume yet.' : 'No videos here. Choose another channel or refresh.'));
  }
  function load() {
    message('Loading your library…'); $('refresh').disabled = true;
    return Promise.all([json('/api/local-videos'), json('/api/watch-progress').catch(function () { return null; }), json('/api/feed').catch(function () { return null; })]).then(function (results) {
      demo = results[0].mode === 'demo';
      feedIds = results[2] ? results[2].videos.map(function (item) { return item.id; }) : null;
      subscriptionChannels = results[2] && results[2].channels || null;
      var merged = {}; (results[2] ? results[2].videos : []).concat(results[0].videos).forEach(function (item) { merged[item.id] = item; });
      videos = Object.keys(merged).map(function (id) { return merged[id]; }).sort(function (a, b) { return (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0); });
      if (results[1]) { progress = results[1].progress; watched = results[1].watchedVideoIds; unwatched = results[1].unwatchedVideoIds || []; }
      renderChannels(); render();
      if (document.activeElement === document.body && !active) { var firstCard = $('grid').querySelector('.card'); if (firstCard) firstCard.focus(); }
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
    $('download-start').textContent = ready ? 'Play now' : jobs[pendingVideo.id] ? 'Download queued' : pendingVideo.missing ? 'Opnieuw downloaden' : 'Download';
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
    if (!active || (demo && active.provider !== 'floatplane') || !isFinite(video.duration) || video.duration <= 0 || video.readyState < 1) return saveQueue;
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
    $('toggle-glyph').setAttribute('href', '/tv/icons.svg?v=20260912c#' + (paused ? 'play' : 'pause'));
  }
  function seek(delta) { if (isFinite(video.duration)) video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + delta)); showControls(); }
  function open(item, button) {
    if (demo && item.provider !== 'floatplane') { message('This is a demo. Configure Youtarr on the MyTube server to play your own downloads.'); return; }
    active = item; origin = button; lastSave = Date.now();
    $('source-label').hidden = item.provider === 'floatplane' || playbackProfiles.length < 2;
    attemptedProfiles = []; $('source').value = defaultProfile;
    $('library').hidden = true; $('player').hidden = false;
    $('playing-title').textContent = item.title; $('playing-channel').textContent = item.channelName;
    $('player-status').textContent = 'Loading video…'; $('position').style.width = '0%'; $('time').textContent = '0:00 / ' + time(item.duration);
    resumeAt = progress[item.id] ? progress[item.id].currentTime : 0;
    startSource(); $('toggle').focus(); showControls();
  }
  function startSource() {
    $('quality').textContent = 'Original quality · detecting resolution…';
    if (active.provider === 'floatplane') { video.src = '/api/floatplane/stream/' + encodeURIComponent(active.id); video.load(); play(); return; }
    var profile = $('source').value || 'primary';
    if (attemptedProfiles.indexOf(profile) < 0) attemptedProfiles.push(profile);
    video.src = '/api/stream/' + encodeURIComponent(active.id) + '?profile=' + encodeURIComponent(profile);
    video.load(); play();
  }
  function backupSource() {
    if (active && active.provider === 'floatplane') return false;
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
    if ($('server-dialog').open) { $('server-dialog').close(); $('server-settings').focus(); }
    else if ($('download-dialog').open) closeDownload();
    else if ($('exit-dialog').open) { $('exit-dialog').close(); $('exit').focus(); }
    else if (active) close();
    else { $('exit-dialog').showModal(); $('stay').focus(); }
  }
  function move(code) {
    var root = $('server-dialog').open ? $('server-dialog') : $('download-dialog').open ? $('download-dialog') : $('exit-dialog').open ? $('exit-dialog') : active ? $('controls') : $('library');
    var elements = Array.prototype.filter.call(root.querySelectorAll('button:not(:disabled),select,input'), function (el) { return el.offsetWidth > 0; });
    var current = document.activeElement;
    if (elements.indexOf(current) < 0) { if (elements[0]) elements[0].focus(); return; }
    // Vertical navigation follows the rail's order, even across the large gap
    // above Refresh. Spatial distance must never send focus into another rail.
    if (root === $('library')) {
      var rail = current.closest('#navigation, #channels');
      if (rail && (code === 38 || code === 40)) {
        var buttons = Array.prototype.filter.call(rail.querySelectorAll('button:not(:disabled)'), function (el) { return el.offsetWidth > 0; });
        var index = buttons.indexOf(current), next = buttons[index + (code === 38 ? -1 : 1)];
        if (next) { next.focus({ preventScroll: true }); next.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
        return;
      }
      if (rail && (code === 37 || code === 39)) {
        var destination;
        if (code === 37 && rail === $('channels')) destination = $('navigation').querySelector('[aria-pressed="true"]');
        if (code === 39 && rail === $('navigation') && !$('channels').hidden) destination = $('channels').querySelector('[aria-pressed="true"]') || $('channels').querySelector('button');
        if (code === 39 && !destination) destination = $('search').hidden ? $('grid').querySelector('.card') : $('search');
        if (destination) { destination.focus({ preventScroll: true }); destination.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
        return;
      }
    }
    var rect = current.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2, best, score = Infinity;
    elements.forEach(function (el) {
      if (el === current) return;
      var r = el.getBoundingClientRect(), dx = r.left + r.width / 2 - x, dy = r.top + r.height / 2 - y;
      var primary = code === 37 ? -dx : code === 39 ? dx : code === 38 ? -dy : dy;
      var secondary = Math.abs(code === 37 || code === 39 ? dy : dx);
      if (primary > 5 && primary + secondary * 3 < score) { score = primary + secondary * 3; best = el; }
    });
    if (best) {
      best.focus({ preventScroll: true }); best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (best.classList.contains('card') && best.offsetTop === $('grid').firstElementChild.offsetTop) $('results').scrollTop = 0;
    }
  }
  document.querySelectorAll('[data-tab]').forEach(function (button) {
    button.setAttribute('aria-label', button.textContent.trim());
    button.onclick = function () {
      tab = button.dataset.tab;
      document.querySelectorAll('[data-tab]').forEach(function (el) { el.setAttribute('aria-pressed', String(el === button)); });
      $('heading').textContent = { all: 'Home', search: 'Zoeken', subscriptions: 'Abonnementen', downloads: 'Bibliotheek', floatplane: 'Floatplane' }[tab];
      var rail = tab === 'subscriptions' || tab === 'floatplane';
      $('channels').hidden = !rail; $('library').classList.toggle('with-channels', rail);
      $('search').hidden = tab !== 'search'; $('library-filters').hidden = tab !== 'downloads';
      renderChannels(); render();
      $('results').scrollTop = 0;
      if (tab === 'floatplane' && !fpLoaded && !fpLoading) loadFloatplane(false);
      if (tab === 'search') $('search').focus();
    };
  });
  $('search').oninput = render;
  $('server-settings').onclick = function () {
    $('server-address').value = window.location.origin; $('server-error').textContent = '';
    $('server-dialog').showModal(); $('server-address').focus();
  };
  $('server-cancel').onclick = back;
  $('server-form').onsubmit = function (event) {
    event.preventDefault();
    try {
      var url = new URL($('server-address').value.trim());
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || ['/', '/tv', '/tv/', '/tv/index.html'].indexOf(url.pathname) < 0) throw new Error('Vul het HTTP- of HTTPS-serveradres in, inclusief poort, zonder gebruikersnaam of wachtwoord.');
      window.location.href = url.origin + '/tv/index.html';
    } catch (error) { $('server-error').textContent = error.message; $('server-address').focus(); }
  };
  $('load-more').onclick = function () { loadFloatplane(true); };
  document.querySelectorAll('[data-filter]').forEach(function (button) { button.onclick = function () {
    libraryFilter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(function (el) { el.setAttribute('aria-pressed', String(el === button)); }); render();
  }; });
  $('refresh').onclick = function () { if (tab === 'floatplane') loadFloatplane(false); else load(); }; $('exit').onclick = back;
  document.querySelectorAll('#navigation button').forEach(function (button) {
    button.setAttribute('aria-label', button.textContent.trim());
    var label = document.createElement('span'); label.className = 'nav-label';
    Array.prototype.slice.call(button.childNodes).forEach(function (node) { if (node.nodeType === 3) { label.textContent += node.textContent; node.remove(); } }); button.appendChild(label);
  });
  $('stay').onclick = function () { $('exit-dialog').close(); $('exit').focus(); };
  $('confirm-exit').onclick = function () { window.close(); $('exit-dialog').close(); message('Use Home on your remote to leave MyTube.'); $('exit').focus(); };
  $('back').onclick = close; $('toggle').onclick = toggle; $('rewind').onclick = function () { seek(-10); }; $('forward').onclick = function () { seek(10); };
  $('restart').onclick = function () { video.currentTime = 0; play(); };
  $('source').onchange = function () { if (active) { resumeAt = video.currentTime; save(); startSource(); } };
  function quality() {
    var profile = playbackProfiles.find(function (entry) { return entry.id === $('source').value; });
    if (video.videoHeight) $('quality').textContent = (video.videoHeight >= 2160 ? '4K · ' : '') + video.videoWidth + ' × ' + video.videoHeight + ' · Original quality · ' + (active && active.provider === 'floatplane' ? 'Floatplane' : profile ? profile.label : 'Primary') + (active && active.provider !== 'floatplane' && $('source').value !== defaultProfile ? ' (backup)' : '');
  }
  video.onloadedmetadata = function () { if (active && resumeAt) video.currentTime = Math.min(resumeAt, Math.max(0, video.duration - 1)); quality(); };
  video.onresize = quality;
  video.onplaying = function () { $('player-status').textContent = ''; playbackButton(false); showControls(); };
  video.onpause = function () { playbackButton(true); save(); showControls(); };
  video.onwaiting = function () { if (active) { $('player-status').textContent = 'Buffering…'; showControls(); } };
  video.onerror = function () { if (active) {
    if (video.error && video.error.code !== 1 && backupSource()) return;
    if (active.provider === 'floatplane') { $('player-status').textContent = 'Floatplane kan deze video niet afspelen. Controleer je verbinding en Floatplane-sessie in de instellingen.'; showControls(); return; }
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
    if (document.activeElement.tagName === 'INPUT' && [37, 39, 13].indexOf(code) >= 0) return;
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
    $('source-label').hidden = (active && active.provider === 'floatplane') || result.profiles.length < 2;
  }).catch(function () { /* Primary playback works on older MyTube servers too. */ });
  clock(); setInterval(clock, 60000); load();
}());
