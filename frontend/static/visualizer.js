// Audio Visualizer — neon bars + scope tapping the audio engine's analyser.
(function () {
  var canvas, ctx, raf = null, running = false, buf = null;
  function size() {
    if (!canvas) return;
    var r = canvas.getBoundingClientRect();
    canvas.width = Math.max(320, r.width);
    canvas.height = Math.max(220, r.height);
  }
  function draw() {
    if (!running) return;
    raf = requestAnimationFrame(draw);
    var musicActive = window.CCMusic && window.CCMusic.isPlaying && window.CCMusic.isPlaying();
    var an = (musicActive && window.CCMusic.getAnalyser && window.CCMusic.getAnalyser())
      || (window.CCAudio && window.CCAudio.getAnalyser())
      || null;
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    // backdrop
    ctx.fillStyle = 'rgba(10,1,24,0.35)';
    ctx.fillRect(0, 0, W, H);
    if (!an) { idle(); return; }
    if (!buf || buf.length !== an.frequencyBinCount) buf = new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(buf);
    var bars = 48, step = Math.floor(buf.length / bars);
    var bw = W / bars;
    for (var i = 0; i < bars; i++) {
      var v = 0; for (var j = 0; j < step; j++) v += buf[i * step + j]; v /= step;
      var h = (v / 255) * H * 0.92;
      var t = i / bars;
      var grad = ctx.createLinearGradient(0, H, 0, H - h);
      grad.addColorStop(0, 'rgba(255,45,149,0.9)');
      grad.addColorStop(0.5, 'rgba(185,87,255,0.9)');
      grad.addColorStop(1, 'rgba(53,196,255,0.95)');
      ctx.fillStyle = grad;
      ctx.shadowColor = 'rgba(53,196,255,0.7)';
      ctx.shadowBlur = 12;
      ctx.fillRect(i * bw + 2, H - h, bw - 4, h);
    }
    // center scope line
    an.getByteTimeDomainData(buf);
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,210,74,0.9)';
    for (var k = 0; k < buf.length; k++) {
      var x = (k / buf.length) * W;
      var y = H / 2 + ((buf[k] - 128) / 128) * (H * 0.35);
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  function idle() {
    var W = canvas.width, H = canvas.height;
    var t = Date.now() / 600;
    ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(185,87,255,0.7)';
    ctx.strokeStyle = 'rgba(185,87,255,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (var x = 0; x < W; x++) {
      var y = H / 2 + Math.sin(x / 40 + t) * 12 * Math.sin(t / 3);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  window.CCViz = {
    onShow: function () {
      canvas = document.getElementById('viz-canvas');
      if (!canvas) return;
      ctx = canvas.getContext('2d');
      size();
      running = true; if (!raf) draw();
      window.addEventListener('resize', size);
    },
    onHide: function () { running = false; if (raf) { cancelAnimationFrame(raf); raf = null; } }
  };
})();
