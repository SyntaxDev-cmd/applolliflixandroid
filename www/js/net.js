// LOLLIFLIX Android - adaptador de rede (usa CapacitorHttp: sem CORS + cleartext)
// Define window.native (mesma interface do Electron) se ainda nao existir.
window.native = window.native || (function () {
  var UA = 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

  function viaCapacitor(url, timeoutMs) {
    var C = window.Capacitor;
    var http = C && C.Plugins && C.Plugins.CapacitorHttp;
    return http.get({
      url: url,
      headers: { 'User-Agent': UA, 'Accept': 'application/json, text/plain, */*' },
      connectTimeout: timeoutMs || 20000,
      readTimeout: timeoutMs || 20000
    }).then(function (res) {
      var t = (typeof res.data === 'string') ? res.data : JSON.stringify(res.data);
      return { ok: res.status >= 200 && res.status < 300, status: res.status, text: t, error: '' };
    }).catch(function (e) {
      return { ok: false, status: 0, text: '', error: String((e && e.message) || e) };
    });
  }

  function viaFetch(url) {
    return fetch(url).then(function (r) {
      return r.text().then(function (t) { return { ok: r.ok, status: r.status, text: t, error: '' }; });
    }).catch(function (e) { return { ok: false, status: 0, text: '', error: String(e) }; });
  }

  function get(url, timeoutMs) {
    var C = window.Capacitor;
    if (C && C.Plugins && C.Plugins.CapacitorHttp) return viaCapacitor(url, timeoutMs);
    return viaFetch(url);
  }

  return {
    get: get,
    win: { minimize: function () {}, maximize: function () {}, close: function () {}, fullscreen: function () {} }
  };
})();
