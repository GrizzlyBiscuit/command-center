const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const index = read("frontend/templates/index.html");
const modern = read("frontend/static/modern.css");
const visualizer = read("frontend/static/visualizer.js");

test("clean palettes stay instant while legacy full-window FX remains removed", () => {
  const tabPanel = modern.match(/\.tab-panel\s*\{([\s\S]*?)\}/)?.[1] || "";

  assert.doesNotMatch(tabPanel, /\banimation\s*:/);
  assert.doesNotMatch(modern, /@keyframes\s+cc-view-in\b/);
  assert.doesNotMatch(index, /CCFX\s*\.\s*whoosh|CCFX\s*&&[\s\S]*?whoosh/);
  for (const id of ["outrun", "ice", "midnight"]) {
    assert.doesNotMatch(modern, new RegExp(`data-theme=["']${id}["'][^}]*tab-panel[^}]*animation`));
  }
});

test("immersive palettes have distinct reduced-motion-safe tab entrances", () => {
  const expected = {
    synthwave: "cc-synth-tab-in 280ms",
    starlight: "cc-starlight-tab-in 380ms",
    matrix: "cc-matrix-tab-in 230ms",
    iceage: "cc-iceage-tab-in 340ms",
    aurora: "cc-aurora-tab-in 360ms",
  };

  for (const [id, animation] of Object.entries(expected)) {
    assert.match(
      modern,
      new RegExp(`html\\[data-theme=["']${id}["']\\] \\.tab-panel:not\\(\\[hidden\\]\\) \\{[^}]*animation:\\s*${animation}`),
    );
  }
  assert.match(modern, /@keyframes\s+cc-synth-tab-in\b/);
  assert.match(modern, /@keyframes\s+cc-starlight-tab-in\b/);
  assert.match(modern, /@keyframes\s+cc-matrix-tab-in\b/);
  assert.match(modern, /@keyframes\s+cc-iceage-tab-in\b/);
  assert.match(modern, /@keyframes\s+cc-aurora-tab-in\b/);
  assert.match(modern, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation:\s*none !important;/);
  assert.match(modern, /body::before \{[\s\S]*?animation:\s*cc-synth-grid-drift 10s linear infinite;/);
  assert.match(modern, /body::after \{\s*animation:\s*cc-synth-sun-breathe 6s ease-in-out infinite;/);
  assert.match(modern, /@keyframes\s+cc-synth-sun-breathe[\s\S]*?scale\(0\.97\)[\s\S]*?scale\(1\.035\)/);
  assert.match(modern, /@keyframes\s+cc-synth-grid-drift[\s\S]*?center 54px;/);
  assert.match(modern, /@keyframes\s+cc-starlight-drift[\s\S]*?73px -21px, 104px 78px, 28px 54px, 182px 29px;/);
  assert.match(modern, /@keyframes\s+cc-starlight-twinkle[\s\S]*?brightness\(1\.42\)/);
  assert.match(modern, /@keyframes\s+cc-starlight-meteor[\s\S]*?translate3d\(68vw, 38vh, 0\)/);
  assert.match(modern, /@keyframes\s+cc-matrix-rain[\s\S]*?18px 175px, 62px 195px, 101px 186px;/);
  assert.match(modern, /html\[data-theme="matrix"\] body::before \{[^}]*animation:\s*cc-matrix-rain 14s linear infinite;/);
  assert.match(modern, /html\[data-theme="iceage"\] body::before \{[^}]*animation:\s*cc-iceage-snow 13s linear infinite;/);
  assert.match(modern, /html\[data-theme="iceage"\] body::after \{[^}]*animation:\s*cc-iceage-glint 7s ease-in-out infinite alternate;/);
  assert.match(modern, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?html\[data-theme="matrix"\] body::before,[\s\S]*?html\[data-theme="matrix"\] \.cc-music-now-playing::before,[\s\S]*?animation:\s*none !important;/);
  assert.match(modern, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?html\[data-theme="iceage"\] body::before,[\s\S]*?html\[data-theme="iceage"\] body::after,[\s\S]*?animation:\s*none !important;/);
});

test("removing tab motion preserves interaction and visualizer animation", () => {
  assert.match(modern, /\.cc-side-nav \.tab-btn[\s\S]*?transition:\s*color 120ms ease/);
  assert.match(index, /window\.dispatchEvent\(new CustomEvent\('cc:tabchange'/);
  assert.match(index, /window\.CCViz\) window\.CCViz\.onShow\(\)/);
  assert.match(visualizer, /requestAnimationFrame/);
});
