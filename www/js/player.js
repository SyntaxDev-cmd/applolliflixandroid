// ============================================================
//  LOLLIFLIX - Player
//  - Ao vivo (.m3u8): hls.js com carregador nativo (CapacitorHttp) -> sem CORS
//  - Filmes/series (.mp4 etc): <video> nativo
//  - Retoma de onde parou (startAt + onProgress)
//  - SISTEMA ANTI-TRAVAMENTO: um vigia confere a cada segundo se o video
//    esta andando. Se travar, tenta em etapas: pular o buraco no buffer,
//    recarregar o stream, e por fim reabrir a fonte no mesmo ponto.
// ============================================================
window.Player = (function () {
  var overlay, video, titleEl, spinner, statusEl, errBox, errMsg, ui, seekWrap, seekEl, bufEl, curEl, durEl;
  var hls = null, hideTimer = null, wired = false;
  var S = null;            // sessao atual: {url, title, live, onProgress, onEnded}
  var handlers = {};       // {zap(delta), close()} definidos pelo app
  var seeking = false, lastSaved = 0;
  var FITS = ['contain', 'cover', 'fill'], FIT_LABEL = { contain: 'Original', cover: 'Zoom', fill: 'Esticar' }, fitIdx = 0;

  // ---- estado do vigia anti-travamento ----
  var wd = { timer: null, lastT: -1, stall: 0, goodT: 0, reloads: 0, nudges: 0, softDone: false, startedAt: 0, everPlayed: false };
  var STALL_NUDGE = 4, STALL_SOFT = 8, STALL_HARD = 15, START_TIMEOUT = 25, MAX_RELOADS = 6;

  var ICON = {
    back: '<svg viewBox="0 0 24 24"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20v-2z"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
    rew: '<svg viewBox="0 0 24 24"><path d="M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6H4c0 4.4 3.6 8 8 8s8-3.6 8-8-3.6-8-8-8z"/><text x="12" y="16.2" font-size="6.5" font-weight="700" text-anchor="middle">10</text></svg>',
    fwd: '<svg viewBox="0 0 24 24"><path d="M12 5V1l5 5-5 5V7c-3.3 0-6 2.7-6 6s2.7 6 6 6 6-2.7 6-6h2c0 4.4-3.6 8-8 8s-8-3.6-8-8 3.6-8 8-8z"/><text x="12" y="16.2" font-size="6.5" font-weight="700" text-anchor="middle">10</text></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
    vol: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4zM14 3.2v2.1c2.9.9 5 3.5 5 6.7s-2.1 5.800-5 6.700v2.100c4-.9 7-4.500 7-8.800s-3-7.900-7-8.800z"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.8-1-3.3-2.5-4v2.2l2.500 2.500V12zM19 12c0 .9-.2 1.800-.5 2.600l1.500 1.500c.6-1.200 1-2.600 1-4.100 0-4.300-3-7.900-7-8.800v2.100c2.900.9 5 3.500 5 6.700zM4.300 3L3 4.300 7.700 9H3v6h4l5 5v-6.700l4.200 4.200c-.7.500-1.400.9-2.200 1.200v2.100c1.400-.3 2.600-1 3.700-1.800l2 2 1.300-1.300-9-9L4.300 3zM12 4L9.900 6.100 12 8.200V4z"/></svg>',
    fit: '<svg viewBox="0 0 24 24"><path d="M19 12h-2v3h-3v2h5v-5zM7 9h3V7H5v5h2V9zm14-6H3c-1.100 0-2 .9-2 2v14c0 1.100.9 2 2 2h18c1.100 0 2-.9 2-2V5c0-1.100-.9-2-2-2zm0 16H3V5h18v14z"/></svg>'
  };

  function $(id) { return document.getElementById(id); }
  function ensure() {
    if (video) return;
    overlay = $('player'); video = $('videoEl'); titleEl = $('playerTitle');
    spinner = $('playerSpinner'); statusEl = $('plStatus'); errBox = $('playerError'); errMsg = $('plErrMsg');
    ui = $('plUi'); seekWrap = $('plSeekWrap'); seekEl = $('plSeek'); bufEl = $('plBuf'); curEl = $('plCur'); durEl = $('plDur');
    if (!wired && video) { wired = true; wire(); }
  }
  function isM3u8(url) { return /\.m3u8(\?|$)/i.test(url); }
  function now() { return Date.now(); }
  function destroyHls() { if (hls) { try { hls.destroy(); } catch (e) {} hls = null; } }
  function showSpinner(on, text) {
    if (spinner) spinner.style.display = on ? 'block' : 'none';
    if (statusEl) { statusEl.textContent = on && text ? text : ''; statusEl.style.display = on && text ? 'block' : 'none'; }
  }
  function showError(msg) {
    showSpinner(false);
    stopWatchdog();
    if (errBox) { errMsg.textContent = msg || 'Nao foi possivel reproduzir.'; errBox.style.display = 'flex'; }
    showUi();
  }
  function clearError() { if (errBox) errBox.style.display = 'none'; }

  // Tela ligada so enquanto o player esta aberto (ponte nativa do MainActivity)
  function keepAwake(on) { try { if (window.LolliNative && window.LolliNative.keepAwake) window.LolliNative.keepAwake(!!on); } catch (e) {} }

  function fmt(t) {
    t = Math.max(0, Math.floor(t || 0));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function isLive() { return !!(S && S.live); }
  function hasDuration() { return !isLive() && video && isFinite(video.duration) && video.duration > 0; }
  function bufferedAhead() {
    try {
      var b = video.buffered, t = video.currentTime;
      for (var i = 0; i < b.length; i++) if (t >= b.start(i) - 0.3 && t <= b.end(i)) return b.end(i) - t;
    } catch (e) {}
    return 0;
  }
  function nextBufferStart() {
    try {
      var b = video.buffered, t = video.currentTime;
      for (var i = 0; i < b.length; i++) if (b.start(i) > t + 0.05) return b.start(i);
    } catch (e) {}
    return -1;
  }

  function updateSeekUi() {
    if (!seekWrap) return;
    var ok = hasDuration();
    seekWrap.style.visibility = ok ? 'visible' : 'hidden';
    if (!ok) return;
    var d = video.duration;
    if (!seeking) {
      seekEl.value = Math.round(video.currentTime / d * 1000);
      curEl.textContent = fmt(video.currentTime);
    }
    durEl.textContent = fmt(d);
    seekEl.style.setProperty('--p', (seekEl.value / 10) + '%');
    if (bufEl) bufEl.style.width = Math.min(100, (video.currentTime + bufferedAhead()) / d * 100) + '%';
  }
  function updatePlayIcon() {
    var b = $('plPlay'); if (!b || !video) return;
    b.innerHTML = video.paused ? ICON.play : ICON.pause;
  }
  function updateMuteIcon() { var b = $('plMute'); if (b && video) b.innerHTML = video.muted ? ICON.mute : ICON.vol; }

  // Salva a posicao (filmes/series) para o "continuar assistindo"
  function saveProgress(force) {
    if (!S || !S.onProgress || !hasDuration()) return;
    var t = video.currentTime;
    if (!force && Math.abs(t - lastSaved) < 5) return;
    lastSaved = t;
    try { S.onProgress(t, video.duration); } catch (e) {}
  }

  function wire() {
    $('plBack').innerHTML = ICON.back;
    $('plFit').innerHTML = ICON.fit;
    updatePlayIcon(); updateMuteIcon();

    video.addEventListener('canplay', function () { if (!video.paused || !wd.everPlayed) showSpinner(false); });
    video.addEventListener('playing', function () {
      showSpinner(false); clearError();
      wd.stall = 0; wd.nudges = 0; wd.softDone = false; wd.everPlayed = true;
      updatePlayIcon(); resetHideTimer();
    });
    video.addEventListener('waiting', function () { if (isOpen() && !video.paused) showSpinner(true); });
    video.addEventListener('pause', function () { updatePlayIcon(); showUi(); saveProgress(true); });
    video.addEventListener('play', updatePlayIcon);
    video.addEventListener('volumechange', updateMuteIcon);
    video.addEventListener('timeupdate', function () { updateSeekUi(); saveProgress(false); });
    // o usuario mudou o ponto do video: a recuperacao deve voltar para o ponto NOVO
    video.addEventListener('seeking', function () { wd.stall = 0; if (S && !S.live) wd.goodT = video.currentTime; });
    video.addEventListener('durationchange', updateSeekUi);
    video.addEventListener('progress', updateSeekUi);
    video.addEventListener('ended', function () {
      if (!isOpen() || isLive()) return;
      var cb = S && S.onEnded;
      if (cb) { try { cb(); } catch (e) {} }
    });
    // erro do <video> nativo: em vez de desistir, tenta reabrir no mesmo ponto
    video.addEventListener('error', function () {
      if (!isOpen() || !S || hls) return;
      if (!video.getAttribute('src')) return;
      hardReload('erro de midia');
    });

    seekEl.addEventListener('input', function () {
      seeking = true; showUi();
      if (hasDuration()) curEl.textContent = fmt(seekEl.value / 1000 * video.duration);
      seekEl.style.setProperty('--p', (seekEl.value / 10) + '%');
    });
    seekEl.addEventListener('change', function () {
      if (hasDuration()) { video.currentTime = seekEl.value / 1000 * video.duration; wd.stall = 0; }
      seeking = false; resetHideTimer();
    });

    $('plRetry').addEventListener('click', function () { if (S) { wd.reloads = 0; startSource(wd.goodT); } });
    $('plFit').addEventListener('click', function () { cycleFit(); resetHideTimer(); });

    // a internet voltou: retoma na hora, sem esperar o vigia
    window.addEventListener('online', function () {
      if (!isOpen() || !S) return;
      var failed = errBox && errBox.style.display === 'flex';
      if (failed || wd.stall >= 3 || !wd.everPlayed) { wd.reloads = 0; clearError(); hardReload('conexao restabelecida'); }
    });
  }

  // ---- Carregador HLS via CapacitorHttp (Android) ----
  function b64ToArrayBuffer(b64) {
    try { var bin = atob(b64); var len = bin.length; var bytes = new Uint8Array(len); for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i); return bytes.buffer; }
    catch (e) { return new ArrayBuffer(0); }
  }
  function makeCapLoader() {
    var CapHttp = window.Capacitor.Plugins.CapacitorHttp;
    function Loader(config) {
      this.config = config;
      this.stats = { aborted: false, loaded: 0, retry: 0, total: 0, chunkCount: 0, bwEstimate: 0, loading: { start: 0, first: 0, end: 0 }, parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 } };
    }
    Loader.prototype.destroy = function () { this.abort(); };
    Loader.prototype.abort = function () { this.stats.aborted = true; this._aborted = true; };
    Loader.prototype.load = function (context, config, callbacks) {
      var self = this; this.context = context; this.callbacks = callbacks; this._aborted = false;
      var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
      this.stats.loading.start = t0;
      var respType = (context.responseType === 'arraybuffer') ? 'arraybuffer' : 'text';
      var headers = {};
      if (context.rangeEnd) headers['Range'] = 'bytes=' + (context.rangeStart || 0) + '-' + (context.rangeEnd - 1);
      CapHttp.request({ url: context.url, method: 'GET', responseType: respType, connectTimeout: 15000, readTimeout: 25000, headers: headers })
        .then(function (res) {
          if (self._aborted) return;
          var t1 = (window.performance && performance.now) ? performance.now() : Date.now();
          self.stats.loading.first = t1; self.stats.loading.end = t1;
          var data = res.data;
          if (respType === 'arraybuffer') { data = (typeof data === 'string') ? b64ToArrayBuffer(data) : (data || new ArrayBuffer(0)); self.stats.loaded = data.byteLength; }
          else { data = (data == null) ? '' : (typeof data === 'string' ? data : JSON.stringify(data)); self.stats.loaded = data.length; }
          self.stats.total = self.stats.loaded;
          var status = res.status || 200;
          if (status < 200 || status >= 400) { callbacks.onError({ code: status, text: 'HTTP ' + status }, context, null, self.stats); return; }
          callbacks.onSuccess({ url: res.url || context.url, data: data }, self.stats, context, null);
        })
        .catch(function (e) { if (self._aborted) return; callbacks.onError({ code: 0, text: String((e && e.message) || e) }, context, null, self.stats); });
    };
    return Loader;
  }
  function usingCap() { return !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp); }

  // ============================================================
  //  Abrir a fonte (usado na 1a vez e em cada recuperacao)
  // ============================================================
  function startSource(startAt) {
    if (!S) return;
    clearError();
    showSpinner(true, wd.reloads > 0 ? 'Reconectando... (' + wd.reloads + ')' : '');
    destroyHls();
    try { video.pause(); } catch (e) {}
    video.removeAttribute('src'); try { video.load(); } catch (e) {}
    wd.lastT = -1; wd.stall = 0; wd.nudges = 0; wd.softDone = false; wd.startedAt = now(); wd.everPlayed = false;
    startAt = (!S.live && startAt > 1) ? startAt : 0;

    if (isM3u8(S.url) && window.Hls && window.Hls.isSupported()) {
      var cfg = {
        enableWorker: true,
        lowLatencyMode: false,
        // buffer folgado: aguenta oscilacao da internet sem travar
        maxBufferLength: 30, maxMaxBufferLength: 90, backBufferLength: 30, maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.6, nudgeOffset: 0.2, nudgeMaxRetry: 12, highBufferWatchdogPeriod: 2,
        // ao vivo: fica alguns segmentos atras da ponta (evita "bufferizando" toda hora)
        liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 12, liveDurationInfinity: true,
        // rede: insiste antes de dar erro
        manifestLoadingTimeOut: 15000, manifestLoadingMaxRetry: 6, manifestLoadingRetryDelay: 800, manifestLoadingMaxRetryTimeout: 8000,
        levelLoadingTimeOut: 15000, levelLoadingMaxRetry: 8, levelLoadingRetryDelay: 800, levelLoadingMaxRetryTimeout: 8000,
        fragLoadingTimeOut: 25000, fragLoadingMaxRetry: 8, fragLoadingRetryDelay: 800, fragLoadingMaxRetryTimeout: 8000,
        startFragPrefetch: true, capLevelToPlayerSize: true, abrEwmaDefaultEstimate: 1500000,
        startPosition: startAt > 0 ? startAt : -1
      };
      if (usingCap()) { try { cfg.loader = makeCapLoader(); } catch (e) {} }
      hls = new window.Hls(cfg);
      var my = hls;
      hls.on(window.Hls.Events.MANIFEST_PARSED, function () { if (hls === my) playVideo(); });
      hls.on(window.Hls.Events.ERROR, function (evt, data) {
        if (hls !== my || !data || !data.fatal) return;
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && !wd.softDone) {
          wd.softDone = true;
          try { hls.recoverMediaError(); return; } catch (e) {}
        }
        hardReload(data.type === window.Hls.ErrorTypes.NETWORK_ERROR ? 'rede' : 'midia');
      });
      hls.loadSource(S.url); hls.attachMedia(video);
    } else {
      video.src = S.url;
      if (startAt > 0) {
        var seekOnce = function () { video.removeEventListener('loadedmetadata', seekOnce); try { video.currentTime = startAt; } catch (e) {} };
        video.addEventListener('loadedmetadata', seekOnce);
      }
      playVideo();
    }
    startWatchdog();
  }
  function playVideo() { var p = video.play(); if (p && p.catch) p.catch(function () {}); }

  // Recuperacao pesada: reabre a fonte do zero, no mesmo ponto (filmes) ou ao vivo
  var reloadTimer = null;
  function hardReload(why) {
    if (!S || !isOpen()) return;
    if (reloadTimer) return;                       // ja existe uma tentativa agendada
    if (wd.reloads >= MAX_RELOADS) {
      showError(S.live ? 'Canal fora do ar ou internet instavel. Tente novamente.' : 'Nao foi possivel carregar o video. Verifique a internet e tente novamente.');
      return;
    }
    wd.reloads++;
    var delay = Math.min(8000, 1000 * wd.reloads);  // espera crescente entre tentativas (~20s no total)
    showSpinner(true, 'Reconectando... (' + wd.reloads + ')');
    reloadTimer = setTimeout(function () { reloadTimer = null; if (S && isOpen()) startSource(wd.goodT); }, delay);
  }

  // ============================================================
  //  VIGIA ANTI-TRAVAMENTO (1 verificacao por segundo)
  // ============================================================
  function startWatchdog() {
    stopWatchdog();
    wd.timer = setInterval(tick, 1000);
  }
  function stopWatchdog() { if (wd.timer) { clearInterval(wd.timer); wd.timer = null; } }

  function tick() {
    if (!isOpen() || !S || reloadTimer) return;
    if (document.hidden) { wd.stall = 0; return; }               // app em segundo plano
    if (errBox && errBox.style.display === 'flex') return;

    // ainda nao comecou a tocar: da um prazo e reabre
    if (!wd.everPlayed) {
      if (!video.paused || video.readyState < 3) {
        if (now() - wd.startedAt > START_TIMEOUT * 1000) hardReload('demorou para iniciar');
      }
      return;
    }
    if (video.paused || video.ended || seeking) { wd.stall = 0; wd.lastT = video.currentTime; return; }

    var t = video.currentTime;
    if (Math.abs(t - wd.lastT) > 0.05) {
      // esta andando: tudo certo
      if (wd.stall >= STALL_NUDGE) showSpinner(false);
      wd.lastT = t; wd.stall = 0; wd.nudges = 0; wd.softDone = false;
      if (!S.live) wd.goodT = t;
      if (wd.reloads > 0 && bufferedAhead() > 4) wd.reloads = 0;  // estabilizou: zera o contador
      return;
    }

    wd.stall++;
    if (wd.stall === 2) showSpinner(true);

    // Etapa 1: tem video baixado logo a frente -> pula o "buraco" do buffer
    if (wd.stall >= STALL_NUDGE && wd.nudges < 3) {
      var nb = nextBufferStart();
      if (nb > 0 && nb - t < 12) { wd.nudges++; try { video.currentTime = nb + 0.1; } catch (e) {} return; }
      if (bufferedAhead() > 1) { wd.nudges++; try { video.currentTime = t + 0.3; } catch (e) {} playVideo(); return; }
    }

    // Etapa 2: religa o carregamento sem derrubar o video
    if (wd.stall >= STALL_SOFT && !wd.softDone) {
      wd.softDone = true;
      showSpinner(true, 'Recuperando o sinal...');
      if (hls) {
        try { hls.startLoad(S.live ? -1 : t); } catch (e) {}
        if (S.live) { try { var lp = hls.liveSyncPosition; if (lp && isFinite(lp) && lp > t) video.currentTime = lp; } catch (e) {} }
      }
      playVideo();
      return;
    }

    // Etapa 3: reabre a fonte no mesmo ponto
    if (wd.stall >= STALL_HARD) { wd.stall = 0; hardReload('travou'); }
  }

  // ============================================================
  //  API publica
  // ============================================================
  // opts: { live, startAt, onProgress(t, d), onEnded() }
  function open(url, title, opts) {
    ensure();
    opts = opts || {};
    S = { url: url, title: title || '', live: !!opts.live, onProgress: opts.onProgress || null, onEnded: opts.onEnded || null };
    seeking = false; lastSaved = opts.startAt || 0;
    wd.reloads = 0; wd.goodT = opts.startAt || 0;
    if (reloadTimer) { clearTimeout(reloadTimer); reloadTimer = null; }
    titleEl.textContent = S.title;
    overlay.classList.toggle('live', S.live);
    $('plPrev').innerHTML = S.live ? ICON.prev : ICON.rew;
    $('plNext').innerHTML = S.live ? ICON.next : ICON.fwd;
    overlay.classList.add('open'); document.body.classList.add('player-open');
    keepAwake(true);
    applyFit();
    updateSeekUi();
    startSource(opts.startAt || 0);
    resetHideTimer();
  }

  function close() {
    ensure();
    saveProgress(true);
    stopWatchdog();
    if (reloadTimer) { clearTimeout(reloadTimer); reloadTimer = null; }
    S = null;
    destroyHls();
    try { video.pause(); } catch (e) {}
    video.removeAttribute('src'); try { video.load(); } catch (e) {}
    showSpinner(false); clearError();
    if (hideTimer) clearTimeout(hideTimer);
    overlay.classList.remove('open'); document.body.classList.remove('player-open');
    keepAwake(false);
  }
  function togglePlay() { if (!video || !S) return; if (video.paused) playVideo(); else video.pause(); }
  function pause() { if (video && isOpen()) { try { video.pause(); } catch (e) {} } }
  function resume() { if (video && isOpen() && video.paused) playVideo(); }
  function toggleMute() { if (video) video.muted = !video.muted; }
  function seek(d) {
    if (!hasDuration()) return;
    video.currentTime = Math.min(video.duration - 1, Math.max(0, video.currentTime + d));
    wd.stall = 0; updateSeekUi();
  }
  // botoes centrais: filme = -10s / +10s ; ao vivo = canal anterior / proximo
  function step(dir) {
    if (isLive()) { if (handlers.zap) handlers.zap(dir); }
    else seek(dir * 10);
  }
  function applyFit() { if (video) video.style.objectFit = FITS[fitIdx]; }
  function cycleFit() { fitIdx = (fitIdx + 1) % FITS.length; applyFit(); return FIT_LABEL[FITS[fitIdx]]; }
  function isOpen() { return !!overlay && overlay.classList.contains('open'); }
  function uiHidden() { return !!ui && ui.classList.contains('hidden'); }
  function showUi() { if (ui) ui.classList.remove('hidden'); }
  function resetHideTimer() {
    showUi();
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (ui && video && !video.paused && !seeking && !(errBox && errBox.style.display === 'flex')) ui.classList.add('hidden');
    }, 3800);
  }
  function setHandlers(h) { handlers = h || {}; }

  return {
    open: open, close: close, togglePlay: togglePlay, pause: pause, resume: resume, toggleMute: toggleMute,
    seek: seek, step: step, cycleFit: cycleFit, setHandlers: setHandlers,
    isOpen: isOpen, isLive: isLive, barHidden: uiHidden, resetHideTimer: resetHideTimer
  };
})();
