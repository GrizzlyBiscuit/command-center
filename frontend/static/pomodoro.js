// Pomodoro / Focus Timer — a sun that "charges" as the session burns down,
// and explodes (reusing the CCFX sun-blast) when it hits zero.
(function () {
  var timer = null, total = 25 * 60, left = 25 * 60, running = false;
  var today = 0;
  function fmt(s) {
    var m = Math.floor(s / 60), ss = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
  }
  function render() {
    var timeEl = document.getElementById('pomo-time');
    var sun = document.getElementById('pomo-sun');
    var core = sun && sun.querySelector('.pomo-core');
    var pct = total > 0 ? left / total : 0; // 1 -> full, 0 -> empty
    if (timeEl) timeEl.textContent = fmt(left);
    if (sun) {
      // charge up: grows brighter + scales as time remains; shrinks toward zero
      var scale = 0.6 + 0.4 * pct;
      sun.style.transform = 'scale(' + scale.toFixed(3) + ')';
      if (core) {
        core.style.opacity = (0.3 + 0.7 * pct).toFixed(2);
        core.style.boxShadow = '0 0 ' + (20 + 60 * pct) + 'px rgba(255,' + Math.floor(120 + 100 * pct) + ',60,0.9)';
      }
    }
    var c = document.getElementById('pomo-count');
    if (c) c.textContent = 'Sessions today: ' + today;
  }
  function tick() {
    left--;
    if (left <= 0) {
      left = 0; render();
      stop();
      // explode! use the same sun-blast as the close button
      var sun = document.getElementById('pomo-sun');
      if (sun) {
        sun.style.transition = 'transform .4s ease-in, opacity .4s';
        sun.style.transform = 'scale(2.4)'; sun.style.opacity = '0';
      }
      if (window.CCFX && window.CCFX.sunBlast) setTimeout(function(){ window.CCFX.sunBlast(); }, 250);
      today++;
      try { localStorage.setItem('cc_pomo_today', String(today)); } catch (e) {}
      setTimeout(function () { if (sun) { sun.style.opacity = '1'; sun.style.transform = 'scale(1)'; } render(); }, 1200);
      return;
    }
    render();
  }
  function start() {
    if (running || left <= 0) return;
    running = true;
    timer = setInterval(tick, 1000);
  }
  function stop() { running = false; if (timer) { clearInterval(timer); timer = null; } }
  function reset(mins) {
    stop();
    total = (mins || 25) * 60; left = total; render();
  }
  window.CCPomo = {
    onShow: function () {
      try { var t = parseInt(localStorage.getItem('cc_pomo_today') || '0', 10); if (!isNaN(t)) today = t; } catch (e) {}
      reset(25); running = false;
      var startBtn = document.getElementById('pomo-start');
      var pauseBtn = document.getElementById('pomo-pause');
      var resetBtn = document.getElementById('pomo-reset');
      if (startBtn) startBtn.onclick = start;
      if (pauseBtn) pauseBtn.onclick = stop;
      if (resetBtn) resetBtn.onclick = function () { reset(25); };
      document.querySelectorAll('.pomo-mode').forEach(function (b) {
        b.onclick = function () {
          document.querySelectorAll('.pomo-mode').forEach(function (x) { x.classList.remove('active'); });
          b.classList.add('active');
          reset(parseInt(b.dataset.min, 10));
        };
      });
    },
    onHide: function () { stop(); }
  };
})();
