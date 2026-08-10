/*
 * Command Center music library.
 * Portions Copyright (c) 2026 sagan246. SPDX-License-Identifier: MIT.
 *
 * DOM contract (all controls are ordinary, controller-friendly elements):
 *   Panel: #cc-music-root, #cc-music-search, #cc-music-content,
 *     #cc-music-status, #cc-music-output, #cc-music-output-status, and
 *     buttons [data-music-view="tracks|albums|artists|stats|settings"].
 *   Persistent dock: #cc-music-player, <audio id="cc-music-audio">,
 *     #cc-music-art, #cc-music-now-title, #cc-music-now-meta,
 *     #cc-music-previous, #cc-music-play, #cc-music-next,
 *     #cc-music-shuffle, #cc-music-repeat, #cc-music-progress,
 *     #cc-music-elapsed, #cc-music-duration, #cc-music-volume,
 *     #cc-music-queue-count, #cc-music-queue-clear, #cc-music-queue,
 *     #cc-music-queue-toggle, #cc-music-player-hide, and
 *     #cc-music-player-show.
 *   Settings controls are rendered into #cc-music-content by this module.
 *
 * Load music-domain.js, music-lyrics.js, and music-remote.js before this file.
 * The audio element can live outside the music tab; playback intentionally
 * continues while another Command Center panel is open.
 */

(function (root) {
  "use strict";

  const Domain = root.CCMusicDomain;
  const Lyrics = root.CCMusicLyrics;
  const Remote = root.CCMusicRemote;
  const MediaUI = root.CCMediaUI;
  const NowPlayingVisualizer = root.CCMusicNowPlayingVisualizer;
  const OrbitBloom = root.MediaPlayerOrbitBloom;
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
  const EXPANDED_GROUP_CONTROL = '.cc-music-group-reveal[aria-expanded="true"]';
  const PLAYER_HIDDEN_STORAGE_KEY = "cc.music.player.hidden.v1";
  const FULLSCREEN_VISUALIZER_SCENE_KEY = "fullscreenVisualizerScene";
  const FULLSCREEN_VISUALIZER_GLOW_KEY = "fullscreenVisualizerCenterGlowEnabled";

  let app = null;

  function expandedGroupForBack(content, activeElement) {
    if (!content || typeof content.querySelector !== "function") return null;
    const activeGroup = activeElement && typeof activeElement.closest === "function"
      ? activeElement.closest(".cc-music-group.is-expanded")
      : null;
    if (activeGroup && typeof content.contains === "function" && content.contains(activeGroup)) {
      const activeControl = activeGroup.querySelector(EXPANDED_GROUP_CONTROL);
      if (activeControl) return activeControl;
    }
    return content.querySelector(EXPANDED_GROUP_CONTROL);
  }

  function dockVisibility(hasTrack, playerHidden) {
    return Object.freeze({
      playerHidden: !hasTrack || Boolean(playerHidden),
      restoreHidden: !hasTrack || !playerHidden,
    });
  }

  function readPlayerHiddenPreference(host) {
    try { return host?.localStorage?.getItem(PLAYER_HIDDEN_STORAGE_KEY) === "1"; }
    catch { return false; }
  }

  function writePlayerHiddenPreference(host, hidden) {
    try { host?.localStorage?.setItem(PLAYER_HIDDEN_STORAGE_KEY, hidden ? "1" : "0"); }
    catch {}
  }

  function readLocalPreference(host, key, fallback = "") {
    try { return host?.localStorage?.getItem(key) ?? fallback; }
    catch { return fallback; }
  }

  function writeLocalPreference(host, key, value) {
    try { host?.localStorage?.setItem(key, String(value)); }
    catch {}
  }

  function isRenderedControl(node, host) {
    if (!node || node.isConnected === false || node.disabled || node.inert) return false;
    const getAttribute = name => {
      try { return node.getAttribute?.(name); }
      catch { return null; }
    };
    if (getAttribute("aria-disabled") === "true") return false;

    let current = node;
    while (current) {
      if (current.hidden || current.inert) return false;
      try {
        if (current.getAttribute?.("aria-hidden") === "true") return false;
      } catch {}
      let style = null;
      try { style = host?.getComputedStyle?.(current) || null; }
      catch {}
      if (style && (
        style.display === "none"
        || style.visibility === "hidden"
        || style.visibility === "collapse"
        || style.contentVisibility === "hidden"
      )) return false;
      current = current.parentElement || null;
    }

    try {
      if (typeof node.getClientRects === "function" && node.getClientRects().length === 0) return false;
    } catch {
      return false;
    }
    return true;
  }

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

  function iconButton(name, label, className, action, fallback = label) {
    const node = button("", className, action);
    setControlIcon(node, name, label, fallback);
    return node;
  }

  function setControlIcon(node, name, label, fallback = label) {
    if (MediaUI?.setButtonIcon) MediaUI.setButtonIcon(node, name, label, { fallback });
    else if (node) {
      node.textContent = fallback;
      node.setAttribute("aria-label", label);
      node.title = label;
    }
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
    if (!Domain || !Remote || !root.document) return null;
    const nodes = {
      root: byId("cc-music-root"),
      search: byId("cc-music-search"),
      sort: byId("cc-music-sort"),
      content: byId("cc-music-content"),
      status: byId("cc-music-status"),
      libraryQueue: byId("cc-music-library-queue"),
      libraryQueueCount: byId("cc-music-library-queue-count"),
      playShown: byId("cc-music-play-shown"),
      shuffleShown: byId("cc-music-shuffle-shown"),
      output: byId("cc-music-output"),
      outputStatus: byId("cc-music-output-status"),
      outputWrap: byId("cc-music-output")?.closest(".cc-music-output-wrap"),
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
      queueBody: byId("cc-music-queue-body"),
      queueSummary: byId("cc-music-queue-summary"),
      queueClose: byId("cc-music-queue-close"),
      queueToggle: byId("cc-music-queue-toggle"),
      playerHide: byId("cc-music-player-hide"),
      playerShow: byId("cc-music-player-show"),
      playerOpen: byId("cc-music-player-open"),
      nowPlaying: byId("cc-music-now-playing"),
      nowPlayingClose: byId("cc-music-now-playing-close"),
      nowPlayingArt: byId("cc-music-now-playing-art"),
      nowPlayingArtFallback: byId("cc-music-now-playing-art-fallback"),
      nowPlayingTitle: byId("cc-music-now-playing-title"),
      nowPlayingMeta: byId("cc-music-now-playing-meta"),
      nowPlayingVisualizer: byId("cc-music-now-playing-visualizer"),
      nowPlayingScene: byId("cc-music-now-playing-scene"),
      nowPlayingSceneName: byId("cc-music-now-playing-scene-name"),
      nowPlayingGlow: byId("cc-music-now-playing-glow"),
      nowPlayingProgress: byId("cc-music-now-playing-progress"),
      nowPlayingElapsed: byId("cc-music-now-playing-elapsed"),
      nowPlayingDuration: byId("cc-music-now-playing-duration"),
      nowPlayingQueue: byId("cc-music-now-playing-queue"),
      nowPlayingQueueCount: byId("cc-music-now-playing-queue-count"),
      nowPlayingPrevious: byId("cc-music-now-playing-previous"),
      nowPlayingPlay: byId("cc-music-now-playing-play"),
      nowPlayingNext: byId("cc-music-now-playing-next"),
      nowPlayingFullscreen: byId("cc-music-now-playing-fullscreen"),
      nowPlayingVolume: byId("cc-music-now-playing-volume"),
      nowPlayingStory: byId("cc-music-now-playing-story"),
      nowPlayingLineBefore: byId("cc-music-now-playing-line-before"),
      nowPlayingLineLead: byId("cc-music-now-playing-line-lead"),
      nowPlayingLineCurrent: byId("cc-music-now-playing-line-current"),
      nowPlayingLineNext: byId("cc-music-now-playing-line-next"),
      nowPlayingLineAfter: byId("cc-music-now-playing-line-after"),
    };
    if (!nodes.root || !nodes.content || !nodes.audio) return null;

    const storyLineSlots = Object.freeze([
      Object.freeze({ nodeKey: "nowPlayingLineBefore", tag: "span", spatialKey: "music-lyric:before" }),
      Object.freeze({ nodeKey: "nowPlayingLineLead", tag: "span", spatialKey: "music-lyric:lead" }),
      Object.freeze({ nodeKey: "nowPlayingLineCurrent", tag: "strong", spatialKey: "music-lyric:current" }),
      Object.freeze({ nodeKey: "nowPlayingLineNext", tag: "span", spatialKey: "music-lyric:next" }),
      Object.freeze({ nodeKey: "nowPlayingLineAfter", tag: "span", spatialKey: "music-lyric:after" }),
    ]);

    const state = {
      view: "albums",
      sort: "newest",
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
      playerHidden: readPlayerHiddenPreference(root),
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
      remote: Remote.normalizePlaybackState({}),
      rendererError: "",
      sharedCommandUnsubscribe: null,
      lyricCache: new Map(),
      lyrics: {
        trackId: null,
        requestToken: 0,
        mode: "metadata",
        cues: [],
        plainText: "",
        loading: false,
      },
    };
    let remoteBridge = null;
    let nowPlayingFrame = 0;
    let nowPlayingReturnFocus = null;
    let queueReturnFocus = null;
    let modalInertState = null;
    let nowPlayingFrequencyData = null;
    let nowPlayingWaveformData = null;
    const classicVisualizer = NowPlayingVisualizer?.create?.({
      canvas: nodes.nowPlayingVisualizer,
      host: root,
      storage: root.localStorage,
      styleSource: nodes.root,
    }) || null;
    let fullscreenVisualizer = null;

    function currentTrack() {
      return state.queueIndex >= 0 ? state.trackById.get(state.queue[state.queueIndex]) || null : null;
    }

    function usingRemoteOutput() {
      return Boolean(remoteBridge?.isRemoteTarget());
    }

    function playbackIsPlaying() {
      return usingRemoteOutput() ? state.remote.playing : !nodes.audio.paused && !nodes.audio.ended;
    }

    function playbackPosition() {
      return usingRemoteOutput()
        ? Remote.projectedPosition(state.remote)
        : Number(nodes.audio.currentTime) || 0;
    }

    function playbackDuration() {
      if (usingRemoteOutput()) return state.remote.duration || currentTrack()?.duration || 0;
      return Number.isFinite(nodes.audio.duration) ? nodes.audio.duration : currentTrack()?.duration || 0;
    }

    function playbackVolume() {
      return usingRemoteOutput() ? state.remote.volume : nodes.audio.volume;
    }

    function getPlaybackState() {
      const track = currentTrack();
      const targetId = remoteBridge?.getTarget() || Remote.OUTPUT_DEVICE;
      return Object.freeze({
        source: "music",
        kind: "music",
        active: Boolean(track),
        itemId: track?.id || "",
        title: track?.title || "Nothing playing",
        subtitle: track ? `${track.artist} · ${track.album}` : "Choose a track from Music",
        artwork: artUrl(track),
        playing: Boolean(track && playbackIsPlaying()),
        position: track ? playbackPosition() : 0,
        duration: track ? playbackDuration() : 0,
        volume: playbackVolume(),
        target: {
          id: targetId,
          label: targetId === Remote.OUTPUT_COMPUTER ? "Command Center PC" : "This device",
          online: targetId === Remote.OUTPUT_COMPUTER ? Boolean(state.remote.rendererOnline) : true,
        },
        capabilities: {
          playPause: Boolean(track),
          previous: Boolean(track),
          next: Boolean(track),
          seek: Boolean(track),
          volume: true,
        },
      });
    }

    function publishPlayback() {
      const detail = getPlaybackState();
      if (typeof root.CustomEvent === "function") {
        root.dispatchEvent?.(new root.CustomEvent("cc:musicplaybackchange", { detail }));
      }
      root.CCMediaSession?.publish?.(root, detail);
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

    function updateOutputStatus() {
      const target = remoteBridge?.getTarget() || Remote.OUTPUT_DEVICE;
      if (nodes.output && nodes.output.value !== target) nodes.output.value = target;
      if (!nodes.outputStatus || !nodes.outputWrap) return;
      let text = "Sound plays on this device.";
      let kind = "device";
      if (remoteBridge?.isRenderer()) {
        if (!remoteBridge.isRendererConnected()) {
          text = "PC player reconnecting - phone control is not ready yet.";
          kind = "offline";
        } else if (state.rendererError === "interaction_required") {
          text = "Press Play once here before starting audio from the phone.";
          kind = "blocked";
        } else if (state.rendererError) {
          text = "PC playback needs attention in this window.";
          kind = "blocked";
        } else {
          text = "This window is the Command Center PC player.";
          kind = "online";
        }
      } else if (usingRemoteOutput()) {
        if (!state.remote.rendererOnline) {
          text = "PC offline - open the desktop Command Center window.";
          kind = "offline";
        } else if (state.remote.error === "interaction_required") {
          text = "PC needs one local Play press before remote audio can start.";
          kind = "blocked";
        } else if (state.remote.error) {
          text = "PC playback needs attention in the desktop window.";
          kind = "blocked";
        } else {
          text = "PC online - controls and sound are routed there.";
          kind = "online";
        }
      } else if (state.remote.rendererOnline) {
        text = "Sound plays here; the Command Center PC is available.";
      }
      if (nodes.outputStatus.textContent !== text) nodes.outputStatus.textContent = text;
      if (nodes.outputWrap.dataset.state !== kind) nodes.outputWrap.dataset.state = kind;
    }

    function knownQueueState(values, requestedIndex) {
      return Remote.filterQueueState(values, requestedIndex, id => state.trackById.has(id));
    }

    function applyRemoteSnapshot(snapshot) {
      state.remote = snapshot || Remote.normalizePlaybackState({});
      updateOutputStatus();
      if (!usingRemoteOutput()) return;
      const known = knownQueueState(state.remote.queue, state.remote.index);
      const nextQueue = known.queue;
      const nextIndex = known.index;
      const queueChanged = nextIndex !== state.queueIndex
        || nextQueue.length !== state.queue.length
        || nextQueue.some((id, index) => id !== state.queue[index]);
      state.queue = nextQueue;
      state.queueIndex = nextIndex;
      state.repeat = state.remote.repeat;
      state.shuffle = state.remote.shuffle;
      if (queueChanged) renderQueue();
      updateDock();
    }

    async function sendRemote(action, values = {}) {
      try {
        const response = await remoteBridge.command(action, values);
        return response;
      } catch (error) {
        setStatus(error.message || "The Command Center PC could not be controlled.", "error");
        remoteBridge.refresh().catch(() => {});
        throw error;
      }
    }

    function sendRemoteLoad({ autoplay = false, position = 0 } = {}) {
      const bounded = Remote.boundQueueState(state.queue, state.queueIndex);
      return sendRemote("load", {
        queue: bounded.queue,
        index: bounded.index,
        autoplay: Boolean(autoplay),
        position: Math.max(0, Number(position) || 0),
        repeat: state.repeat,
        shuffle: state.shuffle,
      });
    }

    function clearPhoneMediaSession() {
      if (!("mediaSession" in root.navigator)) return;
      try {
        root.navigator.mediaSession.metadata = null;
        root.navigator.mediaSession.playbackState = "none";
      } catch {}
    }

    function suspendLocalOutput() {
      flushListening();
      savePlayback(true, { forceLocal: true });
      nodes.audio.pause();
      nodes.audio.removeAttribute("src");
      nodes.audio.load();
      resetListening(null);
      clearPhoneMediaSession();
    }

    function handleTargetChange(target, previous) {
      if (target === Remote.OUTPUT_COMPUTER) {
        if (previous === Remote.OUTPUT_DEVICE) suspendLocalOutput();
        applyRemoteSnapshot(state.remote);
        setStatus("Playback controls now target the Command Center PC.", "success");
      } else {
        state.queue = [];
        state.queueIndex = -1;
        restorePlayback();
        renderQueue();
        updateDock();
        if (previous === Remote.OUTPUT_COMPUTER) setStatus("Playback controls now target this device.", "success");
      }
      updateOutputStatus();
    }

    async function chooseOutputTarget(value) {
      const target = value === Remote.OUTPUT_COMPUTER ? Remote.OUTPUT_COMPUTER : Remote.OUTPUT_DEVICE;
      const previous = remoteBridge.getTarget();
      if (target === previous) return;
      if (previous === Remote.OUTPUT_COMPUTER && target === Remote.OUTPUT_DEVICE) {
        if (nodes.output) nodes.output.disabled = true;
        try {
          await remoteBridge.pauseAndUseDevice();
        } catch {
          // An offline PC cannot be paused, but it must not trap this browser
          // on the remote target.
        } finally {
          if (nodes.output) nodes.output.disabled = remoteBridge.isRenderer();
        }
        return;
      }
      remoteBridge.setTarget(target);
    }

    function captureRendererState() {
      const bounded = Remote.boundQueueState(state.queue, state.queueIndex);
      return {
        queue: bounded.queue,
        index: bounded.index,
        playing: !nodes.audio.paused && !nodes.audio.ended,
        position: Number(nodes.audio.currentTime) || 0,
        duration: Number.isFinite(nodes.audio.duration) ? nodes.audio.duration : currentTrack()?.duration || 0,
        volume: nodes.audio.volume,
        repeat: state.repeat,
        shuffle: state.shuffle,
        error: state.rendererError,
      };
    }

    async function applyRendererCommand(command) {
      const values = command?.args && typeof command.args === "object" ? command.args : command || {};
      const action = String(command?.action || "").toLowerCase();
      if (action === "load") {
        const known = knownQueueState(values.queue, values.index ?? values.queue_index ?? 0);
        const queue = known.queue;
        const selectedIndex = known.index;
        if (known.sourceLength && selectedIndex < 0) {
          throw new Error("The PC music library is out of date. Rescan it before remote playback.");
        }
        const previousId = currentTrack()?.id || null;
        state.queue = queue;
        state.queueIndex = selectedIndex;
        if (["off", "all", "one"].includes(values.repeat)) state.repeat = values.repeat;
        state.shuffle = values.shuffle === true;
        const nextId = currentTrack()?.id || null;
        if (!nextId) {
          stopPlayback();
        } else if (nextId !== previousId || !nodes.audio.src) {
          selectCurrent({ autoplay: false, resumeAt: Number(values.position) || 0 });
        } else if (Number.isFinite(Number(values.position))) {
          nodes.audio.currentTime = Math.max(0, Number(values.position));
        }
        if (values.autoplay === true) {
          await play();
          state.rendererError = "";
        }
        else pause();
        renderQueue();
        updateDock();
        return;
      }
      if (action === "play") {
        await play();
        state.rendererError = "";
        return;
      }
      if (action === "pause") return pause();
      if (action === "next") return next();
      if (action === "previous") return previous();
      if (action === "stop") {
        state.rendererError = "";
        return clearQueue();
      }
      if (action === "seek") {
        const position = Math.max(0, Number(values.position) || 0);
        if (Number.isFinite(nodes.audio.duration)) nodes.audio.currentTime = Math.min(position, nodes.audio.duration);
        state.listen.lastTime = nodes.audio.currentTime;
        updateProgress();
        return;
      }
      if (action === "volume") {
        const volume = Number(values.volume);
        if (!Number.isFinite(volume)) throw new Error("Remote volume is invalid.");
        nodes.audio.volume = Math.max(0, Math.min(1, volume));
        updateDock();
        return;
      }
      if (action === "repeat" && ["off", "all", "one"].includes(values.mode)) {
        state.repeat = values.mode;
        updateDock();
        savePlayback(true);
        return;
      }
      if (action === "shuffle") {
        if (state.shuffle !== (values.enabled === true)) toggleShuffle();
        return;
      }
      throw new Error(`Unsupported PC playback command: ${action || "unknown"}`);
    }

    function updateNav() {
      const viewPresentation = {
        tracks: ["music", "Tracks"],
        albums: ["albums", "Albums"],
        artists: ["artists", "Artists"],
        stats: ["stats", "Listening stats"],
        settings: ["settings", "Music settings"],
      };
      nodes.root.querySelectorAll("[data-music-view]").forEach(control => {
        const active = control.dataset.musicView === state.view;
        const presentation = viewPresentation[control.dataset.musicView] || ["music", "Music"];
        setControlIcon(control, presentation[0], presentation[1], presentation[1]);
        control.classList.toggle("is-active", active);
        control.classList.toggle("active", active);
        control.setAttribute("aria-pressed", active ? "true" : "false");
      });
      if (nodes.search) {
        const searchRegion = nodes.search.closest(".cc-music-search-wrap") || nodes.search;
        searchRegion.hidden = state.view === "stats" || state.view === "settings";
      }
      if (nodes.sort) {
        nodes.sort.value = state.sort;
        nodes.sort.closest(".cc-music-sort-wrap").hidden = state.view !== "albums";
      }
    }

    function filteredTracks() {
      return Domain.searchTracks(state.tracks, state.query).sort(Domain.compareTracks);
    }

    function releaseYear(group) {
      const years = (group?.tracks || [])
        .map(track => String(track.date || track.year || "").match(/\b(19|20)\d{2}\b/)?.[0])
        .map(value => Number(value) || 0);
      return Math.max(0, ...years);
    }

    function sortAlbumGroups(groups) {
      const result = [...groups];
      if (state.sort === "title") return result;
      const direction = state.sort === "oldest" ? 1 : -1;
      return result.sort((left, right) => {
        const dated = (releaseYear(left) - releaseYear(right)) * direction;
        return dated || String(left.label).localeCompare(String(right.label), undefined, { numeric: true, sensitivity: "base" });
      });
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
      if (usingRemoteOutput()) {
        sendRemoteLoad({
          autoplay: state.remote.playing,
          position: Remote.projectedPosition(state.remote),
        }).catch(() => {});
      }
      setStatus(`${ids.length} track${ids.length === 1 ? "" : "s"} added to the queue.`, "success");
    }

    function playShownMusic({ shuffle = false } = {}) {
      const tracks = filteredTracks();
      if (!tracks.length) return;
      if (!shuffle) {
        playTrack(tracks[0].id, tracks);
        return;
      }
      state.shuffle = true;
      state.queue = Domain.shuffleIds(tracks.map(opaqueTrackId));
      state.queueIndex = state.queue.length ? 0 : -1;
      selectCurrent({ autoplay: true });
    }

    function playShuffledTracks(tracks) {
      const ids = (Array.isArray(tracks) ? tracks : [])
        .map(opaqueTrackId)
        .filter(id => state.trackById.has(id));
      if (!ids.length) return;
      state.shuffle = true;
      state.queue = Domain.shuffleIds(ids);
      state.queueIndex = 0;
      selectCurrent({ autoplay: true });
    }

    function trackRow(track, context) {
      const row = element("article", "cc-music-track");
      row.dataset.trackId = String(track.id);

      const main = button("", "cc-music-track-main", () => playTrack(track.id, context));
      main.dataset.spatialKey = `music-track:${opaqueTrackId(track)}`;
      main.setAttribute("aria-label", `Play ${track.title} by ${track.artist}`);

      const artwork = element("span", "cc-music-track-artwork");
      const fallback = element("span", "cc-music-track-art-fallback");
      fallback.setAttribute("aria-hidden", "true");
      const note = MediaUI?.createIcon?.("music", { document: root.document });
      if (note) fallback.append(note);
      else fallback.textContent = "\u266b";
      artwork.append(fallback, trackArtwork(track));

      const copy = element("span", "cc-music-track-copy");
      const titleLine = element("span", "cc-music-track-title-line");
      const contextIndex = Math.max(0, (Array.isArray(context) ? context : []).indexOf(track));
      const trackNumber = String(track.track_number || track.track || contextIndex + 1).split("/")[0];
      titleLine.append(
        element("span", "cc-music-track-number", trackNumber),
        element("strong", "cc-music-track-title", track.title),
      );
      copy.append(titleLine);
      copy.append(element("span", "cc-music-track-meta", `${track.artist} · ${track.album}`));
      const duration = element("span", "cc-music-track-duration", Domain.formatTime(track.duration));
      const cue = element("span", "cc-music-track-cue");
      const playIcon = MediaUI?.createIcon?.("play", { document: root.document });
      if (playIcon) cue.append(playIcon);
      cue.setAttribute("aria-hidden", "true");
      main.append(artwork, copy, duration, cue);

      const actions = element("div", "cc-music-track-actions");
      const nextButton = iconButton(
        "playNext",
        `Play ${track.title} next`,
        "cc-music-secondary",
        () => queueTracks([track], { next: true }),
        "Play next",
      );
      nextButton.dataset.spatialKey = `music-track-next:${opaqueTrackId(track)}`;
      const addButton = iconButton(
        "add",
        `Add ${track.title} to queue`,
        "cc-music-secondary",
        () => queueTracks([track]),
        "Add",
      );
      addButton.dataset.spatialKey = `music-track-add:${opaqueTrackId(track)}`;
      actions.append(nextButton, addButton);
      row.append(main, actions);
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
      const year = releaseYear(group);
      const subtitle = type === "album"
        ? `${group.artist} · ${group.tracks.length} track${group.tracks.length === 1 ? "" : "s"}${year ? ` · ${year}` : ""}`
        : `${group.tracks.length} track${group.tracks.length === 1 ? "" : "s"}`;
      copy.append(element("p", "", subtitle));

      const actions = element("div", "cc-music-group-actions");
      if (type === "album") actions.dataset.controllerNav = "off";
      const playButton = iconButton(
        "play",
        `Play ${type} ${group.label}`,
        "cc-music-primary",
        () => playTrack(group.tracks[0].id, group.tracks),
        "Play",
      );
      const shuffleButton = iconButton(
        "shuffle",
        `Shuffle ${type} ${group.label}`,
        "cc-music-secondary cc-music-group-shuffle",
        () => playShuffledTracks(group.tracks),
        "Shuffle",
      );
      const addButton = iconButton(
        "add",
        `Add ${type} ${group.label} to queue`,
        "cc-music-secondary",
        () => queueTracks(group.tracks),
        type === "album" ? "Add" : "Add all",
      );
      actions.append(playButton, shuffleButton, addButton);

      let albumQueueButton = null;
      let detailsButton = null;
      let detailsPanel = null;
      if (type === "album") {
        albumQueueButton = iconButton(
          "queue",
          `Open queue, ${state.queue.length} tracks`,
          "cc-music-secondary cc-music-album-queue-button",
          null,
          "Queue",
        );
        albumQueueButton.setAttribute("aria-expanded", "false");
        albumQueueButton.setAttribute("aria-controls", "cc-music-queue");
        albumQueueButton.append(element("span", "cc-music-album-queue-count", String(state.queue.length)));

        const safeTrackId = String(opaqueTrackId(group.tracks[0]) || "album").replace(/[^a-zA-Z0-9_-]/g, "");
        const detailsId = `cc-music-album-details-${safeTrackId}`;
        detailsButton = iconButton(
          "details",
          `Release details for ${group.label}`,
          "cc-music-secondary cc-music-album-details-toggle",
          null,
          "Details",
        );
        detailsButton.setAttribute("aria-expanded", "false");
        detailsButton.setAttribute("aria-controls", detailsId);

        detailsPanel = element("dl", "cc-music-album-details");
        detailsPanel.id = detailsId;
        detailsPanel.hidden = true;
        const formats = [...new Set(group.tracks.map(track => String(track.format || "").toUpperCase()).filter(Boolean))];
        const byteSize = group.tracks.reduce((total, track) => total + (Number(track.byte_size) || 0), 0);
        [
          ["Artist", group.artist],
          ["Year", year || "Unknown"],
          ["Tracks", String(group.tracks.length)],
          ["Audio", formats.join(", ") || "Unknown"],
          ["Library size", byteSize > 0 ? `${(byteSize / 1024 / 1024).toFixed(byteSize >= 100 * 1024 * 1024 ? 0 : 1)} MB` : "Unknown"],
        ].forEach(([term, description]) => {
          const row = element("div", "cc-music-album-detail-row");
          row.append(element("dt", "", term), element("dd", "", description));
          detailsPanel.append(row);
        });
        actions.append(albumQueueButton, detailsButton);
      }

      const reveal = iconButton(
        "chevronDown",
        `Show tracks for ${type} ${group.label}`,
        "cc-music-secondary cc-music-group-reveal",
        null,
        type === "album" ? "Open" : "Show tracks",
      );
      reveal.setAttribute("aria-expanded", "false");
      actions.append(reveal);

      let albumCover = null;
      if (type === "album") {
        albumCover = button("", "cc-music-album-cover");
        albumCover.setAttribute("aria-expanded", "false");
        albumCover.setAttribute("aria-label", `Open album ${group.label} by ${group.artist}`);
        albumCover.dataset.spatialKey = `music-album:${opaqueTrackId(group.tracks[0])}`;
        const artwork = element("span", "cc-music-album-artwork");
        const fallback = element("span", "cc-music-album-art-fallback", "\u266b");
        fallback.setAttribute("aria-hidden", "true");
        artwork.append(fallback);
        const artworkTrack = Domain.albumArtworkTrack(group);
        if (artworkTrack) artwork.append(trackArtwork(artworkTrack, "cc-music-album-art"));
        albumCover.append(artwork);
        header.append(albumCover, copy, actions);
      } else {
        header.append(copy, actions);
      }

      const list = element("div", "cc-music-group-tracks");
      list.hidden = true;
      group.tracks.forEach(track => list.append(trackRow(track, group.tracks)));

      function setExpanded(opening, trigger) {
        if (opening) {
          nodes.content.querySelectorAll(".cc-music-group.is-expanded").forEach(openCard => {
            if (openCard === card) return;
            openCard.querySelector(EXPANDED_GROUP_CONTROL)?.click();
          });
        }
        list.hidden = !opening;
        card.classList.toggle("is-expanded", opening);
        nodes.root.classList.toggle("has-album-focus", type === "album" && opening);
        if (type === "album") {
          if (opening) delete actions.dataset.controllerNav;
          else actions.dataset.controllerNav = "off";
        }
        if (!opening && detailsPanel && detailsButton) {
          detailsPanel.hidden = true;
          detailsButton.setAttribute("aria-expanded", "false");
        }
        setControlIcon(
          reveal,
          opening && type === "album" ? "chevronLeft" : (opening ? "chevronUp" : "chevronDown"),
          `${opening ? "Hide" : "Show"} tracks for ${type} ${group.label}`,
          type === "album" ? (opening ? "Close" : "Open") : (opening ? "Hide tracks" : "Show tracks"),
        );
        reveal.setAttribute("aria-expanded", opening ? "true" : "false");
        if (albumCover) {
          albumCover.setAttribute("aria-expanded", opening ? "true" : "false");
          albumCover.setAttribute("aria-label", `${opening ? "Close" : "Open"} album ${group.label} by ${group.artist}`);
        }
        if (opening && trigger) {
          card.querySelectorAll("[data-group-return-focus]").forEach(control => {
            delete control.dataset.groupReturnFocus;
          });
          trigger.dataset.groupReturnFocus = "true";
          const alignExpandedAlbum = () => card.scrollIntoView?.({ block: "start", behavior: "auto" });
          if (root.requestAnimationFrame) root.requestAnimationFrame(alignExpandedAlbum);
          else alignExpandedAlbum();
        }
      }

      reveal.addEventListener("click", () => setExpanded(list.hidden, reveal));
      albumCover?.addEventListener("click", () => setExpanded(list.hidden, albumCover));
      albumQueueButton?.addEventListener("click", () => setQueueOpen(true, albumQueueButton));
      detailsButton?.addEventListener("click", () => {
        if (list.hidden) setExpanded(true, detailsButton);
        const opening = Boolean(detailsPanel?.hidden);
        if (detailsPanel) detailsPanel.hidden = !opening;
        detailsButton.setAttribute("aria-expanded", opening ? "true" : "false");
      });
      card.append(header);
      if (detailsPanel) card.append(detailsPanel);
      card.append(list);
      return card;
    }

    function renderGroups(type) {
      const source = filteredTracks();
      const groups = type === "album" ? sortAlbumGroups(Domain.groupAlbums(source)) : Domain.groupArtists(source);
      if (!groups.length) return emptyState("No matches", "Try a different search.", "Clear search", clearSearch);
      const list = element("div", `cc-music-group-list${type === "album" ? " cc-music-album-grid" : ""}`);
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
            : "You can browse and play this library here. Folder selection and rescanning are available only on the computer running Command Center.",
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
      nodes.root.classList.remove("has-album-focus");
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
      syncLibraryHighlights();
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

    function syncDockVisibility(track = currentTrack()) {
      const visibility = dockVisibility(Boolean(track), state.playerHidden);
      const queueOpen = Boolean(nodes.queue && !nodes.queue.hidden);
      if (nodes.player) nodes.player.hidden = queueOpen ? false : visibility.playerHidden;
      if (nodes.playerShow) nodes.playerShow.hidden = queueOpen ? true : visibility.restoreHidden;
    }

    function setPlayerHidden(hidden) {
      state.playerHidden = Boolean(hidden);
      if (state.playerHidden && nodes.queue && !nodes.queue.hidden) {
        nodes.queue.hidden = true;
        queueControls().forEach(control => {
          control?.setAttribute("aria-expanded", "false");
        });
        queueReturnFocus = null;
      }
      writePlayerHiddenPreference(root, state.playerHidden);
      updateDock();
      const focusCandidates = state.playerHidden
        ? [nodes.playerShow]
        : [nodes.playerOpen, nodes.play, nodes.previous, nodes.next];
      const focusTarget = focusCandidates.find(canRestoreFocus);
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    }

    function syncLibraryHighlights(track = currentTrack()) {
      const currentId = opaqueTrackId(track);
      nodes.content.querySelectorAll(".cc-music-track").forEach(row => {
        const active = currentId !== null && opaqueTrackId(row.dataset.trackId) === currentId;
        row.classList.toggle("is-current", active);
        const main = row.querySelector(".cc-music-track-main");
        if (active) main?.setAttribute("aria-current", "true");
        else main?.removeAttribute("aria-current");
      });
      nodes.content.querySelectorAll(".cc-music-group").forEach(group => {
        group.classList.toggle("is-current", Boolean(group.querySelector(".cc-music-track.is-current")));
      });
    }

    function queueControls() {
      return [
        nodes.queueToggle,
        nodes.libraryQueue,
        nodes.nowPlayingQueue,
        ...nodes.content.querySelectorAll(".cc-music-album-queue-button"),
      ].filter(Boolean);
    }

    function canRestoreFocus(node) {
      return isRenderedControl(node, root);
    }

    function setQueueOpen(opening, returnTarget = null) {
      if (!nodes.queue) return;
      if (opening) queueReturnFocus = returnTarget || root.document.activeElement;
      nodes.queue.hidden = !opening;
      syncDockVisibility();
      queueControls().forEach(control => {
        control?.setAttribute("aria-expanded", opening ? "true" : "false");
      });
      if (nowPlayingIsOpen()) applyModalInert();
      if (opening) focusQueueItem();
      else {
        const focusTarget = returnTarget
          || queueReturnFocus
          || (nowPlayingIsOpen() ? nodes.nowPlayingQueue : null)
          || nodes.queueToggle
          || nodes.libraryQueue;
        queueReturnFocus = null;
        if (canRestoreFocus(focusTarget)) focusTarget.focus?.({ preventScroll: true });
      }
    }

    function nowPlayingIsOpen() {
      return Boolean(nodes.nowPlaying && !nodes.nowPlaying.hidden);
    }

    function queueIsOpen() {
      return Boolean(nodes.queue && !nodes.queue.hidden);
    }

    function applyModalInert() {
      const container = nodes.nowPlaying?.parentElement;
      if (!container || !nowPlayingIsOpen()) return;
      if (!modalInertState) {
        modalInertState = new Map([...container.children].map(child => [child, Boolean(child.inert)]));
      }
      modalInertState.forEach((_wasInert, child) => {
        const isDialog = child === nodes.nowPlaying || child.contains?.(nodes.nowPlaying);
        const ownsQueue = queueIsOpen() && (child === nodes.player || child.contains?.(nodes.queue));
        child.inert = !isDialog && !ownsQueue;
      });
    }

    function restoreModalInert() {
      modalInertState?.forEach((wasInert, child) => {
        if (child?.isConnected) child.inert = wasInert;
      });
      modalInertState = null;
    }

    function modalFocusableElements() {
      const scope = queueIsOpen() ? nodes.queue : nodes.nowPlaying;
      if (!scope) return [];
      return [...scope.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter(canRestoreFocus);
    }

    function handleModalKeydown(event) {
      if (!nowPlayingIsOpen()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (queueIsOpen()) setQueueOpen(false);
        else closeNowPlaying();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = modalFocusableElements();
      if (!controls.length) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      const active = root.document.activeElement;
      if (!controls.includes(active)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    }

    function visualizerFocusActive() {
      return Boolean(nodes.nowPlaying?.classList.contains("is-visualizer-focus"));
    }

    function fullscreenVisualizerScenes() {
      return Array.isArray(OrbitBloom?.SCENE_OPTIONS) ? OrbitBloom.SCENE_OPTIONS : [];
    }

    function syncFullscreenVisualizerScene(sceneValue = "", selectionValue = "") {
      const label = typeof sceneValue === "string"
        ? sceneValue
        : String(sceneValue?.label || sceneValue?.name || "");
      const selection = String(
        selectionValue
        || fullscreenVisualizer?.sceneSelection?.()
        || OrbitBloom?.AUTO_SCENE
        || "auto",
      );
      if (nodes.nowPlayingScene) {
        nodes.nowPlayingScene.value = selection;
        nodes.nowPlayingScene.title = selection === "auto"
          ? `Random - ${label || "visualizer"}`
          : label || "Visualizer";
      }
      if (nodes.nowPlayingSceneName) nodes.nowPlayingSceneName.textContent = label || "Cosmic Bloom";
    }

    function syncFullscreenVisualizerGlow() {
      if (!nodes.nowPlayingGlow) return;
      const enabled = fullscreenVisualizer?.sharedGlowEnabled?.() === true;
      const label = enabled ? "Hide center glow" : "Show center glow";
      nodes.nowPlayingGlow.setAttribute("aria-pressed", String(enabled));
      setControlIcon(nodes.nowPlayingGlow, "glow", label, "Glow");
    }

    function setupNowPlayingVisualizer() {
      if (!fullscreenVisualizer && typeof OrbitBloom?.create === "function") {
        try {
          fullscreenVisualizer = OrbitBloom.create({
            canvas: nodes.nowPlayingVisualizer,
            initialScene: readLocalPreference(root, FULLSCREEN_VISUALIZER_SCENE_KEY, OrbitBloom.AUTO_SCENE || "auto"),
            initialSharedGlow: readLocalPreference(root, FULLSCREEN_VISUALIZER_GLOW_KEY, "false") === "true",
            onSceneChange: syncFullscreenVisualizerScene,
          });
        } catch (error) {
          root.console?.warn?.("[music] full-screen visualizer unavailable", error);
        }
      }
      if (nodes.nowPlayingScene) {
        const existing = new Set(Array.from(nodes.nowPlayingScene.options).map(option => option.value));
        fullscreenVisualizerScenes().forEach(scene => {
          if (existing.has(scene.id)) return;
          const option = root.document.createElement("option");
          option.value = scene.id;
          option.textContent = scene.label;
          nodes.nowPlayingScene.append(option);
        });
      }
      const selection = fullscreenVisualizer?.sceneSelection?.()
        || OrbitBloom?.AUTO_SCENE
        || "auto";
      const current = fullscreenVisualizer?.currentScene?.()
        || fullscreenVisualizerScenes().find(scene => scene.id === selection)?.label
        || "Cosmic Bloom";
      syncFullscreenVisualizerScene(current, selection);
      syncFullscreenVisualizerGlow();
      classicVisualizer?.syncCanvasLabel?.();
    }

    function applyFullscreenVisualizerScene(requested) {
      if (!fullscreenVisualizer) return "auto";
      const available = new Set(["auto", ...fullscreenVisualizerScenes().map(scene => scene.id)]);
      const safeValue = available.has(String(requested || "")) ? String(requested) : "auto";
      const selection = fullscreenVisualizer.setScene?.(safeValue) || "auto";
      writeLocalPreference(root, FULLSCREEN_VISUALIZER_SCENE_KEY, selection);
      syncFullscreenVisualizerScene(fullscreenVisualizer.currentScene?.(), selection);
      if (!playbackIsPlaying()) fullscreenVisualizer.pause?.();
      requestNowPlayingVisualizerFrame();
      return selection;
    }

    function toggleFullscreenVisualizerGlow() {
      if (!fullscreenVisualizer) return false;
      const enabled = fullscreenVisualizer.setSharedGlow?.(
        fullscreenVisualizer.sharedGlowEnabled?.() !== true,
      ) === true;
      writeLocalPreference(root, FULLSCREEN_VISUALIZER_GLOW_KEY, enabled ? "true" : "false");
      syncFullscreenVisualizerGlow();
      requestNowPlayingVisualizerFrame();
      return enabled;
    }

    function setVisualizerFocus(focused, { update = true } = {}) {
      const active = Boolean(focused && nodes.nowPlaying);
      nodes.nowPlaying?.classList.toggle("is-visualizer-focus", active);
      nodes.nowPlayingFullscreen?.setAttribute("aria-pressed", String(active));
      if (active) {
        fullscreenVisualizer?.setArtwork?.(artUrl(currentTrack()));
        fullscreenVisualizer?.open?.();
      } else {
        fullscreenVisualizer?.close?.();
      }
      if (update) updateNowPlayingSurface(currentTrack(), playbackIsPlaying());
      requestNowPlayingVisualizerFrame();
      return active;
    }

    function cycleClassicVisualizer() {
      if (visualizerFocusActive() || !classicVisualizer) return false;
      const mode = classicVisualizer.cycle();
      const label = NowPlayingVisualizer?.MODE_LABELS?.[mode] || mode;
      nodes.nowPlayingVisualizer?.setAttribute("aria-label", `Visualizer: ${label}. Activate to switch`);
      requestNowPlayingVisualizerFrame();
      return true;
    }

    function visualizerSamples(now) {
      const analyser = state.analyser;
      if (analyser) {
        if (!nowPlayingFrequencyData || nowPlayingFrequencyData.length !== analyser.frequencyBinCount) {
          nowPlayingFrequencyData = new Uint8Array(analyser.frequencyBinCount);
        }
        if (!nowPlayingWaveformData || nowPlayingWaveformData.length !== analyser.fftSize) {
          nowPlayingWaveformData = new Uint8Array(analyser.fftSize);
        }
        analyser.getByteFrequencyData(nowPlayingFrequencyData);
        analyser.getByteTimeDomainData(nowPlayingWaveformData);
        return { frequencyData: nowPlayingFrequencyData, waveformData: nowPlayingWaveformData };
      }
      const frequencyData = NowPlayingVisualizer?.syntheticFrequencyData?.(now, 64)
        || new Uint8Array(64).fill(48);
      const waveformData = new Uint8Array(128);
      for (let index = 0; index < waveformData.length; index += 1) {
        waveformData[index] = Math.round(128 + Math.sin(index * 0.23 + now / 420) * 18);
      }
      return { frequencyData, waveformData };
    }

    function clearNowPlayingVisualizer() {
      const canvas = nodes.nowPlayingVisualizer;
      const context = canvas?.getContext?.("2d");
      context?.clearRect?.(0, 0, canvas.width || 0, canvas.height || 0);
    }

    function drawFallbackVisualizer(frequencyData, now) {
      const canvas = nodes.nowPlayingVisualizer;
      const context = canvas?.getContext?.("2d");
      if (!context) return;
      const pixelRatio = Math.max(1, Math.min(2, Number(root.devicePixelRatio) || 1));
      const width = Math.max(1, Math.round((canvas.clientWidth || 560) * pixelRatio));
      const height = Math.max(1, Math.round((canvas.clientHeight || 96) * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.clearRect(0, 0, width, height);
      const bars = 32;
      const gap = Math.max(2, Math.round(width / 190));
      const barWidth = Math.max(2, (width - gap * (bars - 1)) / bars);
      const accent = root.getComputedStyle?.(nodes.root)?.getPropertyValue("--accent")?.trim() || "#7c3aed";
      const gradient = context.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, accent);
      gradient.addColorStop(1, "#f8fafc");
      context.fillStyle = gradient;
      for (let index = 0; index < bars; index += 1) {
        const sourceIndex = Math.floor(index / bars * frequencyData.length * 0.42);
        const idle = 0.16 + Math.abs(Math.sin(index * 0.68 + now / 620)) * 0.22;
        const level = Math.max(0.08, (frequencyData[sourceIndex] || idle * 255) / 255);
        const barHeight = Math.max(3 * pixelRatio, level * height * 0.88);
        context.fillRect(index * (barWidth + gap), height - barHeight, barWidth, barHeight);
      }
    }

    function requestNowPlayingVisualizerFrame() {
      if (nowPlayingFrame || !nowPlayingIsOpen() || !nodes.nowPlayingVisualizer) return;
      if (typeof root.requestAnimationFrame !== "function") {
        drawNowPlayingVisualizer();
        return;
      }
      nowPlayingFrame = root.requestAnimationFrame(() => {
        nowPlayingFrame = 0;
        drawNowPlayingVisualizer();
      });
    }

    function drawNowPlayingVisualizer() {
      if (!nowPlayingIsOpen() || !nodes.nowPlayingVisualizer) return;
      const focused = visualizerFocusActive();
      const playing = playbackIsPlaying();
      if (!playing) {
        if (focused && fullscreenVisualizer) fullscreenVisualizer.pause?.();
        else clearNowPlayingVisualizer();
        return;
      }
      const now = root.performance?.now?.() ?? Date.now();
      const samples = visualizerSamples(now);
      if (focused && fullscreenVisualizer) {
        fullscreenVisualizer.render?.({ ...samples, now });
      } else if (classicVisualizer) {
        classicVisualizer.render?.({ frequencyData: samples.frequencyData, now });
      } else {
        drawFallbackVisualizer(samples.frequencyData, now);
      }
      const reducedMotion = root.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (!reducedMotion && typeof root.requestAnimationFrame === "function") {
        requestNowPlayingVisualizerFrame();
      }
    }

    function openNowPlaying() {
      if (!nodes.nowPlaying || !currentTrack()) return;
      if (queueIsOpen()) setQueueOpen(false, null);
      nowPlayingReturnFocus = root.document.activeElement;
      nodes.nowPlaying.hidden = false;
      nodes.nowPlaying.setAttribute("aria-hidden", "false");
      root.document.body?.classList.add("cc-music-now-playing-open");
      applyModalInert();
      updateDock();
      requestNowPlayingVisualizerFrame();
      nodes.nowPlayingClose?.focus({ preventScroll: true });
    }

    function closeNowPlaying({ restoreFocus = true } = {}) {
      if (!nodes.nowPlaying) return;
      if (queueIsOpen()) setQueueOpen(false, null);
      nodes.nowPlaying.hidden = true;
      nodes.nowPlaying.setAttribute("aria-hidden", "true");
      nodes.nowPlaying.classList.remove("is-visualizer-focus");
      nodes.nowPlayingFullscreen?.setAttribute("aria-pressed", "false");
      fullscreenVisualizer?.close?.();
      root.document.body?.classList.remove("cc-music-now-playing-open");
      if (nowPlayingFrame) root.cancelAnimationFrame?.(nowPlayingFrame);
      nowPlayingFrame = 0;
      restoreModalInert();
      if (restoreFocus) (nowPlayingReturnFocus || nodes.playerOpen)?.focus?.({ preventScroll: true });
      nowPlayingReturnFocus = null;
    }

    function nowPlayingStoryNodes() {
      return storyLineSlots.map(slot => nodes[slot.nodeKey]).filter(Boolean);
    }

    function storyLineCopy(line) {
      if (!line || String(line.tagName || "").toLowerCase() !== "button") return line;
      return line.querySelector?.("[data-music-lyric-copy]") || line;
    }

    function setStoryLineText(line, text) {
      const copy = storyLineCopy(line);
      if (copy) copy.textContent = text == null ? "" : String(text);
    }

    function toggleStoryLineClass(line, className, enabled) {
      line?.classList.toggle(className, enabled);
      const copy = storyLineCopy(line);
      if (copy && copy !== line) copy.classList.toggle(className, enabled);
    }

    function seekFromLyricLine(event) {
      const position = Number(event.currentTarget?.dataset.lyricTime);
      if (!Number.isFinite(position)) return;
      if (usingRemoteOutput()) sendRemoteSeek(position);
      else {
        nodes.audio.currentTime = position;
        state.listen.lastTime = position;
        updateProgress();
        savePlayback(true);
      }
    }

    function setStoryLineInteractive(slot, interactive) {
      const current = nodes[slot.nodeKey];
      if (!current) return null;
      const isButton = String(current.tagName || "").toLowerCase() === "button";
      if (isButton === Boolean(interactive)) return current;

      const replacement = element(interactive ? "button" : slot.tag, interactive ? "cc-music-now-playing-line-button" : "");
      replacement.id = current.id;
      replacement.hidden = current.hidden;
      const text = storyLineCopy(current)?.textContent || "";
      if (interactive) {
        replacement.type = "button";
        replacement.dataset.spatialKey = slot.spatialKey;
        Object.assign(replacement.style, {
          appearance: "none",
          display: "block",
          width: "100%",
          margin: "0",
          padding: "0",
          border: "0",
          borderRadius: "4px",
          background: "transparent",
          boxShadow: "none",
          color: "inherit",
          font: "inherit",
          textAlign: "inherit",
        });
        const copy = element(slot.tag, "", text);
        copy.dataset.musicLyricCopy = "";
        replacement.append(copy);
        replacement.addEventListener("click", seekFromLyricLine);
      } else {
        replacement.textContent = text;
      }
      current.replaceWith(replacement);
      nodes[slot.nodeKey] = replacement;
      return replacement;
    }

    function resetStoryNodes({ preserveControls = false } = {}) {
      storyLineSlots.forEach(slot => {
        const line = preserveControls
          ? nodes[slot.nodeKey]
          : setStoryLineInteractive(slot, false);
        if (!line) return;
        line.hidden = false;
        [line, storyLineCopy(line)].filter(Boolean).forEach(target => {
          target.classList.remove("is-active", "is-blank", "is-clickable");
        });
        line.removeAttribute("aria-current");
        line.removeAttribute("aria-label");
        delete line.dataset.lyricIndex;
        delete line.dataset.lyricTime;
      });
    }

    function renderMetadataStory(track) {
      resetStoryNodes();
      if (nodes.nowPlayingStory) nodes.nowPlayingStory.dataset.mode = "metadata";
      setStoryLineText(nodes.nowPlayingLineBefore, track?.album || "Your local library");
      setStoryLineText(nodes.nowPlayingLineLead, track?.artist || "Ready when you are");
      setStoryLineText(nodes.nowPlayingLineCurrent, track?.title || "Nothing playing");
      const details = [track?.date, track?.genre].filter(Boolean).join(" · ");
      setStoryLineText(nodes.nowPlayingLineNext, details || "Choose something to listen to");
      const quality = [track?.format, track?.bitrate_kbps ? `${track.bitrate_kbps} kbps` : ""].filter(Boolean).join(" · ");
      setStoryLineText(nodes.nowPlayingLineAfter, quality || "Music stays on this computer");
    }

    function renderLoadingLyrics() {
      resetStoryNodes();
      if (nodes.nowPlayingStory) nodes.nowPlayingStory.dataset.mode = "loading";
      nowPlayingStoryNodes().forEach(line => { setStoryLineText(line, ""); });
      setStoryLineText(nodes.nowPlayingLineCurrent, "Loading lyrics…");
    }

    function renderPlainLyrics(text) {
      resetStoryNodes();
      if (nodes.nowPlayingStory) nodes.nowPlayingStory.dataset.mode = "plain";
      nowPlayingStoryNodes().forEach(line => { line.hidden = line !== nodes.nowPlayingLineCurrent; });
      setStoryLineText(nodes.nowPlayingLineCurrent, text || "No lyrics found.");
    }

    function renderSyncedLyrics() {
      if (!Lyrics || state.lyrics.mode !== "lrc") return;
      resetStoryNodes({ preserveControls: true });
      if (nodes.nowPlayingStory) nodes.nowPlayingStory.dataset.mode = "synced";
      const activeIndex = Lyrics.activeLrcIndex(state.lyrics.cues, playbackPosition());
      const slots = Lyrics.lyricWindow(state.lyrics.cues, activeIndex, 2);
      storyLineSlots.forEach((lineSlot, slotIndex) => {
        const slot = slots[slotIndex];
        const interactive = Number.isFinite(slot?.time);
        const line = setStoryLineInteractive(lineSlot, interactive);
        if (!line) return;
        const active = activeIndex >= 0 && slot?.index === activeIndex;
        setStoryLineText(line, slot?.lyric || "");
        toggleStoryLineClass(line, "is-active", active && !slot.blank);
        toggleStoryLineClass(line, "is-blank", Boolean(slot?.blank));
        toggleStoryLineClass(line, "is-clickable", interactive);
        if (active) line.setAttribute("aria-current", "true");
        if (slot?.index != null) line.dataset.lyricIndex = String(slot.index);
        if (interactive) {
          line.dataset.lyricTime = String(slot.time);
          const lyric = slot?.lyric ? `: ${slot.lyric}` : "";
          line.setAttribute("aria-label", `Seek to ${Domain.formatTime(slot.time)}${lyric}`);
        }
      });
    }

    function renderNowPlayingStory(track) {
      if (!track || state.lyrics.trackId !== track.id || state.lyrics.mode === "metadata") {
        renderMetadataStory(track);
      } else if (state.lyrics.loading) {
        renderLoadingLyrics();
      } else if (state.lyrics.mode === "lrc") {
        renderSyncedLyrics();
      } else if (state.lyrics.mode === "plain") {
        renderPlainLyrics(state.lyrics.plainText);
      } else {
        renderMetadataStory(track);
      }
    }

    function safeLyricsUrl(track) {
      const value = String(track?.lyrics_url || "");
      return /^\/api\/music\/lyrics\/[a-zA-Z0-9._~-]+$/.test(value) ? value : "";
    }

    function invalidateLyricCache() {
      state.lyricCache.clear();
      state.lyrics = {
        trackId: null,
        requestToken: state.lyrics.requestToken + 1,
        mode: "metadata",
        cues: [],
        plainText: "",
        loading: false,
      };
    }

    async function ensureNowPlayingLyrics(track) {
      if (!track || !nowPlayingIsOpen()) return;
      const url = safeLyricsUrl(track);
      if (!Lyrics || !track.has_lyrics || !url) {
        if (state.lyrics.trackId !== track.id || state.lyrics.mode !== "metadata") {
          state.lyrics = {
            trackId: track.id,
            requestToken: state.lyrics.requestToken + 1,
            mode: "metadata",
            cues: [],
            plainText: "",
            loading: false,
          };
        }
        renderMetadataStory(track);
        return;
      }

      if (state.lyrics.trackId === track.id && (state.lyrics.loading || state.lyrics.mode !== "metadata")) {
        renderNowPlayingStory(track);
        return;
      }
      const cached = state.lyricCache.get(track.id);
      if (cached) {
        state.lyrics = {
          trackId: track.id,
          requestToken: state.lyrics.requestToken + 1,
          loading: false,
          ...cached,
        };
        renderNowPlayingStory(track);
        return;
      }

      const requestToken = state.lyrics.requestToken + 1;
      state.lyrics = {
        trackId: track.id,
        requestToken,
        mode: "loading",
        cues: [],
        plainText: "",
        loading: true,
      };
      renderLoadingLyrics();
      try {
        const payload = await request(url);
        const text = String(payload?.lyrics || "");
        const requestedFormat = String(payload?.format || track.lyrics_format || "").toLowerCase();
        const cues = requestedFormat === "lrc" || Lyrics.looksLikeLrc(text) ? Lyrics.parseLrc(text) : [];
        const plainText = Lyrics.plainLyricsLines(text).join("\n");
        const result = cues.length
          ? { mode: "lrc", cues, plainText: "" }
          : plainText
            ? { mode: "plain", cues: [], plainText }
            : { mode: "metadata", cues: [], plainText: "" };
        if (state.lyrics.requestToken !== requestToken || state.lyrics.trackId !== track.id) return;
        state.lyricCache.set(track.id, result);
        state.lyrics = { trackId: track.id, requestToken, loading: false, ...result };
        renderNowPlayingStory(currentTrack());
      } catch {
        if (state.lyrics.requestToken !== requestToken || state.lyrics.trackId !== track.id) return;
        const unavailable = { mode: "metadata", cues: [], plainText: "" };
        state.lyricCache.set(track.id, unavailable);
        state.lyrics = {
          trackId: track.id,
          requestToken,
          loading: false,
          ...unavailable,
        };
        renderMetadataStory(currentTrack());
      }
    }

    function updateNowPlayingSurface(track, playing) {
      const source = artUrl(track);
      if (nodes.nowPlayingArt) {
        if (source) {
          nodes.nowPlayingArt.src = source;
          nodes.nowPlayingArt.hidden = false;
        } else {
          nodes.nowPlayingArt.removeAttribute("src");
          nodes.nowPlayingArt.hidden = true;
        }
      }
      if (nodes.nowPlayingArtFallback) nodes.nowPlayingArtFallback.hidden = Boolean(source);
      if (nodes.nowPlayingTitle) nodes.nowPlayingTitle.textContent = track?.title || "Nothing playing";
      if (nodes.nowPlayingMeta) nodes.nowPlayingMeta.textContent = track?.album || "Choose a track, album, or artist.";
      renderNowPlayingStory(track);
      fullscreenVisualizer?.setArtwork?.(source);

      setControlIcon(nodes.nowPlayingPrevious, "previous", "Previous track", "Previous");
      setControlIcon(nodes.nowPlayingPlay, playing ? "pause" : "play", playing ? "Pause music" : "Play music", playing ? "Pause" : "Play");
      setControlIcon(nodes.nowPlayingNext, "next", "Next track", "Next");
      setControlIcon(nodes.nowPlayingQueue, "queue", `Queue, ${state.queue.length} tracks`, "Queue");
      const visualizerFocused = visualizerFocusActive();
      setControlIcon(
        nodes.nowPlayingFullscreen,
        visualizerFocused ? "fullscreenExit" : "fullscreen",
        visualizerFocused ? "Return to Now Playing" : "Full-screen visualizer",
        visualizerFocused ? "Return" : "Visualizer",
      );
      if (nodes.nowPlayingQueueCount) nodes.nowPlayingQueue?.append(nodes.nowPlayingQueueCount);
      nodes.nowPlayingPlay?.setAttribute("aria-pressed", playing ? "true" : "false");
      if (nodes.nowPlayingPlay) nodes.nowPlayingPlay.disabled = !track;
      if (nodes.nowPlayingPrevious) nodes.nowPlayingPrevious.disabled = !track;
      if (nodes.nowPlayingNext) nodes.nowPlayingNext.disabled = !track;
      if (nodes.nowPlayingVolume && root.document.activeElement !== nodes.nowPlayingVolume) {
        nodes.nowPlayingVolume.value = String(playbackVolume());
      }
      if (track && nowPlayingIsOpen()) ensureNowPlayingLyrics(track);
    }

    function updateDock() {
      const track = currentTrack();
      const playing = playbackIsPlaying();
      if (!track && nowPlayingIsOpen()) closeNowPlaying({ restoreFocus: false });
      syncDockVisibility(track);
      syncLibraryHighlights(track);
      if (nodes.player) nodes.player.classList.toggle("is-empty", !track);
      if (nodes.nowTitle) nodes.nowTitle.textContent = track ? track.title : "Nothing playing";
      if (nodes.nowMeta) nodes.nowMeta.textContent = track ? track.artist : "Choose a track from Music";
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
        setControlIcon(nodes.play, playing ? "pause" : "play", playing ? "Pause music" : "Play music", playing ? "Pause" : "Play");
        nodes.play.setAttribute("aria-pressed", playing ? "true" : "false");
        nodes.play.disabled = !track;
      }
      if (nodes.previous) {
        setControlIcon(nodes.previous, "previous", "Previous track", "Previous");
        nodes.previous.disabled = !track;
      }
      if (nodes.next) {
        setControlIcon(nodes.next, "next", "Next track", "Next");
        nodes.next.disabled = !track;
      }
      if (nodes.shuffle) {
        setControlIcon(nodes.shuffle, "shuffle", state.shuffle ? "Turn shuffle off" : "Turn shuffle on", "Shuffle");
        nodes.shuffle.setAttribute("aria-pressed", state.shuffle ? "true" : "false");
      }
      if (nodes.repeat) {
        setControlIcon(nodes.repeat, "repeat", `Repeat ${state.repeat}`, "Repeat");
        nodes.repeat.dataset.repeat = state.repeat;
        nodes.repeat.setAttribute("aria-pressed", state.repeat === "off" ? "false" : "true");
      }
      if (nodes.queueToggle) {
        setControlIcon(nodes.queueToggle, "queue", `Queue, ${state.queue.length} tracks`, "Queue");
        if (nodes.queueCount) nodes.queueToggle.append(nodes.queueCount);
      }
      setControlIcon(nodes.libraryQueue, "queue", `Queue, ${state.queue.length} tracks`, "Queue");
      if (nodes.libraryQueueCount) nodes.libraryQueue?.append(nodes.libraryQueueCount);
      setControlIcon(nodes.playShown, "play", "Play shown music", "Play");
      setControlIcon(nodes.shuffleShown, "shuffle", "Shuffle shown music", "Shuffle");
      setControlIcon(nodes.queueClear, "trash", "Clear queue", "Clear");
      setControlIcon(nodes.queueClose, "close", "Close queue", "Close");
      setControlIcon(nodes.playerHide, "close", "Hide music player", "Hide");
      setControlIcon(nodes.nowPlayingClose, "chevronDown", "Collapse Now Playing", "Close");
      if (nodes.playShown) nodes.playShown.disabled = !filteredTracks().length;
      if (nodes.shuffleShown) nodes.shuffleShown.disabled = !filteredTracks().length;
      if (nodes.volume && root.document.activeElement !== nodes.volume) nodes.volume.value = String(playbackVolume());
      updateNowPlayingSurface(track, playing);
      updateProgress();
      if (nowPlayingIsOpen()) requestNowPlayingVisualizerFrame();
    }

    function updateProgress() {
      const duration = playbackDuration();
      const current = playbackPosition();
      if (nodes.progress && root.document.activeElement !== nodes.progress) {
        const progressValue = duration > 0 ? String(Math.round(current / duration * 1000)) : "0";
        nodes.progress.value = progressValue;
        nodes.progress.setAttribute("aria-valuetext", `${Domain.formatTime(current)} of ${Domain.formatTime(duration)}`);
        if (nodes.nowPlayingProgress && root.document.activeElement !== nodes.nowPlayingProgress) {
          nodes.nowPlayingProgress.value = progressValue;
          nodes.nowPlayingProgress.setAttribute("aria-valuetext", `${Domain.formatTime(current)} of ${Domain.formatTime(duration)}`);
        }
      }
      if (nodes.elapsed) nodes.elapsed.textContent = Domain.formatTime(current);
      if (nodes.duration) nodes.duration.textContent = Domain.formatTime(duration);
      if (nodes.nowPlayingElapsed) nodes.nowPlayingElapsed.textContent = Domain.formatTime(current);
      if (nodes.nowPlayingDuration) {
        const remaining = Math.max(0, duration - current);
        nodes.nowPlayingDuration.textContent = duration ? `-${Domain.formatTime(remaining)}` : "0:00";
      }
      if (nowPlayingIsOpen() && state.lyrics.mode === "lrc") renderSyncedLyrics();
      publishPlayback();
    }

    function renderQueue() {
      if (nodes.queueCount) nodes.queueCount.textContent = String(state.queue.length);
      if (nodes.libraryQueueCount) nodes.libraryQueueCount.textContent = String(state.queue.length);
      if (nodes.nowPlayingQueueCount) nodes.nowPlayingQueueCount.textContent = String(state.queue.length);
      nodes.content.querySelectorAll(".cc-music-album-queue-count").forEach(count => {
        count.textContent = String(state.queue.length);
        const control = count.closest("button");
        setControlIcon(control, "queue", `Open queue, ${state.queue.length} tracks`, "Queue");
        control?.append(count);
      });
      if (nodes.queueSummary) nodes.queueSummary.textContent = `${state.queue.length} track${state.queue.length === 1 ? "" : "s"}`;
      if (nodes.queueClear) nodes.queueClear.disabled = !state.queue.length;
      const queueHost = nodes.queueBody || nodes.queue;
      if (!queueHost) return;
      if (!state.queue.length) {
        replace(queueHost, element("p", "cc-music-muted", "The queue is empty."));
        return;
      }
      const list = element("ol", "cc-music-queue-list");
      state.queue.forEach((id, index) => {
        const track = state.trackById.get(id);
        if (!track) return;
        const item = element("li", "cc-music-queue-item");
        item.dataset.queueIndex = String(index);
        if (index === state.queueIndex) item.classList.add("is-current");
        const playButton = button("", "cc-music-queue-play", () => {
          state.queueIndex = index;
          selectCurrent({ autoplay: true });
        });
        playButton.dataset.spatialKey = `music-queue:${index}:${opaqueTrackId(track)}`;
        playButton.setAttribute("aria-label", `Play ${track.title}`);
        if (index === state.queueIndex) playButton.setAttribute("aria-current", "true");
        const copy = element("span", "cc-music-queue-copy");
        copy.append(
          element("strong", "", track.title),
          element("span", "", track.artist),
          element(
            "small",
            "cc-music-queue-position",
            index === state.queueIndex ? "Now playing" : index > state.queueIndex ? "Up next" : "Played",
          ),
        );
        playButton.append(trackArtwork(track, "cc-music-queue-art"), copy);
        const remove = iconButton(
          "close",
          `Remove ${track.title} from queue`,
          "cc-music-queue-remove",
          () => removeFromQueue(index),
          "Remove",
        );
        remove.dataset.spatialKey = `music-queue-remove:${index}:${opaqueTrackId(track)}`;
        item.append(playButton, remove);
        list.append(item);
      });
      replace(queueHost, list);
    }

    function focusQueueItem(index = state.queueIndex) {
      if (!nodes.queue || nodes.queue.hidden || !["gamepad", "keyboard"].includes(root.document.body?.dataset.inputMode)) return;
      const bounded = Math.max(0, Math.min(Number(index) || 0, state.queue.length - 1));
      const schedule = root.requestAnimationFrame || (callback => root.setTimeout(callback, 0));
      schedule(() => {
        const target = nodes.queue.querySelector(`[data-queue-index="${bounded}"] .cc-music-queue-play`)
          || nodes.queue.querySelector(".cc-music-queue-play")
          || nodes.queueClose;
        target?.focus({ preventScroll: true });
        target?.scrollIntoView?.({ block: "nearest" });
      });
    }

    function removeFromQueue(index) {
      const restoreFocus = Boolean(nodes.queue?.contains(root.document.activeElement));
      const before = currentTrack();
      const result = Domain.removeQueueItem(state.queue, state.queueIndex, index);
      state.queue = result.queue;
      state.queueIndex = state.queue.length ? result.index : -1;
      if (usingRemoteOutput()) {
        if (!state.queue.length) sendRemote("stop").catch(() => {});
        else sendRemoteLoad({
          autoplay: state.remote.playing,
          position: before?.id === currentTrack()?.id ? Remote.projectedPosition(state.remote) : 0,
        }).catch(() => {});
        renderQueue();
        updateDock();
        if (restoreFocus && state.queue.length) focusQueueItem(Math.min(index, state.queue.length - 1));
        return;
      }
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
      if (restoreFocus && state.queue.length) focusQueueItem(Math.min(index, state.queue.length - 1));
    }

    function clearQueue() {
      if (usingRemoteOutput()) {
        state.queue = [];
        state.queueIndex = -1;
        sendRemote("stop").catch(() => {});
        renderQueue();
        updateDock();
        return;
      }
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
      if (usingRemoteOutput()) {
        renderQueue();
        updateDock();
        sendRemoteLoad({ autoplay, position: resumeAt }).catch(() => {});
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
      if (autoplay) play().catch(error => {
        if (remoteBridge?.isRenderer()) {
          const blocked = error?.name === "NotAllowedError" || /not allowed|user gesture|interact/i.test(String(error?.message || ""));
          state.rendererError = blocked ? "interaction_required" : "playback_error";
          updateOutputStatus();
        }
        setStatus(error.message || "Playback could not start.", "error");
      });
    }

    async function play() {
      if (!currentTrack()) {
        if (!state.queue.length && state.tracks.length) {
          state.queue = filteredTracks().map(track => track.id);
          state.queueIndex = 0;
          if (usingRemoteOutput()) {
            selectCurrent({ autoplay: true });
            return;
          }
          selectCurrent();
        } else return;
      }
      if (usingRemoteOutput()) {
        await sendRemote("play");
        return;
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
      if (usingRemoteOutput()) {
        sendRemote("pause").catch(() => {});
        return;
      }
      collectListeningTime();
      nodes.audio.pause();
      flushListening();
      savePlayback(true);
      updateDock();
    }

    function previous() {
      if (!currentTrack()) return;
      if (usingRemoteOutput()) {
        sendRemote("previous").catch(() => {});
        return;
      }
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
      if (usingRemoteOutput()) {
        if (!ended) sendRemote("next").catch(() => {});
        return;
      }
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
      if (usingRemoteOutput()) {
        state.shuffle = !state.shuffle;
        updateDock();
        sendRemote("shuffle", { enabled: state.shuffle }).catch(() => {});
        return;
      }
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
      if (usingRemoteOutput()) {
        sendRemote("repeat", { mode: state.repeat }).catch(() => {});
        return;
      }
      savePlayback(true);
    }

    function savePlayback(force = false, { forceLocal = false } = {}) {
      if (usingRemoteOutput() && !forceLocal) return;
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
      if (usingRemoteOutput()) return;
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
      if (!track || usingRemoteOutput() || !("mediaSession" in root.navigator)) return;
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
      const activeCommand = (action, value, fallback) =>
        root.CCMediaSession?.commandActive?.(action, value) || fallback();
      const handlers = {
        play: () => activeCommand("play", undefined, () => play()),
        pause: () => activeCommand("pause", undefined, pause),
        previoustrack: () => activeCommand("previous", undefined, previous),
        nexttrack: () => activeCommand("next", undefined, () => next()),
      };
      Object.entries(handlers).forEach(([name, handler]) => {
        try { root.navigator.mediaSession.setActionHandler(name, handler); } catch {}
      });
    }

    function setupSharedMediaSession() {
      state.sharedCommandUnsubscribe?.();
      state.sharedCommandUnsubscribe = root.CCMediaSession?.onCommand?.(root, "music", command => {
        const action = String(command?.action || "");
        if (action === "play") play().catch(error => setStatus(error.message, "error"));
        if (action === "pause") pause();
        if (action === "previous") previous();
        if (action === "next") next();
        if (action === "seek") {
          const position = Math.max(0, Number(command.value) || 0);
          if (usingRemoteOutput()) sendRemote("seek", { position }).catch(() => {});
          else {
            const duration = Number(nodes.audio.duration);
            nodes.audio.currentTime = Number.isFinite(duration) ? Math.min(position, duration) : position;
            state.listen.lastTime = nodes.audio.currentTime;
            updateProgress();
            savePlayback(true);
          }
        }
        if (action === "volume") {
          const volume = Math.max(0, Math.min(1, Number(command.value) || 0));
          if (usingRemoteOutput()) sendRemote("volume", { volume }).catch(() => {});
          else {
            nodes.audio.volume = volume;
            updateDock();
            savePlayback(true);
          }
        }
      }) || null;
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
        state.analyser.fftSize = 128;
        state.analyser.smoothingTimeConstant = 0.78;
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
        if (!playbackIsPlaying()) play().catch(error => setStatus(error.message, "error"));
        else pause();
        return true;
      }
      if (action !== "back") return false;
      if (nodes.queue && !nodes.queue.hidden) {
        setQueueOpen(false);
        return true;
      }
      if (nowPlayingIsOpen()) {
        closeNowPlaying();
        return true;
      }
      const musicPanel = nodes.root.closest(".tab-panel");
      if (musicPanel && (musicPanel.hidden || root.getComputedStyle?.(musicPanel).display === "none")) return false;
      const activeGroup = root.document?.activeElement?.closest?.(".cc-music-group.is-expanded");
      const expandedDetails = activeGroup?.querySelector('.cc-music-album-details-toggle[aria-expanded="true"]')
        || nodes.content.querySelector('.cc-music-album-details-toggle[aria-expanded="true"]');
      if (expandedDetails) {
        expandedDetails.click();
        expandedDetails.focus();
        return true;
      }
      const expanded = expandedGroupForBack(nodes.content, root.document?.activeElement);
      if (!expanded) return false;
      const returnFocus = expanded.closest(".cc-music-group")
        ?.querySelector('[data-group-return-focus="true"]') || expanded;
      expanded.click();
      returnFocus.focus();
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
        invalidateLyricCache();
        state.folder = settings.folder;
        state.folderName = settings.folderName;
        state.editable = settings.editable;
        state.libraryId = library.libraryId !== "unconfigured" ? library.libraryId : settings.libraryId || "unconfigured";
        state.tracks = library.tracks;
        state.trackById = new Map(state.tracks.map(track => [track.id, track]));
        state.keysById = new Map(state.tracks.map(track => [track.id, Domain.stableTrackKey(track)]));
        state.storageKey = Domain.playbackStorageKey(state.libraryId);
        if (settings.scan) state.scan = scanPayload(settings.scan);
        if (usingRemoteOutput()) applyRemoteSnapshot(state.remote);
        else if (!state.queue.length) restorePlayback();
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
        if (!keepView) state.view = "albums";
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

    remoteBridge = Remote.createBridge({
      host: root,
      storage: root.localStorage,
      request,
      captureRendererState,
      applyRendererCommand,
      onState: applyRemoteSnapshot,
      onTargetChange: handleTargetChange,
      onRendererChange: active => {
        if (nodes.output) {
          const deviceOption = nodes.output.querySelector('option[value="device"]');
          const computerOption = nodes.output.querySelector('option[value="computer"]');
          if (deviceOption) deviceOption.textContent = active ? "This device (Command Center PC)" : "This device";
          if (computerOption) computerOption.disabled = active;
        }
        updateOutputStatus();
      },
      onRendererConnectionChange: updateOutputStatus,
      onRendererError: error => {
        const blocked = error?.name === "NotAllowedError" || /not allowed|user gesture|interact/i.test(String(error?.message || ""));
        state.rendererError = blocked ? "interaction_required" : "playback_error";
        updateOutputStatus();
        setStatus(
          blocked
            ? "PC audio needs one local Play press in Command Center before phone control can start it."
            : error?.message || "The PC player could not apply a remote command.",
          "error",
        );
      },
      onError: (_error, _context) => updateOutputStatus(),
    });
    if (nodes.output) nodes.output.value = remoteBridge.getTarget();
    updateOutputStatus();

    const sendRemoteSeek = Domain.debounce(value => {
      sendRemote("seek", { position: value }).catch(() => {});
    }, 120);
    const sendRemoteVolume = Domain.debounce(value => {
      sendRemote("volume", { volume: value }).catch(() => {});
    }, 120);

    function bind() {
      setupNowPlayingVisualizer();
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
      nodes.sort?.addEventListener("change", () => {
        if (!["newest", "oldest", "title"].includes(nodes.sort.value)) return;
        state.sort = nodes.sort.value;
        renderContent();
      });
      nodes.output?.addEventListener("change", () => chooseOutputTarget(nodes.output.value));
      nodes.playShown?.addEventListener("click", () => playShownMusic());
      nodes.shuffleShown?.addEventListener("click", () => playShownMusic({ shuffle: true }));
      nodes.play?.addEventListener("click", () => !playbackIsPlaying() ? play().catch(error => setStatus(error.message, "error")) : pause());
      nodes.previous?.addEventListener("click", previous);
      nodes.next?.addEventListener("click", () => next());
      nodes.shuffle?.addEventListener("click", toggleShuffle);
      nodes.repeat?.addEventListener("click", toggleRepeat);
      nodes.queueClear?.addEventListener("click", clearQueue);
      nodes.queueToggle?.addEventListener("click", () => setQueueOpen(nodes.queue?.hidden, nodes.queueToggle));
      nodes.libraryQueue?.addEventListener("click", () => setQueueOpen(nodes.queue?.hidden, nodes.libraryQueue));
      nodes.queueClose?.addEventListener("click", () => setQueueOpen(false));
      nodes.playerHide?.addEventListener("click", () => setPlayerHidden(true));
      nodes.playerShow?.addEventListener("click", () => setPlayerHidden(false));
      nodes.playerOpen?.addEventListener("click", openNowPlaying);
      nodes.playerOpen?.addEventListener("keydown", event => {
        if (!["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        openNowPlaying();
      });
      nodes.nowPlayingClose?.addEventListener("click", () => closeNowPlaying());
      nodes.nowPlayingPlay?.addEventListener("click", () => !playbackIsPlaying() ? play().catch(error => setStatus(error.message, "error")) : pause());
      nodes.nowPlayingPrevious?.addEventListener("click", previous);
      nodes.nowPlayingNext?.addEventListener("click", () => next());
      nodes.nowPlayingQueue?.addEventListener("click", () => setQueueOpen(nodes.queue?.hidden, nodes.nowPlayingQueue));
      nodes.nowPlayingFullscreen?.addEventListener("click", () => {
        setVisualizerFocus(!visualizerFocusActive());
      });
      nodes.nowPlayingScene?.addEventListener("change", () => {
        applyFullscreenVisualizerScene(nodes.nowPlayingScene.value);
      });
      nodes.nowPlayingGlow?.addEventListener("click", toggleFullscreenVisualizerGlow);
      nodes.nowPlayingVisualizer?.addEventListener("click", cycleClassicVisualizer);
      nodes.nowPlayingVisualizer?.addEventListener("keydown", event => {
        if (!["Enter", " "].includes(event.key) || visualizerFocusActive()) return;
        event.preventDefault();
        cycleClassicVisualizer();
      });
      const seekFrom = control => {
        if (usingRemoteOutput()) {
          const duration = playbackDuration();
          const position = duration > 0 ? Number(control.value) / 1000 * duration : 0;
          sendRemoteSeek(position);
          return;
        }
        if (!Number.isFinite(nodes.audio.duration)) return;
        nodes.audio.currentTime = Number(control.value) / 1000 * nodes.audio.duration;
        state.listen.lastTime = nodes.audio.currentTime;
        updateProgress();
      };
      nodes.progress?.addEventListener("input", () => seekFrom(nodes.progress));
      nodes.nowPlayingProgress?.addEventListener("input", () => seekFrom(nodes.nowPlayingProgress));

      const setVolumeFrom = control => {
        const volume = Math.max(0, Math.min(1, Number(control.value)));
        if (usingRemoteOutput()) {
          sendRemoteVolume(volume);
          return;
        }
        nodes.audio.volume = volume;
        savePlayback(true);
        updateDock();
      };
      nodes.volume?.addEventListener("input", () => setVolumeFrom(nodes.volume));
      nodes.nowPlayingVolume?.addEventListener("input", () => setVolumeFrom(nodes.nowPlayingVolume));

      nodes.audio.addEventListener("play", () => {
        state.rendererError = "";
        root.CCAudio?.stop?.();
        if (state.audioContext?.state === "suspended") state.audioContext.resume().catch(() => {});
        if ("mediaSession" in root.navigator) root.navigator.mediaSession.playbackState = "playing";
        updateOutputStatus();
        updateDock();
        requestNowPlayingVisualizerFrame();
      });
      nodes.audio.addEventListener("pause", () => {
        if (usingRemoteOutput()) return;
        collectListeningTime();
        if ("mediaSession" in root.navigator) root.navigator.mediaSession.playbackState = "paused";
        updateDock();
        requestNowPlayingVisualizerFrame();
      });
      nodes.audio.addEventListener("ended", () => {
        if (usingRemoteOutput()) return;
        flushListening();
        next({ ended: true });
      });
      nodes.audio.addEventListener("timeupdate", () => {
        if (usingRemoteOutput()) return;
        collectListeningTime();
        updateProgress();
        savePlayback();
      });
      nodes.audio.addEventListener("durationchange", updateProgress);
      nodes.audio.addEventListener("seeking", () => { state.listen.lastTime = null; });
      nodes.audio.addEventListener("seeked", () => { state.listen.lastTime = nodes.audio.currentTime; });
      nodes.audio.addEventListener("error", () => {
        if (nodes.audio.error) {
          if (remoteBridge?.isRenderer()) state.rendererError = "playback_error";
          setStatus("This track could not be played. It may have moved since the last scan.", "error");
          updateOutputStatus();
        }
        updateDock();
      });
      nodes.art?.addEventListener("error", () => {
        nodes.art.hidden = true;
      });
      nodes.nowPlayingArt?.addEventListener("error", () => {
        nodes.nowPlayingArt.hidden = true;
        if (nodes.nowPlayingArtFallback) nodes.nowPlayingArtFallback.hidden = false;
      });
      root.document.addEventListener("keydown", handleModalKeydown);
      root.document.addEventListener("visibilitychange", () => {
        if (root.document.hidden) {
          flushListening({ keepalive: true });
          savePlayback(true);
        }
      });
      root.addEventListener("pagehide", () => {
        closeNowPlaying({ restoreFocus: false });
        flushListening({ keepalive: true });
        savePlayback(true);
        state.sharedCommandUnsubscribe?.();
        remoteBridge.stop();
      });
      root.addEventListener("cc:tabchange", event => {
        if (event.detail?.name === "music") renderContent();
      });
      root.addEventListener("resize", () => {
        if (visualizerFocusActive()) fullscreenVisualizer?.resize?.();
        requestNowPlayingVisualizerFrame();
      });
      root.addEventListener("cc:ambientaudiochange", syncAmbientControls);
      syncAmbientControls();
      setupMediaSession();
      setupSharedMediaSession();
    }

    bind();
    load().finally(() => remoteBridge.start());

    return Object.freeze({
      getAnalyser,
      getPlaybackState,
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
    getPlaybackState() { return app?.getPlaybackState() || null; },
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
  if (typeof module === "object" && module.exports) {
    module.exports = Object.freeze({
      dockVisibility,
      expandedGroupForBack,
      isRenderedControl,
      readPlayerHiddenPreference,
      writePlayerHiddenPreference,
    });
  }

  function init() {
    if (!app) app = createApp();
  }
  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
