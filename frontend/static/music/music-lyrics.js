/* Command Center music lyric helpers. Copyright (c) 2026 sagan246. MIT. */
(function (root, factory) {
  "use strict";
  const api = Object.freeze(factory());
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CCMusicLyrics = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const TIMESTAMP_SOURCE = String.raw`\[([0-9]{1,3}):([0-5][0-9])(?:[.:]([0-9]{1,3}))?\]`;
  const METADATA_LINE = /^\s*\[(?:al|ar|au|by|la|length|offset|re|ti|ve):[^\]]*\]\s*$/i;
  const EARLY_ACTIVATION_SECONDS = 0.15;

  function normalizedSource(value) {
    return String(value == null ? "" : value)
      .replace(/^\uFEFF/, "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n");
  }

  function timestampSeconds(minutes, seconds, fraction) {
    const milliseconds = fraction
      ? Number(`0.${String(fraction).padEnd(3, "0").slice(0, 3)}`)
      : 0;
    return (Number(minutes) * 60) + Number(seconds) + milliseconds;
  }

  function parseLrc(text) {
    const cues = [];
    let order = 0;

    normalizedSource(text).split("\n").forEach(rawLine => {
      const matcher = new RegExp(TIMESTAMP_SOURCE, "g");
      const timestamps = [];
      let match;
      while ((match = matcher.exec(rawLine)) !== null) {
        timestamps.push(timestampSeconds(match[1], match[2], match[3]));
      }
      if (!timestamps.length) return;

      // Remove all bracketed LRC tags after collecting timestamps. This keeps
      // metadata out of display text while leaving ordinary lyric punctuation
      // untouched. Returned strings are data; consumers should render them via
      // textContent rather than interpolating them into HTML.
      const lyric = rawLine.replace(/\[[^\]]*\]/g, "").trim();
      timestamps.forEach(time => cues.push({ time, lyric, order: order++ }));
    });

    cues.sort((left, right) => (left.time - right.time) || (left.order - right.order));
    return cues.map(({ time, lyric }) => ({ time, lyric }));
  }

  function looksLikeLrc(text) {
    return new RegExp(TIMESTAMP_SOURCE).test(normalizedSource(text));
  }

  function activeLrcIndex(lines, time) {
    if (!Array.isArray(lines) || !lines.length) return -1;
    const currentTime = Number(time);
    if (!Number.isFinite(currentTime)) return -1;

    let activeIndex = -1;
    for (let index = 0; index < lines.length; index += 1) {
      const cueTime = Number(lines[index] && lines[index].time);
      if (!Number.isFinite(cueTime)) continue;
      if (cueTime <= currentTime + EARLY_ACTIVATION_SECONDS) activeIndex = index;
      else break;
    }
    return activeIndex;
  }

  function emptySlot() {
    return Object.freeze({
      index: null,
      time: null,
      lyric: "",
      active: false,
      blank: true,
    });
  }

  function lyricWindow(lines, index, radius = 2) {
    const source = Array.isArray(lines) ? lines : [];
    const requestedRadius = Number(radius);
    const safeRadius = Number.isFinite(requestedRadius)
      ? Math.max(0, Math.min(50, Math.trunc(requestedRadius)))
      : 2;
    const size = (safeRadius * 2) + 1;
    if (!source.length) return Array.from({ length: size }, emptySlot);

    const requestedIndex = Number(index);
    const focusIndex = Number.isInteger(requestedIndex) && requestedIndex >= 0
      ? Math.min(requestedIndex, source.length - 1)
      : 0;

    return Array.from({ length: size }, (_unused, slotIndex) => {
      const cueIndex = focusIndex + slotIndex - safeRadius;
      if (cueIndex < 0 || cueIndex >= source.length) return emptySlot();
      const cue = source[cueIndex] || {};
      const lyric = normalizedSource(cue.lyric).trim();
      const cueTime = Number(cue.time);
      return Object.freeze({
        index: cueIndex,
        time: Number.isFinite(cueTime) ? cueTime : null,
        lyric,
        active: slotIndex === safeRadius,
        blank: lyric === "",
      });
    });
  }

  function plainLyricsLines(text) {
    const lines = normalizedSource(text)
      .split("\n")
      .filter(line => !METADATA_LINE.test(line))
      .map(line => line.trim());

    while (lines.length && !lines[0]) lines.shift();
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return lines;
  }

  return {
    parseLrc,
    looksLikeLrc,
    activeLrcIndex,
    lyricWindow,
    plainLyricsLines,
  };
});
