// Audio Visualizer — neon bars + scope and an Orbit Bloom-inspired particle mode.
(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && root.document) {
    root.CCViz = api.create(root);
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var DEFAULT_MODE = "bars";
  var PARTICLE_MODE = "particle-accelerator";
  var MODE_STORAGE_KEY = "cc_visualizer_mode";
  var TAU = Math.PI * 2;
  var MODE_LABELS = Object.freeze({
    bars: "Bars + scope",
    "particle-accelerator": "Particle accelerator",
  });

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, Number(value) || 0));
  }

  function normalizeMode(value) {
    return Object.prototype.hasOwnProperty.call(MODE_LABELS, String(value || ""))
      ? String(value)
      : DEFAULT_MODE;
  }

  function readMode(storage) {
    try {
      return normalizeMode(storage && storage.getItem(MODE_STORAGE_KEY));
    } catch (_error) {
      return DEFAULT_MODE;
    }
  }

  function writeMode(storage, value) {
    var mode = normalizeMode(value);
    try {
      if (storage) storage.setItem(MODE_STORAGE_KEY, mode);
    } catch (_error) {
      // Storage can be unavailable in private or locked-down browser contexts.
    }
    return mode;
  }

  function averageBand(data, startRatio, endRatio) {
    if (!data || !data.length) return 0;
    var start = Math.max(0, Math.floor(data.length * startRatio));
    var end = Math.max(start + 1, Math.min(data.length, Math.ceil(data.length * endRatio)));
    var total = 0;
    for (var index = start; index < end; index++) total += data[index];
    return total / (end - start) / 255;
  }

  function audioLevels(data) {
    var bass = averageBand(data, 0, 0.16);
    var mids = averageBand(data, 0.16, 0.52);
    var highs = averageBand(data, 0.52, 0.86);
    return {
      bass: bass,
      mids: mids,
      highs: highs,
      energy: clamp(bass * 0.46 + mids * 0.38 + highs * 0.16, 0, 1),
    };
  }

  function clampFrameDelta(milliseconds) {
    return clamp(milliseconds, 0, 50);
  }

  function particleSpeedTarget(levels, beat, reducedMotion) {
    var target = 0.16 + levels.energy * 1.1 + levels.bass * 0.58 + clamp(beat, 0, 1) * 0.72;
    return clamp(target, 0.12, reducedMotion ? 0.42 : 2.15);
  }

  function approachSpeed(current, target, deltaMilliseconds) {
    var deltaSeconds = clampFrameDelta(deltaMilliseconds) / 1000;
    var response = target > current ? 3.4 : 1.35;
    return current + (target - current) * Math.min(1, deltaSeconds * response);
  }

  function advanceParticlePhase(phase, velocity, deltaMilliseconds) {
    return (Number(phase) || 0)
      + Math.max(0, Number(velocity) || 0) * clampFrameDelta(deltaMilliseconds) / 1000;
  }

  function followerCoefficient(deltaMilliseconds, timeConstantMilliseconds) {
    var timeConstant = Math.max(1, Number(timeConstantMilliseconds) || 95);
    return 1 - Math.exp(-clampFrameDelta(deltaMilliseconds) / timeConstant);
  }

  function seededUnit(index, salt) {
    var value = Math.sin((index + 1) * 12.9898 + (salt || 0) * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  function createParticleField(count) {
    var total = Math.max(1, Math.floor(Number(count) || 1));
    var arms = 6;
    var rows = Math.ceil(total / arms);
    return Array.from({ length: total }, function (_unused, index) {
      var row = Math.floor(index / arms);
      return {
        arm: index % arms,
        frequency: seededUnit(index, 1),
        offset: seededUnit(index, 2) * TAU,
        radius: clamp((row + seededUnit(index, 3) * 0.28) / rows, 0, 0.999),
        size: 0.6 + seededUnit(index, 4) * 1.8,
        speed: 0.65 + seededUnit(index, 5) * 0.7,
        hue: seededUnit(index, 6) * 54,
      };
    });
  }

  function resolveAnalyser(host) {
    var music = host && host.CCMusic;
    var musicActive = false;
    try {
      musicActive = Boolean(music && music.isPlaying && music.isPlaying());
    } catch (_error) {
      musicActive = false;
    }
    if (musicActive && music.getAnalyser) {
      try {
        var musicAnalyser = music.getAnalyser();
        if (musicAnalyser) return musicAnalyser;
      } catch (_error) {
        // Fall through to the ambient-audio analyser.
      }
    }
    var ambient = host && host.CCAudio;
    if (ambient && ambient.getAnalyser) {
      try {
        return ambient.getAnalyser() || null;
      } catch (_error) {
        return null;
      }
    }
    return null;
  }

  function audioIsActive(host) {
    try {
      if (host && host.CCMusic && host.CCMusic.isPlaying && host.CCMusic.isPlaying()) return true;
    } catch (_error) {
      // A broken optional source must not stop the visualizer.
    }
    try {
      return Boolean(host && host.CCAudio && host.CCAudio.isOn && host.CCAudio.isOn());
    } catch (_error) {
      return false;
    }
  }

  function create(host) {
    host = host || {};
    var documentRef = host.document || null;
    var canvas = null;
    var context = null;
    var frameHandle = null;
    var running = false;
    var resizeBound = false;
    var resizeObserver = null;
    var controlsBound = false;
    var frequencyData = null;
    var waveformData = null;
    var idleFrequencyData = new Uint8Array(64);
    var mode = readMode(safeStorage());
    var cssWidth = 1;
    var cssHeight = 1;
    var dpr = 1;
    var particles = [];
    var particlePhase = 0;
    var particleVelocity = 0.16;
    var bassFollower = 0;
    var beat = 0;
    var lastFrameAt = 0;
    var needsClear = true;
    var lastFootState = "";
    var lastAudioActive = false;
    var reducedMotion = Boolean(
      host.matchMedia && host.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
    var currentPoint = { x: 0, y: 0 };
    var previousPoint = { x: 0, y: 0 };

    function safeStorage() {
      try {
        return host.localStorage || null;
      } catch (_error) {
        return null;
      }
    }

    function requestFrame(callback) {
      return host.requestAnimationFrame ? host.requestAnimationFrame(callback) : null;
    }

    function cancelFrame(handle) {
      if (handle !== null && host.cancelAnimationFrame) host.cancelAnimationFrame(handle);
    }

    function size() {
      if (!canvas || !context) return false;
      var rect = canvas.getBoundingClientRect();
      cssWidth = Math.max(1, rect.width || canvas.clientWidth || 320);
      cssHeight = Math.max(1, rect.height || canvas.clientHeight || 340);
      var nativeDpr = Math.max(1, Number(host.devicePixelRatio) || 1);
      var pixelBudgetDpr = Math.sqrt(1200000 / Math.max(1, cssWidth * cssHeight));
      dpr = mode === DEFAULT_MODE
        ? 1
        : Math.min(nativeDpr, reducedMotion ? 1 : 1.6, pixelBudgetDpr);
      var width = Math.max(1, Math.round(cssWidth * dpr));
      var height = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        if (context.setTransform) context.setTransform(dpr, 0, 0, dpr, 0, 0);
        needsClear = true;
      }
      var desiredParticles = reducedMotion
        ? clamp(Math.round(cssWidth * cssHeight / 15000), 24, 42)
        : clamp(
          Math.round(cssWidth * cssHeight / 4000),
          cssWidth < 480 ? 56 : 72,
          cssWidth < 480 ? 84 : 132
        );
      if (particles.length !== desiredParticles) particles = createParticleField(desiredParticles);
      return true;
    }

    function ensureBuffers(analyser, includeWaveform) {
      var frequencyLength = Math.max(1, Number(analyser.frequencyBinCount) || 64);
      var waveformLength = Math.max(frequencyLength, Number(analyser.fftSize) || frequencyLength * 2);
      if (!frequencyData || frequencyData.length !== frequencyLength) {
        frequencyData = new Uint8Array(frequencyLength);
      }
      if (includeWaveform && (!waveformData || waveformData.length !== waveformLength)) {
        waveformData = new Uint8Array(waveformLength);
      }
    }

    function clearCanvas() {
      if (!context) return;
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.restore();
      needsClear = false;
    }

    function drawBars(analyser) {
      context.clearRect(0, 0, cssWidth, cssHeight);
      context.fillStyle = "rgba(10,1,24,0.35)";
      context.fillRect(0, 0, cssWidth, cssHeight);
      if (!analyser) {
        drawBarsIdle();
        return;
      }

      var bars = Math.min(48, frequencyData.length);
      var step = Math.max(1, Math.floor(frequencyData.length / bars));
      var barWidth = cssWidth / bars;
      for (var index = 0; index < bars; index++) {
        var value = 0;
        var samples = 0;
        for (var sample = 0; sample < step && index * step + sample < frequencyData.length; sample++) {
          value += frequencyData[index * step + sample];
          samples++;
        }
        value /= Math.max(1, samples);
        var barHeight = value / 255 * cssHeight * 0.92;
        var gradient = context.createLinearGradient(0, cssHeight, 0, cssHeight - barHeight);
        gradient.addColorStop(0, "rgba(255,45,149,0.9)");
        gradient.addColorStop(0.5, "rgba(185,87,255,0.9)");
        gradient.addColorStop(1, "rgba(53,196,255,0.95)");
        context.fillStyle = gradient;
        context.shadowColor = "rgba(53,196,255,0.7)";
        context.shadowBlur = 12;
        context.fillRect(index * barWidth + 2, cssHeight - barHeight, Math.max(1, barWidth - 4), barHeight);
      }

      context.shadowBlur = 0;
      context.beginPath();
      context.lineWidth = 2;
      context.strokeStyle = "rgba(255,210,74,0.9)";
      for (var point = 0; point < waveformData.length; point++) {
        var x = point / Math.max(1, waveformData.length - 1) * cssWidth;
        var y = cssHeight / 2 + (waveformData[point] - 128) / 128 * (cssHeight * 0.35);
        if (point === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }

    function drawBarsIdle() {
      var time = Date.now() / 600;
      context.shadowBlur = 8;
      context.shadowColor = "rgba(185,87,255,0.7)";
      context.strokeStyle = "rgba(185,87,255,0.5)";
      context.lineWidth = 2;
      context.beginPath();
      for (var x = 0; x < cssWidth; x += 2) {
        var y = cssHeight / 2 + Math.sin(x / 40 + time) * 12 * Math.sin(time / 3);
        if (x === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
      context.shadowBlur = 0;
    }

    function particlePosition(particle, travel, phase, span, centerX, centerY, levels, output) {
      var armAngle = particle.arm / 6 * TAU;
      var angle = armAngle + travel * TAU * 1.82 + phase * (0.34 + particle.speed * 0.18) + particle.offset * 0.025;
      var radius = span * (0.07 + Math.pow(travel, 0.88) * (0.89 + levels.bass * 0.08));
      output.x = centerX + Math.cos(angle) * radius;
      output.y = centerY + Math.sin(angle) * radius * (0.7 + levels.mids * 0.06);
      return output;
    }

    function drawParticleAccelerator(now, hasAudio) {
      var levels = audioLevels(hasAudio ? frequencyData : idleFrequencyData);
      var delta = lastFrameAt ? clampFrameDelta(now - lastFrameAt) : 16.67;
      lastFrameAt = now;
      var onset = Math.max(0, levels.bass - bassFollower);
      bassFollower += (levels.bass - bassFollower) * followerCoefficient(delta, 95);
      beat = Math.max(beat * Math.pow(0.86, delta / 16.67), clamp(onset * 7.2, 0, 1));
      var target = particleSpeedTarget(levels, beat, reducedMotion);
      particleVelocity = approachSpeed(particleVelocity, target, delta);
      // Keep radial travel continuous. Wrapping the shared phase would make
      // every particle jump backward at once when the angle crossed 2π.
      particlePhase = advanceParticlePhase(particlePhase, particleVelocity, delta);

      context.fillStyle = reducedMotion ? "rgba(2,3,16,0.32)" : "rgba(2,3,16,0.11)";
      context.fillRect(0, 0, cssWidth, cssHeight);
      var centerX = cssWidth * 0.5;
      var centerY = cssHeight * 0.48;
      var span = Math.min(cssWidth, cssHeight) * 0.53;

      context.save();
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";

      for (var rail = 0; rail < 3; rail++) {
        var railRadius = span * (0.23 + rail * 0.24 + levels.bass * 0.025);
        context.beginPath();
        context.ellipse(centerX, centerY, railRadius, railRadius * 0.7, particlePhase * (rail % 2 ? -0.18 : 0.13), 0, TAU);
        context.strokeStyle = rail === 1
          ? "rgba(185,87,255," + (0.07 + levels.mids * 0.12) + ")"
          : "rgba(53,196,255," + (0.045 + levels.highs * 0.1) + ")";
        context.lineWidth = 0.7 + levels.highs * 1.1;
        context.stroke();
      }

      for (var index = 0; index < particles.length; index++) {
        var particle = particles[index];
        var travel = (particle.radius + particlePhase * (0.055 + particle.speed * 0.022)) % 1;
        var trailLength = reducedMotion ? 0.008 : 0.025 + levels.energy * 0.04 + beat * 0.018;
        particlePosition(particle, travel, particlePhase, span, centerX, centerY, levels, currentPoint);
        particlePosition(
          particle,
          Math.max(0, travel - trailLength),
          particlePhase - trailLength,
          span,
          centerX,
          centerY,
          levels,
          previousPoint
        );
        var bin = Math.min((hasAudio ? frequencyData.length : idleFrequencyData.length) - 1,
          Math.floor(particle.frequency * (hasAudio ? frequencyData.length : idleFrequencyData.length)));
        var spectrum = hasAudio ? frequencyData[bin] / 255 : 0.055;
        var hue = 188 + particle.hue + particle.arm * 11 + levels.highs * 28;
        var alpha = 0.1 + spectrum * 0.62 + levels.energy * 0.12;

        if (!reducedMotion && travel > trailLength) {
          context.beginPath();
          context.moveTo(previousPoint.x, previousPoint.y);
          context.lineTo(currentPoint.x, currentPoint.y);
          context.strokeStyle = "hsla(" + hue + " 96% 65% / " + clamp(alpha * 0.55, 0, 0.75) + ")";
          context.lineWidth = 0.6 + spectrum * 1.8 + beat * 0.7;
          context.stroke();
        }

        var radius = particle.size + spectrum * 3.1 + beat * (particle.arm % 2 ? 1.2 : 2.1);
        context.fillStyle = "hsla(" + hue + " 98% " + (68 + spectrum * 18) + "% / " + clamp(alpha, 0, 0.92) + ")";
        context.shadowColor = "hsla(" + hue + " 100% 64% / 0.75)";
        context.shadowBlur = 5 + spectrum * 18 + beat * 10;
        context.beginPath();
        context.arc(currentPoint.x, currentPoint.y, radius, 0, TAU);
        context.fill();
      }

      var coreRadius = span * (0.045 + levels.bass * 0.045 + beat * 0.018);
      var core = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(3, coreRadius * 3.2));
      core.addColorStop(0, "rgba(255,255,255," + (0.68 + beat * 0.22) + ")");
      core.addColorStop(0.24, "rgba(53,196,255," + (0.42 + levels.bass * 0.3) + ")");
      core.addColorStop(0.62, "rgba(185,87,255," + (0.2 + beat * 0.18) + ")");
      core.addColorStop(1, "rgba(255,45,149,0)");
      context.fillStyle = core;
      context.shadowBlur = 24 + beat * 30;
      context.shadowColor = "rgba(53,196,255,0.7)";
      context.beginPath();
      context.arc(centerX, centerY, Math.max(3, coreRadius * 3.2), 0, TAU);
      context.fill();
      context.restore();
    }

    function updateFoot(hasAudio, announce) {
      if (!documentRef) return;
      var foot = documentRef.getElementById("viz-foot");
      if (!foot) return;
      var state = mode + ":" + (hasAudio ? "active" : "idle");
      if (!announce && state === lastFootState) return;
      lastFootState = state;
      var label = MODE_LABELS[mode];
      foot.textContent = hasAudio
        ? label + " — reacting to active audio."
        : label + " — start music or titlebar audio to make it react.";
    }

    function syncControls() {
      if (!documentRef) return;
      var buttons = documentRef.querySelectorAll("[data-viz-mode]");
      Array.prototype.forEach.call(buttons, function (button) {
        var active = normalizeMode(button.dataset.vizMode) === mode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
      if (canvas) canvas.setAttribute("aria-label", "Audio visualizer: " + MODE_LABELS[mode]);
    }

    function resetParticleMotion() {
      particlePhase = 0;
      particleVelocity = 0.16;
      bassFollower = 0;
      beat = 0;
      lastFrameAt = 0;
    }

    function setMode(value, options) {
      var next = normalizeMode(value);
      var changed = next !== mode;
      mode = next;
      if (!options || options.persist !== false) writeMode(safeStorage(), mode);
      syncControls();
      if (changed) {
        resetParticleMotion();
        needsClear = true;
        if (context) {
          size();
          clearCanvas();
        }
      }
      updateFoot(lastAudioActive, true);
      return mode;
    }

    function bindControls() {
      if (!documentRef || controlsBound) return;
      var buttons = documentRef.querySelectorAll("[data-viz-mode]");
      Array.prototype.forEach.call(buttons, function (button) {
        button.addEventListener("click", function () {
          setMode(button.dataset.vizMode);
        });
      });
      controlsBound = true;
    }

    function mount() {
      if (!documentRef) return false;
      canvas = documentRef.getElementById("viz-canvas");
      if (!canvas) return false;
      context = canvas.getContext("2d");
      if (!context) return false;
      bindControls();
      syncControls();
      var mountedAudioActive = audioIsActive(host);
      lastAudioActive = Boolean(mountedAudioActive && resolveAnalyser(host));
      updateFoot(lastAudioActive, false);
      return size();
    }

    function draw(now) {
      if (!running) {
        frameHandle = null;
        return;
      }
      frameHandle = requestFrame(draw);
      if (!context && !mount()) return;
      if (needsClear) clearCanvas();

      var audioActive = audioIsActive(host);
      var analyser = audioActive ? resolveAnalyser(host) : null;
      var reactiveAudio = Boolean(audioActive && analyser);
      lastAudioActive = reactiveAudio;
      if (reactiveAudio) {
        ensureBuffers(analyser, mode === DEFAULT_MODE);
        analyser.getByteFrequencyData(frequencyData);
        if (mode === DEFAULT_MODE) analyser.getByteTimeDomainData(waveformData);
      }
      if (mode === PARTICLE_MODE) drawParticleAccelerator(Number(now) || Date.now(), reactiveAudio);
      else drawBars(reactiveAudio ? analyser : null);
      updateFoot(reactiveAudio, false);
    }

    function onShow() {
      if (!mount()) return;
      if (!resizeBound && host.addEventListener) {
        host.addEventListener("resize", size);
        resizeBound = true;
      }
      if (running) return;
      if (host.ResizeObserver) {
        if (!resizeObserver) resizeObserver = new host.ResizeObserver(size);
        resizeObserver.observe(canvas);
      }
      running = true;
      lastFrameAt = 0;
      if (frameHandle === null) frameHandle = requestFrame(draw);
    }

    function onHide() {
      running = false;
      cancelFrame(frameHandle);
      frameHandle = null;
      lastFrameAt = 0;
      if (resizeObserver) resizeObserver.disconnect();
      if (resizeBound && host.removeEventListener) {
        host.removeEventListener("resize", size);
        resizeBound = false;
      }
    }

    return {
      getMode: function () { return mode; },
      onHide: onHide,
      onShow: onShow,
      setMode: setMode,
    };
  }

  return {
    DEFAULT_MODE: DEFAULT_MODE,
    MODE_LABELS: MODE_LABELS,
    MODE_STORAGE_KEY: MODE_STORAGE_KEY,
    PARTICLE_MODE: PARTICLE_MODE,
    advanceParticlePhase: advanceParticlePhase,
    approachSpeed: approachSpeed,
    audioIsActive: audioIsActive,
    audioLevels: audioLevels,
    averageBand: averageBand,
    clampFrameDelta: clampFrameDelta,
    create: create,
    createParticleField: createParticleField,
    followerCoefficient: followerCoefficient,
    normalizeMode: normalizeMode,
    particleSpeedTarget: particleSpeedTarget,
    readMode: readMode,
    resolveAnalyser: resolveAnalyser,
    writeMode: writeMode,
  };
});
