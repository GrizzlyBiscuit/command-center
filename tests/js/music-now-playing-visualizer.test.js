const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const Visualizer = require(path.join(root, "frontend/static/music/music-now-playing-visualizer.js"));

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    value(key) { return values.get(key); },
  };
}

function harness(storedMode = "") {
  const operations = [];
  const attributes = new Map();
  const gradient = () => ({ addColorStop() { operations.push("colorStop"); } });
  const context = {
    arc() { operations.push("arc"); },
    beginPath() { operations.push("beginPath"); },
    clearRect() { operations.push("clearRect"); },
    closePath() { operations.push("closePath"); },
    createLinearGradient() { operations.push("linearGradient"); return gradient(); },
    fill() { operations.push("fill"); },
    fillRect() { operations.push("fillRect"); },
    lineTo() { operations.push("lineTo"); },
    moveTo() { operations.push("moveTo"); },
    restore() { operations.push("restore"); },
    roundRect() { operations.push("roundRect"); },
    save() { operations.push("save"); },
    stroke() { operations.push("stroke"); },
  };
  const canvas = {
    clientHeight: 96,
    clientWidth: 560,
    dataset: {},
    height: 96,
    title: "",
    width: 560,
    getBoundingClientRect: () => ({ width: 560, height: 96 }),
    getContext: () => context,
    setAttribute(name, value) { attributes.set(name, String(value)); },
  };
  const storage = memoryStorage(storedMode ? { [Visualizer.MODE_STORAGE_KEY]: storedMode } : {});
  const host = {
    devicePixelRatio: 2,
    getComputedStyle() {
      return { getPropertyValue(name) {
        return { "--accent": "#7c3aed", "--accent-2": "#f8fafc", "--text": "#f8fafc" }[name] || "";
      } };
    },
    localStorage: storage,
  };
  return { attributes, canvas, context, host, operations, storage };
}

test("classic beta modes keep their exact order and safe persisted selection", () => {
  assert.deepEqual(Visualizer.MODES, ["bars", "wave", "dots", "mirror", "ring", "mountain", "orbit", "rain"]);
  assert.equal(Visualizer.DEFAULT_MODE, "bars");
  assert.equal(Visualizer.normalizeMode("RAIN"), "rain");
  assert.equal(Visualizer.normalizeMode("unknown"), "bars");
  assert.equal(Visualizer.nextMode("rain"), "bars");

  const storage = memoryStorage({ [Visualizer.MODE_STORAGE_KEY]: "orbit" });
  assert.equal(Visualizer.readMode(storage), "orbit");
  assert.equal(Visualizer.writeMode(storage, "dots"), "dots");
  assert.equal(storage.value(Visualizer.MODE_STORAGE_KEY), "dots");

  const denied = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(Visualizer.readMode(denied), "bars");
  assert.doesNotThrow(() => Visualizer.writeMode(denied, "ring"));
});

test("synthetic fallback is deterministic, bounded, and animated for remote playback", () => {
  const first = Visualizer.syntheticFrequencyData(1000, 64);
  const again = Visualizer.syntheticFrequencyData(1000, 64);
  const later = Visualizer.syntheticFrequencyData(1600, 64);
  assert.deepEqual(first, again);
  assert.notDeepEqual(first, later);
  assert.equal(first.length, 64);
  for (const value of first) assert.ok(value >= 0 && value <= 255);
});

test("all eight modes render their beta primitives and update accessible state", () => {
  const expectedPrimitive = {
    bars: "roundRect",
    wave: "stroke",
    dots: "arc",
    mirror: "roundRect",
    ring: "stroke",
    mountain: "closePath",
    orbit: "arc",
    rain: "roundRect",
  };
  const data = new Uint8Array(64).fill(196);
  const sample = harness("bars");
  const visualizer = Visualizer.create({
    canvas: sample.canvas,
    host: sample.host,
    storage: sample.storage,
    styleSource: sample.canvas,
  });

  for (const mode of Visualizer.MODES) {
    sample.operations.length = 0;
    visualizer.setMode(mode);
    assert.equal(visualizer.render({ frequencyData: data, now: 1200 }), mode);
    assert.ok(sample.operations.includes("clearRect"), `${mode} should clear its frame`);
    assert.ok(sample.operations.includes(expectedPrimitive[mode]), `${mode} should draw ${expectedPrimitive[mode]}`);
    assert.equal(sample.canvas.dataset.visualizerMode, mode);
    assert.match(sample.canvas.title, new RegExp(Visualizer.MODE_LABELS[mode], "i"));
    assert.match(sample.attributes.get("aria-label"), new RegExp(Visualizer.MODE_LABELS[mode], "i"));
    assert.equal(sample.storage.value(Visualizer.MODE_STORAGE_KEY), mode);
  }
});
