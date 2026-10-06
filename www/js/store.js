// LOLLIFLIX PC - Persistencia local (localStorage, com try/catch)
window.Store = (function () {
  var PREFIX = 'lolliflix.';

  function readRaw(key) {
    try { return localStorage.getItem(PREFIX + key); } catch (e) { return null; }
  }
  function writeRaw(key, val) {
    try { localStorage.setItem(PREFIX + key, val); } catch (e) {}
  }
  function del(key) {
    try { localStorage.removeItem(PREFIX + key); } catch (e) {}
  }
  function getJson(key, fallback) {
    var raw = readRaw(key);
    if (!raw) return fallback;
    try { var v = JSON.parse(raw); return (v === null || v === undefined) ? fallback : v; }
    catch (e) { return fallback; }
  }
  function setJson(key, val) { writeRaw(key, JSON.stringify(val)); }

  function itemKey(it) {
    if (!it) return '';
    return (it.kind || 'x') + ':' + (it.id || '');
  }

  return {
    getJson: getJson,
    setJson: setJson,
    del: del,

    // sessao (usuario/senha) - igual ao app Roku
    getSession: function () { return getJson('session', null); },
    setSession: function (s) { setJson('session', s); },
    clearSession: function () { del('session'); },

    // perfis salvos
    getProfiles: function () { var p = getJson('profiles', []); return Array.isArray(p) ? p : []; },
    addProfile: function (user, pass, maxProfiles, code) {
      var list = this.getProfiles();
      list = list.filter(function (p) { return p.user !== user; });
      list.unshift({ user: user, pass: pass, code: code || '' });
      while (list.length > (maxProfiles || 5)) list.pop();
      setJson('profiles', list);
    },
    removeProfile: function (user) {
      setJson('profiles', this.getProfiles().filter(function (p) { return p.user !== user; }));
    },

    // favoritos
    getFavorites: function () { var f = getJson('favorites', []); return Array.isArray(f) ? f : []; },
    isFavorite: function (it) {
      var k = itemKey(it);
      return this.getFavorites().some(function (f) { return itemKey(f) === k; });
    },
    toggleFavorite: function (it) {
      var k = itemKey(it);
      var list = this.getFavorites();
      var found = list.some(function (f) { return itemKey(f) === k; });
      if (found) list = list.filter(function (f) { return itemKey(f) !== k; });
      else list.unshift(it);
      setJson('favorites', list);
      return !found;
    },

    // historico (continuar assistindo)
    getHistory: function () { var h = getJson('history', []); return Array.isArray(h) ? h : []; },
    addHistory: function (it) {
      var k = itemKey(it);
      if (!it || !it.id) return;
      var list = this.getHistory().filter(function (h) { return itemKey(h) !== k; });
      list.unshift(it);
      while (list.length > 40) list.pop();
      setJson('history', list);
    },

    // cache de recem adicionados
    getRecentCache: function () { var r = getJson('recentCache', []); return Array.isArray(r) ? r : []; },
    setRecentCache: function (list) { setJson('recentCache', list); },

    // ---- continuar assistindo (posicao de filmes e episodios) ----
    // registro: { key, t (seg), d (duracao), title, poster, kind, url, parent, updated }
    getProgressAll: function () { var p = getJson('progress', {}); return (p && typeof p === 'object' && !Array.isArray(p)) ? p : {}; },
    getProgress: function (key) { var p = this.getProgressAll()[key]; return (p && p.t > 0) ? p : null; },
    setProgress: function (key, rec) {
      if (!key) return;
      var all = this.getProgressAll();
      rec.key = key; rec.updated = Date.now();
      all[key] = rec;
      // guarda no maximo 60 titulos (remove os mais antigos)
      var keys = Object.keys(all);
      if (keys.length > 60) {
        keys.sort(function (a, b) { return (all[a].updated || 0) - (all[b].updated || 0); });
        for (var i = 0; i < keys.length - 60; i++) delete all[keys[i]];
      }
      setJson('progress', all);
    },
    clearProgress: function (key) { var all = this.getProgressAll(); if (all[key]) { delete all[key]; setJson('progress', all); } },
    // lista para a fileira "Continuar assistindo" (mais recentes primeiro)
    getContinue: function (limit) {
      var all = this.getProgressAll();
      return Object.keys(all).map(function (k) { return all[k]; })
        .filter(function (r) { return r && r.url && r.t > 20 && (!r.d || r.t < r.d * 0.95); })
        .sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); })
        .slice(0, limit || 20);
    },

    // ---- identificacao do aparelho (para o painel contar dispositivos) ----
    // O Android nao permite ler o MAC real; geramos um ID fixo no formato de MAC
    // na primeira abertura e guardamos no aparelho.
    getDeviceId: function () {
      var id = getJson('deviceId', '');
      if (id && /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(id)) return id;
      var bytes = [];
      try { var a = new Uint8Array(6); window.crypto.getRandomValues(a); for (var i = 0; i < 6; i++) bytes.push(a[i]); }
      catch (e) { for (var j = 0; j < 6; j++) bytes.push(Math.floor(Math.random() * 256)); }
      bytes[0] = (bytes[0] | 0x02) & 0xFE; // endereco "local", nunca conflita com MAC de fabrica
      id = bytes.map(function (b) { return (b < 16 ? '0' : '') + b.toString(16).toUpperCase(); }).join(':');
      setJson('deviceId', id);
      return id;
    },

    // conteudo adulto
    getAdultPin: function () { return getJson('adultPin', ''); },
    setAdultPin: function (pin) { setJson('adultPin', pin); },

    itemKey: itemKey
  };
})();
