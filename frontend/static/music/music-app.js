/*
 * Command Center music library.
 * Portions Copyright (c) 2026 sagan246. SPDX-License-Identifier: MIT.
 *
 * DOM contract (all controls are ordinary, controller-friendly elements):
 *   Panel: #cc-music-root, #cc-music-search, #cc-music-content,
 *     #cc-music-status, and buttons [data-music-view="tracks|albums|artists|stats|settings"].
 *   Persistent dock: #cc-music-player, <audio id="cc-music-audio">,
 *     #cc-music-art, #cc-music-now-title, #cc-music-now-meta,
 *     #cc-music-previous, #cc-music-play, #cc-music-next,
 *     #cc-music-shuffle, #cc-music-repeat, #cc-music-progress,
 *     #cc-music-elapsed, #cc-music-duration, #cc-music-volume,
 *     #cc-music-queue-count, #cc-music-queue-clear, #cc-music-queue,
 *     and optional #cc-music-queue-toggle.
 *   Settings controls are rendered into #cc-music-content by this module.
 *
 * Load music-domain.js before this file. The audio element can live outside the
 * music tab; playback intentionally continues while another Command Center
 * panel is open.
 */

(function (root) {
  "use strict";

  const Domain = root.CCMusicDomain;
  const API = Object.freeze({
    settings: "/api/music/settings",
    library: "/api/music/library",
    scan: "/api/music/scan",
    stats: "/api/music/stats",
  });
  const FINISHED_SCAN_STATES = new Set(["complete", "completed", "done", "ready", "success"]);
  const FAILED_SCAN_STATES = new Set(["error", "failed", "cancelled", "canceled"]);
  const ACTIVE_SCAN_STATES = new Set(["queued", "pending", "running", "scanning", "in_progress"]);
  const PLAY_COUNT_SECONDS = 10;
  const SAVE_INTERVAL_MS = 3000;
  const STATS_FLUSH_SECONDS = 30;

  let app = null;

  function byId(id) {
    return root.document ? root.document.getElementById(id) : null;
  }

  function element(tag, className, text) {
    const node = root.document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function button(label, className, action) {
    const node = element("button", className, label);
    node.type = "button";
    if (action) node.addEventListener("click", action);
    return node;
  }

  function replace(node, ...children) {
    if (node) node.replaceChildren(...children.filter(Boolean));
  }

  function csrfToken() {
    return root.document && root.document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || "";
  }

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    const token = csrfToken();
    if (token) headers.set("X-CSRF-Token", token);
    let body = options.body;
    if (body && typeof body !== "string" && !(body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(body);
    }
    let response;
    try {
      response = await root.fetch(url, { ...options, headers, body });
    } catch (cause) {
      const error = new Error("Could not reach the local music service.");
      error.cause = cause;
      throw error;
    }
    const contentType = response.headers.get("content-type") || "";
    let data = null;
    try {
      data = contentType.includes("json") ? await response.json() : await response.text();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const message = data && typeof data === "object" && (data.error || data.message || data.detail);
      const error = new Error(message || `Music service returned ${response.status}.`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data == null || data === "" ? {} : data;
  }

  function normalizeTrack(raw) {
    const id = Domain.trackId(raw);
    if (id === null) return null;
    return {
      ...raw,
      id,
      title: String(raw.title || raw.name || "Unknown title"),
      artist: String(raw.artist || raw.album_artist || raw.albumartist || "Unknown artist"),
      album: String(raw.album || "Unknown album"),
      duration: Math.max(0, Number(raw.duration || raw.duration_seconds) || 0),
      stable_key: Domain.stableTrackKey(raw),
    };
  }

  function libraryPayload(data) {
    const tracks = Array.isArray(data)
      ? data
      : data?.tracks || data?.library?.tracks || data?.items || [];
    return {
      libraryId: String(data?.library_id || data?.library?.id || data?.id || "unconfigured"),
      tracks: (Array.isArray(tracks) ? tracks : []).map(normalizeTrack).filter(Boolean),
    };
  }

  function settingsPayload(data) {
    const source = data?.settings || data || {};
    return {
      folder: String(source.music_folder || source.folder || ""),
      folderName: String(source.folder_name || ""),
      libraryId: String(source.library_id || data?.library_id || ""),
      scan: source.scan || data?.scan || null,
      editable: source.editable !== false,
    };
  }

  function scanPayload(data) {
    const source = data?.scan || data?.job || data || {};
    return {
      id: source.scan_id || source.job_id || source.id || null,
      status: String(source.status || source.state || "queued").toLocaleLowerCase(),
      message: String(source.message || source.detail || ""),
      scanned: Number(source.scanned || source.files_scanned || source.processed || 0),
      total: Number(source.total || source.files_total || 0),
      pollUrl: source.poll_url || source.status_url || null,
    };
  }

  function createApp() {
    if (!Domain || !root.document) return null;
    const nodes = {
      root: byId("cc-music-root"),
      search: byId("cc-music-search"),
      content: byId("cc-music-content"),
      status: byId("cc-music-status"),
      player: byId("cc-music-player"),
      audio: byId("cc-music-audio"),
      art: byId("cc-music-art"),
      nowTitle: byId("cc-music-now-title"),
      nowMeta: byId("cc-music-now-meta"),
      previous: byId("cc-music-previous"),
      play: byId("cc-music-play"),
      next: byId("cc-music-next"),
      shuffle: byId("cc-music-shuffle"),
      repeat: byId("cc-music-repeat"),
      progress: byId("cc-music-progress"),
      elapsed: byId("cc-music-elapsed"),
      duration: byId("cc-music-duration"),
      volume: byId("cc-music-volume"),
      queueCount: byId("cc-music-queue-count"),
      queueClear: byId("cc-music-queue-clear"),
      queue: byId("cc-music-queue"),
      queueToggle: byId("cc-music-queue-toggle"),
    };
    if (!nodes.root || !nodes.content || !nodes.audio) return null;

    const state = {
      view: "tracks",
      query: "",
      loading: true,
      loadError: null,
      folder: "",
      folderName: "",
      editable: true,
      libraryId: "unconfigured",
      tracks: [],
      trackById: new Map(),
      keysById: new Map(),
      queue: [],
      queueIndex: -1,
      repeat: "off",
      shuffle: false,
      storageKey: Domain.playbackStorageKey("unconfigured"),
      lastSaveAt: 0,
      resumeAt: 0,
      stats: null,
      statsLoading: false,
      statsError: null,
      scan: null,
      scanTimer: null,
      listen: { trackId: null, seconds: 0, lastTime: null, counted: false },
      analyser: null,
      audioContext: null,
      audioSource: null,
    };

    function currentTrack() {
      return state.queueIndex >= 0 ? state.trackById.get(state.queue[state.queueIndex]) || null : null;
    }

    function opaqueTrackId(value) {
      return Domain.trackId(typeof value === "object" ? value : { id: value });
    }

    function setStatus(message, kind = "info") {
      if (!nodes.status) return;
      nodes.status.textContent = message || "";
      nodes.status.dataset.kind = kind;
      nodes.status.hidden = !message;
    }

    function audioUrl(track) {
      return `/api/music/audio/${encodeURIComponent(track.id)}`;
    }

    function artUrl(track) {
      return track && (track.has_artwork || track.artwork_url)
        ? `/api/music/art/${encodeURIComponent(track.id)}`
        : "";
    }

    function updateNav() {
      nodes.root.querySelectorAll("[data-music-view]").forEach(control => {
        const active = control.dataset.musicView === state.view;
        control.classList.toggle("is-active", active);
        control.classList.toggle("active", active);
        control.setAttribute("aria-pressed", active ? "true" : "false");
      });
      if (nodes.search) {
        const searchRegion = nodes.search.closest(".cc-music-search-wrap") || nodes.search;
        searchRegion.hidden = state.view === "stats" || state.view === "settings";
      }
    }

    function filteredTracks() {
      return Domain.searchTracks(state.tracks, state.query).sort(Domain.compareTracks);
    }

    function trackArtwork(track, className = "cc-music-track-art") {
      const image = element("img", className);
      image.alt = "";
      image.loading = "lazy";
      const source = artUrl(track);
      if (source) image.src = source;
      else image.classList.add("is-missing");
      image.addEventListener("error", () => image.classList.add("is-missing"), { once: true });
      return image;
    }

    function playTrack(trackId, sourceTracks) {
      const ids = (Array.isArray(sourceTracks) ? sourceTracks : state.tracks)
        .map(opaqueTrackId)
        .filter(id => state.trackById.has(id));
      const requestedId = opaqueTrackId(trackId);
      let index = ids.indexOf(requestedId);
      if (index < 0 && requestedId !== null && state.trackById.has(requestedId)) {
        ids.push(requestedId);
        index = ids.length - 1;
      }
      if (index < 0) return;
      if (state.shuffle && ids.length > 1) {
        const selected = ids[index];
        state.queue = [selected, ...Domain.shuffleIds(ids.filter((_, itemIndex) => itemIndex !== index))];
        state.queueIndex = 0;
      } else {
        state.queue = ids;
        state.queueIndex = index;
      }
      selectCurrent({ autoplay: true });
    }

    function queueTracks(tracks, { next = false } = {}) {
      const ids = (Array.isArray(tracks) ? tracks : [tracks])
        .map(opaqueTrackId)
        .filter(id => state.trackById.has(id));
      for (const id of (next ? [...ids].reverse() : ids)) {
        state.queue = next
          ? Domain.playNext(state.queue, state.queueIndex, id)
          : Domain.addToQueue(state.queue, id);
      }
      if (state.queueIndex < 0 && state.queue.length) state.queueIndex = 0;
      renderQueue();
      updateDock();
      savePlayback(true);
      setStatus(`${ids.length} track${ids.length === 1 ? "" : "s"} added to the queue.`, "success");
    }

    function trackRow(track, context) {
      const row = element("article", "cc-music-track");
      row.dataset.trackId = String(track.id);
      row.append(trackArtwork(track));
      const copy = element("div", "cc-music-track-copy");
      copy.append(element("strong", "cc-music-track-title", track.title));
      copy.append(element("span", "cc-music-track-meta", `${track.artist} · ${track.album}`));
      const duration = element("span", "cc-music-track-duration", Domain.formatTime(track.duration));
      const actions = element("div", "cc-music-track-actions");
      const playButton = button("Play", "cc-music-primary", () => playTrack(track.id, context));
      playButton.setAttribute("aria-label", `Play ${track.title}`);
      const nextButton = button("Play next", "cc-music-secondary", () => queueTracks([track], { next: true }));
      nextButton.setAttribute("aria-label", `Play ${track.title} next`);
      const addButton = button("Add", "cc-music-secondary", () => queueTracks([track]));
      addButton.setAttribute("aria-label", `Add ${track.title} to queue`);
      actions.append(playButton, nextButton, addButton);
      row.append(copy, duration, actions);
      return row;
    }

    function emptyState(title, message, actionLabel, action) {
      const box = element("section", "cc-music-empty");
      box.append(element("h4", "", title), element("p", "", message));
      if (actionLabel && action) box.append(button(actionLabel, "cc-music-primary", action));
      return box;
    }

    function renderTracks() {
      const tracks = filteredTracks();
      if (!tracks.length) {
        return emptyState(
          state.tracks.length ? "No matches" : "No music yet",
          state.tracks.length ? "Try a different title, artist, or album." : "Choose a music folder in Settings, then scan it.",
          state.tracks.length ? "Clear search" : "Open settings",
          () => state.tracks.length ? clearSearch() : setView("settings"),
        );
      }
      const list = element("div", "cc-music-track-list");
      tracks.forEach(track => list.append(trackRow(track, tracks)));
      return list;
    }

    function groupCard(group, type) {
      const card = element("section", `cc-music-group cc-music-${type}`);
      const header = element("div", "cc-music-group-head");
      const copy = element("div", "cc-music-group-copy");
      copy.append(element("h4", "", group.label));
      const subtitle = type === "album"
        ? `${group.artist} · ${group.tracks.length} track${group.tracks.length === 1 ? "" : "s"}`
        : `${group.tracks.length} track${group.tracks.length === 1 ? "" : "s"}`;
      copy.append(element("p", "", subtitle));
      const actions = element("div", "cc-music-group-actions");
      actions.append(
        button("Play", "cc-music-primary", () => playTrack(group.tracks[0].id, group.tracks)),
        button("Add all", "cc-music-secondary", () => queueTracks(group.tracks)),
      );
      const reveal = button("Show tracks", "cc-music-secondary");
      reveal.setAttribute("aria-expanded", "false");
      actions.append(reveal);
      header.append(copy, actions);
      const list = element("div", "cc-music-group-tracks");
      list.hidden = true;
      group.tracks.forEach(track => list.append(trackRow(track, group.tracks)));
      reveal.addEventListener("click", () => {
        const opening = list.hidden;
        list.hidden = !opening;
        reveal.textContent = opening ? "Hide tracks" : "Show tracks";
        reveal.setAttribute("aria-expanded", opening ? "true" : "false");
      });
      card.append(header, list);
      return card;
    }

    function renderGroups(type) {
      const source = filteredTracks();
      const groups = type === "album" ? Domain.groupAlbums(source) : Domain.groupArtists(source);
      if (!groups.length) return emptyState("No matches", "Try a different search.", "Clear search", clearSearch);
      const list = element("div", "cc-music-group-list");
      groups.forEach(group => list.append(groupCard(group, type)));
      return list;
    }

    function statValue(value) {
      return typeof value === "number" ? value.toLocaleString() : String(value == null ? "—" : value);
    }

    function renderStatsData(data) {
      const source = data?.stats || data || {};
      const wrap = element("div", "cc-music-stats");
      const summary = source.summary || source.totals || source;
      const cards = element("div", "cc-music-stat-grid");
      const definitions = [
        ["Listening time", summary.listening_time_label || (summary.seconds != null ? Domain.formatTime(summary.seconds) : summary.total_time)],
        ["Plays", summary.plays ?? summary.play_count ?? summary.total_plays],
        ["Tracks played", summary.tracks_played ?? summary.unique_tracks],
        ["Library tracks", summary.library_tracks ?? state.tracks.length],
      ];
      definitions.forEach(([label, value]) => {
        const card = element("section", "cc-music-stat-card");
        card.append(element("span", "", label), element("strong", "", statValue(value)));
        cards.append(card);
      });
      wrap.append(cards);

      const top = source.top_tracks || source.most_played || [];
      const history = source.daily || source.history || [];
      wrap.append(renderStatsList("Most played", top), renderListeningHistory(history));
      const refresh = button("Refresh stats", "cc-music-secondary", () => loadStats(true));
      wrap.append(refresh);
      return wrap;
    }

    function renderStatsList(title, items) {
      const section = element("section", "cc-music-stats-list");
      section.append(element("h4", "", title));
      if (!Array.isArray(items) || !items.length) {
        section.append(element("p", "cc-music-muted", "Nothing recorded yet."));
        return section;
      }
      const list = element("ol", "");
      items.slice(0, 12).forEach(item => {
        const row = element("li", "");
        const statsTrack = state.trackById.get(opaqueTrackId(item.track_id));
        const titleText = item.title || item.track_title || statsTrack?.title || "Track";
        const artist = item.artist || item.track_artist || statsTrack?.artist || "";
        const playCount = item.plays ?? item.play_count;
        const metric = playCount != null ? `${playCount} plays` : item.played_at || item.last_played || "";
        row.append(element("strong", "", titleText), element("span", "", [artist, metric].filter(Boolean).join(" · ")));
        list.append(row);
      });
      section.append(list);
      return section;
    }

    function renderListeningHistory(items) {
      const section = element("section", "cc-music-stats-list");
      section.append(element("h4", "", "Listening history"));
      if (!Array.isArray(items) || !items.length) {
        section.append(element("p", "cc-music-muted", "Nothing recorded yet."));
        return section;
      }
      const list = element("ol", "cc-music-history-list");
      [...items].reverse().slice(0, 14).forEach(item => {
        const row = element("li", "");
        const plays = Number(item.play_count ?? item.plays ?? 0) || 0;
        row.append(
          element("strong", "", item.day || item.date || "Listening day"),
          element("span", "", `${Domain.formatTime(item.seconds)} · ${plays} play${plays === 1 ? "" : "s"}`),
        );
        list.append(row);
      });
      section.append(list);
      return section;
    }

    function scanDescription() {
      if (!state.scan) return "Ready to scan the selected folder.";
      const progress = state.scan.total > 0 ? ` ${state.scan.scanned}/${state.scan.total}` : state.scan.scanned > 0 ? ` ${state.scan.scanned} files` : "";
      return state.scan.message || `${state.scan.status}${progress}`;
    }

    function renderSettings() {
      const wrap = element("div", "cc-music-settings");
      const heading = element("div", "cc-music-settings-head");
      heading.append(
        element("h4", "", "Music folder"),
        element(
          "p",
          "cc-music-muted",
          state.editable
            ? "Pick the folder containing this Command Center's music. Subfolders are included."
            : `Folder management is available only on the computer running Command Center${state.folderName ? ` (${state.folderName})` : ""}.`,
        ),
      );
      const label = element("label", "", "Folder path");
      label.htmlFor = "cc-music-folder";
      const input = element("input", "cc-music-folder");
      input.id = "cc-music-folder";
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.value = state.editable ? state.folder : state.folderName;
      input.placeholder = "C:\\Music or /home/me/Music";
      input.disabled = !state.editable;
      const actions = element("div", "cc-music-settings-actions");
      const browse = button("Browse…", "cc-music-secondary", () => browseFolder(input));
      browse.id = "cc-music-browse";
      const save = button("Save folder", "cc-music-primary", () => saveFolder(input.value));
      save.id = "cc-music-save-folder";
      const rescan = button("Rescan library", "cc-music-secondary", startScan);
      rescan.id = "cc-music-rescan";
      browse.disabled = !state.editable;
      save.disabled = !state.editable;
      rescan.disabled = !state.editable || ACTIVE_SCAN_STATES.has(state.scan?.status) || Boolean(state.scanTimer);
      if (rescan.disabled && state.editable) rescan.textContent = "Scanning…";
      const scan = element("p", "cc-music-scan-status", scanDescription());
      scan.id = "cc-music-scan-status";
      scan.setAttribute("role", "status");
      scan.setAttribute("aria-live", "polite");
      actions.append(browse, save, rescan);
      wrap.append(heading, label, input, actions, scan);
      return wrap;
    }

    function renderContent() {
      updateNav();
      if (state.loading) {
        replace(nodes.content, emptyState("Loading music…", "Reading the local library."));
        return;
      }
      if (state.loadError) {
        replace(nodes.content, emptyState("Music library unavailable", state.loadError.message, "Try again", load));
        return;
      }
      if (state.view === "tracks") replace(nodes.content, renderTracks());
      if (state.view === "albums") replace(nodes.content, renderGroups("album"));
      if (state.view === "artists") replace(nodes.content, renderGroups("artist"));
      if (state.view === "settings") replace(nodes.content, renderSettings());
      if (state.view === "stats") {
        if (state.statsLoading) replace(nodes.content, emptyState("Loading stats…", "Reading listening history."));
        else if (state.statsError) replace(nodes.content, emptyState("Stats unavailable", state.statsError.message, "Try again", () => loadStats(true)));
        else if (state.stats) replace(nodes.content, renderStatsData(state.stats));
        else {
          replace(nodes.content, emptyState("Loading stats…", "Reading listening history."));
          loadStats();
        }
      }
    }

    function setView(view) {
      if (!["tracks", "albums", "artists", "stats", "settings"].includes(view)) return;
      state.view = view;
      renderContent();
    }

    function clearSearch() {
      state.query = "";
      if (nodes.search) nodes.search.value = "";
      renderContent();
    }

    async function loadStats(force = false) {
      if (state.statsLoading || (state.stats && !force)) return;
      state.statsLoading = true;
      state.statsError = null;
      if (state.view === "stats") renderContent();
      try {
        state.stats = await request(API.stats);
      } catch (error) {
        state.statsError = error;
      } finally {
        state.statsLoading = false;
        if (state.view === "stats") renderContent();
      }
    }

    function updateDock() {
      const track = currentTrack();
      if (nodes.player) nodes.player.hidden = !track;
      if (nodes.player) nodes.player.classList.toggle("is-empty", !track);
      if (nodes.nowTitle) nodes.nowTitle.textContent = track ? track.title : "Nothing playing";
      if (nodes.nowMeta) nodes.nowMeta.textContent = track ? `${track.artist} · ${track.album}` : "Choose a track from Music";
      if (nodes.art) {
        const source = artUrl(track);
        if (source) {
          nodes.art.src = source;
          nodes.art.alt = "";
          nodes.art.hidden = false;
        } else {
          nodes.art.removeAttribute("src");
          nodes.art.hidden = true;
        }
      }
      if (nodes.play) {
        nodes.play.textContent = nodes.audio.paused ? "Play" : "Pause";
        nodes.play.setAttribute("aria-label", nodes.audio.paused ? "Play music" : "Pause music");
        nodes.play.setAttribute("aria-pressed", nodes.audio.paused ? "false" : "true");
        nodes.play.disabled = !track;
      }
      if (nodes.previous) nodes.previous.disabled = !track;
      if (nodes.next) nodes.next.disabled = !track;
      if (nodes.shuffle) {
        nodes.shuffle.textContent = state.shuffle ? "Shuffle: On" : "Shuffle: Off";
        nodes.shuffle.setAttribute("aria-label", state.shuffle ? "Turn shuffle off" : "Turn shuffle on");
        nodes.shuffle.setAttribute("aria-pressed", state.shuffle ? "true" : "false");
      }
      if (nodes.repeat) {
        nodes.repeat.textContent = `Repeat: ${state.repeat[0].toUpperCase()}${state.repeat.slice(1)}`;
        nodes.repeat.setAttribute("aria-label", `Repeat ${state.repeat}`);
        nodes.repeat.dataset.repeat = state.repeat;
        nodes.repeat.setAttribute("aria-pressed", state.repeat === "off" ? "false" : "true");
      }
      if (nodes.volume && root.document.activeElement !== nodes.volume) nodes.volume.value = String(nodes.audio.volume);
      updateProgress();
    }

    function updateProgress() {
      const duration = Number.isFinite(nodes.audio.duration) ? nodes.audio.duration : currentTrack()?.duration || 0;
      const current = Number.isFinite(nodes.audio.currentTime) ? nodes.audio.currentTime : 0;
      if (nodes.progress && root.document.activeElement !== nodes.progress) {
        nodes.progress.value = duration > 0 ? String(Math.round(current / duration * 1000)) : "0";
        nodes.progress.setAttribute("aria-valuetext", `${Domain.formatTime(current)} of ${Domain.formatTime(duration)}`);
      }
      if (nodes.elapsed) nodes.elapsed.textContent = Domain.formatTime(current);
      if (nodes.duration) nodes.duration.textContent = Domain.formatTime(duration);
    }

    function renderQueue() {
      if (nodes.queueCount) nodes.queueCount.textContent = String(state.queue.length);
      if (nodes.queueClear) nodes.queueClear.disabled = !state.queue.length;
      if (!nodes.queue) return;
      if (!state.queue.length) {
        replace(nodes.queue, element("p", "cc-music-muted", "The queue is empty."));
        return;
      }
      const list = element("ol", "cc-music-queue-list");
      state.queue.forEach((id, index) => {
        const track = state.trackById.get(id);
        if (!track) return;
        const item = element("li", "cc-music-queue-item");
        if (index === state.queueIndex) item.classList.add("is-current");
        const playButton = button("", "cc-music-queue-play", () => {
          state.queueIndex = index;
          selectCurrent({ autoplay: true });
        });
        playButton.setAttribute("aria-label", `Play ${track.title}`);
        playButton.append(element("strong", "", track.title), element("span", "", track.artist));
        const remove = button("Remove", "cc-music-queue-remove", () => removeFromQueue(index));
        remove.setAttribute("aria-label", `Remove ${track.title} from queue`);
        item.append(playButton, remove);
        list.append(item);
      });
      replace(nodes.queue, list);
    }

    function removeFromQueue(index) {
      const before = currentTrack();
      const result = Domain.removeQueueItem(state.queue, state.queueIndex, index);
      state.queue = result.queue;
      state.queueIndex = state.queue.length ? result.index : -1;
      if (!state.queue.length) {
        stopPlayback();
      } else if (result.removedCurrent) {
        flushListening();
        selectCurrent({ autoplay: !nodes.audio.paused });
      } else if (before && currentTrack()?.id !== before.id) {
        selectCurrent({ autoplay: !nodes.audio.paused });
      }
      renderQueue();
      updateDock();
      savePlayback(true);
    }

    function clearQueue() {
      flushListening();
      state.queue = [];
      state.queueIndex = -1;
      stopPlayback();
      renderQueue();
      updateDock();
      savePlayback(true);
    }

    function stopPlayback() {
      nodes.audio.pause();
      nodes.audio.removeAttribute("src");
      nodes.audio.load();
      resetListening(null);
    }

    function resetListening(trackId) {
      state.listen = { trackId, seconds: 0, lastTime: null, counted: false };
    }

    function collectListeningTime({ autoFlush = true } = {}) {
      if (state.listen.trackId == null || nodes.audio.paused || nodes.audio.seeking) {
        state.listen.lastTime = Number(nodes.audio.currentTime) || null;
        return;
      }
      const now = Number(nodes.audio.currentTime) || 0;
      if (state.listen.lastTime != null) {
        const delta = now - state.listen.lastTime;
        if (delta > 0 && delta <= 15) state.listen.seconds += delta;
      }
      state.listen.lastTime = now;
      if (autoFlush && state.listen.seconds >= STATS_FLUSH_SECONDS) flushListening({ collect: false });
    }

    function clientEventId() {
      if (root.crypto && typeof root.crypto.randomUUID === "function") return root.crypto.randomUUID();
      return `ccm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    }

    function flushListening({ keepalive = false, collect = true } = {}) {
      if (collect) collectListeningTime({ autoFlush: false });
      const trackId = state.listen.trackId;
      const seconds = Math.floor(state.listen.seconds);
      const countPlay = !state.listen.counted && state.listen.seconds >= PLAY_COUNT_SECONDS;
      if (trackId == null || (seconds < 1 && !countPlay)) return;
      state.listen.seconds = Math.max(0, state.listen.seconds - seconds);
      if (countPlay) state.listen.counted = true;
      const payload = {
        track_id: trackId,
        seconds,
        count_play: countPlay,
        client_event_id: clientEventId(),
      };
      request(API.stats, { method: "POST", body: payload, keepalive }).catch(() => {
        // Do not silently synthesize path or metadata. A later event can record
        // new listening time; this event ID prevents retries from double-counting.
      });
    }

    function selectCurrent({ autoplay = false, resumeAt = 0 } = {}) {
      const track = currentTrack();
      if (!track) {
        updateDock();
        return;
      }
      if (state.listen.trackId !== null) flushListening();
      resetListening(track.id);
      nodes.audio.src = audioUrl(track);
      nodes.audio.load();
      if (resumeAt > 0) {
        nodes.audio.addEventListener("loadedmetadata", () => {
          const limit = Number.isFinite(nodes.audio.duration) ? Math.max(0, nodes.audio.duration - 0.25) : resumeAt;
          nodes.audio.currentTime = Math.min(resumeAt, limit);
          state.listen.lastTime = nodes.audio.currentTime;
          updateProgress();
        }, { once: true });
      }
      updateMediaSession(track);
      renderQueue();
      updateDock();
      savePlayback(true);
      if (autoplay) play().catch(error => setStatus(error.message || "Playback could not start.", "error"));
    }

    async function play() {
      if (!currentTrack()) {
        if (!state.queue.length && state.tracks.length) {
          state.queue = filteredTracks().map(track => track.id);
          state.queueIndex = 0;
          selectCurrent();
        } else return;
      }
      root.CCAudio?.stop?.();
      if (!nodes.audio.src) selectCurrent();
      getAnalyser();
      const resume = state.audioContext?.state === "suspended"
        ? state.audioContext.resume().catch(() => {})
        : Promise.resolve();
      const playback = nodes.audio.play();
      await Promise.all([resume, playback]);
      updateDock();
    }

    function pause() {
      collectListeningTime();
      nodes.audio.pause();
      flushListening();
      savePlayback(true);
      updateDock();
    }

    function previous() {
      if (!currentTrack()) return;
      if (nodes.audio.currentTime > 4) {
        nodes.audio.currentTime = 0;
        state.listen.lastTime = 0;
        updateProgress();
        return;
      }
      const nextIndex = Domain.nextQueueIndex({
        length: state.queue.length,
        index: state.queueIndex,
        direction: -1,
        repeatMode: state.repeat,
      });
      if (nextIndex < 0) {
        nodes.audio.currentTime = 0;
        return;
      }
      state.queueIndex = nextIndex;
      selectCurrent({ autoplay: true });
    }

    function next({ ended = false } = {}) {
      if (!currentTrack()) return;
      let nextIndex = Domain.nextQueueIndex({
        length: state.queue.length,
        index: state.queueIndex,
        direction: 1,
        repeatMode: state.repeat,
        ended,
      });
      if (nextIndex < 0) {
        flushListening();
        updateDock();
        savePlayback(true);
        return;
      }
      state.queueIndex = nextIndex;
      selectCurrent({ autoplay: true });
    }

    function toggleShuffle() {
      state.shuffle = !state.shuffle;
      if (state.shuffle && state.queue.length > 1) {
        const current = currentTrack();
        const remaining = state.queue.filter((_, index) => index !== state.queueIndex);
        state.queue = current ? [current.id, ...Domain.shuffleIds(remaining)] : Domain.shuffleIds(state.queue);
        state.queueIndex = current ? 0 : state.queue.length ? 0 : -1;
        renderQueue();
      }
      updateDock();
      savePlayback(true);
    }

    function toggleRepeat() {
      state.repeat = Domain.nextRepeatMode(state.repeat);
      updateDock();
      savePlayback(true);
    }

    function savePlayback(force = false) {
      if (!state.storageKey || !root.localStorage) return;
      const now = Date.now();
      if (!force && now - state.lastSaveAt < SAVE_INTERVAL_MS) return;
      state.lastSaveAt = now;
      const data = Domain.buildPlaybackState({
        queue: state.queue,
        index: state.queueIndex,
        position: Number(nodes.audio.currentTime) || 0,
        volume: nodes.audio.volume,
        repeat: state.repeat,
        shuffle: state.shuffle,
        keysById: state.keysById,
      }, new Set(state.trackById.keys()));
      try { root.localStorage.setItem(state.storageKey, JSON.stringify(data)); } catch {}
    }

    function restorePlayback() {
      let raw = null;
      try { raw = root.localStorage?.getItem(state.storageKey); } catch {}
      const restored = Domain.parsePlaybackState(raw, state.tracks);
      if (!restored) {
        nodes.audio.volume = Math.max(0, Math.min(1, Number(nodes.volume?.value) || 0.8));
        return;
      }
      state.queue = restored.queue;
      state.queueIndex = restored.index;
      state.repeat = restored.repeat;
      state.shuffle = restored.shuffle;
      state.resumeAt = restored.position;
      nodes.audio.volume = restored.volume;
      selectCurrent({ resumeAt: restored.position });
    }

    function updateMediaSession(track) {
      if (!track || !("mediaSession" in root.navigator)) return;
      try {
        root.navigator.mediaSession.metadata = new root.MediaMetadata({
          title: track.title,
          artist: track.artist,
          album: track.album,
          artwork: artUrl(track) ? [{ src: artUrl(track), sizes: "512x512" }] : [],
        });
      } catch {}
    }

    function setupMediaSession() {
      if (!("mediaSession" in root.navigator)) return;
      const handlers = {
        play: () => play(),
        pause,
        previoustrack: previous,
        nexttrack: () => next(),
      };
      Object.entries(handlers).forEach(([name, handler]) => {
        try { root.navigator.mediaSession.setActionHandler(name, handler); } catch {}
      });
    }

    function getAnalyser() {
      if (state.analyser) {
        if (state.audioContext?.state === "suspended") state.audioContext.resume().catch(() => {});
        return state.analyser;
      }
      const AudioContext = root.AudioContext || root.webkitAudioContext;
      if (!AudioContext) return null;
      try {
        state.audioContext = state.audioContext || new AudioContext();
        state.analyser = state.audioContext.createAnalyser();
        state.analyser.fftSize = 2048;
        state.analyser.smoothingTimeConstant = 0.82;
        state.audioSource = state.audioContext.createMediaElementSource(nodes.audio);
        state.audioSource.connect(state.analyser);
        state.analyser.connect(state.audioContext.destination);
        if (state.audioContext.state === "suspended") state.audioContext.resume().catch(() => {});
        return state.analyser;
      } catch {
        state.analyser = null;
        return null;
      }
    }

    function handleInputAction(action) {
      if (action === "secondaryAction") {
        if (!currentTrack()) return false;
        if (nodes.audio.paused) play().catch(error => setStatus(error.message, "error"));
        else pause();
        return true;
      }
      if (action !== "back") return false;
      if (nodes.queue && !nodes.queue.hidden) {
        nodes.queue.hidden = true;
        nodes.queueToggle?.setAttribute("aria-expanded", "false");
        nodes.queueToggle?.focus();
        return true;
      }
      const musicPanel = nodes.root.closest(".tab-panel");
      if (musicPanel && (musicPanel.hidden || root.getComputedStyle?.(musicPanel).display === "none")) return false;
      const expanded = nodes.content.querySelector('.cc-music-group-actions button[aria-expanded="true"]');
      if (!expanded) return false;
      expanded.click();
      expanded.focus();
      return true;
    }

    function syncAmbientControls() {
      const ambient = root.CCAudio;
      if (!ambient) return;
      const playing = Boolean(ambient.isOn?.());
      const mode = ambient.getMode?.();
      const titlebarButton = byId("tb-audio");
      titlebarButton?.classList.toggle("active", playing);
      titlebarButton?.setAttribute("aria-pressed", playing ? "true" : "false");
      root.document.querySelectorAll(".tb-audio-opt[data-audio]").forEach(option => {
        option.classList.toggle("active", option.dataset.audio === mode);
      });
      byId("tb-audio-vol")?.classList.toggle("show", playing);
    }

    async function browseFolder(input) {
      const chooser = root.pywebview?.api?.choose_music_folder;
      if (typeof chooser !== "function") {
        setStatus("Native Browse is unavailable here. Paste or type the folder path instead.", "info");
        input.focus();
        input.select();
        return;
      }
      try {
        const result = await chooser.call(root.pywebview.api);
        const folder = typeof result === "string" ? result : result?.music_folder || result?.folder || result?.path;
        if (folder) {
          input.value = String(folder);
          input.focus();
        }
      } catch (error) {
        setStatus(error.message || "The folder picker could not open.", "error");
      }
    }

    async function saveFolder(value) {
      const folder = String(value || "").trim();
      if (!folder) {
        setStatus("Enter a music folder first.", "error");
        byId("cc-music-folder")?.focus();
        return;
      }
      setStatus("Saving music folder…", "info");
      try {
        let data;
        try {
          data = await request(API.settings, { method: "PUT", body: { music_folder: folder } });
        } catch (error) {
          if (error.status !== 405) throw error;
          data = await request(API.settings, { method: "POST", body: { music_folder: folder } });
        }
        const settings = settingsPayload(data);
        state.folder = settings.folder || folder;
        state.folderName = settings.folderName || state.folderName;
        state.editable = settings.editable;
        state.scan = settings.scan ? scanPayload(settings.scan) : null;
        if (state.scan && scanIsFinished(state.scan)) {
          await scanComplete();
          return;
        }
        if (state.scan && ACTIVE_SCAN_STATES.has(state.scan.status)) {
          setStatus("Music folder saved. Scanning the library…", "success");
          pollScan(state.scan);
        } else {
          setStatus("Music folder saved.", "success");
        }
        renderContent();
      } catch (error) {
        setStatus(error.message, "error");
      }
    }

    function scanIsFinished(scan) {
      return FINISHED_SCAN_STATES.has(scan.status);
    }

    async function startScan() {
      if (state.scanTimer) return;
      setStatus("Starting library scan…", "info");
      try {
        state.scan = scanPayload(await request(API.scan, { method: "POST", body: {} }));
        renderContent();
        if (scanIsFinished(state.scan)) {
          await scanComplete();
          return;
        }
        if (FAILED_SCAN_STATES.has(state.scan.status)) throw new Error(state.scan.message || "Library scan failed.");
        if (!ACTIVE_SCAN_STATES.has(state.scan.status)) throw new Error(state.scan.message || "Library scan did not start.");
        pollScan(state.scan);
      } catch (error) {
        state.scanTimer = null;
        setStatus(error.message, "error");
        renderContent();
      }
    }

    function pollScan(scan) {
      if (state.scanTimer) root.clearTimeout(state.scanTimer);
      state.scanTimer = null;
      const encodedId = scan.id == null ? "" : encodeURIComponent(scan.id);
      let url = scan.pollUrl || (encodedId ? `${API.scan}/${encodedId}` : API.scan);
      let attempts = 0;
      const check = async () => {
        attempts += 1;
        try {
          let data;
          try {
            data = await request(url);
          } catch (error) {
            if (error.status !== 404 || !encodedId || url === API.scan) throw error;
            url = `${API.scan}?scan_id=${encodedId}`;
            data = await request(url);
          }
          state.scan = scanPayload(data);
          renderContent();
          if (scanIsFinished(state.scan)) {
            state.scanTimer = null;
            await scanComplete();
            return;
          }
          if (FAILED_SCAN_STATES.has(state.scan.status)) throw new Error(state.scan.message || "Library scan failed.");
          if (attempts >= 240) throw new Error("The scan is still running. Reopen Music later to see the result.");
          state.scanTimer = root.setTimeout(check, 1000);
        } catch (error) {
          state.scanTimer = null;
          setStatus(error.message, "error");
          renderContent();
        }
      };
      state.scanTimer = root.setTimeout(check, 700);
    }

    async function scanComplete() {
      setStatus("Scan complete. Refreshing the library…", "success");
      state.stats = null;
      await load({ keepView: true });
      setStatus(`${state.tracks.length} track${state.tracks.length === 1 ? "" : "s"} ready.`, "success");
    }

    async function load({ keepView = false } = {}) {
      const previousTrackId = state.queueIndex >= 0 ? state.queue[state.queueIndex] : null;
      const wasPlaying = !nodes.audio.paused;
      state.loading = true;
      state.loadError = null;
      renderContent();
      try {
        const [settingsRaw, libraryRaw] = await Promise.all([
          request(API.settings).catch(error => ({ _error: error })),
          request(API.library),
        ]);
        const settings = settingsRaw?._error
          ? { folder: "", folderName: "", libraryId: "", scan: null, editable: false }
          : settingsPayload(settingsRaw);
        const library = libraryPayload(libraryRaw);
        state.folder = settings.folder;
        state.folderName = settings.folderName;
        state.editable = settings.editable;
        state.libraryId = library.libraryId !== "unconfigured" ? library.libraryId : settings.libraryId || "unconfigured";
        state.tracks = library.tracks;
        state.trackById = new Map(state.tracks.map(track => [track.id, track]));
        state.keysById = new Map(state.tracks.map(track => [track.id, Domain.stableTrackKey(track)]));
        state.storageKey = Domain.playbackStorageKey(state.libraryId);
        if (settings.scan) state.scan = scanPayload(settings.scan);
        if (!state.queue.length) restorePlayback();
        else {
          const restored = Domain.parsePlaybackState(Domain.buildPlaybackState({
            queue: state.queue,
            index: state.queueIndex,
            position: nodes.audio.currentTime,
            volume: nodes.audio.volume,
            repeat: state.repeat,
            shuffle: state.shuffle,
            keysById: state.keysById,
          }), state.tracks);
          if (restored) {
            state.queue = restored.queue;
            state.queueIndex = restored.index;
            if (restored.current_track_id !== previousTrackId) {
              selectCurrent({ autoplay: wasPlaying, resumeAt: restored.position });
            }
          } else {
            state.queue = [];
            state.queueIndex = -1;
            stopPlayback();
          }
        }
        if (!keepView) state.view = "tracks";
      } catch (error) {
        state.loadError = error;
      } finally {
        state.loading = false;
        renderContent();
        renderQueue();
        updateDock();
        if (state.scan && ACTIVE_SCAN_STATES.has(state.scan.status) && !state.scanTimer) pollScan(state.scan);
      }
    }

    function bind() {
      nodes.root.querySelectorAll("[data-music-view]").forEach(control => {
        control.addEventListener("click", () => setView(control.dataset.musicView));
      });
      if (nodes.search) {
        const applySearch = Domain.debounce(() => {
          state.query = nodes.search.value;
          renderContent();
        }, 180);
        nodes.search.addEventListener("input", applySearch);
      }
      nodes.play?.addEventListener("click", () => nodes.audio.paused ? play().catch(error => setStatus(error.message, "error")) : pause());
      nodes.previous?.addEventListener("click", previous);
      nodes.next?.addEventListener("click", () => next());
      nodes.shuffle?.addEventListener("click", toggleShuffle);
      nodes.repeat?.addEventListener("click", toggleRepeat);
      nodes.queueClear?.addEventListener("click", clearQueue);
      nodes.queueToggle?.addEventListener("click", () => {
        if (!nodes.queue) return;
        const opening = nodes.queue.hidden;
        nodes.queue.hidden = !opening;
        nodes.queueToggle.setAttribute("aria-expanded", opening ? "true" : "false");
      });
      nodes.progress?.addEventListener("input", () => {
        if (!Number.isFinite(nodes.audio.duration)) return;
        nodes.audio.currentTime = Number(nodes.progress.value) / 1000 * nodes.audio.duration;
        state.listen.lastTime = nodes.audio.currentTime;
        updateProgress();
      });
      nodes.volume?.addEventListener("input", () => {
        nodes.audio.volume = Math.max(0, Math.min(1, Number(nodes.volume.value)));
        savePlayback(true);
      });

      nodes.audio.addEventListener("play", () => {
        root.CCAudio?.stop?.();
        if (state.audioContext?.state === "suspended") state.audioContext.resume().catch(() => {});
        if ("mediaSession" in root.navigator) root.navigator.mediaSession.playbackState = "playing";
        updateDock();
      });
      nodes.audio.addEventListener("pause", () => {
        collectListeningTime();
        if ("mediaSession" in root.navigator) root.navigator.mediaSession.playbackState = "paused";
        updateDock();
      });
      nodes.audio.addEventListener("ended", () => {
        flushListening();
        next({ ended: true });
      });
      nodes.audio.addEventListener("timeupdate", () => {
        collectListeningTime();
        updateProgress();
        savePlayback();
      });
      nodes.audio.addEventListener("durationchange", updateProgress);
      nodes.audio.addEventListener("seeking", () => { state.listen.lastTime = null; });
      nodes.audio.addEventListener("seeked", () => { state.listen.lastTime = nodes.audio.currentTime; });
      nodes.audio.addEventListener("error", () => {
        if (nodes.audio.error) setStatus("This track could not be played. It may have moved since the last scan.", "error");
        updateDock();
      });
      nodes.art?.addEventListener("error", () => {
        nodes.art.hidden = true;
      });
      root.document.addEventListener("visibilitychange", () => {
        if (root.document.hidden) {
          flushListening({ keepalive: true });
          savePlayback(true);
        }
      });
      root.addEventListener("pagehide", () => {
        flushListening({ keepalive: true });
        savePlayback(true);
      });
      root.addEventListener("cc:tabchange", event => {
        if (event.detail?.name === "music") renderContent();
      });
      root.addEventListener("cc:ambientaudiochange", syncAmbientControls);
      syncAmbientControls();
      setupMediaSession();
    }

    bind();
    load();

    return Object.freeze({
      getAnalyser,
      handleInputAction,
      isPlaying: () => !nodes.audio.paused && !nodes.audio.ended,
      next: () => next(),
      onShow: renderContent,
      pause,
      play,
      previous,
      reload: () => load({ keepView: true }),
    });
  }

  const publicApi = {
    getAnalyser() { return app?.getAnalyser() || null; },
    handleInputAction(action, detail) { return app?.handleInputAction(action, detail) || false; },
    isPlaying() { return app?.isPlaying() || false; },
    next() { return app?.next(); },
    onShow() { return app?.onShow(); },
    pause() { return app?.pause(); },
    play() { return app?.play(); },
    previous() { return app?.previous(); },
    reload() { return app?.reload(); },
  };
  root.CCMusic = Object.freeze(publicApi);

  function init() {
    if (!app) app = createApp();
  }
  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
