const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const index = read("frontend/templates/index.html");
const modern = read("frontend/static/modern.css");
const visualizer = read("frontend/static/visualizer.js");

test("tab switches do not trigger a panel entrance or legacy FX overlay", () => {
  const tabPanel = modern.match(/\.tab-panel\s*\{([\s\S]*?)\}/)?.[1] || "";

  assert.doesNotMatch(tabPanel, /\banimation\s*:/);
  assert.doesNotMatch(modern, /@keyframes\s+cc-view-in\b/);
  assert.doesNotMatch(index, /CCFX\s*\.\s*whoosh|CCFX\s*&&[\s\S]*?whoosh/);
});

test("removing tab motion preserves interaction and visualizer animation", () => {
  assert.match(modern, /\.cc-side-nav \.tab-btn[\s\S]*?transition:\s*color 120ms ease/);
  assert.match(index, /window\.dispatchEvent\(new CustomEvent\('cc:tabchange'/);
  assert.match(index, /window\.CCViz\) window\.CCViz\.onShow\(\)/);
  assert.match(visualizer, /requestAnimationFrame/);
});
