const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const Lyrics = require(path.join(
  __dirname,
  "..",
  "..",
  "frontend",
  "static",
  "music",
  "music-lyrics.js",
));

test("exports a dependency-free frozen UMD API", () => {
  assert.equal(Object.isFrozen(Lyrics), true);
  assert.deepEqual(Object.keys(Lyrics).sort(), [
    "activeLrcIndex",
    "looksLikeLrc",
    "lyricWindow",
    "parseLrc",
    "plainLyricsLines",
  ]);
});

test("attaches the same API to a browser-style global without a DOM", () => {
  const filename = path.join(
    __dirname,
    "..",
    "..",
    "frontend",
    "static",
    "music",
    "music-lyrics.js",
  );
  const context = {};
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });

  assert.equal(typeof context.CCMusicLyrics.parseLrc, "function");
  assert.equal(context.CCMusicLyrics.looksLikeLrc("[00:01]Ready"), true);
  assert.equal(Object.isFrozen(context.CCMusicLyrics), true);
});

test("parses metadata-free cues, multiple timestamps, and fractional forms", () => {
  const cues = Lyrics.parseLrc([
    "\uFEFF[ar:Taeyeon]",
    "[ti:Two Times]",
    "[00:03:500][00:01.25] <Stay & sing>",
    "[00:02.5]Middle",
    "[by:Someone]",
  ].join("\r\n"));

  assert.deepEqual(cues, [
    { time: 1.25, lyric: "<Stay & sing>" },
    { time: 2.5, lyric: "Middle" },
    { time: 3.5, lyric: "<Stay & sing>" },
  ]);
});

test("keeps equal-time cues stable and ignores malformed timestamps", () => {
  assert.deepEqual(Lyrics.parseLrc([
    "[00:10.00]First",
    "[00:10.000]Second",
    "[00:60.00]Invalid seconds",
    "[not-a-time]Metadata",
  ].join("\n")), [
    { time: 10, lyric: "First" },
    { time: 10, lyric: "Second" },
  ]);
});

test("detects valid timed cues without mistaking metadata or malformed tags for LRC", () => {
  assert.equal(Lyrics.looksLikeLrc("[ar:Taeyeon]\n[ti:Album]"), false);
  assert.equal(Lyrics.looksLikeLrc("[00:01.23]Lyric"), true);
  assert.equal(Lyrics.looksLikeLrc("[02:03:4]Lyric"), true);
  assert.equal(Lyrics.looksLikeLrc("[00:05.00]"), true);
  assert.equal(Lyrics.looksLikeLrc("[00:99.00]Nope"), false);
  assert.equal(Lyrics.looksLikeLrc(null), false);
});

test("selects cues at exact times, between cues, after the final cue, and during pre-roll", () => {
  const cues = Lyrics.parseLrc([
    "[00:01.00]One",
    "[00:03.00]Two",
    "[00:07.50]Three",
  ].join("\n"));

  assert.equal(Lyrics.activeLrcIndex(cues, 0.84), -1);
  assert.equal(Lyrics.activeLrcIndex(cues, 0.9), 0);
  assert.equal(Lyrics.activeLrcIndex(cues, 1), 0);
  assert.equal(Lyrics.activeLrcIndex(cues, 2.8), 0);
  assert.equal(Lyrics.activeLrcIndex(cues, 2.9), 1);
  assert.equal(Lyrics.activeLrcIndex(cues, 3), 1);
  assert.equal(Lyrics.activeLrcIndex(cues, 999), 2);
  assert.equal(Lyrics.activeLrcIndex(cues, Number.NaN), -1);
  assert.equal(Lyrics.activeLrcIndex([], 10), -1);
});

test("timed blank cues become active clears instead of borrowing a nearby lyric", () => {
  const cues = Lyrics.parseLrc([
    "[00:01.00]Before",
    "[00:04.00]   ",
    "[00:08.00]After",
  ].join("\n"));
  const index = Lyrics.activeLrcIndex(cues, 5);
  const slots = Lyrics.lyricWindow(cues, index);

  assert.equal(index, 1);
  assert.deepEqual(slots.map(slot => slot.index), [null, 0, 1, 2, null]);
  assert.equal(slots[2].active, true);
  assert.equal(slots[2].blank, true);
  assert.equal(slots[2].lyric, "");
  assert.equal(slots[1].lyric, "Before");
  assert.equal(slots[3].lyric, "After");
});

test("default lyric windows contain five slots for pre-roll and final cues", () => {
  const cues = Lyrics.parseLrc([
    "[00:05]First",
    "[00:10]Second",
    "[00:15]Third",
    "[00:20]Final",
  ].join("\n"));

  const preRoll = Lyrics.lyricWindow(cues, Lyrics.activeLrcIndex(cues, 0));
  assert.equal(preRoll.length, 5);
  assert.deepEqual(preRoll.map(slot => slot.index), [null, null, 0, 1, 2]);
  assert.deepEqual(preRoll.map(slot => slot.lyric), ["", "", "First", "Second", "Third"]);
  assert.equal(preRoll[2].active, true);

  const final = Lyrics.lyricWindow(cues, Lyrics.activeLrcIndex(cues, 100));
  assert.deepEqual(final.map(slot => slot.index), [1, 2, 3, null, null]);
  assert.deepEqual(final.map(slot => slot.lyric), ["Second", "Third", "Final", "", ""]);
  assert.equal(final[2].active, true);
});

test("lyricWindow supports a bounded custom radius and always returns safe slots", () => {
  const cues = Lyrics.parseLrc("[00:01]One\n[00:02]Two\n[00:03]Three");
  const slots = Lyrics.lyricWindow(cues, 1, 1);
  assert.equal(slots.length, 3);
  assert.deepEqual(slots.map(slot => slot.lyric), ["One", "Two", "Three"]);
  assert.equal(Object.isFrozen(slots[1]), true);

  const empty = Lyrics.lyricWindow(null, -1);
  assert.equal(empty.length, 5);
  assert.equal(empty.every(slot => slot.index === null && slot.lyric === ""), true);
});

test("plain text fallback normalizes newlines, removes metadata, and preserves stanza breaks", () => {
  assert.deepEqual(Lyrics.plainLyricsLines([
    "\uFEFF  ",
    "[ar:Taeyeon]",
    "  First line  ",
    "",
    "  <Second & final>  ",
    "[offset:+150]",
    "",
  ].join("\r\n")), [
    "First line",
    "",
    "<Second & final>",
  ]);
  assert.deepEqual(Lyrics.plainLyricsLines(null), []);
  assert.deepEqual(Lyrics.plainLyricsLines("\u0000 One\rTwo "), ["One", "Two"]);
});
