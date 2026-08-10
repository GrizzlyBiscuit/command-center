const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const ambientSource = fs.readFileSync(
  path.join(root, "frontend/static/music/music-orbit-bloom-ambient-scenes.js"),
  "utf8",
);
const bloomSource = fs.readFileSync(
  path.join(root, "frontend/static/music/music-orbit-bloom.js"),
  "utf8",
);
const appSource = fs.readFileSync(
  path.join(root, "frontend/static/music/music-app.js"),
  "utf8",
).replace(/\r\n?/g, "\n");
const panelSource = fs.readFileSync(
  path.join(root, "frontend/templates/_music_panel.html"),
  "utf8",
).replace(/\r\n?/g, "\n");

function loadOrbitBloom() {
  const window = {
    devicePixelRatio: 1,
    document: { createElement: () => null },
    matchMedia: () => ({ matches: false }),
  };
  const sandbox = {
    Float32Array,
    Image: function Image() {},
    Map,
    Math,
    Uint8Array,
    console,
    performance: { now: () => 1000 },
    window,
  };
  window.Image = sandbox.Image;
  vm.createContext(sandbox);
  vm.runInContext(ambientSource, sandbox, { filename: "music-orbit-bloom-ambient-scenes.js" });
  vm.runInContext(bloomSource, sandbox, { filename: "music-orbit-bloom.js" });
  return sandbox.window.MediaPlayerOrbitBloom;
}

const OrbitBloom = loadOrbitBloom();

test("full-screen selector exposes Random plus every beta scene in exact order", () => {
  const expected = [
    ["cosmic-bloom", "Cosmic Bloom"],
    ["orbital-tunnel", "Orbital Tunnel"],
    ["double-helix", "Double Helix"],
    ["spirograph", "Spirograph"],
    ["milkdrop-flow", "MilkDrop Flow"],
    ["geiss-waves", "Geiss Waves"],
    ["neon-spectrum", "Neon Spectrum"],
    ["oscilloscope", "Oscilloscope"],
    ["comet-field", "Comet Field"],
    ["spectrum-waterfall", "Spectrum Waterfall"],
    ["liquid-aurora", "Liquid Aurora"],
    ["particle-constellation", "Particle Constellation"],
    ["audio-terrain", "Audio Terrain"],
    ["ink-bloom", "Ink Bloom"],
    ["tunnel-flight", "Tunnel Flight"],
    ["kaleidoscope", "Kaleidoscope"],
    ["deep-space-nebula", "Deep Space Nebula"],
    ["luminous-drift", "Luminous Drift"],
    ["album-warp", "Album Warp"],
    ["game-bloom", "Game Bloom"],
  ];
  assert.equal(OrbitBloom.AUTO_SCENE, "auto");
  assert.equal(OrbitBloom.SCENE_DURATION_MS, 25_000);
  assert.deepEqual(
    Array.from(OrbitBloom.SCENE_OPTIONS, scene => [scene.id, scene.label]),
    expected,
  );
  assert.equal(OrbitBloom.SCENES.length, 20);
  assert.match(panelSource, /<option value="auto">Random<\/option>/);
});

test("scene normalization, curated Random pool, and manual state mirror beta behavior", () => {
  assert.equal(OrbitBloom.normalizeSceneSelection("Neon Spectrum"), "neon-spectrum");
  assert.equal(OrbitBloom.normalizeSceneSelection("album-warp"), "album-warp");
  assert.equal(OrbitBloom.normalizeSceneSelection("unknown"), "auto");
  assert.equal(OrbitBloom.sceneIndexForSelection("cosmic-bloom"), 0);
  assert.equal(OrbitBloom.sceneIndexForSelection("auto"), -1);
  assert.equal(OrbitBloom.AUTO_SCENE_IDS.length, 14);
  for (const id of OrbitBloom.AUTO_SCENE_IDS) {
    assert.ok(OrbitBloom.SCENE_OPTIONS.some(scene => scene.id === id), `${id} must be selectable`);
  }

  const renderer = OrbitBloom.create({
    canvas: {},
    initialScene: "double-helix",
    initialSharedGlow: false,
  });
  assert.equal(renderer.sceneSelection(), "double-helix");
  assert.equal(renderer.setScene("rain-does-not-exist"), "auto");
  assert.equal(renderer.setScene("album-warp"), "album-warp");
  assert.equal(renderer.setSharedGlow(true), true);
  assert.equal(renderer.sharedGlowEnabled(), true);
});

test("Command Center populates, persists, and drives the selector at runtime", () => {
  assert.match(appSource, /function setupNowPlayingVisualizer\(\)/);
  assert.match(appSource, /fullscreenVisualizerScenes\(\)\.forEach\(scene =>/);
  assert.match(appSource, /option\.value = scene\.id/);
  assert.match(appSource, /option\.textContent = scene\.label/);
  assert.match(appSource, /writeLocalPreference\(root, FULLSCREEN_VISUALIZER_SCENE_KEY, selection\)/);
  assert.match(appSource, /writeLocalPreference\(root, FULLSCREEN_VISUALIZER_GLOW_KEY, enabled \? "true" : "false"\)/);
  assert.match(appSource, /nodes\.nowPlayingScene\?\.addEventListener\("change"/);
  assert.match(appSource, /nodes\.nowPlayingGlow\?\.addEventListener\("click", toggleFullscreenVisualizerGlow\)/);
  assert.match(appSource, /fullscreenVisualizer\.render\?\.\(\{ \.\.\.samples, now \}\)/);
  assert.match(appSource, /state\.analyser\.fftSize = 128/);
  assert.match(appSource, /state\.analyser\.smoothingTimeConstant = 0\.78/);
});
