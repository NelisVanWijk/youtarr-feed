(function () {
  'use strict';
  // PCM is opt-in outside webOS. The regular desktop/mobile players do not use
  // this adapter. No Web Audio routing or global TV/receiver settings are changed.
  function TVAudio(video, play, changed, status) {
    this.video = video; this.play = play; this.changed = changed; this.status = status;
    this.preferred = /web[0o]s|netcast/i.test(navigator.userAgent);
    try { var saved = localStorage.getItem('mytube-tv-audio'); if (saved) this.preferred = saved === 'pcm'; } catch { /* Storage can be disabled. */ }
    this.serial = 0; this.offset = 0; this.duration = 0; this.pcm = false; this.loading = false;
  }
  TVAudio.prototype.position = function () {
    if (this.loading) return this.pending || 0;
    return this.pcm ? Math.min(this.duration, this.offset + this.video.currentTime) : this.video.currentTime;
  };
  TVAudio.prototype.length = function () { return this.pcm || (this.loading && this.duration > 0) ? this.duration : this.video.duration; };
  TVAudio.prototype.label = function () {
    if (this.pcm) return 'PCM stereo';
    return this.failed ? 'Origineel geluid (PCM niet beschikbaar)' : 'Origineel geluid';
  };
  TVAudio.prototype.start = function (url, id, profile, start, paused) {
    // Keep the adapter compatible with older webOS engines without transpiling.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    var self = this, serial = ++this.serial;
    clearTimeout(this.timer); if (this.abort) this.abort.abort();
    this.abort = new AbortController();
    if (this.url !== url) { this.failed = false; this.duration = 0; }
    this.url = url; this.id = id; this.profile = profile; this.pending = start || 0;
    this.keepPaused = Boolean(paused); this.loading = true; this.pcm = false; this.offset = 0;
    this.video.pause(); this.video.removeAttribute('src'); this.video.load();
    function native() {
      if (serial !== self.serial) return;
      self.pcm = false; self.offset = 0; self.video.src = url; self.video.load();
      self.changed(); if (!self.keepPaused) self.play();
    }
    if (!this.preferred || this.failed) { native(); return; }
    this.status('Geluid voorbereiden…');
    // One deadline covers inspection, buffering and unsupported native MKV.
    this.timer = setTimeout(function () {
      if (serial !== self.serial) return;
      self.failed = true; self.abort.abort(); native();
    }, 30000);
    fetch('/api/tv/audio/' + encodeURIComponent(id) + '?profile=' + encodeURIComponent(profile), { signal: this.abort.signal })
      .then(function (response) { if (!response.ok) throw new Error('Audio inspection unavailable'); return response.json(); })
      .then(function (plan) {
        if (serial !== self.serial || self.abort.signal.aborted) return;
        if (plan.mode !== 'pcm' || !(plan.duration > 0) || plan.channels < 1 || plan.channels > 2) {
          clearTimeout(self.timer); native(); return;
        }
        self.pcm = true; self.duration = plan.duration;
        self.offset = Math.min(self.pending, Math.max(0, self.duration - 1)); self.pending = self.offset;
        self.video.src = '/api/tv/audio/' + encodeURIComponent(id) + '/stream?profile=' + encodeURIComponent(profile) + '&start=' + self.offset;
        self.video.load(); self.changed(); if (!self.keepPaused) self.play();
      }).catch(function () {
        if (serial !== self.serial || self.abort.signal.aborted) return;
        clearTimeout(self.timer); self.failed = true; native();
      });
  };
  TVAudio.prototype.metadata = function () {
    if (!this.pcm && this.pending && isFinite(this.video.duration)) this.video.currentTime = Math.min(this.pending, Math.max(0, this.video.duration - 1));
    this.loading = false;
    if (this.keepPaused) clearTimeout(this.timer);
    this.changed();
  };
  TVAudio.prototype.playing = function () { this.loading = false; clearTimeout(this.timer); };
  TVAudio.prototype.seek = function (target) {
    var duration = this.length();
    if (!isFinite(duration) || duration <= 0) return;
    target = Math.max(0, Math.min(duration - 0.1, target));
    if (this.pcm || this.loading) this.start(this.url, this.id, this.profile, target, this.loading ? this.keepPaused : this.video.paused);
    else this.video.currentTime = target;
  };
  TVAudio.prototype.fallback = function () {
    if (!this.pcm || this.failed) return false;
    var position = this.position(); this.failed = true;
    this.start(this.url, this.id, this.profile, position, false); return true;
  };
  TVAudio.prototype.toggle = function () {
    var position = this.position(), paused = this.video.paused;
    this.preferred = !this.preferred; this.failed = false;
    try { localStorage.setItem('mytube-tv-audio', this.preferred ? 'pcm' : 'original'); } catch { /* Storage can be disabled. */ }
    if (this.url) this.start(this.url, this.id, this.profile, position, paused);
  };
  TVAudio.prototype.stop = function () {
    ++this.serial; clearTimeout(this.timer); if (this.abort) this.abort.abort();
    this.loading = true; this.url = null; this.pcm = false;
  };
  window.MyTubeAudio = TVAudio;
}());
