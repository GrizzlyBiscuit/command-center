const test = require("node:test");
const assert = require("node:assert/strict");
const Navigation = require("../../frontend/static/input/controller-navigation.js");

function element(tagName, properties = {}){
  return {
    tagName,
    type: "",
    isContentEditable: false,
    matches(selector){
      if(selector.includes("button") && tagName === "BUTTON") return true;
      if(selector.includes("a[href]") && tagName === "A" && properties.href) return true;
      return false;
    },
    ...properties,
  };
}

test("typing targets distinguish text entry from controller-adjustable inputs", () => {
  assert.equal(Navigation.isTypingTarget(element("TEXTAREA")), true);
  assert.equal(Navigation.isTypingTarget(element("DIV", {isContentEditable: true})), true);
  assert.equal(Navigation.isTypingTarget(element("INPUT", {type: "text"})), true);
  assert.equal(Navigation.isTypingTarget(element("INPUT", {type: "search"})), true);
  assert.equal(Navigation.isTypingTarget(element("INPUT", {type: "range"})), false);
  assert.equal(Navigation.isTypingTarget(element("INPUT", {type: "checkbox"})), false);
  assert.equal(Navigation.isTypingTarget(element("BUTTON")), false);
});

test("native activation targets retain their browser keyboard behavior", () => {
  assert.equal(Navigation.isNativeActivationTarget(element("BUTTON")), true);
  assert.equal(Navigation.isNativeActivationTarget(element("A", {href: "/"})), true);
  assert.equal(Navigation.isNativeActivationTarget(element("DIV")), false);
});

test("native picker controls retain directional keyboard behavior", () => {
  assert.equal(Navigation.usesNativeDirectionalKeys(element("SELECT")), true);
  assert.equal(Navigation.usesNativeDirectionalKeys(element("INPUT", {type: "range"})), true);
  assert.equal(Navigation.usesNativeDirectionalKeys(element("INPUT", {type: "date"})), true);
  assert.equal(Navigation.usesNativeDirectionalKeys(element("INPUT", {type: "text"})), false);
  assert.equal(Navigation.usesNativeDirectionalKeys(element("BUTTON")), false);
});

test("section navigation wraps in both directions", () => {
  assert.equal(Navigation.nextSectionIndex(0, 5, -1), 4);
  assert.equal(Navigation.nextSectionIndex(4, 5, 1), 0);
  assert.equal(Navigation.nextSectionIndex(2, 5, 1), 3);
  assert.equal(Navigation.nextSectionIndex(-1, 5, 1), 0);
  assert.equal(Navigation.nextSectionIndex(0, 0, 1), -1);
});
