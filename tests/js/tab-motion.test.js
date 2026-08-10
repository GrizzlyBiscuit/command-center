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
  for (const id of ["outrun", "vaporwave", "cyberpunk", "bloodmoon", "ice", "midnight", "neon"]) {
    assert.doesNotMatch(modern, new RegExp(`data-theme=["']${id}["'][^}]*tab-panel[^}]*animation`));
  }
});

test("immersive palettes have distinct reduced-motion-safe tab entrances", () => {
  const expected = {
    synthwave: "cc-synth-tab-in 280ms",
    matrix: "cc-matrix-tab-in 230ms",
    verse: "cc-verse-tab-in 260ms",
    aurora: "cc-aurora-tab-in 360ms",
  };

  for (const [id, animation] of Object.entries(expected)) {
    assert.match(
      modern,
      new RegExp(`html\\[data-theme=["']${id}["']\\] \\.tab-panel:not\\(\\[hidden\\]\\) \\{[^}]*animation:\\s*${animation}`),
    );
  }
  assert.match(modern, /@keyframes\s+cc-synth-tab-in\b/);
  assert.match(modern, /@keyframes\s+cc-matrix-tab-in\b/);
  assert.match(modern, /@keyframes\s+cc-verse-tab-in\b/);
  assert.match(modern, /@keyframes\s+cc-aurora-tab-in\b/);
  assert.match(modern, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation:\s*none !important;/);
  assert.match(modern, /body::after \{\s*animation:\s*cc-synth-sun-breathe 8s ease-in-out infinite;/);
});

test("removing tab motion preserves interaction and visualizer animation", () => {
  assert.match(modern, /\.cc-side-nav \.tab-btn[\s\S]*?transition:\s*color 120ms ease/);
  assert.match(index, /window\.dispatchEvent\(new CustomEvent\('cc:tabchange'/);
  assert.match(index, /window\.CCViz\) window\.CCViz\.onShow\(\)/);
  assert.match(visualizer, /requestAnimationFrame/);
});
