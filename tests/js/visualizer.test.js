const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const Visualizer = require(path.join(root, "frontend/static/visualizer.js"));

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    value(key) { return values.get(key); },
  };
}

function gradient() {
  return { addColorStop() {} };
}

function createHarness({ storedMode, audioActive = true, analyserAvailable = true, reducedMotion = false } = {}) {
  const operations = [];
  const context = {
    arc() { operations.push("arc"); },
    beginPath() { operations.push("beginPath"); },
    clearRect() { operations.push("clearRect"); },
    createLinearGradient() { operations.push("linearGradient"); return gradient(); },
    createRadialGradient() { operations.push("radialGradient"); return gradient(); },
    ellipse() { operations.push("ellipse"); },
    fill() { operations.push("fill"); },
    fillRect() { operations.push("fillRect"); },
    lineTo() {},
    moveTo() { operations.push("moveTo"); },
    restore() {},
    save() {},
    setTransform() {},
    stroke() { operations.push("stroke"); },
  };
  const attributes = new Map();
  const canvas = {
    width: 0,
    height: 0,
    clientWidth: 720,
    clientHeight: 340,
    getBoundingClientRect: () => ({ width: 720, height: 340 }),
    getContext: () => context,
    setAttribute(name, value) { attributes.set(name, value); },
  };
  const footWrites = [];
  let footText = "";
  const foot = {};
  Object.defineProperty(foot, "textContent", {
    get() { return footText; },
    set(value) { footText = String(value); footWrites.push(footText); },
  });

  function button(mode) {
    const listeners = new Map();
    const attrs = new Map();
    const classes = new Set(mode === "bars" ? ["active"] : []);
    return {
      dataset: { vizMode: mode },
      classList: {
        contains(value) { return classes.has(value); },
        toggle(value, force) {
          if (force) classes.add(value);
          else classes.delete(value);
        },
      },
      addEventListener(name, callback) { listeners.set(name, callback); },
      click() { listeners.get("click")?.(); },
      getAttribute(name) { return attrs.get(name) || null; },
      setAttribute(name, value) { attrs.set(name, String(value)); },
    };
  }

  const buttons = [button("bars"), button("particle-accelerator")];
  const document = {
    getElementById(id) {
      return { "viz-canvas": canvas, "viz-foot": foot }[id] || null;
    },
    querySelectorAll(selector) { return selector === "[data-viz-mode]" ? buttons : []; },
  };
  const storage = memoryStorage(storedMode ? { [Visualizer.MODE_STORAGE_KEY]: storedMode } : {});
  const frameCallbacks = new Map();
  const added = [];
  const removed = [];
  const resizeObservers = [];
  let nextFrame = 1;
  let cancelled = [];
  const analyserReads = { frequency: 0, waveform: 0 };
  const analyser = {
    fftSize: 128,
    frequencyBinCount: 64,
    getByteFrequencyData(data) { analyserReads.frequency++; data.fill(196); },
    getByteTimeDomainData(data) { analyserReads.waveform++; data.fill(128); },
  };
  const host = {
    CCAudio: {
      getAnalyser: () => analyserAvailable ? analyser : null,
      isOn: () => audioActive,
    },
    CCMusic: { getAnalyser: () => null, isPlaying: () => false },
    addEventListener(type, callback) { added.push([type, callback]); },
    cancelAnimationFrame(id) { cancelled.push(id); frameCallbacks.delete(id); },
    devicePixelRatio: 2,
    document,
    localStorage: storage,
    matchMedia: () => ({ matches: reducedMotion }),
    removeEventListener(type, callback) { removed.push([type, callback]); },
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.disconnected = false;
        this.observed = [];
        resizeObservers.push(this);
      }
      disconnect() { this.disconnected = true; }
      observe(element) { this.disconnected = false; this.observed.push(element); }
    },
    requestAnimationFrame(callback) {
      const id = nextFrame++;
      frameCallbacks.set(id, callback);
      return id;
    },
  };

  function step(now = 16.67) {
    const entry = frameCallbacks.entries().next().value;
    assert.ok(entry, "expected a queued animation frame");
    frameCallbacks.delete(entry[0]);
    entry[1](now);
  }

  return {
    added,
    analyserReads,
    attributes,
    buttons,
    cancelled: () => cancelled,
    canvas,
    foot,
    footWrites,
    frameCallbacks,
    host,
    operations,
    removed,
    resizeObservers,
    step,
    storage,
  };
}

test("mode preference defaults safely, validates values, and tolerates denied storage", () => {
  const storage = memoryStorage();
  assert.equal(Visualizer.readMode(storage), Visualizer.DEFAULT_MODE);
  assert.equal(Visualizer.normalizeMode("unknown"), Visualizer.DEFAULT_MODE);
  assert.equal(Visualizer.writeMode(storage, Visualizer.PARTICLE_MODE), Visualizer.PARTICLE_MODE);
  assert.equal(storage.value(Visualizer.MODE_STORAGE_KEY), Visualizer.PARTICLE_MODE);

  const denied = {
    getItem() { throw new Error("denied"); },
    setItem() { throw new Error("denied"); },
  };
  assert.equal(Visualizer.readMode(denied), Visualizer.DEFAULT_MODE);
  assert.doesNotThrow(() => Visualizer.writeMode(denied, Visualizer.PARTICLE_MODE));
});

test("particle acceleration reacts to energy while remaining bounded and frame-rate safe", () => {
  const silence = Visualizer.audioLevels(new Uint8Array(64));
  const loud = Visualizer.audioLevels(new Uint8Array(64).fill(255));
  assert.equal(silence.energy, 0);
  assert.ok(loud.energy > 0.99);

  const idleTarget = Visualizer.particleSpeedTarget(silence, 0, false);
  const loudTarget = Visualizer.particleSpeedTarget(loud, 1, false);
  assert.ok(loudTarget > idleTarget);
  assert.ok(loudTarget <= 2.15);
  assert.ok(Visualizer.particleSpeedTarget(loud, 1, true) <= 0.42);
  assert.equal(Visualizer.clampFrameDelta(10_000), 50);

  const accelerated = Visualizer.approachSpeed(idleTarget, loudTarget, 10_000);
  assert.ok(Number.isFinite(accelerated));
  assert.ok(accelerated > idleTarget && accelerated <= loudTarget);

  const beforeWrap = Math.PI * 2 - 0.01;
  const afterWrap = Visualizer.advanceParticlePhase(beforeWrap, 1, 50);
  assert.ok(afterWrap > Math.PI * 2);
  assert.ok(afterWrap - beforeWrap < 0.051);

  const oneFrame = Visualizer.followerCoefficient(1000 / 60, 95);
  const twoHalfFrames = 1 - Math.pow(1 - Visualizer.followerCoefficient(1000 / 120, 95), 2);
  assert.ok(Math.abs(oneFrame - twoHalfFrames) < 1e-12);
});

test("particle seeds are deterministic, finite, and capped to normalized ranges", () => {
  const first = Visualizer.createParticleField(72);
  const second = Visualizer.createParticleField(72);
  assert.deepEqual(first, second);
  assert.equal(first.length, 72);
  for (const particle of first) {
    assert.ok(Number.isInteger(particle.arm) && particle.arm >= 0 && particle.arm < 6);
    assert.ok(particle.frequency >= 0 && particle.frequency < 1);
    assert.ok(particle.radius >= 0 && particle.radius < 1);
    for (const value of Object.values(particle)) assert.ok(Number.isFinite(value));
  }
});

test("runtime keeps one animation loop, persists mode, and cleans up its resize listener", () => {
  const harness = createHarness();
  const visualizer = Visualizer.create(harness.host);
  assert.equal(visualizer.getMode(), "bars");

  visualizer.onShow();
  visualizer.onShow();
  assert.equal(harness.frameCallbacks.size, 1);
  assert.equal(harness.added.filter(([type]) => type === "resize").length, 1);
  assert.equal(harness.resizeObservers.length, 1);
  assert.deepEqual(harness.resizeObservers[0].observed, [harness.canvas]);
  assert.equal(harness.canvas.width, 720, "default bars keep a 1x backing canvas");

  harness.operations.length = 0;
  harness.step();
  assert.ok(harness.operations.includes("linearGradient"));
  assert.ok(!harness.operations.includes("ellipse"));
  assert.equal(harness.analyserReads.waveform, 1);

  harness.buttons[1].click();
  assert.equal(visualizer.getMode(), Visualizer.PARTICLE_MODE);
  assert.equal(harness.storage.value(Visualizer.MODE_STORAGE_KEY), Visualizer.PARTICLE_MODE);
  assert.equal(harness.buttons[1].getAttribute("aria-pressed"), "true");
  assert.match(harness.attributes.get("aria-label"), /Particle accelerator/);
  assert.equal(harness.canvas.width, 1152, "particle mode uses a capped high-DPI canvas");

  harness.operations.length = 0;
  harness.step(33.34);
  assert.ok(harness.operations.includes("ellipse"));
  assert.ok(harness.operations.includes("radialGradient"));
  assert.equal(harness.analyserReads.waveform, 1, "particle mode does not read unused waveform data");
  assert.match(harness.foot.textContent, /reacting to active audio/);

  visualizer.onHide();
  assert.equal(harness.frameCallbacks.size, 0);
  assert.equal(harness.removed.filter(([type]) => type === "resize").length, 1);
  assert.equal(harness.resizeObservers[0].disconnected, true);

  const writesBeforeResume = harness.footWrites.length;
  visualizer.onShow();
  assert.equal(harness.frameCallbacks.size, 1);
  assert.equal(harness.added.filter(([type]) => type === "resize").length, 2);
  assert.equal(harness.resizeObservers.length, 1, "resume reuses the same observer");
  assert.equal(harness.resizeObservers[0].observed.length, 2);
  assert.equal(harness.footWrites.length, writesBeforeResume, "resume does not flash a false idle status");
  visualizer.onHide();
});

test("saved particle mode restores before the first frame and reduced motion keeps it selected", () => {
  const harness = createHarness({ storedMode: Visualizer.PARTICLE_MODE, reducedMotion: true, audioActive: false });
  const visualizer = Visualizer.create(harness.host);
  assert.equal(visualizer.getMode(), Visualizer.PARTICLE_MODE);
  visualizer.onShow();
  assert.equal(harness.buttons[1].getAttribute("aria-pressed"), "true");
  harness.operations.length = 0;
  harness.step();
  assert.ok(harness.operations.includes("ellipse"));
  assert.ok(!harness.operations.includes("moveTo"), "reduced motion omits particle trails");
  assert.match(harness.foot.textContent, /start music or titlebar audio/);
  visualizer.onHide();
});

test("active playback without an analyser falls back to safe particle idle rendering", () => {
  const harness = createHarness({ storedMode: Visualizer.PARTICLE_MODE, analyserAvailable: false });
  const visualizer = Visualizer.create(harness.host);
  visualizer.onShow();
  assert.doesNotThrow(() => harness.step());
  assert.ok(harness.operations.includes("ellipse"));
  assert.match(harness.foot.textContent, /start music or titlebar audio/);
  visualizer.onHide();
});

test("visualizer mode controls are accessible controller targets in the page", () => {
  const html = fs.readFileSync(path.join(root, "frontend/templates/index.html"), "utf8");
  assert.match(html, /role="group" aria-labelledby="viz-mode-label"/);
  assert.match(html, /data-viz-mode="bars"[^>]*data-spatial-key="visualizer-mode-bars"[^>]*aria-pressed="true"/);
  assert.match(html, /data-viz-mode="particle-accelerator"[^>]*data-spatial-key="visualizer-mode-particle-accelerator"[^>]*aria-pressed="false"/);
  assert.match(html, /id="viz-foot" aria-live="polite"/);
});
