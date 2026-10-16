(function(root) {
  // Renders protection layers for one overlay window (one per display).
  // renderState: { blur, pixelate, blackout, focus, vignette, level }
  const Intensity = root.SmartScreenIntensity;

  const CAPTURE_INTERVAL_MS = 125;
  const CAPTURE_RETRY_MS = 3000;

  function createPixelateController(api, layer, canvas) {
    let running = false;
    let starting = false;
    let stream = null;
    let video = null;
    let drawTimer = null;
    let retryTimer = null;
    let blockPx = 24;
    let hasFrame = false;

    function showCover() {
      hasFrame = false;
      canvas.style.visibility = 'hidden';
    }

    function teardown() {
      if (drawTimer) { clearInterval(drawTimer); drawTimer = null; }
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
      if (video) { video.srcObject = null; video = null; }
      showCover();
    }

    function fail(reason) {
      console.warn(`Pixelate capture unavailable (${reason}); showing opaque cover.`);
      teardown();
      if (running && !retryTimer) {
        retryTimer = setTimeout(() => { retryTimer = null; if (running) begin(); }, CAPTURE_RETRY_MS);
      }
    }

    function draw() {
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      const w = Math.max(1, Math.ceil(window.innerWidth / blockPx));
      const h = Math.max(1, Math.ceil(window.innerHeight / blockPx));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(video, 0, 0, w, h);
      if (!hasFrame) {
        hasFrame = true;
        canvas.style.visibility = 'visible';
      }
    }

    async function begin() {
      if (starting || stream) return;
      starting = true;
      try {
        const source = await api.getCaptureSource();
        if (!running) return;
        if (!source?.ok || !source.sourceId) throw new Error(source?.error || 'no capture source');

        const media = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: source.sourceId,
              maxWidth: 1280,
              maxHeight: 1280,
              maxFrameRate: 10
            }
          }
        });
        if (!running) { media.getTracks().forEach((t) => t.stop()); return; }

        stream = media;
        stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => fail('capture ended')));
        video = document.createElement('video');
        video.muted = true;
        video.srcObject = stream;
        await video.play();
        drawTimer = setInterval(() => {
          try { draw(); } catch (error) { fail(error.message); }
        }, CAPTURE_INTERVAL_MS);
      } catch (error) {
        fail(error?.message || 'capture error');
      } finally {
        starting = false;
      }
    }

    return {
      update(enabled, block) {
        blockPx = Math.max(2, Math.round(block || blockPx));
        if (enabled && !running) {
          running = true;
          showCover();
          begin();
        } else if (!enabled && running) {
          running = false;
          if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
          teardown();
        }
        layer.style.opacity = enabled ? '1' : '0';
      },
      get hasFrame() { return hasFrame; }
    };
  }

  function create({ api, initialPointer }) {
    const blurLayer = document.getElementById('overlay');
    const pixelateLayer = document.getElementById('pixelateLayer');
    const pixelateCanvas = document.getElementById('pixelateCanvas');
    const blackoutLayer = document.getElementById('blackoutLayer');
    const focusLayer = document.getElementById('focusLayer');
    const vignetteLayer = document.getElementById('vignetteLayer');

    const pixelate = createPixelateController(api, pixelateLayer, pixelateCanvas);
    let state = { blur: false, pixelate: false, blackout: false, focus: false, vignette: false, level: Intensity.DEFAULT_LEVEL, curtain: null };
    let pointerX = initialPointer?.x ?? window.innerWidth / 2;
    let pointerY = initialPointer?.y ?? window.innerHeight / 2;

    function renderFocus(params) {
      focusLayer.style.background = `radial-gradient(circle 120px at ${pointerX}px ${pointerY}px, transparent 0px, rgba(0,0,0,${params.focusDarkness}) 150px)`;
    }

    // Presence Gate curtain ({ on, effect }) is drawn at full intensity on top of the
    // manual effects and appears without the fade-in transition.
    function curtainEffect() {
      return state.curtain && state.curtain.on ? state.curtain.effect || 'blackout' : null;
    }

    function setInstant(layer, instant) {
      layer.style.transition = instant ? 'none' : '';
    }

    function apply(next) {
      state = { ...state, ...next };
      const params = Intensity.computeIntensity(state.level);
      const full = Intensity.computeIntensity(100);
      const curtain = curtainEffect();

      const blurCurtain = curtain === 'blur';
      const blurPx = blurCurtain ? full.blurPx : params.blurPx;
      blurLayer.style.backdropFilter = `blur(${blurPx}px)`;
      blurLayer.style.webkitBackdropFilter = `blur(${blurPx}px)`;
      blurLayer.style.background = `rgba(0,0,0,${blurCurtain ? full.dimOpacity : params.dimOpacity})`;
      setInstant(blurLayer, blurCurtain);
      blurLayer.style.opacity = state.blur || blurCurtain ? '1' : '0';

      const pixelCurtain = curtain === 'pixelate';
      setInstant(pixelateLayer, pixelCurtain);
      pixelate.update(Boolean(state.pixelate) || pixelCurtain, pixelCurtain ? full.pixelBlockPx : params.pixelBlockPx);

      const blackCurtain = curtain === 'blackout';
      blackoutLayer.style.background = `rgba(0,0,0,${blackCurtain ? 1 : params.blackoutOpacity})`;
      setInstant(blackoutLayer, blackCurtain);
      blackoutLayer.style.opacity = state.blackout || blackCurtain ? '1' : '0';

      if (state.focus) renderFocus(params);
      focusLayer.style.opacity = state.focus ? '1' : '0';

      vignetteLayer.style.background = `radial-gradient(circle at center, rgba(0,0,0,0) 40%, rgba(0,0,0,${params.vignetteOpacity}) 85%)`;
      vignetteLayer.style.opacity = state.vignette ? '1' : '0';
      document.body.classList.toggle('curtain-on', Boolean(curtain));
    }

    document.addEventListener('mousemove', (event) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (state.focus) renderFocus(Intensity.computeIntensity(state.level));
    });

    return { apply, get state() { return { ...state }; } };
  }

  root.SmartScreenEffects = Object.freeze({ create });
})(window);
