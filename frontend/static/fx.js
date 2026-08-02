/* Command Center — window transition FX engine.
   Provides window.CCFX.{minimize, resize, exit} that play a synthwave
   effect, then invoke the pywebview API callback when the visual peaks. */
(function () {
  var PALETTE = ['#ff2d95', '#b957ff', '#35c4ff', '#ffe14a', '#ff8a3c', '#39ff14'];

  function overlay() {
    var o = document.getElementById('fx-overlay');
    if (!o) {
      o = document.createElement('div');
      o.id = 'fx-overlay';
      document.body.appendChild(o);
    }
    return o;
  }
  function clear(o) { o.classList.remove('active'); o.innerHTML = ''; }
  function shakeApp() {
    var s = document.querySelector('.app-shell');
    if (!s) return;
    s.classList.remove('fx-shaking');
    void s.offsetWidth;
    s.classList.add('fx-shaking');
    setTimeout(function () { s.classList.remove('fx-shaking'); }, 400);
  }

  // ---- MINIMIZE: CRT power-off collapse ----
  function minimize(cb) {
    var o = overlay(); clear(o); o.classList.add('active');
    var sheet = document.createElement('div');
    sheet.className = 'fx-crt-sheet';
    o.appendChild(sheet);
    void sheet.offsetWidth;
    sheet.classList.add('run');
    var fired = false;
    function go() { if (fired) return; fired = true; cb && cb(); }
    // fire the native minimize right as the line collapses (~0.4s)
    setTimeout(go, 400);
    setTimeout(function () { clear(o); }, 560);
  }

  // ---- RESIZE: RGB-split glitch + shake ----
  function resize(cb) {
    var o = overlay(); clear(o); o.classList.add('active');
    shakeApp();
    // three colored slice bars sweeping
    var cols = ['rgba(255,45,149,0.55)', 'rgba(53,196,255,0.55)', 'rgba(57,255,20,0.5)'];
    for (var i = 0; i < 6; i++) {
      var bar = document.createElement('div');
      bar.className = 'fx-glitch-bar';
      bar.style.top = (Math.random() * 90) + '%';
      bar.style.height = (6 + Math.random() * 16) + '%';
      bar.style.background = cols[i % cols.length];
      bar.style.animationDelay = (Math.random() * 0.12) + 's';
      o.appendChild(bar);
      void bar.offsetWidth;
      bar.classList.add('run');
    }
    var fired = false;
    function go() { if (fired) return; fired = true; cb && cb(); }
    // toggle the actual window mid-glitch so the flicker masks the jump
    setTimeout(go, 170);
    setTimeout(function () { clear(o); }, 480);
  }

  // ---- EXIT: the sun itself explodes and that is what closes the app ----
  // Warm flash + shockwave ring + shard storm burst from the SUN's real
  // position (not screen center); the sun self-destructs, and at the boom's
  // climax we hit the native close + a warm full-screen fade so it reads as
  // "the sun blowing up took the window with it".
  function exit(cb) {
    var sun = document.querySelector('.synth-sun');
    var rect = sun ? sun.getBoundingClientRect() : null;
    var cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    var cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    var R = rect ? Math.max(rect.width, rect.height) / 2 : 180;

    // blow the sun apart: flare huge + bright, then implode to nothing
    if (sun) {
      sun.classList.add('sfx-sun-boom');
      sun.animate([
        { transform: 'translate(-50%,-50%) scale(1)',   opacity: 1, filter: 'brightness(1)' },
        { transform: 'translate(-50%,-50%) scale(1.7)', opacity: 1, filter: 'brightness(2.4)' },
        { transform: 'translate(-50%,-50%) scale(0.15)', opacity: 0, filter: 'brightness(3)' }
      ], { duration: 620, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
    }

    var o = overlay(); clear(o); o.classList.add('active');
    shakeApp();

    // warm flash centered on the sun
    var flash = document.createElement('div');
    flash.className = 'fx-flash';
    flash.style.left = cx + 'px'; flash.style.top = cy + 'px';
    flash.style.width = (R * 2.6) + 'px'; flash.style.height = (R * 2.6) + 'px';
    flash.style.transform = 'translate(-50%,-50%)';
    o.appendChild(flash);

    // shockwave ring from the sun
    var ring = document.createElement('div');
    ring.className = 'fx-ring';
    ring.style.left = cx + 'px'; ring.style.top = cy + 'px';
    o.appendChild(ring);

    // shard particles flying outward from the sun
    var N = 60;
    for (var i = 0; i < N; i++) {
      var s = document.createElement('div');
      s.className = 'fx-shard';
      var color = PALETTE[i % PALETTE.length];
      s.style.background = color;
      s.style.boxShadow = '0 0 12px 2px ' + color;
      var sz = 6 + Math.random() * 18;
      s.style.width = sz + 'px'; s.style.height = sz + 'px';
      s.style.left = cx + 'px'; s.style.top = cy + 'px';
      o.appendChild(s);
      var ang = (Math.PI * 2) * (i / N) + (Math.random() - 0.5) * 0.5;
      var dist = R + 220 + Math.random() * Math.max(window.innerWidth, window.innerHeight);
      var dx = Math.cos(ang) * dist;
      var dy = Math.sin(ang) * dist;
      var rot = (Math.random() * 720 - 360);
      s.animate([
        { transform: 'translate(-50%,-50%) translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
        { transform: 'translate(-50%,-50%) translate(' + dx + 'px,' + dy + 'px) rotate(' + rot + 'deg) scale(0.2)', opacity: 0 }
      ], { duration: 620 + Math.random() * 260, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
    }

    // warm full-screen burn that rises to cover the window as it dies
    var burn = document.createElement('div');
    burn.className = 'fx-burn';
    o.appendChild(burn);

    void flash.offsetWidth;
    flash.classList.add('run');
    ring.classList.add('run');
    burn.classList.add('run');

    // at the boom's climax: the sun is gone -> take the window with it
    var fired = false;
    function go() { if (fired) return; fired = true; cb && cb(); }
    setTimeout(go, 640);
    // clear the FX layer after everything settles
    setTimeout(function () { clear(o); }, 1000);
  }

  window.CCFX = { minimize: minimize, resize: resize, exit: exit };

  // Detonate the visible sun as a pure visual blast (no window close) — reused
  // by the Pomodoro timer when a session completes.
  function sunBlast() {
    var sun = document.querySelector('.synth-sun');
    if (!sun) return;
    var rect = sun.getBoundingClientRect();
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    var o = overlay(); clear(o); o.classList.add('active');
    var flash = document.createElement('div'); flash.className = 'fx-flash';
    var ring = document.createElement('div'); ring.className = 'fx-ring';
    flash.style.left = ring.style.left = cx + 'px';
    flash.style.top = ring.style.top = cy + 'px';
    flash.style.transform = ring.style.transform = 'translate(-50%,-50%)';
    flash.style.margin = ring.style.margin = '0';
    o.appendChild(flash); o.appendChild(ring);
    var shards = 36;
    for (var i = 0; i < shards; i++) {
      var s = document.createElement('div'); s.className = 'fx-shard';
      var col = ['#fff200', '#ff8a3c', '#ff2d00', '#ff2d95', '#35c4ff'][i % 5];
      s.style.width = s.style.height = (4 + Math.random() * 8) + 'px';
      s.style.background = col; s.style.boxShadow = '0 0 10px ' + col;
      s.style.left = cx + 'px'; s.style.top = cy + 'px';
      o.appendChild(s);
      var ang = (i / shards) * Math.PI * 2 + Math.random();
      var dist = 120 + Math.random() * 260;
      var dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist;
      s.animate([
        { transform: 'translate(-50%,-50%) translate(0,0) scale(1)', opacity: 1 },
        { transform: 'translate(-50%,-50%) translate(' + dx + 'px,' + dy + 'px) scale(0.2)', opacity: 0 }
      ], { duration: 620 + Math.random() * 260, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
    }
    void flash.offsetWidth; flash.classList.add('run'); ring.classList.add('run');
    setTimeout(function () { clear(o); }, 1000);
  }

  // ---- TAB-SWITCH WHOOSH: glitch sweep across the content area ----
  function whoosh() {
    var o = overlay(); clear(o); o.classList.add('active');
    for (var i = 0; i < 4; i++) {
      var bar = document.createElement('div');
      bar.className = 'fx-glitch-bar';
      bar.style.top = (Math.random() * 90) + '%';
      bar.style.height = (5 + Math.random() * 14) + '%';
      bar.style.background = ['rgba(255,45,149,0.5)', 'rgba(53,196,255,0.5)', 'rgba(185,87,255,0.5)'][i % 3];
      bar.style.animationDelay = (i * 0.04) + 's';
      o.appendChild(bar);
      void bar.offsetWidth; bar.classList.add('run');
    }
    setTimeout(function () { clear(o); }, 360);
  }

  // ---- CLICK RIPPLE: neon ring at the cursor on any clickable ----
  function ripple(x, y) {
    var o = overlay();
    var r = document.createElement('div');
    r.className = 'fx-ripple';
    r.style.left = x + 'px'; r.style.top = y + 'px';
    o.appendChild(r);
    r.addEventListener('animationend', function () { r.remove(); });
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t.closest && t.closest('button, a, .tab-btn, .hero-chip, .agent-run, .cc-side-toggle, .tb-btn, input, .slider')) {
      ripple(e.clientX, e.clientY);
    }
  }, true);

  // ---- SYNTHWAVE AUDIO (two modes: warm hum pad + generated lo-fi loop) ----
  // Both are fully synthesized via WebAudio (no asset files). Off until the
  // operator clicks, per browser autoplay rules.
  var Audio = (function () {
    var ctx = null, master = null, playing = false, mode = 'hum', current = null;
    var vol = 0.2;  // master level (hum was way too loud at 1.0)
    try { var sv = parseFloat(localStorage.getItem('cc_audio_vol')); if (!isNaN(sv)) vol = Math.min(1, Math.max(0, sv)); } catch (e) {}

    function ensureCtx() {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
      }
      return true;
    }

    // ---- HUM: warm detuned-saw pad (the original) ----
    function HumEngine() {
      var filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 420; filt.Q.value = 6; filt.connect(master);
      var o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55;
      var o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 55.4;
      var o3 = ctx.createOscillator(); o3.type = 'triangle'; o3.frequency.value = 110;
      var g3 = ctx.createGain(); g3.gain.value = 0.25; o3.connect(g3); g3.connect(filt);
      o1.connect(filt); o2.connect(filt);
      var lfo = ctx.createOscillator(); lfo.frequency.value = 0.05;
      var lfoG = ctx.createGain(); lfoG.gain.value = 260; lfo.connect(lfoG); lfoG.connect(filt.frequency);
      o1.start(); o2.start(); o3.start(); lfo.start();
      return { mode: 'hum', stop: function () { try { o1.stop(); o2.stop(); o3.stop(); lfo.stop(); } catch (e) {} } };
    }

    // ---- LO-FI SYNTHWAVE: chord pad + bass + soft drums, generated ----
    function LofiEngine() {
      var out = ctx.createGain(); out.gain.value = 0.5; out.connect(master);
      var padFilt = ctx.createBiquadFilter(); padFilt.type = 'lowpass'; padFilt.frequency.value = 1100; padFilt.Q.value = 2; padFilt.connect(out);
      var flfo = ctx.createOscillator(); flfo.frequency.value = 0.07;
      var flfoG = ctx.createGain(); flfoG.gain.value = 400; flfo.connect(flfoG); flfoG.connect(padFilt.frequency); flfo.start();

      // i - VI - III - VII in A minor (Am F C G)
      var chords = [[220.00, 261.63, 329.63], [174.61, 220.00, 261.63], [261.63, 329.63, 392.00], [196.00, 246.94, 293.66]];
      var basses = [110.00, 87.31, 130.81, 98.00];
      var bpm = 74, beat = 60 / bpm, step = beat / 2;
      var bar = 0, stepIdx = 0, next = ctx.currentTime + 0.1, timer = null;

      function pad(chord) {
        var g = ctx.createGain(); g.connect(padFilt);
        var t0 = ctx.currentTime;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.16, t0 + beat * 0.5);
        g.gain.linearRampToValueAtTime(0.0001, t0 + beat * 2);
        chord.forEach(function (f) {
          var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
          var od = ctx.createOscillator(); od.type = 'sawtooth'; od.frequency.value = f * 1.005;
          o.connect(g); od.connect(g); o.start(t0); od.start(t0);
          o.stop(t0 + beat * 2 + 0.05); od.stop(t0 + beat * 2 + 0.05);
        });
      }
      function bass(f, t) {
        var o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.9);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + beat);
      }
      function kick(t) {
        var o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        var g = ctx.createGain(); g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.2);
      }
      function hat(t) {
        var len = Math.floor(ctx.sampleRate * 0.05);
        var b = ctx.createBuffer(1, len, ctx.sampleRate); var d = b.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
        var s = ctx.createBufferSource(); s.buffer = b;
        var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
        var g = ctx.createGain(); g.gain.setValueAtTime(0.1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
        s.connect(hp); hp.connect(g); g.connect(out); s.start(t); s.stop(t + 0.05);
      }
      function schedule() {
        while (next < ctx.currentTime + 0.2) {
          var chord = chords[bar % chords.length];
          if (stepIdx % 8 === 0) pad(chord);
          if (stepIdx % 4 === 0) { kick(next); bass(basses[bar % basses.length], next); }
          hat(next);
          next += step; stepIdx++;
          if (stepIdx >= 8) { stepIdx = 0; bar++; }
        }
      }
      timer = setInterval(schedule, 25); schedule();
      return { mode: 'lofi', stop: function () { if (timer) clearInterval(timer); try { flfo.stop(); } catch (e) {} } };
    }

    function stopCurrent() { if (current) { try { current.stop(); } catch (e) {} current = null; } }

    function start() {
      if (!ensureCtx()) return;
      if (ctx.state === 'suspended') ctx.resume();
      if (!current || current.mode !== mode) { stopCurrent(); current = (mode === 'lofi' ? LofiEngine() : HumEngine()); }
      playing = true;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.8);
    }
    function stop() {
      playing = false;
      if (master) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
      }
      setTimeout(function () { if (!playing) stopCurrent(); }, 700);
    }
    return {
      toggle: function () { playing ? stop() : start(); return playing; },
      setMode: function (m) {
        if (m !== 'hum' && m !== 'lofi') return;
        var wasPlaying = playing;
        mode = m;
        if (wasPlaying) { stopCurrent(); if (ensureCtx()) current = (mode === 'lofi' ? LofiEngine() : HumEngine()); }
      },
      setVolume: function (v) {
        vol = Math.min(1, Math.max(0, v));
        try { localStorage.setItem('cc_audio_vol', String(vol)); } catch (e) {}
        if (playing && master) {
          master.gain.cancelScheduledValues(ctx.currentTime);
          master.gain.linearRampToValueAtTime(vol, ctx.currentTime + 0.15);
        }
      },
      getVolume: function () { return vol; },
      getMode: function () { return mode; },
      isOn: function () { return playing; },
      // expose a live AnalyserNode tapped off the master bus (for the visualizer)
      getAnalyser: function () {
        if (!ensureCtx()) return null;
        if (!current && !playing) { /* nothing playing yet; build a silent analyser anyway */ }
        if (!window.__ccAnalyser) {
          try { window.__ccAnalyser = ctx.createAnalyser(); window.__ccAnalyser.fftSize = 1024; master.connect(window.__ccAnalyser); } catch (e) {}
        }
        return window.__ccAnalyser;
      }
    };
  })();
  window.CCAudio = Audio;

  window.CCFX.whoosh = whoosh;
  window.CCFX.sunBlast = sunBlast;

  // ---- Cursor-following tooltips for [data-tip] elements ----
  function initTips() {
    var tip = document.getElementById('cc-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'cc-tip';
      document.body.appendChild(tip);
    }
    var active = null;

    function show(el) {
      active = el;
      tip.textContent = el.getAttribute('data-tip') || '';
      tip.classList.add('show');
    }
    function hide() {
      active = null;
      tip.classList.remove('show');
    }
    function move(e) {
      if (!active) return;
      var pad = 16;
      var x = e.clientX + pad;
      var y = e.clientY + pad;
      // keep on-screen
      var r = tip.getBoundingClientRect();
      if (x + r.width > window.innerWidth - 6) x = e.clientX - r.width - pad;
      if (y + r.height > window.innerHeight - 6) y = e.clientY - r.height - pad;
      if (y < 4) y = 4;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    }

    // delegate so dynamically-added buttons work too
    document.addEventListener('mouseover', function (e) {
      var el = e.target.closest('[data-tip]');
      if (el) show(el);
    });
    document.addEventListener('mouseout', function (e) {
      var el = e.target.closest('[data-tip]');
      if (el && (!e.relatedTarget || !e.relatedTarget.closest || e.relatedTarget.closest('[data-tip]') !== el)) hide();
    });
    document.addEventListener('mousemove', move);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTips);
  } else {
    initTips();
  }
})();
