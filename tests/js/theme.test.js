const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const themePath = path.join(root, "frontend", "static", "theme.js");
const basePath = path.join(root, "frontend", "templates", "base.html");
const appearancePath = path.join(root, "frontend", "templates", "darkmode.html");
const modernPath = path.join(root, "frontend", "static", "modern.css");
const read = file => fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
const themeSource = read(themePath);
const baseSource = read(basePath);
const appearanceSource = read(appearancePath);
const modernSource = read(modernPath);

function createStyle() {
  const values = new Map();
  const removed = [];
  return {
    values,
    removed,
    setProperty(name, value) {
      values.set(name, String(value));
    },
    removeProperty(name) {
      const previous = values.get(name) || "";
      values.delete(name);
      removed.push(name);
      return previous;
    },
    getPropertyValue(name) {
      return values.get(name) || "";
    },
  };
}

function createClassList() {
  const values = new Set();
  return {
    toggle(name, force) {
      const enabled = force === undefined ? !values.has(name) : Boolean(force);
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    },
    contains(name) {
      return values.has(name);
    },
  };
}

function createElement(tagName) {
  const attributes = new Map();
  return {
    tagName: String(tagName).toUpperCase(),
    type: "",
    className: "",
    dataset: {},
    style: createStyle(),
    classList: createClassList(),
    innerHTML: "",
    onclick: null,
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
  };
}

function loadTheme({ savedTheme = null, withPicker = true } = {}) {
  const storage = new Map();
  if (savedTheme !== null) storage.set("cc_theme", savedTheme);

  const rootAttributes = new Map();
  const rootStyle = createStyle();
  const documentElement = {
    style: rootStyle,
    setAttribute(name, value) {
      rootAttributes.set(name, String(value));
    },
    getAttribute(name) {
      return rootAttributes.has(name) ? rootAttributes.get(name) : null;
    },
  };

  const picker = {
    dataset: {},
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
  const currentLabel = { textContent: "" };

  const document = {
    readyState: "complete",
    documentElement,
    createElement,
    addEventListener() {},
    getElementById(id) {
      if (id === "theme-swatches") return withPicker ? picker : null;
      if (id === "theme-current") return currentLabel;
      return null;
    },
    querySelectorAll(selector) {
      return selector === ".theme-swatch" && withPicker ? picker.children : [];
    },
  };

  const localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
  };

  const context = { document, localStorage };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(themeSource, context, { filename: themePath });

  return {
    api: context.CCTheme,
    currentLabel,
    documentElement,
    picker,
    rootStyle,
    storage,
  };
}

function swatchFor(harness, themeId) {
  return harness.picker.children.find(button => button.dataset.theme === themeId);
}

test("Synthwave is the first-run default while valid saved themes remain authoritative", () => {
  const firstRun = loadTheme();
  assert.equal(firstRun.documentElement.getAttribute("data-theme"), "synthwave");
  assert.equal(firstRun.storage.get("cc_theme"), "synthwave");
  assert.equal(firstRun.currentLabel.textContent, "Synthwave");
  assert.equal(swatchFor(firstRun, "synthwave").classList.contains("active"), true);

  const restored = loadTheme({ savedTheme: "midnight" });
  assert.equal(restored.documentElement.getAttribute("data-theme"), "midnight");
  assert.equal(restored.storage.get("cc_theme"), "midnight");
  assert.equal(restored.currentLabel.textContent, "Ink");
  assert.equal(swatchFor(restored, "midnight").classList.contains("active"), true);

  const invalid = loadTheme({ savedTheme: "unknown-theme" });
  assert.equal(invalid.documentElement.getAttribute("data-theme"), "synthwave");
  assert.equal(invalid.storage.get("cc_theme"), "synthwave");
});

test("the early boot and standalone Appearance page use the same first-run default", () => {
  assert.match(baseSource, /var selectedTheme = 'synthwave';/);
  assert.match(baseSource, /if \(knownThemes\.indexOf\(savedTheme\) !== -1\) selectedTheme = savedTheme;/);
  assert.match(baseSource, /document\.documentElement\.setAttribute\('data-theme', selectedTheme\);/);
  assert.match(appearanceSource, /id="appearance-current"[^>]*>Synthwave selected</);
  assert.match(appearanceSource, /if \(!labels\[cur\]\) cur = 'synthwave';/);
});

test("Synthwave backdrop is continuous, animated, responsive, and remains behind full-screen Music", () => {
  assert.match(
    modernSource,
    /html\[data-theme="synthwave"\] body \{(?=[^}]*repeating-linear-gradient\(0deg, rgba\(255, 255, 255, 0\.014\))(?=[^}]*radial-gradient\(circle at 8% 12%)(?=[^}]*radial-gradient\(circle at 91% 17%)[^}]*\}/,
  );
  assert.match(
    modernSource,
    /html\[data-theme="synthwave"\] body::before \{(?=[^}]*position: fixed;)(?=[^}]*repeating-linear-gradient)(?=[^}]*perspective\(38rem\))(?=[^}]*animation: cc-synth-grid-drift 10s linear infinite;)[^}]*\}/,
  );
  assert.match(
    modernSource,
    /html\[data-theme="synthwave"\] body::after \{(?=[^}]*position: fixed;)(?=[^}]*width: clamp\(340px, 40vw, 640px\);)(?=[^}]*repeating-linear-gradient)[^}]*\}[\s\S]*?body::after \{\s*animation: cc-synth-sun-breathe 6s ease-in-out infinite;/,
  );
  assert.match(
    modernSource,
    /body:has\(#tab-home:not\(\[hidden\]\)\)::after \{(?=[^}]*width: clamp\(560px, 64vw, 980px\);)(?=[^}]*opacity: 0\.9;)[^}]*\}/,
  );
  assert.match(modernSource, /html\[data-theme="synthwave"\] body #tab-music \{\s*background: rgba\(3, 0, 12, 0\.24\);/);
  assert.match(modernSource, /html\[data-theme="synthwave"\] body \.cc-music \{\s*background: transparent;/);
  assert.match(modernSource, /html\[data-theme="synthwave"\] body \.cc-music-content \{\s*background: rgba\(2, 0, 9, 0\.16\);/);
  assert.match(
    modernSource,
    /html\[data-theme="synthwave"\] :is\([\s\S]*?\.app-main > \.panel:not\(\.home-panel\)[\s\S]*?\) \{(?=[^}]*inset 0 1px 0 rgba\(67, 231, 255, 0\.12\))(?=[^}]*inset 0 -1px 0 rgba\(255, 79, 183, 0\.08\))(?=[^}]*backdrop-filter: blur\(9px\) saturate\(118%\);)[^}]*\}/,
  );
  assert.match(
    modernSource,
    /html\[data-theme="synthwave"\] :is\(\.workspace-heading h1, \.panel-h, \.appearance-header h1, \.cc-hero h1\) \{(?=[^}]*letter-spacing: 0\.025em;)(?=[^}]*text-shadow:[^}]*rgba\(255, 79, 183, 0\.16\))[^}]*\}/,
  );
  assert.doesNotMatch(modernSource, /body\.cc-music-now-playing-open::before,[\s\S]*?body\.cc-music-now-playing-open::after \{\s*opacity: 0;/);
  assert.match(
    modernSource,
    /@media \(max-width: 900px\) \{[\s\S]*?body::before \{[\s\S]*?background-size: 48px 42px, 48px 42px;[\s\S]*?body:has\(#tab-home:not\(\[hidden\]\)\)::after \{[\s\S]*?width: clamp\(440px, 118vw, 720px\);/,
  );

  const tabPanelRule = modernSource.match(/\.tab-panel \{([^}]*)\}/)?.[1] || "";
  assert.doesNotMatch(tabPanelRule, /animation|transition/);
});

test("Synthwave is registered and apply updates palette state", () => {
  const harness = loadTheme();

  assert.ok(harness.api.list().includes("synthwave"));
  harness.api.apply("synthwave");

  assert.equal(harness.documentElement.getAttribute("data-theme"), "synthwave");
  assert.equal(harness.storage.get("cc_theme"), "synthwave");
  assert.equal(harness.currentLabel.textContent, "Synthwave");
  assert.equal(harness.rootStyle.getPropertyValue("--bg"), "#080315");
  assert.equal(harness.rootStyle.getPropertyValue("--accent"), "#ff4fb7");
  assert.equal(harness.rootStyle.getPropertyValue("--accent-2"), "#43e7ff");
  assert.equal(harness.rootStyle.getPropertyValue("--surface-active"), "#38205f");
  assert.equal(harness.rootStyle.getPropertyValue("--text"), "#fff7ff");

  const active = swatchFor(harness, "synthwave");
  assert.ok(active, "Synthwave should have a generated swatch");
  assert.equal(active.classList.contains("active"), true);
  assert.equal(active.getAttribute("aria-pressed"), "true");
  for (const swatch of harness.picker.children.filter(item => item !== active)) {
    assert.equal(swatch.classList.contains("active"), false);
    assert.equal(swatch.getAttribute("aria-pressed"), "false");
  }
});

test("the final restrained and animated theme set registers complete persistent palettes", () => {
  const expected = {
    starlight: { label: "Starlight", accent: "#8dbbff", accent2: "#edf5ff", bg: "#030712" },
    matrix: { label: "Matrix", accent: "#39ff78", accent2: "#b4ffca", bg: "#020704" },
    iceage: { label: "Ice Age", accent: "#72e6ff", accent2: "#e9fcff", bg: "#020a12" },
    aurora: { label: "Aurora", accent: "#65f5bf", accent2: "#8eb8ff", bg: "#041014" },
  };
  const harness = loadTheme();

  assert.deepEqual(
    Array.from(harness.api.list()),
    ["outrun", "ice", "midnight", "synthwave", "starlight", "matrix", "iceage", "aurora"],
  );

  for (const [id, palette] of Object.entries(expected)) {
    assert.ok(harness.api.list().includes(id));
    harness.api.apply(id);
    assert.equal(harness.documentElement.getAttribute("data-theme"), id);
    assert.equal(harness.storage.get("cc_theme"), id);
    assert.equal(harness.currentLabel.textContent, palette.label);
    assert.equal(harness.rootStyle.getPropertyValue("--bg"), palette.bg);
    assert.equal(harness.rootStyle.getPropertyValue("--accent"), palette.accent);
    assert.equal(harness.rootStyle.getPropertyValue("--accent-2"), palette.accent2);
    assert.match(harness.rootStyle.getPropertyValue("--theme-player"), /^rgba\(/);
    assert.equal(swatchFor(harness, id).classList.contains("active"), true);
  }

  assert.match(baseSource, /'outrun', 'ice', 'midnight', 'synthwave', 'starlight', 'matrix', 'iceage', 'aurora'/);
  for (const removed of ["vaporwave", "cyberpunk", "bloodmoon", "neon", "verse"]) {
    assert.equal(harness.api.list().includes(removed), false);
  }
});

test("immersive themes have distinct animated scenes and readable glass surfaces", () => {
  assert.match(modernSource, /html\[data-theme="starlight"\] body::before \{(?=[^}]*radial-gradient\(circle)(?=[^}]*background-size: 113px 127px, 181px 163px, 239px 211px, 307px 281px;)(?=[^}]*cc-starlight-drift 16s linear infinite alternate)(?=[^}]*cc-starlight-twinkle 3\.6s ease-in-out infinite)[^}]*\}/);
  assert.match(modernSource, /html\[data-theme="starlight"\] body::after \{(?=[^}]*linear-gradient\(90deg, transparent)(?=[^}]*animation: cc-starlight-meteor 6\.8s cubic-bezier)[^}]*\}/);
  assert.match(modernSource, /html\[data-theme="starlight"\] \.cc-hero::after \{(?=[^}]*radial-gradient\(circle at 9% 68%)(?=[^}]*radial-gradient\(circle at 91% 48%)[^}]*\}/);
  assert.match(modernSource, /html\[data-theme="matrix"\] body::before \{(?=[^}]*repeating-linear-gradient)(?=[^}]*background-size: 92px 100%, 137px 100%, 173px 100%;)(?=[^}]*animation: cc-matrix-rain 14s linear infinite;)[^}]*\}/);
  assert.match(modernSource, /html\[data-theme="matrix"\] body::after \{(?=[^}]*repeating-linear-gradient\(0deg)(?=[^}]*radial-gradient\(ellipse at center)[^}]*\}/);
  assert.match(modernSource, /html\[data-theme="matrix"\] :is\(\.workspace-heading h1, \.panel-h, \.appearance-header h1, \.cc-hero h1, \.cc-nav-label\) \{(?=[^}]*Cascadia Mono)(?=[^}]*letter-spacing: 0\.055em;)[^}]*\}/);
  assert.match(modernSource, /html\[data-theme="matrix"\] :is\(\.btn-primary, button\[type="submit"\], input\[type="submit"\]\) \{(?=[^}]*background: linear-gradient\(180deg, #6dff99, #30df68\);)(?=[^}]*color: #011c08;)[^}]*\}/);
  assert.match(modernSource, /html\[data-theme="matrix"\] :is\(input, textarea, select\) \{(?=[^}]*border-color: rgba\(57, 255, 120, 0\.2\);)(?=[^}]*background: rgba\(1, 11, 4, 0\.86\);)[^}]*\}/);
  assert.match(modernSource, /html\[data-theme="iceage"\] body::before \{(?=[^}]*radial-gradient\(circle)(?=[^}]*background-size: 126px 154px, 211px 247px, 173px 201px;)(?=[^}]*cc-iceage-snow 13s linear infinite)[^}]*\}/);
  assert.match(modernSource, /html\[data-theme="iceage"\] body::after \{(?=[^}]*clip-path: polygon)(?=[^}]*cc-iceage-glint 7s ease-in-out infinite alternate)[^}]*\}/);
  assert.match(modernSource, /@keyframes\s+cc-iceage-snow\b/);
  assert.match(modernSource, /@keyframes\s+cc-iceage-glint\b/);
  assert.match(modernSource, /html\[data-theme="aurora"\] body::before \{(?=[^}]*conic-gradient)(?=[^}]*filter: blur\(58px\);)[^}]*\}/);
  assert.match(modernSource, /html\[data-theme="aurora"\] body::after \{(?=[^}]*radial-gradient\(circle at 18% 24%)(?=[^}]*opacity: 0\.28;)[^}]*\}/);
  assert.match(modernSource, /html:is\(\[data-theme="starlight"\], \[data-theme="matrix"\], \[data-theme="iceage"\], \[data-theme="aurora"\]\) :is\([\s\S]*?\.app-titlebar,[\s\S]*?background: var\(--theme-shell\);/);
});

test("a saved Synthwave preference is restored while building picker controls", () => {
  const harness = loadTheme({ savedTheme: "synthwave" });
  const ids = Array.from(harness.api.list());
  const synthwave = swatchFor(harness, "synthwave");

  assert.equal(harness.picker.dataset.built, "1");
  assert.equal(harness.picker.children.length, ids.length);
  assert.deepEqual(harness.picker.children.map(button => button.dataset.theme), ids);
  assert.ok(synthwave, "restored theme should be represented in the picker");
  assert.equal(synthwave.type, "button");
  assert.equal(synthwave.getAttribute("data-tip"), "Synthwave palette");
  assert.match(synthwave.innerHTML, />Synthwave</);
  assert.equal(synthwave.classList.contains("active"), true);
  assert.equal(synthwave.getAttribute("aria-pressed"), "true");
  assert.equal(harness.documentElement.getAttribute("data-theme"), "synthwave");
  assert.equal(harness.storage.get("cc_theme"), "synthwave");
  assert.equal(harness.currentLabel.textContent, "Synthwave");
});

test("switching from Synthwave to Graphite clears Synthwave-only variables", () => {
  const harness = loadTheme();
  harness.api.apply("synthwave");
  assert.equal(harness.rootStyle.getPropertyValue("--surface-active"), "#38205f");
  assert.equal(harness.rootStyle.getPropertyValue("--text-soft"), "#eadff3");

  harness.api.apply("outrun");

  assert.equal(harness.documentElement.getAttribute("data-theme"), "outrun");
  assert.equal(harness.storage.get("cc_theme"), "outrun");
  assert.equal(harness.currentLabel.textContent, "Graphite");
  assert.equal(harness.rootStyle.getPropertyValue("--surface-active"), "");
  assert.equal(harness.rootStyle.getPropertyValue("--text-soft"), "");
  assert.equal(harness.rootStyle.getPropertyValue("--accent"), "");
  assert.ok(harness.rootStyle.removed.includes("--surface-active"));
  assert.ok(harness.rootStyle.removed.includes("--text-soft"));
});

test("the standalone Appearance cards match the runtime theme registry", () => {
  const harness = loadTheme({ withPicker: false });
  const registryIds = Array.from(harness.api.list());
  const cardIds = Array.from(
    appearanceSource.matchAll(/data-theme="([^"]+)"/g),
    match => match[1],
  );

  assert.deepEqual(cardIds, registryIds);
  assert.ok(cardIds.includes("synthwave"));
  assert.deepEqual(cardIds.slice(-3), ["matrix", "iceage", "aurora"]);
});
