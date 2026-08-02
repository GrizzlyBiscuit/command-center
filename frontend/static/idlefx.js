/* Command Center — Idle FX.
 * When the operator leaves the window alone, the synthwave scene comes ALIVE:
 * neon particle drift, floating orbs, grid sway, sun breathing, hue-cycle,
 * panel glow pulse. Any input (mouse/key/touch/scroll) instantly calms it.
 * Cheap: capped particle count, rAF, eased speed ramp, prefers-reduced-motion
 * respected. Lives alongside (not inside) fx.js so transitions are untouched. */
(function () {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var IDLE_AFTER = 3500;            // ms of no input before the scene wakes up
  var RAMP = 600;                   // ms ease for speed/opacity changes
  var MAX_PARTICLES = 80;           // drifting motes (denser now)
  var MAX_RAIN = 60;                // vertical neon rain streaks when idle

  var glowSprite = (function () {
    var s = document.createElement('canvas');
    var R = 16; s.width = s.height = R * 2;
    var g = s.getContext('2d');
    var grd = g.createRadialGradient(R, R, 0, R, R, R);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, R * 2, R * 2);
    return s;
  })();

  var PALETTE = ['#ff2d95', '#b957ff', '#35c4ff', '#ffe14a', '#ff8a3c', '#39ff14'];
  var body = document.body;

  // ---------- idle detection ----------
  var idleTimer = null;
  function wake() {
    body.classList.remove('idle');
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      body.classList.add('idle');
      try {
        var shell = document.querySelector('.app-shell');
        var sb = document.getElementById('cc-sidebar');
        if (shell && !shell.classList.contains('sidebar-collapsed')) {
          shell.classList.add('sidebar-collapsed');
          if (sb) sb.classList.add('collapsed');
          localStorage.setItem('cc_sidebar_collapsed', '1');
        }
      } catch (e) {}
    }, IDLE_AFTER);
  }
  ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll', 'resize']
    .forEach(function (ev) { window.addEventListener(ev, wake, { passive: true }); });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) wake(); else body.classList.add('idle');
  });

  if (/[?&]idle=1\b/.test(location.search)) {
    body.classList.add('idle');
  } else {
    wake();
  }

  // ---------- floating orbs (pure-CSS drift; JS just spawns them) ----------
  function spawnOrbs() {
    if (document.getElementById('idle-orbs')) return;
    var wrap = document.createElement('div');
    wrap.id = 'idle-orbs';
    wrap.className = 'idle-orbs';
    for (var i = 0; i < 6; i++) {
      var o = document.createElement('div');
      o.className = 'idle-orb';
      var c = PALETTE[i % PALETTE.length];
      o.style.background = 'radial-gradient(circle at 30% 30%, ' + c + ', transparent 70%)';
      o.style.boxShadow = '0 0 40px 6px ' + c;
      o.style.left = (8 + Math.random() * 84) + 'vw';
      o.style.top = (10 + Math.random() * 78) + 'vh';
      o.style.animationDuration = (14 + Math.random() * 16) + 's';
      o.style.animationDelay = (-Math.random() * 18) + 's';
      wrap.appendChild(o);
    }
    body.appendChild(wrap);
  }
  spawnOrbs();

  // ---------- neon particle field (canvas) ----------
  var canvas = document.createElement('canvas');
  canvas.id = 'idle-particles';
  canvas.className = 'idle-particles';
  body.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  var W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
  var motes = [];

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  function seed() {
    motes = [];
    for (var i = 0; i < MAX_PARTICLES; i++) {
      var c = PALETTE[(Math.random() * PALETTE.length) | 0];
      motes.push({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25 - 0.12,
        r: 1 + Math.random() * 2.6, c: c, a: 0.25 + Math.random() * 0.5
      });
    }
    rain = [];
    for (var j = 0; j < MAX_RAIN; j++) {
      var rc = PALETTE[(Math.random() * PALETTE.length) | 0];
      rain.push({
        x: Math.random() * W, y: Math.random() * H,
        len: 30 + Math.random() * 70, vy: 1.5 + Math.random() * 3.5,
        c: rc, a: 0.15 + Math.random() * 0.35
      });
    }
  }
  var rain = [];
  seed();

  var speed = 1, targetSpeed = 1;
  var glow = 0.35, targetGlow = 0.35;
  var idleGlow = false;
  var rafOn = false;

  function loop() {
    rafOn = false;
    frame();
  }
  function startLoop() { if (!rafOn) { rafOn = true; requestAnimationFrame(loop); } }

  function frame() {
    targetSpeed = body.classList.contains('idle') ? 2.6 : 1;
    targetGlow = body.classList.contains('idle') ? 1 : 0.0;
    speed += (targetSpeed - speed) * 0.04;
    glow += (targetGlow - glow) * 0.04;

    if (glow < 0.01) {
      ctx.clearRect(0, 0, W, H);
      return;
    }

    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      m.x += m.vx * speed; m.y += m.vy * speed;
      if (m.x < -20) m.x = W + 20; else if (m.x > W + 20) m.x = -20;
      if (m.y < -20) m.y = H + 20; else if (m.y > H + 20) m.y = -20;
      ctx.globalAlpha = m.a * glow;
      ctx.drawImage(glowSprite, m.x - (m.r * 6) / 2, m.y - (m.r * 6) / 2, m.r * 6, m.r * 6);
    }
    for (var k = 0; k < rain.length; k++) {
      var d2 = rain[k];
      d2.y += d2.vy * speed;
      if (d2.y - d2.len > H) { d2.y = -d2.len; d2.x = Math.random() * W; }
      var grd = ctx.createLinearGradient(d2.x, d2.y - d2.len, d2.x, d2.y);
      grd.addColorStop(0, 'transparent');
      grd.addColorStop(1, d2.c);
      ctx.strokeStyle = grd;
      ctx.globalAlpha = d2.a * glow;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(d2.x, d2.y - d2.len);
      ctx.lineTo(d2.x, d2.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    startLoop();
  }
  startLoop();

  var _obs = new MutationObserver(function () {
    if (body.classList.contains('idle')) startLoop();
  });
  try { _obs.observe(body, { attributes: true, attributeFilter: ['class'] }); } catch (e) {}

  window.CCIdleFX = { kill: function () { body.classList.remove('idle'); } };
})();
