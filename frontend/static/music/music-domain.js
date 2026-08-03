/*
 * Portions Copyright (c) 2026 sagan246
 * SPDX-License-Identifier: MIT
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CCMusicDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const REPEAT_MODES = Object.freeze(["off", "all", "one"]);

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function normalizedText(value) {
    return text(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  }

  function normalizedId(value) {
    if (value == null || typeof value === "object") return null;
    const id = String(value).trim();
    return id && id.length <= 256 ? id : null;
  }

  function trackId(track) {
    if (!track || typeof track !== "object") return null;
    return normalizedId(track.id == null ? track.track_id : track.id);
  }

  function stableTrackKey(track) {
    if (!track || typeof track !== "object") return "";
    const provided = text(track.key || track.library_key || track.stable_key);
    if (provided) return provided;
    const id = trackId(track);
    if (id) return `id:${id}`;
    return JSON.stringify([
      normalizedText(track.artist),
      normalizedText(track.album),
      normalizedText(track.title),
      Number(track.disc_number || track.disc || 1),
      Number(track.track_number || track.track || 0),
      Number(track.duration || 0),
    ]);
  }

  function compareText(a, b) {
    return text(a).localeCompare(text(b), undefined, { numeric: true, sensitivity: "base" });
  }

  function compareTracks(a, b) {
    return compareText(a.artist || "Unknown artist", b.artist || "Unknown artist")
      || compareText(a.album || "Unknown album", b.album || "Unknown album")
      || (Number(a.disc_number || a.disc || 1) - Number(b.disc_number || b.disc || 1))
      || (Number(a.track_number || a.track || 9999) - Number(b.track_number || b.track || 9999))
      || compareText(a.title || "Unknown title", b.title || "Unknown title")
      || compareText(trackId(a), trackId(b));
  }

  function albumIdentity(track) {
    const album = normalizedText(track && track.album) || "unknown album";
    const owner = normalizedText(track && (track.album_artist || track.albumartist || track.artist)) || "unknown artist";
    return JSON.stringify([owner, album]);
  }

  function artistIdentity(track) {
    return normalizedText(track && (track.album_artist || track.albumartist || track.artist)) || "unknown artist";
  }

  function groupBy(source, identity, label) {
    const groups = new Map();
    for (const track of Array.isArray(source) ? source : []) {
      const id = trackId(track);
      if (id === null) continue;
      const key = identity(track);
      if (!groups.has(key)) groups.set(key, { key, label: label(track), tracks: [] });
      groups.get(key).tracks.push(track);
    }
    return [...groups.values()]
      .map(group => ({ ...group, tracks: [...group.tracks].sort(compareTracks) }))
      .sort((a, b) => compareText(a.label, b.label) || compareText(a.key, b.key));
  }

  function groupAlbums(source) {
    return groupBy(
      source,
      albumIdentity,
      track => text(track.album) || "Unknown album",
    ).map(group => ({
      ...group,
      artist: text(group.tracks[0] && (group.tracks[0].album_artist || group.tracks[0].albumartist || group.tracks[0].artist)) || "Unknown artist",
    }));
  }

  function albumArtworkTrack(group) {
    const tracks = Array.isArray(group && group.tracks) ? group.tracks : [];
    return tracks.find(track => Boolean(track && (track.has_artwork || text(track.artwork_url)))) || null;
  }

  function groupArtists(source) {
    return groupBy(
      source,
      artistIdentity,
      track => text(track.album_artist || track.albumartist || track.artist) || "Unknown artist",
    );
  }

  function searchableTrackText(track) {
    return normalizedText([
      track && track.title,
      track && track.artist,
      track && (track.album_artist || track.albumartist),
      track && track.album,
      track && track.genre,
      track && track.year,
    ].map(text).join(" "));
  }

  function searchTracks(source, query) {
    const words = normalizedText(query).split(/\s+/).filter(Boolean);
    const tracks = Array.isArray(source) ? source : [];
    if (!words.length) return [...tracks];
    return tracks.filter(track => {
      const haystack = searchableTrackText(track);
      return words.every(word => haystack.includes(word));
    });
  }

  function dedupeIds(values, validIds) {
    const valid = validIds instanceof Set
      ? new Set([...validIds].map(normalizedId).filter(Boolean))
      : null;
    const result = [];
    for (const value of Array.isArray(values) ? values : []) {
      const id = normalizedId(value);
      if (id === null || (valid && !valid.has(id))) continue;
      result.push(id);
    }
    return result;
  }

  function addToQueue(queue, id) {
    const clean = dedupeIds(queue);
    const nextId = normalizedId(id);
    return nextId === null ? clean : [...clean, nextId];
  }

  function playNext(queue, currentIndex, id) {
    const clean = dedupeIds(queue);
    const nextId = normalizedId(id);
    if (nextId === null) return clean;
    const index = Number.isInteger(currentIndex) && currentIndex >= 0
      ? Math.min(currentIndex + 1, clean.length)
      : 0;
    return [...clean.slice(0, index), nextId, ...clean.slice(index)];
  }

  function removeQueueItem(queue, currentIndex, removeIndex) {
    const clean = dedupeIds(queue);
    if (!Number.isInteger(removeIndex) || removeIndex < 0 || removeIndex >= clean.length) {
      return { queue: clean, index: Math.min(Math.max(Number(currentIndex) || 0, 0), Math.max(0, clean.length - 1)), removedCurrent: false };
    }
    const index = Number.isInteger(currentIndex) ? currentIndex : 0;
    const removedCurrent = removeIndex === index;
    const nextQueue = clean.filter((_, itemIndex) => itemIndex !== removeIndex);
    let nextIndex = index;
    if (removeIndex < index) nextIndex -= 1;
    if (nextIndex >= nextQueue.length) nextIndex = Math.max(0, nextQueue.length - 1);
    return { queue: nextQueue, index: nextIndex, removedCurrent };
  }

  function normalizeRepeatMode(value) {
    return REPEAT_MODES.includes(value) ? value : "off";
  }

  function nextRepeatMode(value) {
    const index = REPEAT_MODES.indexOf(normalizeRepeatMode(value));
    return REPEAT_MODES[(index + 1) % REPEAT_MODES.length];
  }

  function nextQueueIndex({ length, index, direction = 1, repeatMode = "off", ended = false }) {
    if (!Number.isInteger(length) || length < 1) return -1;
    const current = Number.isInteger(index) && index >= 0 && index < length ? index : 0;
    const repeat = normalizeRepeatMode(repeatMode);
    if (ended && repeat === "one") return current;
    const step = direction < 0 ? -1 : 1;
    const candidate = current + step;
    if (candidate >= 0 && candidate < length) return candidate;
    if (repeat === "all") return candidate < 0 ? length - 1 : 0;
    return -1;
  }

  function shuffleIds(values, random = Math.random) {
    const result = dedupeIds(values);
    for (let index = result.length - 1; index > 0; index -= 1) {
      const other = Math.max(0, Math.min(index, Math.floor(Number(random()) * (index + 1))));
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }

  function playbackStorageKey(libraryId) {
    const namespace = text(libraryId).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || "unconfigured";
    return `cc.music.playback.v1.${namespace}`;
  }

  function normalizedVolume(value) {
    const volume = Number(value);
    return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
  }

  function buildPlaybackState(values, catalog) {
    const validIds = catalog instanceof Set ? catalog : null;
    const queue = dedupeIds(values && values.queue, validIds);
    let index = Number(values && values.index);
    if (!Number.isInteger(index) || index < 0 || index >= queue.length) index = queue.length ? 0 : -1;
    return {
      queue,
      queue_keys: queue.map(id => text(values && values.keysById && values.keysById.get(id)) || `id:${id}`),
      index,
      current_track_id: index >= 0 ? queue[index] : null,
      current_track_key: index >= 0 ? text(values && values.keysById && values.keysById.get(queue[index])) : "",
      position: Math.max(0, Number(values && values.position) || 0),
      volume: normalizedVolume(values && values.volume == null ? 1 : values.volume),
      repeat: normalizeRepeatMode(values && values.repeat),
      shuffle: Boolean(values && values.shuffle),
      updated_at: Date.now(),
    };
  }

  function parsePlaybackState(raw, catalog) {
    let saved;
    try { saved = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
    if (!saved || typeof saved !== "object") return null;
    const tracks = Array.isArray(catalog) ? catalog : [];
    const byId = new Map(tracks.map(track => [trackId(track), track]).filter(([id]) => id !== null));
    const byKey = new Map(tracks.map(track => [stableTrackKey(track), trackId(track)]).filter(([key, id]) => key && id !== null));
    const oldQueue = Array.isArray(saved.queue) ? saved.queue : [];
    const oldKeys = Array.isArray(saved.queue_keys) ? saved.queue_keys : [];
    const savedIndex = Number.isInteger(saved.index) ? saved.index : oldQueue.map(normalizedId).indexOf(normalizedId(saved.current_track_id));
    const resolved = [];
    const oldIndexes = [];
    for (let index = 0; index < Math.max(oldQueue.length, oldKeys.length); index += 1) {
      const rawId = normalizedId(oldQueue[index]);
      const id = rawId !== null && byId.has(rawId) ? rawId : byKey.get(text(oldKeys[index]));
      if (id === undefined || id === null) continue;
      resolved.push(id);
      oldIndexes.push(index);
    }
    if (!resolved.length) return null;
    let index = oldIndexes.indexOf(savedIndex);
    if (index < 0) {
      const after = oldIndexes.findIndex(oldIndex => oldIndex > savedIndex);
      index = after >= 0 ? after : resolved.length - 1;
    }
    const sameTrack = oldIndexes[index] === savedIndex;
    return {
      queue: resolved,
      index,
      current_track_id: resolved[index],
      position: sameTrack ? Math.max(0, Number(saved.position) || 0) : 0,
      volume: normalizedVolume(saved.volume == null ? 1 : saved.volume),
      repeat: normalizeRepeatMode(saved.repeat),
      shuffle: Boolean(saved.shuffle),
    };
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

  return Object.freeze({
    REPEAT_MODES,
    addToQueue,
    albumArtworkTrack,
    albumIdentity,
    buildPlaybackState,
    compareTracks,
    debounce,
    formatTime,
    groupAlbums,
    groupArtists,
    nextQueueIndex,
    nextRepeatMode,
    normalizeRepeatMode,
    normalizedText,
    parsePlaybackState,
    playbackStorageKey,
    playNext,
    removeQueueItem,
    searchTracks,
    shuffleIds,
    stableTrackKey,
    trackId,
  });
});
