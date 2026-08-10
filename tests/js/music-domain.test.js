const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");

const Music = require(path.join(__dirname, "..", "..", "frontend", "static", "music", "music-domain.js"));

function track(id, title, artist = "Artist", album = "Album", extra = {}) {
  return { id, title, artist, album, ...extra };
}

const ID = Object.freeze({
  one: "00000000000000000000000000000001",
  two: "00000000000000000000000000000002",
  three: "00000000000000000000000000000003",
  ten: "00000000000000000000000000000010",
  eleven: "00000000000000000000000000000011",
  twelve: "00000000000000000000000000000012",
  thirty: "00000000000000000000000000000030",
  forty: "00000000000000000000000000000040",
});

test("search is accent-insensitive, multi-word, and spans metadata", () => {
  const tracks = [
    track(ID.one, "Café Moon", "Taeyeon", "Blue"),
    track(ID.two, "Moonlight", "Someone", "Red", { genre: "Ambient Pop" }),
    track(ID.three, "Signal", "Taeyeon", "Purpose", { date: "2019-10-28", folder: "Korean/Solo/Purpose" }),
  ];

  assert.deepEqual(Music.searchTracks(tracks, "cafe taeyeon").map(item => item.id), [ID.one]);
  assert.deepEqual(Music.searchTracks(tracks, "ambient red").map(item => item.id), [ID.two]);
  assert.deepEqual(Music.searchTracks(tracks, "2019 purpose").map(item => item.id), [ID.three]);
  assert.deepEqual(Music.searchTracks(tracks, "korean solo").map(item => item.id), [ID.three]);
  assert.deepEqual(Music.searchTracks(tracks, "  "), tracks);
});

test("albums with the same title are kept separate by artist", () => {
  const groups = Music.groupAlbums([
    track(ID.one, "One", "Artist A", "Live"),
    track(ID.two, "Two", "Artist B", "Live"),
    track(ID.three, "Three", "Artist A", "Live"),
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => [group.artist, group.tracks.length]), [["Artist A", 2], ["Artist B", 1]]);
});

test("album artwork uses the first art-bearing track without changing its opaque id", () => {
  const noArt = track(ID.one, "One");
  const withArt = track(ID.two, "Two", "Artist", "Album", { has_artwork: true });
  const withUrl = track(ID.three, "Three", "Artist", "Album", { artwork_url: `/api/music/art/${ID.three}` });

  assert.equal(Music.albumArtworkTrack({ tracks: [noArt, withArt, withUrl] }), withArt);
  assert.equal(Music.albumArtworkTrack({ tracks: [noArt] }), null);
  assert.equal(Music.albumArtworkTrack({ tracks: [] }), null);
  assert.equal(Music.albumArtworkTrack({ tracks: [noArt, withArt] }).id, ID.two);
});

test("stable identity prefers opaque backend IDs over colliding metadata", () => {
  const first = track(ID.one, "Same", "Artist", "Album", { duration: 180 });
  const second = track(ID.two, "Same", "Artist", "Album", { duration: 180 });

  assert.equal(Music.trackId(first), ID.one);
  assert.equal(Music.stableTrackKey(first), `id:${ID.one}`);
  assert.notEqual(Music.stableTrackKey(first), Music.stableTrackKey(second));
});

test("artist groups and tracks have deterministic natural ordering", () => {
  const groups = Music.groupArtists([
    track(ID.three, "Song 10", "Beta", "Set", { track_number: 10 }),
    track(ID.two, "Song 2", "Beta", "Set", { track_number: 2 }),
    track(ID.one, "Alpha song", "Alpha", "Set"),
  ]);

  assert.deepEqual(groups.map(group => group.label), ["Alpha", "Beta"]);
  assert.deepEqual(groups[1].tracks.map(item => item.title), ["Song 2", "Song 10"]);
});

test("queue helpers add, insert next, and remove without corrupting the active index", () => {
  assert.deepEqual(Music.addToQueue([ID.one, ID.two], ID.three), [ID.one, ID.two, ID.three]);
  assert.deepEqual(Music.playNext([ID.one, ID.three], 0, ID.two), [ID.one, ID.two, ID.three]);
  assert.deepEqual(Music.playNext([], -1, ID.ten), [ID.ten]);

  assert.deepEqual(Music.removeQueueItem([ID.one, ID.two, ID.three], 2, 0), {
    queue: [ID.two, ID.three], index: 1, removedCurrent: false,
  });
  assert.deepEqual(Music.removeQueueItem([ID.one, ID.two, ID.three], 1, 1), {
    queue: [ID.one, ID.three], index: 1, removedCurrent: true,
  });
  assert.deepEqual(Music.removeQueueItem([ID.one], 0, 0), {
    queue: [], index: 0, removedCurrent: true,
  });
});

test("repeat behavior distinguishes track end from manual next", () => {
  assert.equal(Music.nextQueueIndex({ length: 2, index: 0, ended: true, repeatMode: "one" }), 0);
  assert.equal(Music.nextQueueIndex({ length: 2, index: 0, ended: false, repeatMode: "one" }), 1);
  assert.equal(Music.nextQueueIndex({ length: 2, index: 1, ended: true, repeatMode: "off" }), -1);
  assert.equal(Music.nextQueueIndex({ length: 2, index: 1, ended: true, repeatMode: "all" }), 0);
  assert.equal(Music.nextQueueIndex({ length: 2, index: 0, direction: -1, repeatMode: "all" }), 1);
  assert.deepEqual(["off", "all", "one", "off"], [
    "off",
    Music.nextRepeatMode("off"),
    Music.nextRepeatMode("all"),
    Music.nextRepeatMode("one"),
  ]);
});

test("shuffle supports deterministic injection and retains every occurrence", () => {
  const values = [ID.one, ID.two, ID.two, ID.three];
  const shuffled = Music.shuffleIds(values, () => 0);
  assert.deepEqual(shuffled, [ID.two, ID.two, ID.three, ID.one]);
  assert.deepEqual([...shuffled].sort(), [...values].sort());
});

test("persistence is namespaced and strips unsafe library id characters", () => {
  assert.equal(Music.playbackStorageKey("library/home music"), "cc.music.playback.v1.library-home-music");
  assert.equal(Music.playbackStorageKey(""), "cc.music.playback.v1.unconfigured");
});

test("playback state clamps values and rejects unknown repeat modes", () => {
  const keys = new Map([[ID.one, "a"], [ID.two, "b"]]);
  const state = Music.buildPlaybackState({
    queue: [ID.one, ID.two, "bad", "ffffffffffffffffffffffffffffffff"],
    index: 1,
    position: -3,
    volume: 8,
    repeat: "forever",
    shuffle: true,
    keysById: keys,
  }, new Set([ID.one, ID.two]));

  assert.deepEqual(state.queue, [ID.one, ID.two]);
  assert.deepEqual(state.queue_keys, ["a", "b"]);
  assert.equal(state.current_track_id, ID.two);
  assert.equal(state.position, 0);
  assert.equal(state.volume, 1);
  assert.equal(state.repeat, "off");
  assert.equal(state.shuffle, true);

  const invalidVolume = Music.buildPlaybackState({ queue: [ID.one], volume: "not-a-number" }, new Set([ID.one]));
  assert.equal(invalidVolume.volume, 1);
  assert.deepEqual(invalidVolume.queue_keys, [`id:${ID.one}`]);
});

test("saved queue survives scan id changes through stable keys", () => {
  const catalog = [
    track(ID.thirty, "Active", "Artist", "Album", { stable_key: "active" }),
    track(ID.forty, "Next", "Artist", "Album", { stable_key: "next" }),
  ];
  const restored = Music.parsePlaybackState({
    queue: [ID.eleven, ID.twelve, "00000000000000000000000000000013"],
    queue_keys: ["removed", "active", "next"],
    index: 1,
    position: 42,
    volume: 0.4,
    repeat: "all",
  }, catalog);

  assert.deepEqual(restored.queue, [ID.thirty, ID.forty]);
  assert.equal(restored.index, 0);
  assert.equal(restored.current_track_id, ID.thirty);
  assert.equal(restored.position, 42);
  assert.equal(restored.volume, 0.4);
});

test("restore advances to the next surviving item if the active track vanished", () => {
  const catalog = [
    track(ID.thirty, "Previous", "Artist", "Album", { stable_key: "previous" }),
    track(ID.forty, "Next", "Artist", "Album", { stable_key: "next" }),
  ];
  const restored = Music.parsePlaybackState({
    queue: [ID.ten, ID.eleven, ID.twelve],
    queue_keys: ["previous", "removed", "next"],
    index: 1,
    position: 42,
  }, catalog);

  assert.deepEqual(restored.queue, [ID.thirty, ID.forty]);
  assert.equal(restored.index, 1);
  assert.equal(restored.current_track_id, ID.forty);
  assert.equal(restored.position, 0);
});

test("time formatting handles short and long tracks", () => {
  assert.equal(Music.formatTime(0), "0:00");
  assert.equal(Music.formatTime(65.9), "1:05");
  assert.equal(Music.formatTime(3661), "1:01:01");
});

test("debounce only invokes the final call", () => {
  const callbacks = new Map();
  let nextId = 0;
  const calls = [];
  const clock = {
    setTimeout(callback) { nextId += 1; callbacks.set(nextId, callback); return nextId; },
    clearTimeout(id) { callbacks.delete(id); },
  };
  const debounced = Music.debounce(value => calls.push(value), 100, clock);
  debounced("first");
  debounced("last");
  assert.equal(callbacks.size, 1);
  [...callbacks.values()][0]();
  assert.deepEqual(calls, ["last"]);
});
