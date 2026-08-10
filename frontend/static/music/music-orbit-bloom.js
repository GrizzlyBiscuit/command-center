/*
 * Adapted from Local Media Player Orbit Bloom.
 * Copyright (c) 2026 sagan246. SPDX-License-Identifier: MIT.
 */
// Full-screen Orbit Bloom renderer.
//
// This module owns drawing only. audio-visualizer.js owns the shared Web
// Audio graph and passes frequency and waveform snapshots into render().
(function(){
  "use strict";

  const AUTO_SCENE = "auto";
  const SCENE_DURATION_MS = 25000;
  const TRANSITION_MS = 2200;
  const MANUAL_TRANSITION_MS = 420;
  const SPECTRUM_POINTS = 48;
  const TAU = Math.PI * 2;

  function scene(id, label, background, accent, sheen, glow, flare){
    return Object.freeze({
      id,
      label,
      palette:Object.freeze({
        background:Object.freeze(background),
        accent:Object.freeze(accent),
        sheen:Object.freeze(sheen),
        glow:Object.freeze(glow),
        flare:Object.freeze(flare),
      }),
    });
  }

  // One catalog owns selector metadata and color roles. Renderers are matched
  // to these stable IDs below, so adding a scene cannot shift a parallel array.
  const SCENE_CATALOG = Object.freeze([
    scene("cosmic-bloom", "Cosmic Bloom", [2,5,18], [40,210,255], [218,249,255], [132,76,255], [255,76,153]),
    scene("orbital-tunnel", "Orbital Tunnel", [1,8,20], [20,224,196], [166,255,239], [48,104,255], [255,184,84]),
    scene("double-helix", "Double Helix", [5,3,20], [78,178,255], [222,246,255], [191,66,255], [255,74,122]),
    scene("spirograph", "Spirograph", [7,4,18], [62,216,255], [255,229,176], [157,78,255], [255,88,128]),
    scene("milkdrop-flow", "MilkDrop Flow", [2,3,14], [44,235,255], [232,255,248], [88,72,255], [255,62,190]),
    scene("geiss-waves", "Geiss Waves", [2,7,14], [40,255,190], [226,255,242], [30,124,255], [255,142,64]),
    scene("neon-spectrum", "Neon Spectrum", [2,5,15], [56,224,255], [232,252,255], [80,92,255], [255,78,174]),
    scene("oscilloscope", "Oscilloscope", [1,7,12], [50,255,180], [220,255,246], [22,147,255], [255,176,60]),
    scene("comet-field", "Comet Field", [3,3,16], [94,186,255], [236,248,255], [158,66,255], [255,76,112]),
    scene("spectrum-waterfall", "Spectrum Waterfall", [2,6,16], [44,238,222], [228,255,250], [54,110,255], [255,100,190]),
    scene("liquid-aurora", "Liquid Aurora", [1,7,13], [44,255,194], [200,255,238], [75,94,255], [244,74,255]),
    scene("particle-constellation", "Particle Constellation", [2,4,14], [106,198,255], [238,250,255], [121,73,255], [255,96,155]),
    scene("audio-terrain", "Audio Terrain", [1,8,13], [34,244,193], [210,255,241], [36,116,255], [255,174,70]),
    scene("ink-bloom", "Ink Bloom", [7,2,13], [255,74,173], [255,225,244], [95,70,255], [255,116,63]),
    scene("tunnel-flight", "Tunnel Flight", [1,5,15], [45,224,255], [230,253,255], [73,76,255], [255,71,181]),
    scene("kaleidoscope", "Kaleidoscope", [5,2,14], [63,234,255], [255,240,210], [176,65,255], [255,72,112]),
    scene("deep-space-nebula", "Deep Space Nebula", [1,2,10], [45,122,255], [225,240,255], [118,54,255], [255,68,174]),
    scene("luminous-drift", "Luminous Drift", [1,6,10], [74,255,198], [232,255,220], [72,142,255], [255,196,82]),
    scene("album-warp", "Album Warp", [2,2,8], [62,220,255], [245,248,255], [130,66,255], [255,75,150]),
    scene("game-bloom", "Game Bloom", [2,3,14], [64,222,255], [220,255,252], [112,72,255], [255,104,174]),
  ]);
  const SCENE_OPTIONS = Object.freeze(
    SCENE_CATALOG.map(({id, label})=>Object.freeze({id, label}))
  );
  const SCENES = Object.freeze(SCENE_CATALOG.map(sceneEntry=>sceneEntry.label));
  const VISUAL_PALETTES = Object.freeze(
    SCENE_CATALOG.map(sceneEntry=>sceneEntry.palette)
  );
  // Random is deliberately curated. Less-favored experiments remain available
  // in the manual selector without diluting the automatic visual journey.
  const AUTO_SCENE_IDS = Object.freeze([
    "cosmic-bloom",
    "double-helix",
    "spirograph",
    "milkdrop-flow",
    "geiss-waves",
    "neon-spectrum",
    "oscilloscope",
    "comet-field",
    "spectrum-waterfall",
    "liquid-aurora",
    "particle-constellation",
    "audio-terrain",
    "kaleidoscope",
    "album-warp",
  ]);
  const AUTO_SCENE_INDEXES = Object.freeze(
    AUTO_SCENE_IDS.map(id=>SCENE_OPTIONS.findIndex(scene=>scene.id===id))
      .filter(index=>index>=0)
  );

  function clamp(value, low=0, high=1){
    return Math.max(low, Math.min(high, value));
  }

  function averageBand(data, startRatio, endRatio){
    if(!data?.length) return 0;
    const start = Math.max(0, Math.floor(data.length * startRatio));
    const end = Math.max(start + 1, Math.min(data.length, Math.ceil(data.length * endRatio)));
    let total = 0;
    for(let index=start; index<end; index++) total += data[index];
    return total / (end - start) / 255;
  }

  function waveformEnergy(data){
    if(!data?.length) return 0;
    let total = 0;
    for(const sample of data){
      const centered = (sample - 128) / 128;
      total += centered * centered;
    }
    return clamp(Math.sqrt(total / data.length));
  }

  function spectralCentroid(data){
    if(!data?.length || data.length === 1) return 0;
    let weighted = 0;
    let total = 0;
    for(let index=0; index<data.length; index++){
      const magnitude = data[index] / 255;
      weighted += magnitude * index;
      total += magnitude;
    }
    return total ? clamp(weighted / total / (data.length - 1)) : 0;
  }

  function normalizeSceneSelection(selection){
    const value = String(selection ?? AUTO_SCENE).trim().toLowerCase();
    if(value === AUTO_SCENE) return AUTO_SCENE;
    const match = SCENE_OPTIONS.find(scene=>
      scene.id === value || scene.label.toLowerCase() === value
    );
    return match?.id || AUTO_SCENE;
  }

  function sceneIndexForSelection(selection){
    const normalized = normalizeSceneSelection(selection);
    if(normalized === AUTO_SCENE) return -1;
    return SCENE_OPTIONS.findIndex(scene=>scene.id === normalized);
  }

  function randomSceneIndex(excludedIndex=-1, random=Math.random){
    const sceneCount = SCENE_OPTIONS.length;
    if(sceneCount <= 1) return 0;
    const excluded = Number.isInteger(excludedIndex)
      && excludedIndex >= 0
      && excludedIndex < sceneCount
      ? excludedIndex
      : -1;
    const randomValue = clamp(Number(random()) || 0, 0, .999999999);
    if(excluded < 0) return Math.floor(randomValue * sceneCount);
    const candidate = Math.floor(randomValue * (sceneCount - 1));
    return candidate >= excluded ? candidate + 1 : candidate;
  }

  function randomAutoSceneIndex(excludedIndex=-1, random=Math.random){
    const candidates=AUTO_SCENE_INDEXES.filter(index=>index!==excludedIndex);
    const pool=candidates.length?candidates:AUTO_SCENE_INDEXES;
    if(!pool.length)return randomSceneIndex(excludedIndex,random);
    const randomValue=clamp(Number(random())||0,0,.999999999);
    return pool[Math.floor(randomValue*pool.length)];
  }

  function autoSceneDurationMs(sceneIndex){
    return SCENE_OPTIONS[sceneIndex]?.id==="particle-constellation"
      ? Math.round(SCENE_DURATION_MS*1.35)
      : SCENE_DURATION_MS;
  }

  function mixRgb(from, to, amount){
    const ratio = clamp(amount);
    return from.map((value, index)=>Math.round(value + (to[index] - value) * ratio));
  }

  function paletteAt(sceneIndex){
    return VISUAL_PALETTES[
      ((sceneIndex % VISUAL_PALETTES.length) + VISUAL_PALETTES.length)
      % VISUAL_PALETTES.length
    ];
  }

  function mixPalette(from, to, amount){
    return {
      background:mixRgb(from.background, to.background, amount),
      accent:mixRgb(from.accent, to.accent, amount),
      sheen:mixRgb(from.sheen, to.sheen, amount),
      glow:mixRgb(from.glow, to.glow, amount),
      flare:mixRgb(from.flare, to.flare, amount),
    };
  }

  function rhythmBands(data){
    return {
      kick:averageBand(data, 0, .17),
      snare:averageBand(data, .17, .58),
      hat:averageBand(data, .58, 1),
    };
  }

  function normalizeLevel(value, floor, peak, minimumRange=.08){
    const range = Math.max(minimumRange, peak - floor);
    return clamp((value - floor) / range);
  }

  function qualityScaleForFrameTime(frameTimeMs){
    if(frameTimeMs > 28) return .58;
    if(frameTimeMs > 22) return .74;
    if(frameTimeMs > 18.5) return .88;
    return 1;
  }

  function seededUnit(index, salt=0){
    const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  function coverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight){
    if(sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0){
      return {sx:0, sy:0, sw:0, sh:0};
    }
    const sourceRatio = sourceWidth / sourceHeight;
    const targetRatio = targetWidth / targetHeight;
    if(sourceRatio > targetRatio){
      const sw = sourceHeight * targetRatio;
      return {sx:(sourceWidth - sw) / 2, sy:0, sw, sh:sourceHeight};
    }
    const sh = sourceWidth / targetRatio;
    return {sx:0, sy:(sourceHeight - sh) / 2, sw:sourceWidth, sh};
  }

  function create({
    canvas,
    initialScene=AUTO_SCENE,
    initialSharedGlow=false,
    onSceneChange=()=>{},
    random=Math.random,
  }={}){
    let context = null;
    let isActive = false;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let currentScene = -1;
    let previousScene = 0;
    let sceneChangedAt = 0;
    let transitionDurationMs = TRANSITION_MS;
    let autoSceneExpiresAt = 0;
    let lastFrameAt = 0;
    let adaptivePeak = .2;
    let adaptiveFloor = .012;
    let frameTimeFollower = 16.67;
    let qualityScale = 1;
    let fastEnergy = 0;
    let slowEnergy = 0;
    let bassFollower = 0;
    let beatPulse = 0;
    let lastBeatAt = 0;
    let rhythmMemory = 0;
    let particles = [];
    let sceneSelection = normalizeSceneSelection(initialScene);
    let spectrumHistory = [];
    let lastSpectrumSnapshotAt = 0;
    let artworkSource = "";
    let artworkImage = null;
    let sharedGlowEnabled = Boolean(initialSharedGlow);
    const smoothSpectrum = new Float32Array(SPECTRUM_POINTS);
    const followers = {sub:0, bass:0, mids:0, highs:0, air:0, energy:0, waveform:0};
    const rhythmFollowers = {
      kickFast:0,
      kickSlow:0,
      snareFast:0,
      snareSlow:0,
      hatFast:0,
      hatSlow:0,
    };
    const rhythmPulses = {kick:0, snare:0, hat:0};
    const lastRhythmAt = {kick:0, snare:0, hat:0};
    const reducedMotion = Boolean(
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    );

    // The visual focus sits above true center so the transport has room below.
    function stageCenterY(){
      return height * (width < height ? .43 : .455);
    }

    function rgba(rgb, alpha){
      return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${clamp(alpha)})`;
    }

    function follow(current, target, attack=.24, release=.075){
      return current + (target - current) * (target > current ? attack : release);
    }

    function updateRhythmPulse(name, value, now, threshold, gateMs){
      const fastKey = `${name}Fast`;
      const slowKey = `${name}Slow`;
      rhythmFollowers[fastKey] = follow(rhythmFollowers[fastKey], value, .48, .19);
      rhythmFollowers[slowKey] = follow(rhythmFollowers[slowKey], value, .065, .035);
      const onset = Math.max(
        0,
        rhythmFollowers[fastKey] - rhythmFollowers[slowKey] * 1.08
      );
      if(onset > threshold && now - lastRhythmAt[name] > gateMs){
        rhythmPulses[name] = Math.max(
          rhythmPulses[name],
          clamp(.22 + (onset - threshold) * 7.5)
        );
        lastRhythmAt[name] = now;
      }
      return onset;
    }

    function ensureParticles(){
      const desired = reducedMotion ? 28 : clamp(Math.round((width * height) / 19000), 54, 118);
      if(particles.length === desired) return;
      particles = Array.from({length:desired}, (_, index)=>({
        angle:seededUnit(index, 1) * TAU,
        radius:.12 + seededUnit(index, 2) * .88,
        depth:.28 + seededUnit(index, 3) * .72,
        size:.55 + seededUnit(index, 4) * 1.65,
        speed:(.025 + seededUnit(index, 5) * .085) * (index % 2 ? 1 : -1),
        shimmer:seededUnit(index, 6) * TAU,
      }));
    }

    function ensureSize(){
      if(!canvas) return false;
      context ||= canvas.getContext("2d");
      if(!context) return false;
      const rect = canvas.getBoundingClientRect();
      if(rect.width < 2 || rect.height < 2) return false;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width * dpr));
      height = Math.max(1, Math.round(rect.height * dpr));
      if(canvas.width !== width || canvas.height !== height){
        canvas.width = width;
        canvas.height = height;
        context.clearRect(0, 0, width, height);
      }
      ensureParticles();
      return true;
    }

    function spectrumAt(data, index){
      const start = Math.pow(index / SPECTRUM_POINTS, 1.72) * .92;
      const end = Math.pow((index + 1) / SPECTRUM_POINTS, 1.72) * .92;
      return averageBand(data, start, end);
    }

    function levels(frequencyData, waveformData, now){
      const raw = {
        sub:averageBand(frequencyData, 0, .055),
        bass:averageBand(frequencyData, .055, .17),
        mids:averageBand(frequencyData, .17, .45),
        highs:averageBand(frequencyData, .45, .76),
        air:averageBand(frequencyData, .76, 1),
        waveform:waveformEnergy(waveformData),
      };
      const rawEnergy = clamp(
        raw.sub * .24
        + raw.bass * .31
        + raw.mids * .27
        + raw.highs * .13
        + raw.air * .05
      );
      const frameDelta = lastFrameAt && now - lastFrameAt < 120
        ? clamp(now - lastFrameAt, 4, 50)
        : 16.67;
      frameTimeFollower = follow(frameTimeFollower, frameDelta, .075, .025);
      const qualityTarget = reducedMotion
        ? .72
        : qualityScaleForFrameTime(frameTimeFollower);
      qualityScale += (qualityTarget - qualityScale) * (
        qualityTarget < qualityScale ? .045 : .012
      );

      // Track the usable dynamic range instead of assuming every master has
      // the same loudness. The floor rises very slowly so quiet songs remain
      // expressive, but falls quickly when the recording becomes sparse.
      adaptiveFloor += (rawEnergy - adaptiveFloor) * (
        rawEnergy < adaptiveFloor ? .07 : .0007
      );
      adaptiveFloor = clamp(adaptiveFloor, 0, .14);
      adaptivePeak = Math.max(adaptiveFloor + .1, rawEnergy, adaptivePeak * .9965);
      const normalizedEnergy = normalizeLevel(rawEnergy, adaptiveFloor, adaptivePeak);
      raw.energy = clamp(rawEnergy * .55 + normalizedEnergy * .45);

      for(const key of Object.keys(followers)){
        followers[key] = follow(
          followers[key],
          raw[key],
          key === "sub" || key === "bass" ? .31 : .23,
          key === "energy" ? .055 : .08
        );
      }

      for(let index=0; index<SPECTRUM_POINTS; index++){
        const next = spectrumAt(frequencyData, index);
        smoothSpectrum[index] = follow(smoothSpectrum[index], next, .34, .105);
      }

      fastEnergy = follow(fastEnergy, rawEnergy, .42, .17);
      slowEnergy = follow(slowEnergy, rawEnergy, .055, .035);
      bassFollower = follow(bassFollower, raw.sub * .55 + raw.bass * .45, .18, .08);
      const bands = rhythmBands(frequencyData);
      const normalization = Math.max(.16, adaptivePeak * 1.25);
      const kickLevel = clamp(bands.kick * .62 + bands.kick / normalization * .38);
      const snareLevel = clamp(bands.snare * .58 + bands.snare / normalization * .42);
      const hatLevel = clamp(bands.hat * .52 + bands.hat / normalization * .48);
      updateRhythmPulse("kick", kickLevel, now, .024, 145);
      updateRhythmPulse("snare", snareLevel, now, .018, 105);
      updateRhythmPulse("hat", hatLevel, now, .012, 64);
      const transient = Math.max(
        0,
        fastEnergy - slowEnergy * 1.11,
        raw.sub * .62 + raw.bass * .38 - bassFollower
      );
      if(transient > .032 && now - lastBeatAt > 165){
        beatPulse = Math.max(beatPulse, clamp(.3 + transient * 7.2));
        lastBeatAt = now;
      }
      const frameScale = Math.max(1, frameDelta / 16.67);
      const decay = Math.pow(.88, frameScale);
      beatPulse *= decay;
      rhythmPulses.kick *= Math.pow(.86, frameScale);
      rhythmPulses.snare *= Math.pow(.81, frameScale);
      rhythmPulses.hat *= Math.pow(.72, frameScale);
      rhythmMemory = follow(
        rhythmMemory,
        rhythmPulses.kick * .48 + rhythmPulses.snare * .34 + rhythmPulses.hat * .18,
        .13,
        .018
      );
      lastFrameAt = now;

      return {
        ...followers,
        beat:Math.max(beatPulse, rhythmPulses.kick * .78, rhythmPulses.snare * .32),
        centroid:spectralCentroid(frequencyData),
        kick:rhythmPulses.kick,
        snare:rhythmPulses.snare,
        hat:rhythmPulses.hat,
        memory:rhythmMemory,
        spectrum:smoothSpectrum,
      };
    }

    function rememberSpectrum(now){
      if(now - lastSpectrumSnapshotAt < 52) return;
      lastSpectrumSnapshotAt = now;
      spectrumHistory.unshift(Float32Array.from(smoothSpectrum));
      if(spectrumHistory.length > 34) spectrumHistory.length = 34;
    }

    function backdrop(colors, audio, time){
      context.globalCompositeOperation = "source-over";
      // A partial clear leaves a restrained afterimage instead of hard frame
      // changes. Clearing with true black preserves untouched OLED pixels.
      context.fillStyle = `rgba(0,0,0,${.13 + audio.energy * .08})`;
      context.fillRect(0, 0, width, height);
      if(!sharedGlowEnabled) return;

      const cx = width * (.5 + Math.sin(time * .17) * .012 * audio.mids);
      const cy = stageCenterY() + Math.cos(time * .13) * height * .012 * audio.highs;
      const radius = Math.max(width, height) * .69;
      const pulseColor = mixRgb(
        colors.glow,
        colors.flare,
        clamp(audio.kick * .38 + audio.snare * .72)
      );
      const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(
        0,
        rgba(pulseColor, .07 + audio.energy * .15 + audio.beat * .055 + audio.memory * .035)
      );
      gradient.addColorStop(.3, rgba(colors.accent, .025 + audio.mids * .075));
      gradient.addColorStop(.58, rgba(colors.background, .018 + audio.bass * .025));
      gradient.addColorStop(.78, "rgba(0,0,0,0)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
    }

    function drawAtmosphere(colors, audio, time, intensity=1){
      const cx = width * .5;
      const cy = stageCenterY();
      const span = Math.hypot(width, height) * .48;
      context.save();
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";
      const particleCount = reducedMotion
        ? particles.length
        : Math.max(28, Math.floor(particles.length * qualityScale));
      for(let index=0; index<particleCount; index++){
        const particle = particles[index];
        const motion = reducedMotion
          ? 0
          : time * particle.speed * (1 + audio.highs * .8 + audio.hat * .55);
        const angle = particle.angle + motion;
        const pulse = 1 + Math.sin(time * (.35 + particle.depth * .45) + particle.shimmer) * .018;
        const radius = span * particle.radius * pulse * (
          1 + audio.bass * .035 + audio.kick * .024
        );
        const squash = .72 + particle.depth * .22;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius * squash;
        const shimmer = .42 + .58 * Math.max(0, Math.sin(time * 1.35 + particle.shimmer));
        const alpha = intensity * particle.depth * (
          .025 + audio.highs * .14 + audio.air * .17 * shimmer + audio.hat * .09
        );
        const size = (
          particle.size + audio.highs * 1.4 + audio.hat * 1.7 * particle.depth
        ) * dpr;
        const color = audio.hat > .12 && index % 7 === 0
          ? colors.flare
          : index % 4 === 0
            ? colors.glow
            : index % 3 === 0 ? colors.sheen : colors.accent;
        context.fillStyle = rgba(color, alpha);
        context.shadowColor = rgba(color, alpha * 1.6);
        context.shadowBlur = (3 + audio.highs * 8) * dpr;
        context.beginPath();
        context.arc(x, y, size, 0, TAU);
        context.fill();

        if((audio.highs > .18 || audio.hat > .08) && !reducedMotion){
          const trail = (6 + audio.highs * 22 + audio.hat * 18) * particle.depth * dpr;
          context.strokeStyle = rgba(color, alpha * .42);
          context.lineWidth = Math.max(.6, size * .28);
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(x - Math.sin(angle) * trail, y + Math.cos(angle) * trail * squash);
          context.stroke();
        }
      }
      context.restore();
    }

    function drawCore(colors, audio, radiusScale=.15){
      const cx = width * .5;
      const cy = stageCenterY();
      const radius = Math.min(width, height) * radiusScale * (
        1 + audio.bass * .18 + audio.kick * .105
      );
      const centerColor = mixRgb(colors.sheen, colors.flare, audio.snare * .5);
      const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, rgba(centerColor, .2 + audio.energy * .34));
      gradient.addColorStop(.22, rgba(colors.accent, .1 + audio.bass * .22));
      gradient.addColorStop(.58, rgba(colors.glow, .035 + audio.mids * .13));
      gradient.addColorStop(1, rgba(colors.glow, 0));
      context.save();
      context.globalCompositeOperation = "screen";
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(cx, cy, radius, 0, TAU);
      context.fill();
      context.restore();
    }

    function drawWaveformHalo(colors, audio, waveformData, time, radiusScale=.27, alphaScale=1){
      if(!waveformData?.length) return;
      const cx = width * .5;
      const cy = stageCenterY();
      const base = Math.min(width, height) * radiusScale * (1 + audio.bass * .06);
      const samples = Math.min(180, waveformData.length);
      context.save();
      context.globalCompositeOperation = "screen";
      context.translate(cx, cy);
      context.rotate(reducedMotion ? 0 : time * .025 + audio.snare * .035);
      context.lineJoin = "round";
      context.lineCap = "round";
      context.beginPath();
      for(let index=0; index<=samples; index++){
        const sampleIndex = index % samples;
        const normalized = (waveformData[sampleIndex] - 128) / 128;
        const angle = index / samples * TAU;
        const radius = base + normalized * Math.min(width, height) * (.035 + audio.waveform * .045);
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if(index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.closePath();
      const gradient = context.createLinearGradient(-base, -base, base, base);
      gradient.addColorStop(0, rgba(colors.glow, .16 * alphaScale + audio.mids * .28 * alphaScale));
      gradient.addColorStop(
        .5,
        rgba(
          mixRgb(colors.sheen, colors.flare, audio.snare * .72),
          .2 * alphaScale + audio.highs * .34 * alphaScale
        )
      );
      gradient.addColorStop(1, rgba(colors.accent, .14 * alphaScale + audio.bass * .3 * alphaScale));
      context.strokeStyle = gradient;
      context.lineWidth = (1.1 + audio.highs * 2.6) * dpr;
      context.shadowColor = rgba(colors.sheen, .38 * alphaScale);
      context.shadowBlur = (7 + audio.energy * 22) * dpr;
      context.stroke();
      context.restore();
    }

    function drawSpectrumCrown(colors, audio, time, radiusScale=.31, alphaScale=1){
      const cx = width * .5;
      const cy = stageCenterY();
      const count = SPECTRUM_POINTS * 2;
      const base = Math.min(width, height) * radiusScale * (1 + audio.bass * .055);
      context.save();
      context.translate(cx, cy);
      context.rotate(reducedMotion ? 0 : -time * .018);
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";
      for(let index=0; index<count; index++){
        const mirrored = index < SPECTRUM_POINTS ? index : count - index - 1;
        const value = audio.spectrum[mirrored];
        const angle = index / count * TAU;
        const inner = base * (.985 + Math.sin(index * .31 + time) * .004);
        const length = Math.min(width, height) * (
          .008 + value * .075 + audio.kick * .007 + audio.hat * .014
        );
        const color = audio.hat > .14 && index % 8 === 0
          ? colors.flare
          : index % 5 < 2 ? colors.glow : index % 3 ? colors.accent : colors.sheen;
        context.strokeStyle = rgba(
          color,
          alphaScale * (.035 + value * .34 + audio.highs * .05 + audio.hat * .06)
        );
        context.lineWidth = (.7 + value * 1.7) * dpr;
        context.beginPath();
        context.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
        context.lineTo(Math.cos(angle) * (inner + length), Math.sin(angle) * (inner + length));
        context.stroke();
      }
      context.restore();
    }

    function drawShockwave(colors, audio){
      const pulse = Math.max(audio.kick, audio.snare * .72, audio.beat * .6);
      if(pulse < .025) return;
      const cx = width * .5;
      const cy = stageCenterY();
      const progress = 1 - pulse;
      const radius = Math.min(width, height) * (.18 + progress * .29);
      const color = mixRgb(colors.sheen, colors.flare, clamp(audio.snare + audio.kick * .35));
      context.save();
      context.globalCompositeOperation = "screen";
      context.strokeStyle = rgba(color, pulse * .17);
      context.lineWidth = (1 + pulse * 6) * dpr;
      context.shadowColor = rgba(colors.flare, pulse * .34);
      context.shadowBlur = (10 + pulse * 30) * dpr;
      context.beginPath();
      context.arc(cx, cy, radius, 0, TAU);
      context.stroke();
      if(audio.snare > .08){
        context.strokeStyle = rgba(colors.flare, audio.snare * .11);
        context.lineWidth = (1 + audio.snare * 2.5) * dpr;
        context.beginPath();
        context.arc(cx, cy, radius * 1.08, -.17 * Math.PI, .17 * Math.PI);
        context.arc(cx, cy, radius * 1.08, .83 * Math.PI, 1.17 * Math.PI);
        context.stroke();
      }
      context.restore();
    }

    // Frame feedback is the defining motion language of classic desktop
    // visualizers. Reusing the current canvas keeps these scenes lightweight
    // and avoids a second WebGL renderer or a large preset dependency.
    function drawFeedbackEcho(audio, time, {
      alpha=.54,
      direction=1,
      drift=.012,
      rotation=.002,
      zoom=.004,
    }={}){
      if(reducedMotion || !canvas) return;
      const cx = width * .5;
      const cy = stageCenterY();
      const scale = 1 + zoom + audio.bass * .006 + audio.kick * .0025;
      const offsetX = Math.sin(time * .37) * width * drift * audio.mids;
      const offsetY = Math.cos(time * .29) * height * drift * audio.highs;
      context.save();
      // Transform the prior frame without additively brightening it. New
      // scene strokes use screen blending below; using it for feedback too
      // would compound pale pixels until the whole canvas washed out.
      context.globalCompositeOperation = "source-over";
      context.globalAlpha *= clamp(alpha + audio.energy * .08);
      context.translate(cx + offsetX, cy + offsetY);
      context.rotate(
        direction * (
          rotation
          + Math.sin(time * .21) * .0018
          + audio.snare * .0025
        )
      );
      context.scale(scale, scale);
      context.translate(-cx, -cy);
      context.drawImage(canvas, 0, 0, width, height);
      context.restore();
    }

    function drawBloom(colors, audio, waveformData, time){
      const cx = width * .5;
      const cy = stageCenterY();
      const radius = Math.min(width, height) * (
        .15 + audio.bass * .05 + audio.kick * .022
      );
      drawAtmosphere(colors, audio, time, 1);
      drawCore(colors, audio, .2);

      context.save();
      context.translate(cx, cy);
      context.globalCompositeOperation = "screen";
      for(let layer=0; layer<4; layer++){
        const petals = 5 + layer * 2;
        const layerRadius = radius * (1 + layer * .43);
        const spin = (layer % 2 ? -1 : 1) * (
          time * (.035 + layer * .008) + audio.snare * .045
        );
        context.save();
        context.rotate(spin);
        context.beginPath();
        for(let point=0; point<=300; point++){
          const angle = point / 300 * TAU;
          const spectrum = audio.spectrum[(point + layer * 7) % SPECTRUM_POINTS];
          const wave = Math.sin(angle * petals + time * (.52 + layer * .12));
          const ripple = Math.sin(angle * (petals + 3) - time * .31) * audio.highs;
          const r = layerRadius * (
            1
            + wave * (.095 + audio.mids * .18)
            + ripple * .035
            + spectrum * .045
          );
          const x = Math.cos(angle) * r;
          const y = Math.sin(angle) * r;
          if(point === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        const color = audio.snare > .12 && layer === 0
          ? colors.flare
          : layer % 3 === 1 ? colors.glow : layer % 2 ? colors.accent : colors.sheen;
        context.strokeStyle = rgba(color, .1 + audio.energy * .36 - layer * .009);
        context.lineWidth = (.9 + audio.highs * 2.4 + layer * .3) * dpr;
        context.shadowColor = rgba(color, .5);
        context.shadowBlur = (8 + audio.energy * 28) * dpr;
        context.stroke();
        context.restore();
      }
      context.restore();

      drawWaveformHalo(colors, audio, waveformData, time, .27, .9);
      drawSpectrumCrown(colors, audio, time, .325, .9);
      drawShockwave(colors, audio);
    }

    function drawTunnel(colors, audio, waveformData, time){
      const drift = reducedMotion ? 0 : 1;
      const cx = width * .5 + Math.sin(time * .31) * width * .027 * drift;
      const cy = stageCenterY() + Math.cos(time * .24) * height * .022 * drift;
      const maxRadius = Math.hypot(width, height) * .6;
      drawAtmosphere(colors, audio, time * 1.15, .72);
      context.save();
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";
      for(let ring=0; ring<22; ring++){
        const phase = (ring / 22 + time * (.044 + audio.energy * .014)) % 1;
        const radius = Math.pow(phase, 1.75) * maxRadius + 3 * dpr;
        const spectrum = audio.spectrum[(ring * 3) % SPECTRUM_POINTS];
        const alpha = (1 - phase) * (.035 + spectrum * .29 + audio.energy * .08);
        const color = ring % 4 === 0 ? colors.sheen : ring % 2 ? colors.accent : colors.glow;
        context.strokeStyle = rgba(color, alpha);
        context.lineWidth = (
          .7 + spectrum * 3.2 + audio.kick * 1.55
        ) * (1 - phase * .5) * dpr;
        context.shadowColor = rgba(color, alpha * 1.7);
        context.shadowBlur = (3 + audio.energy * 15) * dpr;
        context.beginPath();
        context.ellipse(
          cx,
          cy,
          radius,
          radius * (.61 + audio.mids * .075),
          time * .024,
          0,
          TAU
        );
        context.stroke();
      }

      // Bright high-frequency streaks converge on the moving vanishing point.
      for(let ray=0; ray<28; ray++){
        const spectrum = audio.spectrum[(ray * 5) % SPECTRUM_POINTS];
        if(spectrum < .12) continue;
        const angle = ray / 28 * TAU + time * .012;
        const inner = Math.min(width, height) * (.08 + audio.bass * .025);
        const outer = Math.min(width, height) * (.26 + spectrum * .23);
        const rayColor = audio.hat > .12 && ray % 6 === 0
          ? colors.flare
          : ray % 3 ? colors.accent : colors.sheen;
        context.strokeStyle = rgba(rayColor, spectrum * (.07 + audio.hat * .035));
        context.lineWidth = Math.max(.55, spectrum * 1.2) * dpr;
        context.beginPath();
        context.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner * .63);
        context.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer * .63);
        context.stroke();
      }
      context.restore();
    }

    function drawHelix(colors, audio, waveformData, time){
      // Keep only enough room for the stroke glow; the helix is a horizontal
      // composition and should span the full stage on wide screens.
      const margin = Math.max(2 * dpr, width * .008);
      const span = width - margin * 2;
      const center = stageCenterY();
      const amplitude = Math.min(height * .23, width * .2) * (1 + audio.bass * .22);
      drawAtmosphere(colors, audio, time * .72, .74);
      context.save();
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";
      context.lineJoin = "round";
      const speed = reducedMotion
        ? 0
        : time * (1.05 + audio.energy * .34) + audio.snare * .08;
      for(let strand=0; strand<2; strand++){
        for(let echo=2; echo>=0; echo--){
          context.beginPath();
          for(let point=0; point<=220; point++){
            const ratio = point / 220;
            const x = margin + ratio * span;
            const spectrum = audio.spectrum[Math.min(SPECTRUM_POINTS - 1, Math.floor(ratio * SPECTRUM_POINTS))];
            const phase = ratio * Math.PI * 7 + speed + strand * Math.PI - echo * .045;
            const y = center + Math.sin(phase) * amplitude * (1 + spectrum * .075);
            if(point === 0) context.moveTo(x, y); else context.lineTo(x, y);
          }
          const color = strand ? colors.glow : colors.sheen;
          context.strokeStyle = rgba(color, (.055 + audio.energy * .34) * (1 - echo * .25));
          context.lineWidth = (.8 + audio.highs * 2.7 + (2 - echo) * .45) * dpr;
          context.shadowColor = rgba(color, .55);
          context.shadowBlur = echo === 0 ? (9 + audio.energy * 24) * dpr : 0;
          context.stroke();
        }
      }

      for(let point=0; point<38; point++){
        const ratio = point / 37;
        const x = margin + ratio * span;
        const spectrum = audio.spectrum[Math.min(SPECTRUM_POINTS - 1, Math.floor(ratio * SPECTRUM_POINTS))];
        const phase = ratio * Math.PI * 7 + speed;
        const y1 = center + Math.sin(phase) * amplitude;
        const y2 = center - Math.sin(phase) * amplitude;
        const rungColor = audio.snare > .1 && point % 5 === 0
          ? colors.flare
          : colors.accent;
        context.strokeStyle = rgba(rungColor, .025 + audio.mids * .12 + spectrum * .06);
        context.lineWidth = (.55 + spectrum) * dpr;
        context.beginPath();
        context.moveTo(x, y1);
        context.lineTo(x, y2);
        context.stroke();
        if(point % 3 === 0){
          context.fillStyle = rgba(colors.sheen, .08 + spectrum * .36);
          context.beginPath();
          context.arc(x, y1, (1.1 + spectrum * 2.4) * dpr, 0, TAU);
          context.fill();
        }
      }
      context.restore();
    }

    function drawSpirograph(colors, audio, waveformData, time){
      const cx = width * .5;
      const cy = stageCenterY();
      const scale = Math.min(width, height) * (
        .26 + audio.bass * .052 + audio.kick * .018
      );
      drawAtmosphere(colors, audio, -time * .82, .86);
      context.save();
      context.translate(cx, cy);
      context.globalCompositeOperation = "screen";
      const rotation = reducedMotion ? 0 : time * .038;
      for(let layer=0; layer<4; layer++){
        const outer = 5 + layer;
        const inner = (
          2.05 + layer * .37 + audio.mids * .3 + audio.centroid * .2 + audio.snare * .08
        );
        const offset = .61 + audio.highs * .24;
        for(let echo=2; echo>=0; echo--){
          context.save();
          context.rotate(rotation - echo * .014);
          context.beginPath();
          const pointCount = Math.max(440, Math.round(820 * qualityScale));
          for(let point=0; point<=pointCount; point++){
            const t = point / pointCount * Math.PI * 13;
            const spectrum = audio.spectrum[point % SPECTRUM_POINTS];
            const localScale = scale * (1 + spectrum * .022);
            const x = (
              (outer - inner) * Math.cos(t)
              + offset * inner * Math.cos((outer - inner) / inner * t)
            ) * localScale / outer;
            const y = (
              (outer - inner) * Math.sin(t)
              - offset * inner * Math.sin((outer - inner) / inner * t)
            ) * localScale / outer;
            if(point === 0) context.moveTo(x, y); else context.lineTo(x, y);
          }
          const color = audio.snare > .13 && layer === 0
            ? colors.flare
            : layer % 3 === 1 ? colors.glow : layer % 2 ? colors.accent : colors.sheen;
          context.strokeStyle = rgba(
            color,
            (.055 + audio.energy * .28 - layer * .004) * (1 - echo * .24)
          );
          context.lineWidth = (.65 + layer * .22 + audio.highs * 1.7 + (2 - echo) * .25) * dpr;
          context.shadowColor = rgba(color, .48);
          context.shadowBlur = echo === 0 ? (7 + audio.energy * 20) * dpr : 0;
          context.stroke();
          context.restore();
        }
      }
      context.restore();
    }

    function drawMilkDropFlow(colors, audio, waveformData, time){
      drawFeedbackEcho(audio, time, {
        alpha:.5,
        direction:Math.sin(time * .09) >= 0 ? 1 : -1,
        drift:.018,
        rotation:.0026,
        zoom:.0035,
      });
      drawAtmosphere(colors, audio, time * 1.28, .46);
      if(!waveformData?.length) return;

      const margin = width * .04;
      const span = width - margin * 2;
      const center = stageCenterY();
      const sampleCount = Math.min(240, waveformData.length);
      context.save();
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";
      context.lineJoin = "round";

      // Mirrored ribbons break away from the circular language used by the
      // other scenes while preserving the kaleidoscopic MilkDrop feel.
      for(let layer=0; layer<5; layer++){
        const layerOffset = (layer - 2) * height * .048;
        for(let mirror=-1; mirror<=1; mirror+=2){
          context.beginPath();
          for(let point=0; point<=sampleCount; point++){
            const ratio = point / sampleCount;
            const sourceIndex = Math.min(
              waveformData.length - 1,
              Math.floor(ratio * waveformData.length)
            );
            const wave = (waveformData[sourceIndex] - 128) / 128;
            const spectrumIndex = Math.min(
              SPECTRUM_POINTS - 1,
              Math.floor(ratio * SPECTRUM_POINTS)
            );
            const spectrum = audio.spectrum[spectrumIndex];
            const x = margin + ratio * span;
            const sway = Math.sin(
              ratio * TAU * (1.5 + layer * .24)
              + time * (.72 + layer * .08)
            );
            const y = center + mirror * (
              layerOffset
              + wave * height * (.042 + audio.waveform * .045)
              + sway * height * (.012 + spectrum * .026)
            );
            if(point === 0) context.moveTo(x, y); else context.lineTo(x, y);
          }
          const color = layer % 3 === 0
            ? colors.flare
            : layer % 2 ? colors.glow : colors.accent;
          const alpha = .055 + audio.energy * .24 + audio.highs * .12 - layer * .004;
          context.strokeStyle = rgba(color, alpha);
          context.lineWidth = (.8 + audio.highs * 2.2 + (4 - layer) * .18) * dpr;
          context.shadowColor = rgba(color, .46 + audio.beat * .18);
          context.shadowBlur = (6 + audio.energy * 19 + audio.hat * 13) * dpr;
          context.stroke();
        }
      }

      // Sparse frequency columns give transients a crisp structure without
      // turning the scene into a conventional bar visualizer.
      const columnCount = Math.max(20, Math.round(42 * qualityScale));
      for(let index=0; index<columnCount; index++){
        const ratio = index / Math.max(1, columnCount - 1);
        const spectrum = audio.spectrum[
          Math.min(SPECTRUM_POINTS - 1, Math.floor(ratio * SPECTRUM_POINTS))
        ];
        if(spectrum < .08) continue;
        const x = margin + ratio * span;
        const length = height * (.018 + spectrum * .13 + audio.hat * .025);
        const columnColor = index % 5 === 0 ? colors.sheen : colors.accent;
        context.strokeStyle = rgba(columnColor, .035 + spectrum * .18);
        context.lineWidth = (.6 + spectrum * 1.3) * dpr;
        context.beginPath();
        context.moveTo(x, center - length);
        context.lineTo(x, center + length);
        context.stroke();
      }
      context.restore();
      drawShockwave(colors, audio);
    }

    function drawGeissWaves(colors, audio, waveformData, time){
      drawFeedbackEcho(audio, time, {
        alpha:.58,
        direction:-1,
        drift:.01,
        rotation:.0012,
        zoom:.006,
      });
      drawAtmosphere(colors, audio, -time * .6, .52);

      const margin = width * .025;
      const span = width - margin * 2;
      const center = stageCenterY();
      const rowCount = Math.max(9, Math.round(15 * qualityScale));
      const pointCount = Math.max(120, Math.round(220 * qualityScale));
      context.save();
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";
      context.lineJoin = "round";

      // Layered contour lines drift through one another like the soft liquid
      // feedback fields associated with Geiss, with bass controlling breadth
      // and upper frequencies adding finer ripples.
      for(let row=0; row<rowCount; row++){
        const rowRatio = row / Math.max(1, rowCount - 1);
        const baseY = center + (rowRatio - .5) * height * .64;
        context.beginPath();
        for(let point=0; point<=pointCount; point++){
          const ratio = point / pointCount;
          const spectrumIndex = Math.min(
            SPECTRUM_POINTS - 1,
            Math.floor(ratio * SPECTRUM_POINTS)
          );
          const spectrum = audio.spectrum[spectrumIndex];
          const waveIndex = waveformData?.length
            ? Math.min(
              waveformData.length - 1,
              Math.floor(ratio * waveformData.length)
            )
            : 0;
          const wave = waveformData?.length
            ? (waveformData[waveIndex] - 128) / 128
            : 0;
          const phase = (
            ratio * TAU * (1.2 + rowRatio * 1.8)
            + time * (.34 + rowRatio * .5)
            + row * .58
          );
          const envelope = Math.sin(ratio * Math.PI);
          const y = baseY
            + Math.sin(phase) * height * (.014 + audio.mids * .035)
            + Math.cos(phase * .47 - time * .19) * height * .009
            + wave * height * .024 * envelope
            + spectrum * height * .018 * Math.sin(phase * .73);
          const x = margin + ratio * span;
          if(point === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        const color = row % 5 === 0
          ? colors.flare
          : row % 3 === 0 ? colors.sheen : row % 2 ? colors.glow : colors.accent;
        const depth = 1 - Math.abs(rowRatio - .5) * 1.25;
        context.strokeStyle = rgba(
          color,
          .025 + audio.energy * .15 + Math.max(0, depth) * .075
        );
        context.lineWidth = (
          .65 + audio.highs * 1.5 + Math.max(0, depth) * .75
        ) * dpr;
        context.shadowColor = rgba(color, .3 + audio.beat * .16);
        context.shadowBlur = (4 + audio.energy * 14) * dpr;
        context.stroke();
      }

      // A few diagonal currents keep quiet passages moving and give beats a
      // visible direction rather than another center-focused pulse.
      for(let current=0; current<7; current++){
        const spectrum = audio.spectrum[(current * 7) % SPECTRUM_POINTS];
        const x = width * (
          .08 + current / 7 * .86 + Math.sin(time * .11 + current) * .015
        );
        const lean = width * (.035 + spectrum * .055);
        context.strokeStyle = rgba(
          current % 2 ? colors.accent : colors.glow,
          .018 + spectrum * .11 + audio.kick * .035
        );
        context.lineWidth = (.6 + spectrum * 1.2) * dpr;
        context.beginPath();
        context.moveTo(x - lean, center - height * .36);
        context.bezierCurveTo(
          x + lean,
          center - height * .12,
          x - lean,
          center + height * .12,
          x + lean,
          center + height * .36
        );
        context.stroke();
      }
      context.restore();
    }

    // A classic spectrum analyzer with a restrained reflection. It gives the
    // journey a crisp, legible mode that feels different from the fluid scenes.
    function drawNeonSpectrum(colors, audio, waveformData, time){
      drawAtmosphere(colors, audio, time * .38, .3);
      const count = Math.max(28, Math.round(SPECTRUM_POINTS * qualityScale));
      const margin = width * .055;
      const span = width - margin * 2;
      const gap = span / count;
      const baseline = height * .73;
      const maxBarHeight = height * .43;
      context.save();
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";
      for(let index=0; index<count; index++){
        const spectrumIndex = Math.min(
          SPECTRUM_POINTS - 1,
          Math.floor(index / Math.max(1, count - 1) * SPECTRUM_POINTS)
        );
        const value = audio.spectrum[spectrumIndex];
        const shaped = Math.pow(value, .72);
        const x = margin + (index + .5) * gap;
        const barHeight = (
          .012 + shaped * .72 + audio.kick * .025 + audio.hat * .018
        ) * maxBarHeight;
        const color = audio.snare > .13 && index % 7 === 0
          ? colors.flare
          : index % 5 < 2 ? colors.glow : index % 3 ? colors.accent : colors.sheen;
        const alpha = .08 + shaped * .58 + audio.energy * .08;
        context.strokeStyle = rgba(color, alpha);
        context.lineWidth = Math.max(1.2, gap * .48);
        context.shadowColor = rgba(color, .45 + shaped * .32);
        context.shadowBlur = (5 + shaped * 22 + audio.beat * 9) * dpr;
        context.beginPath();
        context.moveTo(x, baseline);
        context.lineTo(x, baseline - barHeight);
        context.stroke();

        context.strokeStyle = rgba(color, alpha * .18);
        context.shadowBlur = (2 + shaped * 7) * dpr;
        context.beginPath();
        context.moveTo(x, baseline + gap * .45);
        context.lineTo(x, baseline + Math.min(height * .11, barHeight * .22));
        context.stroke();
      }
      context.restore();
    }

    // Multiple waveform traces evoke a hardware oscilloscope. The active
    // trace carries transients while the quieter echoes provide persistence.
    function drawOscilloscope(colors, audio, waveformData, time){
      drawFeedbackEcho(audio, time, {
        alpha:.38,
        direction:1,
        drift:.004,
        rotation:.0005,
        zoom:.0015,
      });
      drawAtmosphere(colors, audio, -time * .22, .22);
      if(!waveformData?.length) return;
      const margin = width * .045;
      const span = width - margin * 2;
      const sampleCount = Math.min(360, waveformData.length);
      const center = stageCenterY();
      context.save();
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";
      context.lineJoin = "round";

      for(let trace=4; trace>=0; trace--){
        const offset = (trace - 2) * height * .072;
        context.beginPath();
        for(let point=0; point<=sampleCount; point++){
          const ratio = point / sampleCount;
          const sourceIndex = Math.min(
            waveformData.length - 1,
            Math.floor(ratio * waveformData.length)
          );
          const wave = (waveformData[sourceIndex] - 128) / 128;
          const spectrumIndex = Math.min(
            SPECTRUM_POINTS - 1,
            Math.floor(ratio * SPECTRUM_POINTS)
          );
          const spectrum = audio.spectrum[spectrumIndex];
          const x = margin + ratio * span;
          const y = center + offset
            + wave * height * (.075 + audio.waveform * .08)
            + Math.sin(ratio * TAU * 2 + time * .42 + trace) * spectrum * height * .012;
          if(point === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        const activeTrace = trace === 2;
        const color = activeTrace
          ? mixRgb(colors.sheen, colors.flare, audio.snare * .6)
          : trace % 2 ? colors.glow : colors.accent;
        context.strokeStyle = rgba(
          color,
          activeTrace
            ? .22 + audio.energy * .56
            : .025 + audio.energy * .08 + (4 - Math.abs(trace - 2)) * .012
        );
        context.lineWidth = (
          activeTrace ? 1.25 + audio.highs * 2.5 : .65 + audio.highs * .7
        ) * dpr;
        context.shadowColor = rgba(color, activeTrace ? .62 : .22);
        context.shadowBlur = (activeTrace ? 10 + audio.energy * 24 : 4) * dpr;
        context.stroke();
      }
      context.restore();
    }

    // Perspective streaks are a nod to classic starfield visualizers. The
    // vanishing point drifts off-center so this scene avoids another halo.
    function drawCometField(colors, audio, waveformData, time){
      const vanishingX = width * (.57 + Math.sin(time * .13) * .06);
      const vanishingY = height * (.39 + Math.cos(time * .11) * .045);
      const count = Math.max(56, Math.round(112 * qualityScale));
      const speed = .12 + audio.energy * .32 + audio.kick * .12;
      context.save();
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";
      for(let index=0; index<count; index++){
        const seed = seededUnit(index, 14);
        const depth = (seed + time * speed * (.18 + seededUnit(index, 15) * .34)) % 1;
        const previousDepth = Math.max(0, depth - (.015 + audio.highs * .035 + audio.hat * .025));
        const angle = seededUnit(index, 16) * TAU;
        const spread = Math.max(width, height) * (.12 + seededUnit(index, 17) * .72);
        const squash = .62 + seededUnit(index, 18) * .32;
        const x = vanishingX + Math.cos(angle) * spread * depth * depth;
        const y = vanishingY + Math.sin(angle) * spread * depth * depth * squash;
        const previousX = vanishingX + Math.cos(angle) * spread * previousDepth * previousDepth;
        const previousY = vanishingY + Math.sin(angle) * spread * previousDepth * previousDepth * squash;
        const spectrum = audio.spectrum[index % SPECTRUM_POINTS];
        const color = index % 9 === 0 && audio.snare > .07
          ? colors.flare
          : index % 4 === 0 ? colors.sheen : index % 3 ? colors.accent : colors.glow;
        const alpha = depth * (.035 + spectrum * .38 + audio.highs * .07);
        context.strokeStyle = rgba(color, alpha);
        context.lineWidth = (.55 + depth * 2.2 + spectrum * 1.8) * dpr;
        context.shadowColor = rgba(color, alpha * 1.5);
        context.shadowBlur = (3 + depth * 13 + spectrum * 8) * dpr;
        context.beginPath();
        context.moveTo(previousX, previousY);
        context.lineTo(x, y);
        context.stroke();
      }
      context.restore();
    }

    // A rolling FFT history creates a real waterfall rather than a decorative
    // approximation. New rows arrive at the front and recede toward a horizon.
    function drawSpectrumWaterfall(colors, audio, waveformData, time){
      drawAtmosphere(colors, audio, time * .18, .2);
      const rows = spectrumHistory.length ? spectrumHistory : [audio.spectrum];
      const horizonY = height * .2;
      const floorY = height * .83;
      context.save();
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";
      context.lineJoin = "round";
      for(let row=rows.length - 1; row>=0; row--){
        const age = row / Math.max(1, rows.length - 1);
        const depth = 1 - age;
        const spectrum = rows[row];
        const baseY = horizonY + Math.pow(depth, .72) * (floorY - horizonY);
        const halfSpan = width * (.12 + depth * .42);
        const centerX = width * .5 + Math.sin(time * .08) * width * .018 * depth;
        context.beginPath();
        for(let index=0; index<SPECTRUM_POINTS; index++){
          const ratio = index / Math.max(1, SPECTRUM_POINTS - 1);
          const x = centerX + (ratio - .5) * halfSpan * 2;
          const value = Math.pow(spectrum[index], .78);
          const y = baseY - value * height * (.018 + depth * .13);
          if(index === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        const color = row === 0
          ? mixRgb(colors.sheen, colors.flare, audio.snare * .52)
          : row % 5 === 0 ? colors.glow : colors.accent;
        context.strokeStyle = rgba(
          color,
          .018 + depth * .13 + (row === 0 ? audio.energy * .38 : 0)
        );
        context.lineWidth = (
          .55 + depth * 1.35 + (row === 0 ? audio.highs * 1.9 : 0)
        ) * dpr;
        context.shadowColor = rgba(color, row === 0 ? .52 : .16);
        context.shadowBlur = (row === 0 ? 8 + audio.energy * 20 : 2) * dpr;
        context.stroke();
      }
      context.restore();
    }

    // Wide translucent ribbons move independently instead of orbiting a
    // center point. Mids shape their path, while bass changes their breadth.
    function drawLiquidAurora(colors, audio, waveformData, time){
      drawAtmosphere(colors, audio, time * .36, .34);
      const samples = Math.max(54, Math.round(100 * qualityScale));
      const ribbonCount = reducedMotion ? 3 : 5;
      const margin = -width * .06;
      const span = width * 1.12;
      context.save();
      context.globalCompositeOperation = "screen";
      context.lineJoin = "round";
      context.lineCap = "round";
      for(let ribbon=0; ribbon<ribbonCount; ribbon++){
        const points = [];
        const phase = ribbon * 1.21 + time * (.12 + ribbon * .012);
        const baseY = height * (.23 + ribbon * .125);
        const breadth = height * (
          .028 + ribbon * .005 + audio.bass * .045 + audio.kick * .014
        );
        for(let point=0; point<=samples; point++){
          const ratio = point / samples;
          const spectrumIndex = Math.min(
            SPECTRUM_POINTS - 1,
            Math.floor(ratio * SPECTRUM_POINTS)
          );
          const spectrum = audio.spectrum[spectrumIndex];
          const waveIndex = waveformData?.length
            ? Math.min(waveformData.length - 1, Math.floor(ratio * waveformData.length))
            : 0;
          const wave = waveformData?.length ? (waveformData[waveIndex] - 128) / 128 : 0;
          const x = margin + ratio * span;
          const y = baseY
            + Math.sin(ratio * TAU * (1.1 + ribbon * .09) + phase) * height * (.04 + audio.mids * .075)
            + Math.sin(ratio * TAU * 2.7 - phase * .74) * height * .018
            + wave * height * (.008 + audio.waveform * .026)
            - spectrum * height * .018;
          points.push({x, y, width:breadth * (.68 + spectrum * .82)});
        }
        context.beginPath();
        points.forEach((point, index)=>{
          const y = point.y - point.width;
          if(index === 0) context.moveTo(point.x, y); else context.lineTo(point.x, y);
        });
        for(let index=points.length - 1; index>=0; index--){
          const point = points[index];
          context.lineTo(point.x, point.y + point.width);
        }
        context.closePath();
        const gradient = context.createLinearGradient(margin, baseY, margin + span, baseY);
        const first = ribbon % 2 ? colors.glow : colors.accent;
        const middle = ribbon % 3 ? colors.sheen : colors.flare;
        gradient.addColorStop(0, rgba(first, 0));
        gradient.addColorStop(.18, rgba(first, .025 + audio.energy * .08));
        gradient.addColorStop(.52, rgba(middle, .05 + audio.mids * .18 + audio.snare * .08));
        gradient.addColorStop(.82, rgba(colors.glow, .025 + audio.highs * .1));
        gradient.addColorStop(1, rgba(colors.glow, 0));
        context.fillStyle = gradient;
        context.shadowColor = rgba(middle, .2 + audio.energy * .22);
        context.shadowBlur = (14 + audio.mids * 34 + audio.snare * 12) * dpr;
        context.fill();

        context.strokeStyle = rgba(
          middle,
          .035 + audio.highs * .16 + audio.hat * .08
        );
        context.lineWidth = (.7 + audio.highs * 1.7) * dpr;
        context.stroke();
      }
      context.restore();
    }

    // A sparse network provides a calmer scene. Connections only appear when
    // nearby particles share enough high-frequency energy.
    function drawParticleConstellation(colors, audio, waveformData, time){
      drawAtmosphere(colors, audio, -time * .18, .18);
      const count = Math.max(28, Math.round(Math.min(68, particles.length) * qualityScale));
      const cx = width * .5;
      const cy = stageCenterY();
      const span = Math.min(width, height) * (.48 + audio.bass * .045);
      const nodes = [];
      for(let index=0; index<count; index++){
        const particle = particles[index];
        const angle = particle.angle + (
          reducedMotion ? 0 : time * particle.speed * (.34 + audio.highs * .65)
        );
        const orbit = span * particle.radius;
        nodes.push({
          x:cx + Math.cos(angle) * orbit,
          y:cy + Math.sin(angle) * orbit * (.62 + particle.depth * .24),
          energy:audio.spectrum[index % SPECTRUM_POINTS],
          depth:particle.depth,
        });
      }
      const linkDistance = Math.min(width, height) * (.16 + audio.mids * .025);
      context.save();
      context.globalCompositeOperation = "screen";
      for(let first=0; first<nodes.length; first++){
        const from = nodes[first];
        for(let second=first + 1; second<nodes.length; second++){
          const to = nodes[second];
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const distance = Math.hypot(dx, dy);
          if(distance > linkDistance) continue;
          const shared = (from.energy + to.energy) * .5;
          const alpha = (1 - distance / linkDistance) * (
            .018 + shared * .14 + audio.highs * .035
          );
          if(alpha < .012) continue;
          const color = (first + second) % 5 === 0 ? colors.glow : colors.accent;
          context.strokeStyle = rgba(color, alpha);
          context.lineWidth = (.45 + shared * .8) * dpr;
          context.beginPath();
          context.moveTo(from.x, from.y);
          context.lineTo(to.x, to.y);
          context.stroke();
        }
      }
      for(let index=0; index<nodes.length; index++){
        const node = nodes[index];
        const transient = index % 11 === 0 ? audio.snare : index % 7 === 0 ? audio.hat : 0;
        const color = transient > .06
          ? colors.flare
          : index % 4 === 0 ? colors.sheen : index % 3 ? colors.accent : colors.glow;
        const radius = (
          .75 + node.depth * 1.8 + node.energy * 3.2 + transient * 3
        ) * dpr;
        const alpha = .09 + node.energy * .52 + audio.energy * .08;
        context.fillStyle = rgba(color, alpha);
        context.shadowColor = rgba(color, .4 + node.energy * .4);
        context.shadowBlur = (4 + node.energy * 18 + transient * 10) * dpr;
        context.beginPath();
        context.arc(node.x, node.y, radius, 0, TAU);
        context.fill();
      }
      context.restore();
      drawShockwave(colors, {...audio, beat:audio.beat * .45});
    }

    // FFT history becomes a horizon grid: the current spectrum is nearest the
    // viewer and older snapshots recede into the distance.
    function drawAudioTerrain(colors, audio, waveformData, time){
      drawAtmosphere(colors, audio, time * .12, .16);
      const history = spectrumHistory.length ? spectrumHistory : [audio.spectrum];
      const rowCount = Math.min(reducedMotion ? 10 : 18, history.length);
      const columnCount = Math.max(18, Math.round(30 * qualityScale));
      const horizonY = height * .24;
      const floorY = height * .84;
      const centerX = width * .5 + Math.sin(time * .11) * width * .015;
      const pointAt = (row, column)=>{
        const depth = row / Math.max(1, rowCount - 1);
        const perspective = Math.pow(depth, .72);
        const snapshot = history[Math.min(history.length - 1, rowCount - row - 1)];
        const ratio = column / Math.max(1, columnCount - 1);
        const spectrumIndex = Math.min(
          SPECTRUM_POINTS - 1,
          Math.floor(ratio * SPECTRUM_POINTS)
        );
        const value = Math.pow(snapshot?.[spectrumIndex] || 0, .72);
        return {
          x:centerX + (ratio - .5) * width * (.18 + perspective * .92),
          y:horizonY + perspective * (floorY - horizonY)
            - value * height * (.018 + perspective * .16),
          value,
          depth,
        };
      };
      context.save();
      context.globalCompositeOperation = "screen";
      context.lineJoin = "round";
      context.lineCap = "round";
      for(let row=0; row<rowCount; row++){
        context.beginPath();
        let rowEnergy = 0;
        for(let column=0; column<columnCount; column++){
          const point = pointAt(row, column);
          rowEnergy += point.value;
          if(column === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        }
        const depth = row / Math.max(1, rowCount - 1);
        const color = row === rowCount - 1
          ? mixRgb(colors.sheen, colors.flare, audio.snare * .55)
          : row % 4 === 0 ? colors.glow : colors.accent;
        context.strokeStyle = rgba(
          color,
          .018 + depth * .13 + rowEnergy / columnCount * .2
        );
        context.lineWidth = (.5 + depth * 1.3) * dpr;
        context.shadowColor = rgba(color, row === rowCount - 1 ? .48 : .12);
        context.shadowBlur = (row === rowCount - 1 ? 8 + audio.energy * 18 : 2) * dpr;
        context.stroke();
      }
      for(let column=0; column<columnCount; column+=2){
        context.beginPath();
        for(let row=0; row<rowCount; row++){
          const point = pointAt(row, column);
          if(row === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        }
        context.strokeStyle = rgba(
          column % 6 === 0 ? colors.glow : colors.accent,
          .018 + audio.highs * .055
        );
        context.lineWidth = .55 * dpr;
        context.stroke();
      }
      context.restore();
    }

    // Overlapping gradients and curved tendrils mimic pigment spreading in
    // water. Large blooms follow bass; sharper edges arrive with transients.
    function drawInkBloom(colors, audio, waveformData, time){
      drawAtmosphere(colors, audio, -time * .16, .12);
      const count = reducedMotion ? 5 : Math.max(6, Math.round(9 * qualityScale));
      const cx = width * .5;
      const cy = stageCenterY();
      context.save();
      context.globalCompositeOperation = "screen";
      for(let index=0; index<count; index++){
        const angle = seededUnit(index, 31) * TAU + time * (
          .018 + seededUnit(index, 32) * .028
        ) * (index % 2 ? 1 : -1);
        const orbit = Math.min(width, height) * (
          .06 + seededUnit(index, 33) * .32
        );
        const spectrum = audio.spectrum[(index * 6) % SPECTRUM_POINTS];
        const x = cx + Math.cos(angle) * orbit * (1 + audio.bass * .18);
        const y = cy + Math.sin(angle) * orbit * .72;
        const radius = Math.min(width, height) * (
          .07 + seededUnit(index, 34) * .11 + spectrum * .085 + audio.kick * .022
        );
        const color = index % 4 === 0
          ? colors.flare
          : index % 3 === 0 ? colors.glow : index % 2 ? colors.accent : colors.sheen;
        const gradient = context.createRadialGradient(
          x - radius * .16,
          y - radius * .12,
          radius * .04,
          x,
          y,
          radius
        );
        gradient.addColorStop(0, rgba(color, .08 + spectrum * .2 + audio.mids * .08));
        gradient.addColorStop(.34, rgba(color, .04 + spectrum * .13));
        gradient.addColorStop(.72, rgba(color, .012 + audio.energy * .035));
        gradient.addColorStop(1, rgba(color, 0));
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(x, y, radius, 0, TAU);
        context.fill();

        const curl = radius * (1.1 + audio.mids * .65);
        context.strokeStyle = rgba(color, .015 + spectrum * .08 + audio.highs * .025);
        context.lineWidth = (.6 + spectrum * 1.2) * dpr;
        context.shadowColor = rgba(color, .22 + spectrum * .2);
        context.shadowBlur = (7 + spectrum * 15) * dpr;
        context.beginPath();
        context.moveTo(x - radius * .35, y + radius * .08);
        context.bezierCurveTo(
          x - curl,
          y - curl * .45,
          x + curl * .72,
          y - curl * .65,
          x + radius * .42,
          y + radius * .24
        );
        context.stroke();
      }
      context.restore();
    }

    // Rectangular light gates provide forward motion without repeating the
    // circular composition used by Orbital Tunnel.
    function drawTunnelFlight(colors, audio, waveformData, time){
      drawAtmosphere(colors, audio, time * .54, .2);
      const vanishingX = width * (.5 + Math.sin(time * .16) * .065);
      const vanishingY = height * (.4 + Math.cos(time * .13) * .035);
      const gateCount = reducedMotion ? 12 : 20;
      const speed = .055 + audio.energy * .018 + audio.kick * .009;
      context.save();
      context.globalCompositeOperation = "screen";
      context.lineJoin = "round";
      for(let gate=0; gate<gateCount; gate++){
        const phase = (gate / gateCount + time * speed) % 1;
        const depth = Math.pow(phase, 1.8);
        const halfWidth = width * (.018 + depth * .54);
        const halfHeight = height * (.012 + depth * .42);
        const spectrum = audio.spectrum[(gate * 4) % SPECTRUM_POINTS];
        const offsetX = (vanishingX - width * .5) * depth;
        const offsetY = (vanishingY - height * .5) * depth;
        const x = vanishingX - offsetX;
        const y = vanishingY - offsetY;
        const skew = Math.sin(time * .18 + gate * .37) * halfWidth * .045;
        const color = gate % 5 === 0
          ? colors.sheen
          : gate % 3 === 0 ? colors.glow : gate % 2 ? colors.accent : colors.flare;
        const alpha = phase * (
          .035 + spectrum * .27 + audio.highs * .045 + audio.hat * .04
        );
        context.strokeStyle = rgba(color, alpha);
        context.lineWidth = (.55 + depth * 2 + spectrum * 1.5) * dpr;
        context.shadowColor = rgba(color, alpha * 1.6);
        context.shadowBlur = (3 + depth * 12 + spectrum * 12) * dpr;
        context.beginPath();
        context.moveTo(x - halfWidth + skew, y - halfHeight);
        context.lineTo(x + halfWidth + skew, y - halfHeight);
        context.lineTo(x + halfWidth - skew, y + halfHeight);
        context.lineTo(x - halfWidth - skew, y + halfHeight);
        context.closePath();
        context.stroke();
      }

      const streakCount = Math.max(18, Math.round(34 * qualityScale));
      for(let streak=0; streak<streakCount; streak++){
        const side = streak % 2 ? 1 : -1;
        const lane = seededUnit(streak, 41);
        const spectrum = audio.spectrum[(streak * 5) % SPECTRUM_POINTS];
        const startX = vanishingX + side * width * (.025 + lane * .08);
        const endX = vanishingX + side * width * (.2 + lane * .45);
        const startY = vanishingY + (seededUnit(streak, 42) - .5) * height * .07;
        const endY = vanishingY + (startY - vanishingY) * 4.8
          + (seededUnit(streak, 43) - .5) * height * .48;
        context.strokeStyle = rgba(
          streak % 4 ? colors.accent : colors.flare,
          .012 + spectrum * .13 + audio.hat * .03
        );
        context.lineWidth = (.45 + spectrum) * dpr;
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.stroke();
      }
      context.restore();
    }

    // Mirrored waveform geometry makes a restrained kaleidoscope. The scene
    // deliberately leaves negative space between wedges for OLED contrast.
    function drawKaleidoscope(colors, audio, waveformData, time){
      drawAtmosphere(colors, audio, -time * .28, .22);
      const cx = width * .5;
      const cy = stageCenterY();
      const segmentCount = reducedMotion ? 6 : 10;
      const samples = Math.min(96, waveformData?.length || 0);
      const inner = Math.min(width, height) * (.055 + audio.bass * .018);
      const span = Math.min(width, height) * (.34 + audio.kick * .025);
      context.save();
      context.translate(cx, cy);
      context.rotate(reducedMotion ? 0 : time * .026);
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";
      context.lineJoin = "round";
      for(let segment=0; segment<segmentCount; segment++){
        context.save();
        context.rotate(segment / segmentCount * TAU);
        if(segment % 2) context.scale(1, -1);
        for(let layer=0; layer<3; layer++){
          context.beginPath();
          const pointCount = samples || 72;
          for(let point=0; point<=pointCount; point++){
            const ratio = point / pointCount;
            const sampleIndex = waveformData?.length
              ? Math.min(waveformData.length - 1, Math.floor(ratio * waveformData.length))
              : 0;
            const wave = waveformData?.length
              ? (waveformData[sampleIndex] - 128) / 128
              : Math.sin(ratio * TAU * 2);
            const spectrum = audio.spectrum[
              Math.min(SPECTRUM_POINTS - 1, Math.floor(ratio * SPECTRUM_POINTS))
            ];
            const radius = inner + ratio * span * (1 + spectrum * .07);
            const angle = (
              .12
              + Math.sin(ratio * Math.PI * (2.5 + layer * .45) + layer * .8) * .09
              + wave * (.035 + audio.waveform * .055)
            );
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            if(point === 0) context.moveTo(x, y); else context.lineTo(x, y);
          }
          const color = layer === 0
            ? colors.sheen
            : layer === 1 ? colors.accent : audio.snare > .08 ? colors.flare : colors.glow;
          context.strokeStyle = rgba(
            color,
            .025 + audio.energy * .1 + audio.highs * .08 - layer * .004
          );
          context.lineWidth = (.55 + audio.highs * 1.25 + layer * .28) * dpr;
          context.shadowColor = rgba(color, .26 + audio.energy * .25);
          context.shadowBlur = (4 + audio.energy * 16) * dpr;
          context.stroke();
        }
        context.restore();
      }
      context.restore();
      drawShockwave(colors, {...audio, beat:audio.beat * .62});
    }

    const ambientSceneModule = window.MediaPlayerOrbitBloomAmbientScenes;
    if(typeof ambientSceneModule?.create !== "function"){
      throw new Error("Orbit Bloom ambient scenes are unavailable");
    }
    const ambientDrawers = ambientSceneModule.create({
      SPECTRUM_POINTS,
      TAU,
      clamp,
      coverCrop,
      drawAtmosphere,
      rgba,
      seededUnit,
      stageCenterY,
      state:()=>({
        artworkImage,
        context,
        dpr,
        height,
        particles,
        qualityScale,
        reducedMotion,
        width,
      }),
    });
    const drawerById = Object.freeze({
      "audio-terrain":drawAudioTerrain,
      "comet-field":drawCometField,
      "cosmic-bloom":drawBloom,
      "double-helix":drawHelix,
      "geiss-waves":drawGeissWaves,
      "ink-bloom":drawInkBloom,
      "kaleidoscope":drawKaleidoscope,
      "liquid-aurora":drawLiquidAurora,
      "milkdrop-flow":drawMilkDropFlow,
      "neon-spectrum":drawNeonSpectrum,
      "orbital-tunnel":drawTunnel,
      "oscilloscope":drawOscilloscope,
      "particle-constellation":drawParticleConstellation,
      "spectrum-waterfall":drawSpectrumWaterfall,
      "spirograph":drawSpirograph,
      "tunnel-flight":drawTunnelFlight,
      ...ambientDrawers,
    });
    const DRAWERS = Object.freeze(SCENE_CATALOG.map(sceneEntry=>{
      const drawer = drawerById[sceneEntry.id];
      if(typeof drawer !== "function"){
        throw new Error(`Missing Orbit Bloom renderer: ${sceneEntry.id}`);
      }
      return drawer;
    }));

    function changeScene(nextScene, now, transitionMs=TRANSITION_MS){
      if(nextScene === currentScene) return;
      previousScene = currentScene < 0 ? nextScene : currentScene;
      currentScene = nextScene;
      sceneChangedAt = now;
      transitionDurationMs = transitionMs;
      onSceneChange(SCENES[currentScene], sceneSelection);
    }

    function render({frequencyData, waveformData, now=performance.now()}={}){
      if(!isActive || !ensureSize() || !frequencyData?.length) return;
      if(sceneSelection === AUTO_SCENE && now >= autoSceneExpiresAt){
        changeScene(randomAutoSceneIndex(currentScene, random), now);
        autoSceneExpiresAt = now + autoSceneDurationMs(currentScene);
      }
      const audio = levels(frequencyData, waveformData, now);
      rememberSpectrum(now);
      const time = reducedMotion ? 0 : now / 1000;
      const transition = clamp((now - sceneChangedAt) / transitionDurationMs);
      const eased = transition * transition * (3 - 2 * transition);
      const previousColors = paletteAt(previousScene);
      const currentColors = paletteAt(currentScene);
      const backdropColors = mixPalette(previousColors, currentColors, eased);
      backdrop(backdropColors, audio, time);
      // Stop invoking the outgoing renderer after its transition. Several
      // scenes set their own canvas alpha, so drawing an "invisible" previous
      // scene could otherwise leave parts of it visible indefinitely.
      if(transition < 1){
        context.save();
        context.globalAlpha = 1 - eased;
        DRAWERS[previousScene](previousColors, audio, waveformData, time);
        context.restore();
      }
      context.save();
      context.globalAlpha = eased;
      DRAWERS[currentScene](currentColors, audio, waveformData, time);
      context.restore();
    }

    function drawIdle(){
      if(!ensureSize()) return;
      context.clearRect(0, 0, width, height);
      const idleScene = currentScene < 0 ? 0 : currentScene;
      const colors = paletteAt(idleScene);
      const audio = {
        bass:.02,
        mids:.025,
        highs:.015,
        energy:.025,
        beat:0,
        kick:0,
        snare:0,
        hat:0,
        memory:0,
      };
      backdrop(colors, audio, 0);
      drawAtmosphere(colors, audio, 0, .42);
    }

    function resetDynamics(){
      adaptivePeak = .2;
      adaptiveFloor = .012;
      frameTimeFollower = 16.67;
      qualityScale = 1;
      fastEnergy = 0;
      slowEnergy = 0;
      bassFollower = 0;
      beatPulse = 0;
      lastBeatAt = 0;
      rhythmMemory = 0;
      lastFrameAt = 0;
      lastSpectrumSnapshotAt = 0;
      spectrumHistory = [];
      smoothSpectrum.fill(0);
      for(const key of Object.keys(followers)) followers[key] = 0;
      for(const key of Object.keys(rhythmFollowers)) rhythmFollowers[key] = 0;
      for(const key of Object.keys(rhythmPulses)) rhythmPulses[key] = 0;
      for(const key of Object.keys(lastRhythmAt)) lastRhythmAt[key] = 0;
    }

    function open(){
      isActive = true;
      const now = performance.now();
      currentScene = sceneSelection === AUTO_SCENE
        ? randomAutoSceneIndex(-1, random)
        : sceneIndexForSelection(sceneSelection);
      previousScene = currentScene;
      sceneChangedAt = now - TRANSITION_MS;
      transitionDurationMs = TRANSITION_MS;
      autoSceneExpiresAt = now + autoSceneDurationMs(currentScene);
      resetDynamics();
      onSceneChange(SCENES[currentScene], sceneSelection);
      drawIdle();
    }

    function close(){
      isActive = false;
      if(context) context.clearRect(0, 0, canvas.width, canvas.height);
    }

    function pause(){
      if(isActive) drawIdle();
    }

    function setScene(selection){
      const normalized = normalizeSceneSelection(selection);
      if(normalized === sceneSelection) return sceneSelection;
      sceneSelection = normalized;
      const now = performance.now();
      if(sceneSelection === AUTO_SCENE){
        changeScene(
          randomAutoSceneIndex(currentScene, random),
          now,
          MANUAL_TRANSITION_MS
        );
        autoSceneExpiresAt = now + autoSceneDurationMs(currentScene);
      }else if(isActive){
        changeScene(
          sceneIndexForSelection(sceneSelection),
          now,
          MANUAL_TRANSITION_MS
        );
      }
      return sceneSelection;
    }

    function setArtwork(source){
      const normalized = String(source || "").trim();
      if(normalized === artworkSource) return;
      artworkSource = normalized;
      artworkImage = null;
      if(!normalized || typeof window.Image !== "function") return;
      const image = new window.Image();
      image.decoding = "async";
      image.onload = ()=>{
        if(artworkSource !== normalized) return;
        artworkImage = image;
        if(isActive && currentScene === SCENE_OPTIONS.length - 1) drawIdle();
      };
      image.onerror = ()=>{
        if(artworkSource === normalized){
          artworkImage = null;
          artworkSource = "";
        }
      };
      image.src = normalized;
    }

    function setSharedGlow(enabled){
      sharedGlowEnabled = Boolean(enabled);
      if(isActive) drawIdle();
      return sharedGlowEnabled;
    }

    return {
      active:()=>isActive,
      close,
      currentScene:()=>currentScene < 0 ? SCENES[0] : SCENES[currentScene],
      open,
      pause,
      render,
      resize:()=>{if(isActive) drawIdle();},
      sceneSelection:()=>sceneSelection,
      setArtwork,
      setScene,
      setSharedGlow,
      sharedGlowEnabled:()=>sharedGlowEnabled,
    };
  }

  window.MediaPlayerOrbitBloom = {
    AUTO_SCENE,
    AUTO_SCENE_IDS,
    SCENE_OPTIONS,
    SCENES,
    SCENE_DURATION_MS,
    VISUAL_PALETTES,
    averageBand,
    coverCrop,
    create,
    mixPalette,
    mixRgb,
    normalizeLevel,
    paletteAt,
    qualityScaleForFrameTime,
    randomSceneIndex,
    randomAutoSceneIndex,
    rhythmBands,
    sceneIndexForSelection,
    spectralCentroid,
    normalizeSceneSelection,
    waveformEnergy,
  };
})();
