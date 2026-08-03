const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

const { expandedGroupForBack } = require(path.join(
  __dirname,
  "..",
  "..",
  "frontend",
  "static",
  "music",
  "music-app.js",
));

function group(control) {
  return {
    querySelector() { return control; },
  };
}

test("Back resolves the expanded album containing the active control", () => {
  const firstControl = { name: "first" };
  const secondControl = { name: "second" };
  const firstGroup = group(firstControl);
  const secondGroup = group(secondControl);
  const content = {
    contains(candidate) { return candidate === firstGroup || candidate === secondGroup; },
    querySelector() { return firstControl; },
  };
  const activeElement = {
    closest() { return secondGroup; },
  };

  assert.equal(expandedGroupForBack(content, activeElement), secondControl);
});

test("Back falls through to the open group when focus is outside Music", () => {
  const firstControl = { name: "first" };
  const content = {
    contains() { return false; },
    querySelector() { return firstControl; },
  };
  const activeElement = {
    closest() { return null; },
  };

  assert.equal(expandedGroupForBack(content, activeElement), firstControl);
  assert.equal(expandedGroupForBack(null, activeElement), null);
});
