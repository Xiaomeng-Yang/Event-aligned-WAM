/* Project page behaviour: section nav, BibTeX copy, episode explorer.
   Plain script (no modules) so the page also works when opened from file://. */
(function () {
  'use strict';

  var D = window.PAGE_DATA || {};
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var SVGNS = 'http://www.w3.org/2000/svg';
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var isLocal = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\]|)$/.test(location.hostname);
  var params = new URLSearchParams(location.search);
  // Missing clips show "coming soon" boxes while previewing locally; on the
  // published site their panels are hidden. Override with ?placeholders=0|1.
  var showPlaceholders = params.has('placeholders') ? params.get('placeholders') !== '0' : isLocal;

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
    });
    if (text != null) n.textContent = text;
    return n;
  }
  function svg(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  function icon(id) {
    var s = svg('svg', { 'aria-hidden': 'true', focusable: 'false' });
    svg('use', { href: '#' + id }, s);
    return s;
  }
  function segmented(group, onChange) {
    var buttons = $$('button', group);
    buttons.forEach(function (b) {
      b.addEventListener('click', function () {
        buttons.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        onChange(b);
      });
    });
  }

  /* ---------------------------------------------------------------- nav */
  function initNav() {
    var nav = $('.topnav'), hero = $('.hero');
    if (!nav || !hero || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (entries) {
      nav.classList.toggle('is-visible', !entries[0].isIntersecting);
    }, { rootMargin: '-60px 0px 0px 0px' }).observe(hero);

    var links = $$('.topnav-links a');
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute('href').slice(1)] = a; });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (a) { a.removeAttribute('aria-current'); });
        if (byId[e.target.id]) byId[e.target.id].setAttribute('aria-current', 'true');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(byId).forEach(function (id) { var s = document.getElementById(id); if (s) spy.observe(s); });
  }

  /* ---------------------------------------------------------------- BibTeX */
  function initCopy() {
    $$('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var text = $(btn.getAttribute('data-copy')).textContent;
        var status = $('.copy-status', btn.parentNode);
        function done(ok) {
          btn.textContent = ok ? 'Copied' : 'Copy failed';
          if (status) status.textContent = ok ? 'BibTeX copied to the clipboard.' : 'Could not copy; select the text instead.';
          setTimeout(function () { btn.textContent = 'Copy'; }, 1800);
        }
        function fallback() {
          var ta = el('textarea');
          ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
          ta.remove(); done(ok);
        }
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
        } else fallback();
      });
    });
  }

  /* ---------------------------------------------------------------- video helpers */
  var players = [];
  var loader = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      loader.unobserve(e.target);
      if (e.target.__load) e.target.__load();
    });
  }, { rootMargin: '600px 0px' }) : null;
  var viewer = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var p = e.target.__player;
      if (p) { p.visible = e.isIntersecting; if (e.isIntersecting) p.resume(); else p.suspend(); }
    });
  }, { threshold: 0.25 }) : null;
  document.addEventListener('visibilitychange', function () {
    players.forEach(function (p) { if (document.hidden) p.suspend(); else if (p.visible) p.resume(); });
  });

  function makeVideo(src, poster) {
    var v = el('video', { muted: '', playsinline: '', preload: 'none' });
    v.muted = true; // iOS needs the property as well as the attribute
    v.playsInline = true;
    if (poster) v.setAttribute('poster', poster);
    v.dataset.src = src;
    return v;
  }
  function attach(v) { if (!v.getAttribute('src')) { v.src = v.dataset.src; v.load(); } }

  function placeholder(title, paths) {
    var box = el('div', { class: 'vplaceholder' });
    box.appendChild(el('div', null, title));
    if (isLocal) paths.forEach(function (p) { box.appendChild(el('code', null, p)); });
    return box;
  }

  /* Two independent rollouts of different lengths. They start together; each plays
     once and holds its last frame with a result badge; when both have ended they
     restart together. Speed and pause apply to both. */
  function ComparePair(root, entry) {
    var self = this;
    var sides = [['lingbot', 'LingBot-VA', 'base'], ['ours', 'Ours', 'ours']].map(function (s) {
      var meta = entry[s[0]];
      var box = el('div', { class: 'vbox' });
      var label = el('div', { class: 'vlabel' });
      label.appendChild(el('span', { class: 'vkey ' + s[2], 'aria-hidden': 'true' }));
      label.appendChild(document.createTextNode(s[1]));
      var frame = el('div', { class: 'vframe' });
      if (meta.w && meta.h) frame.style.setProperty('--ar', meta.w + ' / ' + meta.h);
      var v = makeVideo(meta.src, meta.poster);
      v.setAttribute('aria-label', s[1] + ' rollout on ' + entry.name);
      var badge = el('div', { class: 'vbadge ' + (meta.result === 'success' ? 'success' : 'fail') });
      badge.appendChild(icon(meta.result === 'success' ? 'i-check' : 'i-cross'));
      badge.appendChild(document.createTextNode((meta.result === 'success' ? 'Success' : 'Failed') + ' · step ' + meta.step));
      badge.hidden = true;
      frame.appendChild(v); frame.appendChild(badge);
      box.appendChild(label); box.appendChild(frame);
      return { v: v, badge: badge, frame: frame, ended: false, meta: meta };
    });
    var pair = el('div', { class: 'vpair' });
    sides.forEach(function (s) { pair.appendChild(s.v.parentNode.parentNode); });

    var controls = el('div', { class: 'vcontrols' });
    var playBtn = el('button', { class: 'vbtn', type: 'button', 'aria-label': 'Pause' });
    playBtn.appendChild(icon('i-pause'));
    var restartBtn = el('button', { class: 'vbtn', type: 'button', 'aria-label': 'Restart both clips' });
    restartBtn.appendChild(icon('i-restart'));
    var progress = el('div', { class: 'vprogress', 'aria-hidden': 'true' });
    var fill = el('div', { class: 'vprogress-fill' });
    var ticks = sides.map(function (_, k) { return el('span', { class: 'vtick ' + (k ? 'ours' : 'base') }); });
    progress.appendChild(fill); ticks.forEach(function (t) { progress.appendChild(t); });
    var speed = el('div', { class: 'seg', role: 'group', 'aria-label': 'Playback speed' });
    [1, 2, 4].forEach(function (r) {
      var b = el('button', { type: 'button', 'aria-pressed': String(r === (entry.rate || 1)), 'data-rate': String(r) }, r + '×');
      speed.appendChild(b);
    });
    controls.appendChild(playBtn); controls.appendChild(restartBtn); controls.appendChild(progress); controls.appendChild(speed);

    root.textContent = '';
    root.appendChild(pair); root.appendChild(controls);
    root.appendChild(el('p', { class: 'vnote' }, (D.videos && D.videos.timebase === 'dedup')
      ? 'Same initial state for both policies. One frame per camera update, so time is compressed; steps are the control steps shown in the paper\u2019s figures, and ticks mark where each clip ends.'
      : 'Same initial state for both policies. One frame per control step; steps are the control steps shown in the paper\u2019s figures, and ticks mark where each clip ends.'));

    this.rate = entry.rate || 1;
    this.intent = !reduceMotion;  // the user wants it playing
    this.visible = false;
    this.restartTimer = 0;
    this.raf = 0;
    this.token = 0;  // invalidates a start that is still waiting for data

    segmented(speed, function (b) { self.rate = Number(b.dataset.rate); sides.forEach(function (s) { s.v.playbackRate = self.rate; }); });
    playBtn.addEventListener('click', function () {
      self.intent = !self.intent;
      if (self.intent) { if (sides.every(function (s) { return s.ended; })) self.restart(); else self.resume(); } else self.suspend();
      self.syncButton();
    });
    restartBtn.addEventListener('click', function () { self.intent = true; self.restart(); self.syncButton(); });

    sides.forEach(function (s) {
      s.v.addEventListener('ended', function () {
        s.ended = true; s.badge.hidden = false;
        if (sides.every(function (x) { return x.ended; })) {
          clearTimeout(self.restartTimer);
          self.restartTimer = setTimeout(function () { if (self.intent && self.visible) self.restart(); }, 1500);
        }
      });
      s.v.addEventListener('loadedmetadata', function () { self.layoutTicks(); s.v.playbackRate = self.rate; });
      s.v.addEventListener('error', function () { root.textContent = ''; root.appendChild(placeholder('Rollout clips for ' + entry.name + ' could not be loaded.', [s.meta.src])); });
    });

    this.sides = sides;
    this.root = root;
    this.playBtn = playBtn;
    this.fill = fill;
    this.ticks = ticks;
    root.__load = function () { sides.forEach(function (s) { attach(s.v); }); };
    root.__player = this;
    if (loader) loader.observe(root); else root.__load();
    if (viewer) viewer.observe(root); else { this.visible = true; }
    if (reduceMotion) this.showBigPlay();
    this.syncButton();
    players.push(this);
  }
  ComparePair.prototype.syncButton = function () {
    this.playBtn.textContent = '';
    this.playBtn.appendChild(icon(this.intent ? 'i-pause' : 'i-play'));
    this.playBtn.setAttribute('aria-label', this.intent ? 'Pause' : 'Play');
  };
  ComparePair.prototype.layoutTicks = function () {
    var durs = this.sides.map(function (s) { return s.v.duration || 0; });
    var max = Math.max.apply(null, durs) || 1;
    this.ticks.forEach(function (t, k) { t.style.left = 'calc(' + (100 * durs[k] / max) + '% - 1px)'; t.hidden = !durs[k]; });
  };
  ComparePair.prototype.tick = function () {
    var self = this;
    cancelAnimationFrame(this.raf);
    var step = function () {
      var durs = self.sides.map(function (s) { return s.v.duration || 0; });
      var max = Math.max.apply(null, durs) || 1;
      var t = Math.max.apply(null, self.sides.map(function (s) { return s.ended ? s.v.duration || 0 : s.v.currentTime; }));
      self.fill.style.width = (100 * t / max) + '%';
      if (!self.sides.every(function (s) { return s.v.paused; })) self.raf = requestAnimationFrame(step);
    };
    step();
  };
  // Ready gate: wait until every unfinished clip can play, then start them together.
  ComparePair.prototype.playAll = function () {
    var self = this, token = ++this.token;
    var pending = this.sides.filter(function (s) { return !s.ended; });
    pending.forEach(function (s) { attach(s.v); });
    Promise.all(pending.map(function (s) {
      return s.v.readyState >= 3 ? null : new Promise(function (res) { s.v.addEventListener('canplay', res, { once: true }); });
    })).then(function () {
      if (token !== self.token || !self.intent || !self.visible) return null;
      return Promise.all(pending.map(function (s) { s.v.playbackRate = self.rate; return s.v.play(); }))
        .then(function () { self.tick(); });
    }).catch(function (err) {
      // Only a blocked autoplay needs the big play button; an AbortError just means
      // a pause or seek interrupted the start.
      if (err && err.name === 'NotAllowedError') { self.intent = false; self.syncButton(); self.showBigPlay(); }
    });
  };
  ComparePair.prototype.restart = function () {
    clearTimeout(this.restartTimer);
    this.sides.forEach(function (s) { s.ended = false; s.badge.hidden = true; s.v.pause(); try { s.v.currentTime = 0; } catch (e) { /* not loaded yet */ } });
    if (this.intent) this.playAll();
  };
  ComparePair.prototype.resume = function () {
    if (!this.intent || !this.visible) return;
    this.sides.forEach(function (s) { attach(s.v); });
    this.playAll();
  };
  ComparePair.prototype.suspend = function () {
    this.token++;
    this.sides.forEach(function (s) { s.v.pause(); });
    cancelAnimationFrame(this.raf);
  };
  ComparePair.prototype.showBigPlay = function () {
    var self = this;
    if ($('.vbig-play', this.root)) return;
    var b = el('button', { class: 'vbig-play', type: 'button', 'aria-label': 'Play both clips' });
    b.appendChild(icon('i-play'));
    b.addEventListener('click', function () { b.remove(); self.intent = true; self.visible = true; self.restart(); self.syncButton(); });
    this.sides[1].frame.appendChild(b);
  };
  ComparePair.prototype.destroy = function () {
    this.suspend();
    clearTimeout(this.restartTimer);
    if (viewer) viewer.unobserve(this.root);
    if (loader) loader.unobserve(this.root);
    players.splice(players.indexOf(this), 1);
  };

  /* One pre-composed side-by-side clip (real | predicted): sync is exact. */
  function PvrPlayer(root, entry) {
    var self = this;
    root.textContent = '';
    var toggle = el('div', { class: 'seg pvr-toggle', role: 'group', 'aria-label': 'Which half to show' });
    toggle.appendChild(el('button', { type: 'button', 'aria-pressed': 'true', 'data-half': 'real' }, 'Real execution'));
    toggle.appendChild(el('button', { type: 'button', 'aria-pressed': 'false', 'data-half': 'pred' }, 'Predicted future'));
    var labels = el('div', { class: 'pvr-labels', 'aria-hidden': 'true' });
    labels.appendChild(el('span', null, 'Real execution'));
    labels.appendChild(el('span', null, 'Predicted future (ours)'));
    var frame = el('div', { class: 'pvr-frame' });
    if (entry.w && entry.h) frame.style.setProperty('--ar', entry.w + ' / ' + entry.h);
    var v = makeVideo(entry.src, entry.poster);
    var rate = entry.rate || 1;
    v.loop = true;
    v.defaultPlaybackRate = rate;  // survives load(), unlike playbackRate
    v.playbackRate = rate;
    v.setAttribute('aria-label', 'Real execution and predicted future side by side, ' + entry.name);
    if (reduceMotion) v.controls = true;
    frame.appendChild(v);
    var center = el('div', { class: 'center-p' });
    center.appendChild(toggle);

    var controls = el('div', { class: 'vcontrols' });
    var playBtn = el('button', { class: 'vbtn', type: 'button' });
    var speed = el('div', { class: 'seg', role: 'group', 'aria-label': 'Playback speed' });
    [0.5, 1, 2].forEach(function (r) {
      speed.appendChild(el('button', { type: 'button', 'aria-pressed': String(r === rate), 'data-rate': String(r) }, r + '×'));
    });
    controls.appendChild(playBtn); controls.appendChild(speed);

    root.appendChild(center); root.appendChild(labels); root.appendChild(frame); root.appendChild(controls);
    segmented(toggle, function (b) { frame.classList.toggle('show-pred', b.dataset.half === 'pred'); });
    segmented(speed, function (b) { v.defaultPlaybackRate = v.playbackRate = Number(b.dataset.rate); });
    playBtn.addEventListener('click', function () {
      self.intent = !self.intent;
      if (self.intent) self.resume(); else self.suspend();
      self.syncButton();
    });
    v.addEventListener('error', function () { root.textContent = ''; root.appendChild(placeholder('The prediction clip for ' + entry.name + ' could not be loaded.', [entry.src])); });
    this.v = v; this.root = root; this.visible = false; this.playBtn = playBtn;
    this.intent = !reduceMotion;
    this.syncButton();
    root.__load = function () { attach(v); };
    root.__player = this;
    if (loader) loader.observe(root); else root.__load();
    if (viewer) viewer.observe(root); else this.visible = true;
    players.push(this);
  }
  PvrPlayer.prototype.resume = function () {
    if (!this.intent || !this.visible) return;
    attach(this.v);
    this.v.play().catch(function () {});
  };
  PvrPlayer.prototype.syncButton = function () {
    this.playBtn.textContent = '';
    this.playBtn.appendChild(icon(this.intent ? 'i-pause' : 'i-play'));
    this.playBtn.setAttribute('aria-label', this.intent ? 'Pause' : 'Play');
  };
  PvrPlayer.prototype.suspend = function () { this.v.pause(); };
  PvrPlayer.prototype.destroy = function () {
    this.suspend();
    if (viewer) viewer.unobserve(this.root);
    if (loader) loader.unobserve(this.root);
    players.splice(players.indexOf(this), 1);
  };

  /* Each real-world task plays independently; restart and speed are shared.
     The static video elements retain native controls when JavaScript is absent. */
  function RealWorldPlayer(root) {
    var self = this;
    this.root = root;
    this.rate = 1;
    this.visible = false;
    this.active = true;
    this.destroyed = false;
    this.loaded = false;
    this.raf = 0;
    this.clips = $$('video', root).map(function (v) {
      var box = v.parentNode.parentNode;
      var label = $('.vlabel', box);
      var controls = el('div', { class: 'vcontrols real-world-clip-controls' });
      var playBtn = el('button', { class: 'vbtn', type: 'button' });
      var progress = el('div', { class: 'vprogress', 'aria-hidden': 'true' });
      var fill = el('div', { class: 'vprogress-fill' });
      progress.appendChild(fill);
      controls.appendChild(playBtn); controls.appendChild(progress);
      box.appendChild(controls);
      v.controls = false;
      v.muted = true;
      v.playsInline = true;
      v.loop = true;
      return { v: v, box: box, name: label ? label.textContent.trim() : 'real-world clip',
        playBtn: playBtn, fill: fill, intent: !reduceMotion, starting: false, token: 0 };
    });

    var controls = el('div', { class: 'vcontrols real-world-shared-controls' });
    var restartBtn = el('button', { class: 'vbtn', type: 'button', 'aria-label': 'Restart all real-world clips' });
    restartBtn.appendChild(icon('i-restart'));
    var speed = el('div', { class: 'seg', role: 'group', 'aria-label': 'Real-world playback speed' });
    [1, 2, 4].forEach(function (r) {
      speed.appendChild(el('button', { type: 'button', 'aria-pressed': String(r === 1), 'data-rate': String(r) }, r + '×'));
    });
    controls.appendChild(restartBtn); controls.appendChild(speed);
    root.appendChild(controls);

    segmented(speed, function (b) {
      self.rate = Number(b.dataset.rate);
      self.clips.forEach(function (c) { c.v.defaultPlaybackRate = c.v.playbackRate = self.rate; });
    });
    restartBtn.addEventListener('click', function () { self.restart(); });
    this.clips.forEach(function (c) {
      c.playBtn.addEventListener('click', function () {
        c.intent = !c.intent;
        if (c.intent) self.playClip(c); else self.pauseClip(c);
        self.syncButton(c);
      });
      c.v.addEventListener('loadedmetadata', function () {
        c.v.playbackRate = self.rate;
        self.updateProgress(c);
      });
      c.v.addEventListener('timeupdate', function () { self.updateProgress(c); });
      c.v.addEventListener('error', function () {
        if (self.destroyed) return;
        c.intent = false;
        self.pauseClip(c);
        self.syncButton(c);
        if (!$('.real-world-error', c.box)) {
          var note = el('p', { class: 'vnote real-world-error', role: 'status' }, 'This clip could not be loaded. ');
          var source = $('source', c.v);
          note.appendChild(el('a', { href: c.v.currentSrc || (source && source.getAttribute('src')) || '' }, 'Open the video directly.'));
          c.box.appendChild(note);
        }
      });
      self.syncButton(c);
    });
    root.__load = function () {
      if (self.loaded || self.destroyed) return;
      self.loaded = true;
      self.clips.forEach(function (c) { c.v.preload = 'auto'; c.v.load(); });
    };
    root.__player = this;
    this.onPageHide = function () { self.active = false; self.suspend(); };
    this.onPageShow = function () { self.active = true; self.resume(); };
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    players.push(this);
    if (loader) loader.observe(root); else root.__load();
    if (viewer) viewer.observe(root); else { this.visible = true; this.resume(); }
  }
  RealWorldPlayer.prototype.canPlay = function (c) {
    return c.intent && this.visible && this.active && !this.destroyed && !document.hidden;
  };
  RealWorldPlayer.prototype.syncButton = function (c) {
    c.playBtn.textContent = '';
    c.playBtn.appendChild(icon(c.intent ? 'i-pause' : 'i-play'));
    c.playBtn.setAttribute('aria-label', (c.intent ? 'Pause ' : 'Play ') + c.name);
  };
  RealWorldPlayer.prototype.updateProgress = function (c) {
    var duration = isFinite(c.v.duration) && c.v.duration > 0 ? c.v.duration : 1;
    c.fill.style.width = Math.min(100, 100 * (c.v.currentTime || 0) / duration) + '%';
  };
  RealWorldPlayer.prototype.tick = function () {
    var self = this;
    cancelAnimationFrame(this.raf);
    function step() {
      self.clips.forEach(function (c) { self.updateProgress(c); });
      if (self.clips.some(function (c) { return self.canPlay(c) && !c.v.paused; })) self.raf = requestAnimationFrame(step);
    }
    step();
  };
  RealWorldPlayer.prototype.playClip = function (c) {
    if (!this.canPlay(c) || c.starting) return;
    var self = this, token = ++c.token;
    c.starting = true;
    this.root.__load();
    c.v.playbackRate = this.rate;
    function failed() {
      if (token !== c.token) return;
      c.intent = false;
      self.pauseClip(c);
      self.syncButton(c);
    }
    try {
      Promise.resolve(c.v.play()).then(function () {
        // A pending play must not revive a paused, hidden, or destroyed clip.
        if (!self.canPlay(c)) c.v.pause();
        if (token !== c.token) return;
        c.starting = false;
        if (self.canPlay(c)) self.tick();
      }).catch(failed);
    } catch (e) { failed(); }
  };
  RealWorldPlayer.prototype.pauseClip = function (c) {
    c.token++;
    c.starting = false;
    c.v.pause();
    this.updateProgress(c);
  };
  RealWorldPlayer.prototype.resume = function () {
    var self = this;
    this.clips.forEach(function (c) { self.playClip(c); });
  };
  RealWorldPlayer.prototype.suspend = function () {
    var self = this;
    cancelAnimationFrame(this.raf);
    this.clips.forEach(function (c) { self.pauseClip(c); });
  };
  RealWorldPlayer.prototype.restart = function () {
    var self = this;
    this.suspend();
    this.clips.forEach(function (c) {
      c.intent = true;
      try { c.v.currentTime = 0; } catch (e) { /* Metadata may still be loading. */ }
      self.updateProgress(c);
      self.syncButton(c);
    });
    this.resume();
  };
  RealWorldPlayer.prototype.destroy = function () {
    this.destroyed = true;
    this.suspend();
    if (viewer) viewer.unobserve(this.root);
    if (loader) loader.unobserve(this.root);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
    this.root.__player = null;
    this.root.__load = null;
    var index = players.indexOf(this);
    if (index !== -1) players.splice(index, 1);
  };

  function initRealWorld() {
    var root = $('#panel-real-world .panel-body');
    if (root && $('video', root)) new RealWorldPlayer(root);
  }

  /* ---------------------------------------------------------------- episode explorer */
  function initExplorer() {
    var picker = $('#task-picker');
    if (!picker) return;
    var V = (D.videos || { rollouts: [], imagination: [] });
    var rollout = $('#panel-rollout'), pvr = $('#panel-pvr');
    var current = { pair: null, pvr: null };
    var find = function (list, task) { return list.filter(function (e) { return e.task === task; })[0]; };

    function show(task, name) {
      if (current.pair) current.pair.destroy();
      if (current.pvr) current.pvr.destroy();
      current.pair = current.pvr = null;

      var r = find(V.rollouts, task);
      var body = $('.panel-body', rollout);
      if (r && r.available) {
        rollout.hidden = false;
        current.pair = new ComparePair(body, r);
      } else if (showPlaceholders) {
        rollout.hidden = false;
        body.textContent = '';
        body.appendChild(placeholder('Rollout clips for ' + name + ' are coming soon.',
          r ? [r.lingbot.src, r.ours.src] : []));
      } else rollout.hidden = true;

      var m = find(V.imagination, task);
      body = $('.panel-body', pvr);
      if (m && m.available) {
        pvr.hidden = false;
        current.pvr = new PvrPlayer(body, m);
      } else if (showPlaceholders) {
        pvr.hidden = false;
        body.textContent = '';
        body.appendChild(placeholder('The prediction-vs-reality clip for ' + name + ' is coming soon.', m ? [m.src] : []));
      } else pvr.hidden = true;
    }

    segmented(picker, function (b) { show(b.dataset.task, b.textContent); });
    var first = $('[aria-pressed="true"]', picker) || $('button', picker);
    show(first.dataset.task, first.textContent);
  }

  function init() {
    initNav();
    initCopy();
    initExplorer();
    initRealWorld();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
