// LOLLIFLIX - Player
// Ao vivo (.m3u8): hls.js. No Android usamos um carregador proprio que baixa via
// CapacitorHttp (nativo) -> sem bloqueio de CORS e suporta segmentos binarios.
// VOD (.mp4): <video> nativo (cross-origin + cleartext liberados).
window.Player = (function () {
  var overlay, video, titleEl, spinner, errEl, hls = null, hideTimer = null;

  function ensure() {
    overlay = document.getElementById('player');
    video = document.getElementById('videoEl');
    titleEl = document.getElementById('playerTitle');
    spinner = document.getElementById('playerSpinner');
    errEl = document.getElementById('playerError');
  }
  function isM3u8(url) { return /\.m3u8(\?|$)/i.test(url); }
  function destroyHls() { if (hls) { try { hls.destroy(); } catch (e) {} hls = null; } }
  function showSpinner(on) { if (spinner) spinner.style.display = on ? 'block' : 'none'; }
  function showError(msg) { showSpinner(false); if (errEl) { errEl.textContent = msg || 'Nao foi possivel reproduzir.'; errEl.style.display = 'block'; } }
  function clearError() { if (errEl) errEl.style.display = 'none'; }

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
      CapHttp.request({ url: context.url, method: 'GET', responseType: respType, connectTimeout: 20000, readTimeout: 30000, headers: headers })
        .then(function (res) {
          if (self._aborted) return;
          var now = (window.performance && performance.now) ? performance.now() : Date.now();
          self.stats.loading.first = now; self.stats.loading.end = now;
          var data = res.data;
          if (respType === 'arraybuffer') { data = (typeof data === 'string') ? b64ToArrayBuffer(data) : (data || new ArrayBuffer(0)); self.stats.loaded = data.byteLength; }
          else { data = (data == null) ? '' : (typeof data === 'string' ? data : JSON.stringify(data)); self.stats.loaded = data.length; }
          self.stats.total = self.stats.loaded;
          var status = res.status || 200;
          if (status < 200 || status >= 400) { callbacks.onError({ code: status, text: 'HTTP ' + status }, context, null); return; }
          callbacks.onSuccess({ url: context.url, data: data }, self.stats, context, null);
        })
        .catch(function (e) { if (self._aborted) return; callbacks.onError({ code: 0, text: String((e && e.message) || e) }, context, null); });
    };
    return Loader;
  }

  function usingCap() { return !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp); }

  function open(url, title) {
    ensure(); clearError(); showSpinner(true);
    titleEl.textContent = title || '';
    overlay.classList.add('open'); document.body.classList.add('player-open');
    destroyHls();
    try { video.pause(); } catch (e) {}
    video.removeAttribute('src'); try { video.load(); } catch (e) {}

    if (isM3u8(url) && window.Hls && window.Hls.isSupported()) {
      var cfg = { maxBufferLength: 30, manifestLoadingTimeOut: 20000, fragLoadingTimeOut: 30000, fragLoadingMaxRetry: 4, manifestLoadingMaxRetry: 4 };
      if (usingCap()) { try { cfg.loader = makeCapLoader(); } catch (e) {} }
      hls = new window.Hls(cfg);
      hls.loadSource(url); hls.attachMedia(video);
      hls.on(window.Hls.Events.MANIFEST_PARSED, function () { playVideo(); });
      hls.on(window.Hls.Events.ERROR, function (evt, data) {
        if (data && data.fatal) {
          if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) { try { hls.startLoad(); } catch (e) { showError('Erro de rede no stream.'); } }
          else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) { try { hls.recoverMediaError(); } catch (e) { showError('Erro de midia.'); } }
          else { showError('Nao foi possivel abrir o canal.'); }
        }
      });
    } else {
      video.src = url; playVideo();
    }
    video.oncanplay = function () { showSpinner(false); };
    video.onplaying = function () { showSpinner(false); };
    video.onerror = function () { showError('Formato nao suportado ou stream indisponivel.'); };
    resetHideTimer();
  }
  function playVideo() { var p = video.play(); if (p && p.catch) p.catch(function () { showSpinner(false); }); }

  function close() {
    ensure(); destroyHls();
    try { video.pause(); } catch (e) {}
    video.removeAttribute('src'); try { video.load(); } catch (e) {}
    overlay.classList.remove('open'); document.body.classList.remove('player-open');
  }
  function togglePlay() { if (!video) return; if (video.paused) playVideo(); else video.pause(); }
  function toggleMute() { if (video) video.muted = !video.muted; }
  function seek(d) { if (video && isFinite(video.duration)) video.currentTime = Math.max(0, video.currentTime + d); }
  function isOpen() { return overlay && overlay.classList.contains('open'); }
  function resetHideTimer() { var bar = document.getElementById('playerBar'); if (bar) bar.classList.remove('hidden'); if (hideTimer) clearTimeout(hideTimer); hideTimer = setTimeout(function () { if (bar && video && !video.paused) bar.classList.add('hidden'); }, 3500); }

  return { open: open, close: close, togglePlay: togglePlay, toggleMute: toggleMute, seek: seek, isOpen: isOpen, resetHideTimer: resetHideTimer };
})();
