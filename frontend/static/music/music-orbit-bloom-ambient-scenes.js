/*
 * Adapted from Local Media Player Orbit Bloom.
 * Copyright (c) 2026 sagan246. SPDX-License-Identifier: MIT.
 */
// Ambient and artwork-driven full-screen visualizer scenes.
//
// The core renderer supplies the live canvas state and shared drawing helpers.
// Keeping these scenes here lets the engine own timing/audio analysis without
// also becoming the permanent home for every visual experiment.
(function(){
  "use strict";

  function create(runtime){
    const glowSprites = new Map();

    function state(){
      return runtime.state();
    }

    function glowSprite(color){
      const key = color.join(",");
      if(glowSprites.has(key)) return glowSprites.get(key);
      const canvas = window.document?.createElement?.("canvas");
      if(!canvas){
        glowSprites.set(key, null);
        return null;
      }
      const size = 128;
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if(!context){
        glowSprites.set(key, null);
        return null;
      }
      const gradient = context.createRadialGradient(
        size / 2,
        size / 2,
        0,
        size / 2,
        size / 2,
        size / 2
      );
      gradient.addColorStop(0, `rgba(${key},1)`);
      gradient.addColorStop(.18, `rgba(${key},.58)`);
      gradient.addColorStop(1, `rgba(${key},0)`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
      glowSprites.set(key, canvas);
      return canvas;
    }

    // A broad, offset dust band gives this scene a recognizable silhouette
    // even when the optional shared center glow is disabled. The low and mid
    // bands breathe through the clouds while treble animates the star field.
    function drawDeepSpaceNebula(colors, audio, waveformData, time){
      const {
        context,
        width,
        height,
        dpr,
        reducedMotion,
        particles,
        qualityScale,
      } = state();
      const cy = runtime.stageCenterY();
      const shortSide = Math.min(width, height);
      const motion = reducedMotion ? 0 : time;
      context.save();
      context.globalCompositeOperation = "screen";

      // Overlapping cloud knots form a diagonal S-curve instead of another
      // centered halo. Adjacent layers drift at different rates for depth.
      const cloudLayers = reducedMotion ? 2 : 3;
      const cloudSteps = reducedMotion ? 9 : 14;
      for(let layer=0; layer<cloudLayers; layer++){
        for(let step=0; step<cloudSteps; step++){
          const ratio = step / Math.max(1, cloudSteps - 1);
          const waveIndex = waveformData?.length
            ? Math.min(
              waveformData.length - 1,
              Math.floor(ratio * waveformData.length)
            )
            : 0;
          const wave = waveformData?.length
            ? Math.abs((waveformData[waveIndex] - 128) / 128)
            : 0;
          const phase = ratio * Math.PI * 1.7
            + layer * .82
            + motion * (.018 + layer * .004);
          const x = width * (-.08 + ratio * 1.16);
          const y = cy
            + Math.sin(phase) * shortSide * (.16 + layer * .025)
            + (ratio - .5) * shortSide * .12
            + (layer - 1) * shortSide * .07;
          const radius = shortSide * (
            .13
            + runtime.seededUnit(step + layer * cloudSteps, 31) * .075
            + audio.bass * .025
            + wave * .018
          );
          const color = (step + layer) % 4 === 0
            ? colors.flare
            : layer === 1 ? colors.glow : colors.accent;
          const cloud = context.createRadialGradient(x, y, 0, x, y, radius);
          cloud.addColorStop(
            0,
            runtime.rgba(
              color,
              .045 + audio.energy * .075 + audio.mids * .035 + wave * .025
            )
          );
          cloud.addColorStop(
            .38,
            runtime.rgba(color, .026 + audio.mids * .035)
          );
          cloud.addColorStop(1, runtime.rgba(color, 0));
          context.fillStyle = cloud;
          context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
      }

      const starCount = Math.max(
        reducedMotion ? 44 : 72,
        Math.floor(particles.length * qualityScale * 1.3)
      );
      for(let index=0; index<starCount; index++){
        const particle = particles[index % particles.length];
        const x = runtime.seededUnit(index, 40) * width;
        const drift = reducedMotion
          ? 0
          : motion * (1.4 + particle.depth * 4.5) * dpr;
        const y = (runtime.seededUnit(index, 41) * height + drift) % height;
        const shimmer = .25 + .75 * Math.max(
          0,
          Math.sin(motion * (1.1 + particle.depth) + particle.shimmer)
        );
        const brightStar = index % 13 === 0;
        const size = (
          .45
          + particle.depth * 1.35
          + audio.hat * (brightStar ? 2.1 : .85)
        ) * dpr;
        const color = brightStar ? colors.flare : colors.sheen;
        context.fillStyle = runtime.rgba(
          color,
          .11 + shimmer * .28 + audio.highs * .26 + audio.hat * .14
        );
        context.beginPath();
        context.arc(x, y, size, 0, runtime.TAU);
        context.fill();
        if(brightStar && (audio.hat > .12 || shimmer > .86)){
          context.strokeStyle = runtime.rgba(
            color,
            .08 + shimmer * .22 + audio.hat * .24
          );
          context.lineWidth = .65 * dpr;
          context.beginPath();
          context.moveTo(x - size * 4, y);
          context.lineTo(x + size * 4, y);
          context.moveTo(x, y - size * 4);
          context.lineTo(x, y + size * 4);
          context.stroke();
        }
      }

      // A narrow bright seam makes the cloud band legible on OLED blacks.
      for(let layer=0; layer<2; layer++){
        context.strokeStyle = runtime.rgba(
          layer ? colors.flare : colors.sheen,
          .028 + audio.energy * .055 + audio.snare * .025
        );
        context.lineWidth = (
          (layer ? 2.5 : 7) + audio.bass * (layer ? 4 : 12)
        ) * dpr;
        context.beginPath();
        for(let step=0; step<=36; step++){
          const ratio = step / 36;
          const x = width * (-.04 + ratio * 1.08);
          const y = cy
            + Math.sin(ratio * Math.PI * 1.7 + motion * .018) * shortSide * .16
            + (ratio - .5) * shortSide * .12;
          if(step === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }
      context.restore();
    }

    // Recreates the game's large bloom field without depending on its DOM or
    // state. Bass expands the nested halos, mids animate the radial spokes,
    // and high-frequency transients add small cyan sparks around the field.
    function drawGameBloom(colors, audio, waveformData, time){
      const {
        context,
        width,
        height,
        dpr,
        reducedMotion,
        particles,
        qualityScale,
      } = state();
      const cx = width * .5;
      const cy = runtime.stageCenterY();
      const shortSide = Math.min(width, height);
      const outerRadius = Math.max(
        shortSide * .54,
        Math.min(width, height * 1.16) * (.48 + audio.bass * .035)
      );
      const pulse = reducedMotion
        ? 0
        : Math.sin(time * .72) * .008 + audio.kick * .045;

      context.save();
      context.globalCompositeOperation = "screen";

      const fieldRadius = outerRadius * (1.12 + audio.energy * .09);
      const field = context.createRadialGradient(
        cx,
        cy,
        0,
        cx,
        cy,
        fieldRadius
      );
      field.addColorStop(
        0,
        runtime.rgba(colors.glow, .085 + audio.bass * .11)
      );
      field.addColorStop(
        .3,
        runtime.rgba(colors.accent, .055 + audio.mids * .08)
      );
      field.addColorStop(
        .68,
        runtime.rgba(colors.glow, .028 + audio.energy * .05)
      );
      field.addColorStop(1, runtime.rgba(colors.background, 0));
      context.fillStyle = field;
      context.fillRect(0, 0, width, height);

      // Soft nested rings give the scene the same oversized target-like
      // structure as the game while remaining subtle behind lyrics.
      const ringScales = [.3, .55, .82, 1];
      for(let index=0; index<ringScales.length; index++){
        const radius = outerRadius * ringScales[index] * (1 + pulse);
        const color = index % 2 ? colors.glow : colors.accent;
        context.strokeStyle = runtime.rgba(
          color,
          .025 + audio.energy * .035 + (index === 3 ? audio.kick * .06 : 0)
        );
        context.lineWidth = (
          index === 3 ? 7 + audio.bass * 9 : 3 + audio.mids * 4
        ) * dpr;
        context.shadowColor = runtime.rgba(color, .18 + audio.energy * .2);
        context.shadowBlur = (12 + audio.bass * 30) * dpr;
        context.beginPath();
        context.arc(cx, cy, radius, 0, runtime.TAU);
        context.stroke();
      }

      const spokeCount = reducedMotion
        ? 72
        : Math.round(104 + qualityScale * 32);
      context.shadowBlur = 0;
      context.lineCap = "round";
      for(let index=0; index<spokeCount; index++){
        const ratio = index / spokeCount;
        const spectrum = audio.spectrum[
          Math.min(
            runtime.SPECTRUM_POINTS - 1,
            Math.floor(ratio * runtime.SPECTRUM_POINTS)
          )
        ];
        const waveIndex = waveformData?.length
          ? Math.min(
              waveformData.length - 1,
              Math.floor(ratio * waveformData.length)
            )
          : 0;
        const wave = waveformData?.length
          ? Math.abs((waveformData[waveIndex] - 128) / 128)
          : 0;
        const angle = ratio * runtime.TAU - Math.PI / 2;
        const inner = outerRadius * (1.025 + audio.kick * .012);
        const length = (
          13
          + spectrum * 52
          + wave * 20
          + audio.highs * 12
        ) * dpr;
        const color = index % 5 === 0 ? colors.glow : colors.accent;
        context.strokeStyle = runtime.rgba(
          color,
          .08 + spectrum * .18 + audio.highs * .08
        );
        context.lineWidth = (.65 + spectrum * .75) * dpr;
        context.beginPath();
        context.moveTo(
          cx + Math.cos(angle) * inner,
          cy + Math.sin(angle) * inner
        );
        context.lineTo(
          cx + Math.cos(angle) * (inner + length),
          cy + Math.sin(angle) * (inner + length)
        );
        context.stroke();
      }

      // A few detached sparks echo the glowing game pieces without turning
      // this scene into gameplay or making the motion visually busy.
      const sparkCount = reducedMotion
        ? 5
        : Math.max(8, Math.floor(13 * qualityScale));
      for(let index=0; index<sparkCount; index++){
        const particle = particles[index];
        const phase = particle.shimmer;
        const orbit = outerRadius * (
          .42 + runtime.seededUnit(index, 71) * .66
        );
        const drift = reducedMotion
          ? 0
          : time * (.022 + particle.depth * .025) * (index % 2 ? 1 : -1);
        const angle = runtime.seededUnit(index, 72) * runtime.TAU + drift;
        const x = cx + Math.cos(angle) * orbit;
        const y = cy + Math.sin(angle) * orbit * .86;
        const spectrum = audio.spectrum[index % runtime.SPECTRUM_POINTS];
        const radius = (
          1.2 + particle.depth * 2.6 + spectrum * 3.5 + audio.hat * 2
        ) * dpr;
        const color = index % 4 === 0 ? colors.flare : colors.sheen;
        const sprite = glowSprite(color);
        const halo = radius * (5 + audio.energy * 3);
        if(sprite){
          context.globalAlpha = .08 + spectrum * .2 + audio.hat * .15;
          context.drawImage(
            sprite,
            x - halo,
            y - halo,
            halo * 2,
            halo * 2
          );
          context.globalAlpha = 1;
        }
        context.fillStyle = runtime.rgba(
          color,
          .25 + spectrum * .45 + audio.hat * .2
        );
        context.beginPath();
        context.arc(x, y, Math.max(.7 * dpr, radius), 0, runtime.TAU);
        context.fill();
      }
      context.restore();
    }

    // Bioluminescent motes move through a loose flow field rather than an
    // orbit. Glow sprites avoid rebuilding dozens of gradients every frame.
    function drawLuminousDrift(
      colors,
      audio,
      waveformData,
      time,
      {density=1, opacity=1, speedScale=.2, trails=1}={}
    ){
      const {
        context,
        width,
        height,
        dpr,
        reducedMotion,
        particles,
        qualityScale,
      } = state();
      const baseMoteCount = reducedMotion
        ? 32
        : Math.max(44, Math.floor(particles.length * qualityScale));
      const moteCount = Math.max(18, Math.floor(baseMoteCount * density));
      const speed = .45 + audio.mids * 1.35 + audio.snare * .32;
      const motionTime = time * speedScale;
      context.save();
      context.globalCompositeOperation = "screen";
      for(let index=0; index<moteCount; index++){
        const particle = particles[index];
        const phase = particle.shimmer;
        const depth = particle.depth;
        const baseX = runtime.seededUnit(index, 51) * width;
        const baseY = runtime.seededUnit(index, 52) * height;
        const horizontalTravel = motionTime * (
          5 + depth * 13
        ) * speed * dpr;
        const x = (
          baseX
          + horizontalTravel
          + Math.sin(
            motionTime * (.17 + depth * .18) + phase
          ) * width * .055
        ) % (width + 60 * dpr) - 30 * dpr;
        const y = (
          baseY
          + Math.sin(
            motionTime * (.24 + depth * .2) + phase * 1.7
          ) * height * .075
          + Math.cos(motionTime * .11 + phase) * height * .025
          + height
        ) % height;
        const spectrum = audio.spectrum[index % runtime.SPECTRUM_POINTS];
        const near = depth > .62;
        const flicker = .4 + .6 * Math.max(
          0,
          Math.sin(time * (1.2 + depth * 2.4) + phase)
        );
        const transient = index % 5 === 0
          ? audio.hat
          : index % 3 === 0 ? audio.snare : audio.kick;
        const radius = (
          .75
          + depth * 3.15
          + spectrum * 3.8
          + (near ? audio.bass * 4.8 + audio.kick * 2.5 : audio.highs * 2.2)
        ) * dpr;
        const color = audio.hat > .09 && index % 6 === 0
          ? colors.flare
          : index % 4 === 0
            ? colors.glow
            : index % 3 === 0 ? colors.sheen : colors.accent;
        const alpha = opacity * (
          .055
          + depth * .09
          + spectrum * .18
          + flicker * audio.highs * .14
          + transient * .18
        );
        const haloRadius = radius * (
          3.7 + audio.bass * 2.2 + transient * 1.8
        );
        const sprite = glowSprite(color);
        if(sprite){
          context.globalAlpha = runtime.clamp(alpha * 1.55);
          context.drawImage(
            sprite,
            x - haloRadius,
            y - haloRadius,
            haloRadius * 2,
            haloRadius * 2
          );
          context.globalAlpha = 1;
        }else{
          const halo = context.createRadialGradient(
            x,
            y,
            0,
            x,
            y,
            haloRadius
          );
          halo.addColorStop(0, runtime.rgba(color, alpha * 1.55));
          halo.addColorStop(.2, runtime.rgba(color, alpha * .64));
          halo.addColorStop(1, runtime.rgba(color, 0));
          context.fillStyle = halo;
          context.beginPath();
          context.arc(x, y, haloRadius, 0, runtime.TAU);
          context.fill();
        }

        context.fillStyle = runtime.rgba(
          near && audio.kick > .12 ? colors.sheen : color,
          .32 + alpha * 1.6
        );
        context.beginPath();
        context.arc(x, y, Math.max(.75 * dpr, radius * .42), 0, runtime.TAU);
        context.fill();

        if(
          trails > 0
          && !reducedMotion
          && (audio.energy > .06 || transient > .035)
        ){
          const trail = (
            5 + audio.mids * 20 + transient * 24
          ) * depth * dpr * trails;
          context.strokeStyle = runtime.rgba(
            color,
            alpha * (.25 + transient * .8)
          );
          context.lineWidth = Math.max(.55 * dpr, radius * .18);
          context.lineCap = "round";
          context.beginPath();
          context.moveTo(x, y);
          context.quadraticCurveTo(
            x - trail * .46,
            y - Math.sin(phase + motionTime * .3) * trail * .14,
            x - trail,
            y + Math.cos(phase) * trail * .12
          );
          context.stroke();
        }
      }
      context.restore();
    }

    // The cover remains recognizable while waveform-driven horizontal slices
    // refract it. A darker base and color echoes keep text readable on top.
    function drawAlbumWarp(colors, audio, waveformData, time){
      const {
        context,
        width,
        height,
        dpr,
        reducedMotion,
        artworkImage,
        qualityScale,
      } = state();
      if(!artworkImage?.complete || !artworkImage.naturalWidth){
        drawDeepSpaceNebula(colors, audio, waveformData, time);
        return;
      }
      const crop = runtime.coverCrop(
        artworkImage.naturalWidth,
        artworkImage.naturalHeight,
        width,
        height
      );
      const sliceCount = reducedMotion
        ? 24
        : Math.round(34 + qualityScale * 18);
      const sliceHeight = height / sliceCount;
      context.save();
      context.globalCompositeOperation = "source-over";
      context.fillStyle = "rgba(0,0,0,.62)";
      context.fillRect(0, 0, width, height);
      for(let slice=0; slice<sliceCount; slice++){
        const ratio = slice / sliceCount;
        const sampleIndex = waveformData?.length
          ? Math.min(
              waveformData.length - 1,
              Math.floor(ratio * waveformData.length)
            )
          : 0;
        const wave = waveformData?.length
          ? (waveformData[sampleIndex] - 128) / 128
          : 0;
        const spectrum = audio.spectrum[
          Math.min(
            runtime.SPECTRUM_POINTS - 1,
            Math.floor(ratio * runtime.SPECTRUM_POINTS)
          )
        ];
        const sway = Math.sin(ratio * runtime.TAU * 2.4 + time * .46) * (
          3 + audio.mids * 17
        ) * dpr;
        const offset = sway + wave * (8 + audio.waveform * 42) * dpr;
        const sourceY = crop.sy + crop.sh * ratio;
        const sourceHeight = crop.sh / sliceCount + 1;
        const destinationY = slice * sliceHeight;
        context.globalAlpha = .3 + audio.energy * .22;
        context.drawImage(
          artworkImage,
          crop.sx,
          sourceY,
          crop.sw,
          sourceHeight,
          offset - spectrum * 9 * dpr,
          destinationY,
          width + spectrum * 18 * dpr,
          sliceHeight + 1
        );
      }

      context.globalCompositeOperation = "screen";
      context.globalAlpha = .08 + audio.snare * .13;
      context.drawImage(
        artworkImage,
        crop.sx,
        crop.sy,
        crop.sw,
        crop.sh,
        -audio.kick * 13 * dpr,
        0,
        width,
        height
      );
      const tint = context.createLinearGradient(0, 0, width, height);
      tint.addColorStop(0, runtime.rgba(colors.glow, .08 + audio.bass * .08));
      tint.addColorStop(.48, "rgba(0,0,0,0)");
      tint.addColorStop(1, runtime.rgba(colors.flare, .06 + audio.highs * .08));
      context.globalAlpha = 1;
      context.fillStyle = tint;
      context.fillRect(0, 0, width, height);
      context.restore();
      runtime.drawAtmosphere(colors, audio, time * .3, .3);
      // The artwork refraction is the foundation; sparse moving lights add
      // the lively depth that appeared during the original scene crossfade.
      const wideScreen = width > height;
      drawLuminousDrift(colors, audio, waveformData, time, {
        density:wideScreen ? .42 : .58,
        opacity:wideScreen ? .3 : .56,
        speedScale:1,
        trails:wideScreen ? .24 : .36,
      });
    }

    return Object.freeze({
      "album-warp":drawAlbumWarp,
      "deep-space-nebula":drawDeepSpaceNebula,
      "game-bloom":drawGameBloom,
      "luminous-drift":drawLuminousDrift,
    });
  }

  window.MediaPlayerOrbitBloomAmbientScenes = {create};
})();
