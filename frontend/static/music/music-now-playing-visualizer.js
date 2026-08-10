/*
 * Local Media Player-compatible Now Playing visualizer modes.
 * Portions Copyright (c) 2026 sagan246. SPDX-License-Identifier: MIT.
 */
(function (root, factory) {
  "use strict";
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CCMusicNowPlayingVisualizer = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const MODES = Object.freeze(["bars", "wave", "dots", "mirror", "ring", "mountain", "orbit", "rain"]);
  const MODE_STORAGE_KEY = "cc.music.now-playing.visualizer.mode.v1";
  const DEFAULT_MODE = "bars";
  const MODE_LABELS = Object.freeze({
    bars: "Bars",
    wave: "Wave",
    dots: "Dots",
    mirror: "Mirror",
    ring: "Ring",
    mountain: "Mountain",
    orbit: "Orbit",
    rain: "Rain",
  });

  function normalizeMode(value) {
    const mode = String(value || "").trim().toLowerCase();
    return MODES.includes(mode) ? mode : DEFAULT_MODE;
  }

  function readMode(storage) {
    try { return normalizeMode(storage?.getItem?.(MODE_STORAGE_KEY)); }
    catch { return DEFAULT_MODE; }
  }

  function writeMode(storage, value) {
    const mode = normalizeMode(value);
    try { storage?.setItem?.(MODE_STORAGE_KEY, mode); }
    catch {}
    return mode;
  }

  function nextMode(value) {
    const mode = normalizeMode(value);
    return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  }

  function syntheticFrequencyData(now = 0, length = 64) {
    const data = new Uint8Array(Math.max(8, Number(length) || 64));
    for (let index = 0; index < data.length; index += 1) {
      const lowRollOff = Math.max(0.18, 1 - index / data.length * 0.78);
      const pulse = 0.26
        + Math.abs(Math.sin(index * 0.61 + now / 610)) * 0.28
        + Math.abs(Math.sin(index * 0.17 - now / 880)) * 0.16;
      data[index] = Math.round(Math.min(1, pulse * lowRollOff) * 255);
    }
    return data;
  }

  function create(options = {}) {
    const host = options.host || root;
    const canvas = options.canvas || null;
    const storage = options.storage || host?.localStorage;
    const styleSource = options.styleSource || canvas;
    let mode = readMode(storage);

    function cssValue(name, fallback) {
      try {
        const value = host?.getComputedStyle?.(styleSource)?.getPropertyValue?.(name)?.trim();
        return value || fallback;
      } catch {
        return fallback;
      }
    }

    function colors() {
      return {
        accent: cssValue("--accent", cssValue("--cc-local-music-accent", "#7c3aed")),
        strong: cssValue("--accent-2", cssValue("--cc-local-music-accent-strong", "#a855f7")),
        text: cssValue("--text", "#f8fafc"),
      };
    }

    function setMode(value, { remember = true } = {}) {
      mode = remember ? writeMode(storage, value) : normalizeMode(value);
      syncCanvasLabel();
      return mode;
    }

    function cycle() {
      return setMode(nextMode(mode));
    }

    function syncCanvasLabel() {
      if (!canvas) return;
      const label = MODE_LABELS[mode] || mode;
      canvas.title = `Visualizer: ${label}. Click to switch.`;
      canvas.dataset.visualizerMode = mode;
      canvas.setAttribute?.("aria-label", `Visualizer: ${label}. Activate to switch`);
    }

    function prepare() {
      const context = canvas?.getContext?.("2d");
      if (!context) return null;
      const rect = canvas.getBoundingClientRect?.() || {
        width: canvas.clientWidth || 560,
        height: canvas.clientHeight || 96,
      };
      if (rect.width < 2 || rect.height < 2) return null;
      const dpr = Math.max(1, Math.min(2, Number(host?.devicePixelRatio) || 1));
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.clearRect(0, 0, width, height);
      return { context, dpr, width, height };
    }

    function average(data, start, end) {
      let total = 0;
      for (let index = start; index < end; index += 1) total += data[index] || 0;
      return total / Math.max(1, end - start) / 255;
    }

    function band(data, index, count) {
      const limit = data.length * 0.72;
      const start = Math.floor(index / count * limit);
      const end = Math.max(start + 1, Math.floor((index + 1) / count * limit));
      return average(data, start, end);
    }

    function rounded(context, x, y, width, height, radius) {
      if (typeof context.roundRect === "function") {
        context.beginPath();
        context.roundRect(x, y, width, height, radius);
        context.fill();
      } else {
        context.fillRect(x, y, width, height);
      }
    }

    function alpha(context, amount, callback) {
      context.save?.();
      context.globalAlpha = amount;
      callback();
      context.restore?.();
    }

    function gradient(context, x0, y0, x1, y1, palette) {
      const fill = context.createLinearGradient(x0, y0, x1, y1);
      fill.addColorStop(0, palette.strong);
      fill.addColorStop(1, palette.accent);
      return fill;
    }

    function drawBars(data, count, now) {
      const state = prepare();
      if (!state) return;
      const { context, dpr, width, height } = state;
      const palette = colors();
      const gap = Math.max(2 * dpr, width / (count * 5));
      const barWidth = (width - gap * (count - 1)) / count;
      for (let index = 0; index < count; index += 1) {
        const value = band(data, index, count);
        const barHeight = Math.max(3 * dpr, value * height * 0.92);
        const x = index * (barWidth + gap);
        const y = height - barHeight;
        context.fillStyle = gradient(context, 0, y, 0, height, palette);
        rounded(context, x, y, barWidth, barHeight, Math.min(barWidth / 2, 4 * dpr));
      }
    }

    function drawWave(data, count, now) {
      const state = prepare();
      if (!state) return;
      const { context, dpr, width, height } = state;
      const palette = colors();
      context.lineWidth = 3 * dpr;
      context.lineCap = "round";
      const line = context.createLinearGradient(0, 0, width, 0);
      line.addColorStop(0, palette.accent);
      line.addColorStop(0.5, palette.strong);
      line.addColorStop(1, palette.accent);
      context.strokeStyle = line;
      context.beginPath();
      for (let index = 0; index < count; index += 1) {
        const value = band(data, index, count);
        const x = index / (count - 1) * width;
        const y = height * 0.55 - Math.sin(index * 0.55 + now / 260) * value * height * 0.32 - value * height * 0.22;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }

    function drawDots(data, count) {
      const state = prepare();
      if (!state) return;
      const { context, dpr, width, height } = state;
      const palette = colors();
      const rows = 4;
      const gap = width / (count + 1);
      for (let index = 0; index < count; index += 1) {
        const value = band(data, index, count);
        const lit = Math.max(1, Math.round(value * rows));
        for (let row = 0; row < rows; row += 1) {
          const active = row < lit;
          alpha(context, active ? 0.42 + value * 0.54 : 0.09, () => {
            context.fillStyle = active ? palette.strong : palette.accent;
            context.beginPath();
            context.arc((index + 1) * gap, height - (row + 1) * height / (rows + 1), Math.max(2.5 * dpr, 4 * dpr * value), 0, Math.PI * 2);
            context.fill();
          });
        }
      }
    }

    function drawMirror(data, count) {
      const state = prepare();
      if (!state) return;
      const { context, dpr, width, height } = state;
      const palette = colors();
      const middle = height * 0.5;
      const gap = Math.max(2 * dpr, width / (count * 5));
      const barWidth = (width - gap * (count - 1)) / count;
      for (let index = 0; index < count; index += 1) {
        const value = band(data, index, count);
        const barHeight = Math.max(2 * dpr, value * height * 0.45);
        const fill = context.createLinearGradient(0, middle - barHeight, 0, middle + barHeight);
        fill.addColorStop(0, palette.strong);
        fill.addColorStop(0.5, palette.accent);
        fill.addColorStop(1, palette.strong);
        context.fillStyle = fill;
        rounded(context, index * (barWidth + gap), middle - barHeight, barWidth, barHeight * 2, Math.min(barWidth / 2, 4 * dpr));
      }
    }

    function drawRing(data, count, now) {
      const state = prepare();
      if (!state) return;
      const { context, dpr, width, height } = state;
      const palette = colors();
      const centerX = width / 2;
      const centerY = height / 2;
      const base = Math.min(width, height) * 0.18;
      const averageLevel = average(data, 0, Math.max(1, Math.floor(data.length * 0.72)));
      for (let index = 0; index < count; index += 1) {
        const value = band(data, index, count);
        const angle = index / count * Math.PI * 2 + now / 2400;
        const inner = base + averageLevel * height * 0.12;
        const outer = inner + value * height * 0.26;
        context.strokeStyle = palette.strong;
        context.lineWidth = Math.max(2 * dpr, 3 * dpr * value);
        alpha(context, 0.22 + value * 0.72, () => {
          context.beginPath();
          context.moveTo(centerX + Math.cos(angle) * inner, centerY + Math.sin(angle) * inner);
          context.lineTo(centerX + Math.cos(angle) * outer, centerY + Math.sin(angle) * outer);
          context.stroke();
        });
      }
      alpha(context, 0.28, () => {
        context.strokeStyle = palette.accent;
        context.lineWidth = dpr;
        context.beginPath();
        context.arc(centerX, centerY, base + averageLevel * height * 0.12, 0, Math.PI * 2);
        context.stroke();
      });
    }

    function drawMountain(data, count, now) {
      const state = prepare();
      if (!state) return;
      const { context, width, height } = state;
      const palette = colors();
      const ground = height * 0.9;
      const fill = context.createLinearGradient(0, height * 0.12, 0, ground);
      fill.addColorStop(0, palette.strong);
      fill.addColorStop(1, palette.accent);
      context.fillStyle = fill;
      context.beginPath();
      context.moveTo(0, ground);
      for (let index = 0; index < count; index += 1) {
        const value = band(data, index, count);
        context.lineTo(index / (count - 1) * width, ground - value * height * 0.78 - Math.sin(index * 0.5 + now / 500) * height * 0.035);
      }
      context.lineTo(width, ground);
      context.closePath();
      alpha(context, 0.62, () => context.fill());
    }

    function drawOrbit(data, count, now) {
      const state = prepare();
      if (!state) return;
      const { context, dpr, width, height } = state;
      const palette = colors();
      const centerX = width / 2;
      const centerY = height / 2;
      const bass = average(data, 0, Math.min(10, data.length));
      const base = Math.min(width, height) * (0.18 + bass * 0.18);
      for (let index = 0; index < count; index += 1) {
        const value = band(data, index, count);
        const angle = index / count * Math.PI * 2 + now / 900 * (index % 2 ? 1 : -0.7);
        const radius = base + value * height * 0.23;
        alpha(context, 0.18 + value * 0.65, () => {
          context.fillStyle = palette.strong;
          context.beginPath();
          context.arc(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius, Math.max(2 * dpr, 5 * dpr * value), 0, Math.PI * 2);
          context.fill();
        });
      }
    }

    function drawRain(data, count, now) {
      const state = prepare();
      if (!state) return;
      const { context, dpr, width, height } = state;
      const palette = colors();
      const time = now / 38;
      for (let index = 0; index < count; index += 1) {
        const value = band(data, index, count);
        const x = (index + 0.5) * width / count;
        const drops = Math.max(1, Math.round(value * 4));
        for (let drop = 0; drop < drops; drop += 1) {
          const y = (time * (0.45 + value) + index * 17 + drop * 29) % height;
          context.fillStyle = palette.strong;
          alpha(context, 0.12 + value * 0.55, () => rounded(context, x - 1.5 * dpr, y, 3 * dpr, Math.max(6 * dpr, 18 * dpr * value), 2 * dpr));
        }
      }
    }

    const renderers = Object.freeze({
      bars: [drawBars, 32],
      wave: [drawWave, 44],
      dots: [drawDots, 32],
      mirror: [drawMirror, 32],
      ring: [drawRing, 48],
      mountain: [drawMountain, 48],
      orbit: [drawOrbit, 28],
      rain: [drawRain, 40],
    });

    function render({ frequencyData, now = 0 } = {}) {
      const data = frequencyData?.length ? frequencyData : syntheticFrequencyData(now);
      const [renderer, count] = renderers[mode] || renderers[DEFAULT_MODE];
      renderer(data, count, now);
      return mode;
    }

    syncCanvasLabel();
    return Object.freeze({
      cycle,
      getMode: () => mode,
      render,
      setMode,
      syncCanvasLabel,
    });
  }

  return Object.freeze({
    DEFAULT_MODE,
    MODES,
    MODE_LABELS,
    MODE_STORAGE_KEY,
    create,
    nextMode,
    normalizeMode,
    readMode,
    syntheticFrequencyData,
    writeMode,
  });
});
