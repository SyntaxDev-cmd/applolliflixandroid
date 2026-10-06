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
    addProfile: function (user, pass, maxProfiles) {
      var list = this.getProfiles();
      list = list.filter(function (p) { return p.user !== user; });
      list.unshift({ user: user, pass: pass });
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

    // conteudo adulto
    getAdultPin: function () { return getJson('adultPin', ''); },
    setAdultPin: function (pin) { setJson('adultPin', pin); },

    itemKey: itemKey
  };
})();
