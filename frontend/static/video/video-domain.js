/*
 * Command Center video domain helpers.
 * Portions Copyright (c) 2026 sagan246. SPDX-License-Identifier: MIT.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CCVideoDomain = Object.freeze(api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function normalizedText(value) {
    return text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  }

  function videoId(video) {
    if (!video || typeof video !== "object") return null;
    const value = video.id == null ? video.video_id : video.id;
    if (value == null || typeof value === "object") return null;
    const id = String(value).trim();
    return id && id.length <= 256 ? id : null;
  }

  function stableVideoKey(video) {
    const provided = text(video && (video.stable_key || video.library_key || video.key));
    if (provided) return provided;
    const id = videoId(video);
    return id ? `id:${id}` : JSON.stringify([
      normalizedText(video && video.title),
      Number(video && (video.byte_size || video.size) || 0),
      text(video && video.modified_at),
    ]);
  }

  function compareVideos(left, right) {
    return text(left?.folder || "(root)").localeCompare(
      text(right?.folder || "(root)"),
      undefined,
      { numeric: true, sensitivity: "base" },
    ) || text(left?.title || "Untitled video").localeCompare(
      text(right?.title || "Untitled video"),
      undefined,
      { numeric: true, sensitivity: "base" },
    ) || text(videoId(left)).localeCompare(text(videoId(right)), undefined, { numeric: true });
  }

  function searchVideos(source, query) {
    const terms = normalizedText(query).split(/\s+/).filter(Boolean);
    const videos = Array.isArray(source) ? source : [];
    if (!terms.length) return [...videos];
    return videos.filter(video => {
      const haystack = normalizedText([
        video?.title,
        video?.folder,
        video?.format,
        video?.mime_type,
      ].map(text).join(" "));
      return terms.every(term => haystack.includes(term));
    });
  }

  function formatTime(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (!bytes) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const amount = bytes / (1024 ** exponent);
    const digits = amount >= 100 || exponent === 0 ? 0 : amount >= 10 ? 1 : 2;
    return `${amount.toFixed(digits)} ${units[exponent]}`;
  }

  function progressPercent(progress, fallbackDuration = 0) {
    const duration = Math.max(0, Number(progress?.duration) || Number(fallbackDuration) || 0);
    if (progress?.completed === true) return 100;
    if (!duration) return 0;
    return Math.max(0, Math.min(100, Number(progress?.position) / duration * 100));
  }

  function resumePosition(progress, fallbackDuration = 0) {
    if (!progress || progress.completed === true) return 0;
    const position = Math.max(0, Number(progress.position) || 0);
    const duration = Math.max(0, Number(progress.duration) || Number(fallbackDuration) || 0);
    if (position < 5) return 0;
    if (duration > 0 && position >= Math.max(duration * 0.9, duration - 20)) return 0;
    return position;
  }

  function playbackCompleted(position, duration, ended = false) {
    if (ended) return true;
    const total = Math.max(0, Number(duration) || 0);
    const current = Math.max(0, Number(position) || 0);
    return total > 0 && current >= Math.max(total * 0.9, total - 20);
  }

  function nextQueueIndex(length, index, direction = 1) {
    if (!Number.isInteger(length) || length < 1) return -1;
    const current = Number.isInteger(index) && index >= 0 && index < length ? index : 0;
    const candidate = current + (direction < 0 ? -1 : 1);
    return candidate >= 0 && candidate < length ? candidate : -1;
  }

  function debounce(fn, wait = 180, clock = { setTimeout, clearTimeout }) {
    let timer = null;
    return function debounced(...args) {
      if (timer !== null) clock.clearTimeout(timer);
      timer = clock.setTimeout(() => {
        timer = null;
        fn.apply(this, args);
      }, wait);
    };
  }

  return {
    compareVideos,
    debounce,
    formatBytes,
    formatTime,
    nextQueueIndex,
    normalizedText,
    playbackCompleted,
    progressPercent,
    resumePosition,
    searchVideos,
    stableVideoKey,
    videoId,
  };
});
