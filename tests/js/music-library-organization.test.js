const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = relativePath => fs
  .readFileSync(path.join(root, relativePath), "utf8")
  .replace(/\r\n?/g, "\n");
const panel = read("frontend/templates/_music_panel.html");
const appSource = read("frontend/static/music/music-app.js");
const {
  ALBUM_SORT_MODES,
  albumYearSections,
  folderBucket,
  folderDisplayLabel,
  folderTrackSections,
  releaseYear,
  safeRelativeFolder,
} = require(path.join(root, "frontend/static/music/music-app.js"));

test("the existing album dropdown separates ordering from organization", () => {
  assert.deepEqual(ALBUM_SORT_MODES, ["newest", "oldest", "title", "folder", "year"]);
  assert.match(panel, /<select id="cc-music-sort" aria-label="Album order or organization">/);
  assert.match(panel, /<optgroup label="Order albums">[\s\S]*?value="newest"[\s\S]*?value="oldest"[\s\S]*?value="title"[\s\S]*?<\/optgroup>/);
  assert.match(panel, /<optgroup label="Organize albums">[\s\S]*?value="folder"[\s\S]*?value="year"[\s\S]*?<\/optgroup>/);
  assert.match(appSource, /if \(!ALBUM_SORT_MODES\.includes\(nodes\.sort\.value\)\) return;/);
});

test("folder labels retain only safe relative POSIX keys", () => {
  assert.equal(safeRelativeFolder("Artist\\Album"), "Artist/Album");
  assert.equal(safeRelativeFolder(" ./Artist//Album  "), "Artist/Album");
  assert.equal(folderDisplayLabel("Artist/Album"), "Artist / Album");
  assert.equal(folderBucket("Artist/Album/Disc 2"), "Artist/Album");
  assert.equal(safeRelativeFolder("."), "");
  assert.equal(folderDisplayLabel(""), "Library root");

  for (const unsafe of ["C:\\Music\\Album", "/srv/music/Album", "\\\\server\\share", "Artist/../Secret", "https://host/music"]) {
    assert.equal(safeRelativeFolder(unsafe), "", `${unsafe} must not become a public folder label`);
    assert.equal(folderDisplayLabel(unsafe), "Library root");
  }
});

test("folder organization partitions tracks without changing opaque IDs", () => {
  const rootTrack = { id: "opaque-root", folder: "" };
  const first = { id: "opaque-a", folder: "Artist/Album 2/Disc 1" };
  const firstDiscTwo = { id: "opaque-a2", folder: "Artist/Album 2/Disc 2" };
  const second = { id: "opaque-b", folder: "Artist\\Album 10\\Disc 1" };
  const sections = folderTrackSections([second, rootTrack, firstDiscTwo, first]);

  assert.deepEqual(sections.map(section => section.folder), ["Artist/Album 2", "Artist/Album 10", ""]);
  assert.deepEqual(sections.map(section => section.label), ["Artist / Album 2", "Artist / Album 10", "Library root"]);
  assert.deepEqual(sections[0].tracks.map(track => track.id), ["opaque-a2", "opaque-a"]);
  assert.equal(sections[1].tracks[0].id, "opaque-b");
  assert.equal(sections[2].tracks[0], rootTrack);
});

test("year organization uses the earliest album year and keeps unknown years last", () => {
  const recent = { key: "recent", tracks: [{ id: "r1", date: "2024-01-02" }, { id: "r2", date: "undated", year: "2023" }] };
  const older = { key: "older", tracks: [{ id: "o1", date: "1999" }] };
  const unknown = { key: "unknown", tracks: [{ id: "u1", date: "Spring 1998" }, { id: "u2", date: "" }] };

  assert.equal(releaseYear(recent), 2023);
  const sections = albumYearSections([unknown, older, recent]);
  assert.deepEqual(sections.map(section => section.label), ["2023", "1999", "Unknown year"]);
  assert.equal(sections[0].groups[0], recent);
  assert.equal(sections[2].groups[0], unknown);
  assert.match(appSource, /renderAlbumSections\(albumYearSections\(groups\), "year"\)/);
});
