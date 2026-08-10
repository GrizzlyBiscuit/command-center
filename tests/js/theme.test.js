const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
const themePath = path.join(root, "frontend", "static", "theme.js");
const appearancePath = path.join(root, "frontend", "templates", "darkmode.html");
const themeSource = fs.readFileSync(themePath, "utf8");
const appearanceSource = fs.readFileSync(appearancePath, "utf8");

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
});
