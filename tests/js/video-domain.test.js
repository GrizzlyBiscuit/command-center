const assert = require("node:assert/strict");
const test = require("node:test");

const Video = require("../../frontend/static/video/video-domain.js");

test("video IDs stay opaque and reject object-shaped values", () => {
  assert.equal(Video.videoId({ id: "opaque-video-a" }), "opaque-video-a");
  assert.equal(Video.videoId({ video_id: 42 }), "42");
  assert.equal(Video.videoId({ id: { path: "private.mp4" } }), null);
  assert.equal(Video.videoId({ id: "" }), null);
});

test("video ordering and search include safe relative folders", () => {
  const source = [
    { id: "b", folder: "Concert B", title: "2 Finale", format: "webm" },
    { id: "a2", folder: "Concert A", title: "10 Encore", format: "mp4" },
    { id: "a1", folder: "Concert A", title: "2 Opening", format: "mp4" },
  ];
  assert.deepEqual(
    [...source].sort(Video.compareVideos).map(item => item.id),
    ["a1", "a2", "b"],
  );
  assert.deepEqual(Video.searchVideos(source, "concert a mp4").map(item => item.id), ["a2", "a1"]);
  assert.deepEqual(Video.searchVideos(source, "finale webm").map(item => item.id), ["b"]);
});

test("resume positions skip tiny starts and nearly completed videos", () => {
  assert.equal(Video.resumePosition({ position: 4, duration: 200 }), 0);
  assert.equal(Video.resumePosition({ position: 80, duration: 200 }), 80);
  assert.equal(Video.resumePosition({ position: 190, duration: 200 }), 0);
  assert.equal(Video.resumePosition({ position: 80, duration: 200, completed: true }), 0);
});

test("completion uses either ended state or the final playback window", () => {
  assert.equal(Video.playbackCompleted(20, 100, false), false);
  assert.equal(Video.playbackCompleted(81, 100, false), false);
  assert.equal(Video.playbackCompleted(90, 100, false), true);
  assert.equal(Video.playbackCompleted(1, 10, false), false);
  assert.equal(Video.playbackCompleted(0, 0, true), true);
});

test("progress percentages and display helpers are bounded", () => {
  assert.equal(Video.progressPercent({ position: 50, duration: 200 }), 25);
  assert.equal(Video.progressPercent({ position: 900, duration: 200 }), 100);
  assert.equal(Video.progressPercent({ completed: true }), 100);
  assert.equal(Video.formatTime(3665), "1:01:05");
  assert.equal(Video.formatBytes(1024 * 1024), "1.00 MB");
});

test("video queues stop at their ends", () => {
  assert.equal(Video.nextQueueIndex(3, 1, 1), 2);
  assert.equal(Video.nextQueueIndex(3, 2, 1), -1);
  assert.equal(Video.nextQueueIndex(3, 0, -1), -1);
  assert.equal(Video.nextQueueIndex(0, 0, 1), -1);
});
