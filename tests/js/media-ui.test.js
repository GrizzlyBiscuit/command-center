const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const mediaUI = require(path.join(root, "frontend/static/media/media-ui.js"));
const base = fs.readFileSync(path.join(root, "frontend/templates/base.html"), "utf8");

class FakeNode {
  constructor(ownerDocument, tagName) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.dataset = {};
    this.classNames = new Set();
    this.classList = { add: value => this.classNames.add(value) };
    this.textContent = "";
    this.title = "";
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || null; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  querySelector(selector) {
    if (selector !== ".cc-media-icon") return null;
    return this.children.find(child => child.getAttribute?.("class") === "cc-media-icon") || null;
  }
}

const documentRef = {
  createElementNS(_namespace, tagName) { return new FakeNode(documentRef, tagName); },
};

test("shared media icons are local, accessible, and keep control geometry stable", () => {
  for (const name of ["play", "pause", "previous", "next", "queue", "restart", "film"]) {
    assert.ok(mediaUI.icons.includes(name));
  }
  const icon = mediaUI.createIcon("play", { document: documentRef });
  assert.equal(icon.tagName, "svg");
  assert.equal(icon.getAttribute("aria-hidden"), "true");
  assert.equal(icon.getAttribute("focusable"), "false");

  const control = new FakeNode(documentRef, "button");
  mediaUI.setButtonIcon(control, "play", "Play music");
  const original = control.children[0];
  control.append(new FakeNode(documentRef, "span"));
  mediaUI.setButtonIcon(control, "play", "Resume music");
  assert.equal(control.children[0], original);
  assert.equal(control.getAttribute("aria-label"), "Resume music");
  assert.equal(control.title, "Resume music");
  assert.ok(control.classNames.has("cc-media-icon-button"));
});

test("shared icon assets load before both media applications", () => {
  const ui = base.indexOf("media/media-ui.js");
  assert.ok(ui >= 0);
  assert.ok(ui < base.indexOf("music/music-app.js"));
  assert.ok(ui < base.indexOf("video/video-app.js"));
  assert.match(base, /media\/media-ui\.css/);
});
