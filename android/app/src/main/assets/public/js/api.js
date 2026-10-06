// LOLLIFLIX PC - Camada Xtream Codes (mesmo metodo do app Roku)
window.API = (function () {
  var CFG = window.APP_CONFIG;

  function timeout() { return CFG.requestTimeoutMs || 20000; }

  function strOr(v, f) {
    if (v === undefined || v === null) return f;
    if (typeof v === 'string') return v === '' ? f : v;
    if (typeof v === 'number') return String(v);
    return f;
  }

  function normalizeHost(raw) {
    var h = (raw || '').toString().trim();
    if (!h) return '';
    if (h.charAt(h.length - 1) === '/') h = h.slice(0, -1);
    if (h.indexOf('http') !== 0) h = 'http://' + h;
    return h;
  }

  function isAdult(name) {
    var low = (name || '').toString().toLowerCase();
    if (!low) return false;
    return CFG.adultKeywords.some(function (k) { return low.indexOf(k) >= 0; });
  }

  // GET JSON via processo principal
  function getJson(url) {
    return window.native.get(url, timeout()).then(function (res) {
      if (!res || !res.ok || !res.text) return null;
      try { return JSON.parse(res.text); } catch (e) { return null; }
    });
  }

  function b64utf8(s) {
    if (!s) return '';
    try { return decodeURIComponent(escape(window.atob(s))); }
    catch (e) { try { return window.atob(s); } catch (e2) { return ''; } }
  }

  function base(server) {
    return server.host + '/player_api.php?username=' + encodeURIComponent(server.user) +
      '&password=' + encodeURIComponent(server.pass) + '&action=';
  }

  // ---- Config do painel (servidores + branding) ----
  function getConfig() {
    return getJson(CFG.configEndpoint).then(function (parsed) {
      var out = { ok: false, servers: [], branding: {}, error: 'Nao foi possivel conectar ao painel' };
      if (!parsed) { out.error = 'Resposta invalida do painel'; return out; }
      var servers = [];
      var list = parsed.servidores || [];
      for (var i = 0; i < list.length; i++) {
        var host = normalizeHost(list[i].hdPosterUrl);
        if (host) servers.push({ name: strOr(list[i].title, 'Servidor'), host: host });
      }
      if (servers.length === 0) { out.error = 'Nenhum servidor disponivel'; return out; }
      out.servers = servers;
      out.branding = {
        welcome: strOr(parsed.bienvenida, ''),
        title: strOr(parsed.titulo, ''),
        logo: strOr(parsed.logo, ''),
        fondo: strOr(parsed.fondo, ''),
        logomenu: strOr(parsed.LogoMenu, ''),
        logologin: strOr(parsed.LogoLogin, '')
      };
      out.ok = true;
      out.error = '';
      return out;
    });
  }

  // ---- Login ----
  function login(servers, user, pass) {
    user = (user || '').trim();
    pass = (pass || '').trim();
    var idx = 0;
    var lastError = 'Usuario ou senha incorretos.';

    function tryNext() {
      if (idx >= servers.length) {
        return Promise.resolve({ ok: false, error: lastError });
      }
      var srv = servers[idx++];
      var url = srv.host + '/player_api.php?username=' + encodeURIComponent(user) + '&password=' + encodeURIComponent(pass);
      return getJson(url).then(function (json) {
        if (json && json.user_info) {
          var ui = json.user_info;
          var authOk = String(ui.auth) === '1';
          var statusOk = strOr(ui.status, '').toLowerCase() === 'active';
          if (authOk && statusOk) {
            return {
              ok: true,
              server: { name: srv.name, host: srv.host, user: user, pass: pass },
              userInfo: {
                status: strOr(ui.status, ''),
                expire: strOr(ui.exp_date, ''),
                maxCon: strOr(ui.max_connections, ''),
                activeCon: strOr(ui.active_cons, ''),
                trial: strOr(ui.is_trial, '0')
              }
            };
          } else if (authOk && !statusOk) {
            lastError = 'Conta ' + strOr(ui.status, 'inativa') + '.';
          }
        }
        return tryNext();
      });
    }

    if (!user || !pass) return Promise.resolve({ ok: false, error: 'Informe usuario e senha.' });
    if (!servers || servers.length === 0) return Promise.resolve({ ok: false, error: 'Sem servidores.' });
    return tryNext();
  }

  // ---- Categorias ----
  function categories(server, kind) {
    var action = kind === 'live' ? 'get_live_categories' : (kind === 'series' ? 'get_series_categories' : 'get_vod_categories');
    return getJson(base(server) + action).then(function (json) {
      var out = [];
      if (Array.isArray(json)) {
        json.forEach(function (c) { out.push({ id: strOr(c.category_id, ''), name: strOr(c.category_name, 'Categoria') }); });
      }
      return out;
    });
  }

  // ---- Streams por categoria ----
  function streams(server, kind, categoryId) {
    var action = kind === 'live' ? 'get_live_streams' : (kind === 'series' ? 'get_series' : 'get_vod_streams');
    var url = base(server) + action;
    if (categoryId) url += '&category_id=' + encodeURIComponent(categoryId);
    return getJson(url).then(function (json) { return parseStreams(json, kind, server); });
  }

  function parseStreams(json, kind, server) {
    var out = [];
    if (!Array.isArray(json)) return out;
    json.forEach(function (s) {
      if (kind === 'live') {
        out.push({
          kind: 'live', id: strOr(s.stream_id, ''), streamId: strOr(s.stream_id, ''),
          title: strOr(s.name, ''), poster: strOr(s.stream_icon, ''), num: strOr(s.num, ''),
          epgChannelId: strOr(s.epg_channel_id, ''), categoryId: strOr(s.category_id, ''),
          url: liveUrl(server, s.stream_id)
        });
      } else if (kind === 'series') {
        out.push({
          kind: 'series', id: strOr(s.series_id, ''), seriesId: strOr(s.series_id, ''),
          title: strOr(s.name, ''), poster: strOr(s.cover, ''), rating: strOr(s.rating, ''),
          plot: strOr(s.plot, ''), categoryId: strOr(s.category_id, '')
        });
      } else {
        out.push({
          kind: 'movie', id: strOr(s.stream_id, ''), streamId: strOr(s.stream_id, ''),
          title: strOr(s.name, ''), poster: strOr(s.stream_icon, ''), rating: strOr(s.rating, ''),
          added: strOr(s.added, ''), ext: strOr(s.container_extension, 'mp4'),
          categoryId: strOr(s.category_id, ''), url: vodUrl(server, s.stream_id, s.container_extension)
        });
      }
    });
    return out;
  }

  // ---- Recem adicionados (rapido: 1a categorias; fallback: lista completa) ----
  function recent(server, limit, hideAdult) {
    limit = limit || 12;
    return categories(server, 'movie').then(function (cats) {
      if (cats && cats.length) {
        var pick = [];
        for (var i = 0; i < cats.length && pick.length < 3; i++) {
          if (!(hideAdult && isAdult(cats[i].name))) pick.push(cats[i]);
        }
        return Promise.all(pick.map(function (c) { return streams(server, 'movie', c.id); }))
          .then(function (lists) {
            var all = [];
            lists.forEach(function (l) { all = all.concat(l); });
            all = all.filter(function (m) { return !(hideAdult && isAdult(m.title)); });
            if (all.length === 0) return recentFull(server, limit, hideAdult);
            return sortRecent(all, limit);
          });
      }
      return recentFull(server, limit, hideAdult);
    });
  }

  function recentFull(server, limit, hideAdult) {
    return streams(server, 'movie', '').then(function (all) {
      all = all.filter(function (m) { return !(hideAdult && isAdult(m.title)); });
      return sortRecent(all, limit);
    });
  }

  function sortRecent(all, limit) {
    var hasDate = all.some(function (m) { return parseInt(m.added, 10) > 0; });
    if (hasDate) {
      all.sort(function (a, b) { return (parseInt(b.added, 10) || 0) - (parseInt(a.added, 10) || 0); });
    } else {
      for (var i = all.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = all[i]; all[i] = all[j]; all[j] = t; }
    }
    return all.slice(0, limit);
  }

  // ---- EPG ----
  function epg(server, streamId) {
    return getJson(base(server) + 'get_short_epg&stream_id=' + encodeURIComponent(streamId) + '&limit=4').then(function (json) {
      var out = [];
      if (json && Array.isArray(json.epg_listings)) {
        json.epg_listings.forEach(function (e) {
          out.push({ title: b64utf8(e.title), description: b64utf8(e.description), start: strOr(e.start, ''), stop: strOr(e.end, '') });
        });
      }
      return out;
    });
  }

  // ---- Info de serie (temporadas/episodios) ----
  function seriesInfo(server, seriesId) {
    return getJson(base(server) + 'get_series_info&series_id=' + encodeURIComponent(seriesId)).then(function (json) {
      var out = { info: {}, seasons: [] };
      if (!json) return out;
      if (json.info) {
        out.info = {
          title: strOr(json.info.name, ''), plot: strOr(json.info.plot, ''), poster: strOr(json.info.cover, ''),
          genre: strOr(json.info.genre, ''), rating: strOr(json.info.rating, ''), releaseDate: strOr(json.info.releaseDate, '')
        };
      }
      if (json.episodes) {
        var keys = Object.keys(json.episodes).sort(function (a, b) { return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0); });
        keys.forEach(function (k) {
          var list = json.episodes[k] || [];
          var eps = [];
          if (Array.isArray(list)) {
            list.forEach(function (ep) {
              var ext = strOr(ep.container_extension, 'mp4');
              eps.push({
                kind: 'episode', id: strOr(ep.id, ''), title: strOr(ep.title, 'Episodio'),
                episodeNum: strOr(ep.episode_num, ''), season: k, ext: ext,
                url: seriesUrl(server, ep.id, ext),
                poster: (ep.info && ep.info.movie_image) ? strOr(ep.info.movie_image, '') : '',
                plot: (ep.info && ep.info.plot) ? strOr(ep.info.plot, '') : ''
              });
            });
          }
          out.seasons.push({ season: k, episodes: eps });
        });
      }
      return out;
    });
  }

  // ---- URLs de stream ----
  function liveUrl(server, id) { return server.host + '/live/' + server.user + '/' + server.pass + '/' + strOr(id, '') + '.m3u8'; }
  function vodUrl(server, id, ext) { return server.host + '/movie/' + server.user + '/' + server.pass + '/' + strOr(id, '') + '.' + strOr(ext, 'mp4'); }
  function seriesUrl(server, id, ext) { return server.host + '/series/' + server.user + '/' + server.pass + '/' + strOr(id, '') + '.' + strOr(ext, 'mp4'); }

  function formatExpire(unixStr) {
    var s = strOr(unixStr, '');
    if (!s) return 'ILIMITADO';
    var secs = parseInt(s, 10);
    if (!secs || secs <= 0) return 'ILIMITADO';
    var d = new Date(secs * 1000);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  return {
    getConfig: getConfig, login: login, categories: categories, streams: streams,
    recent: recent, epg: epg, seriesInfo: seriesInfo,
    liveUrl: liveUrl, vodUrl: vodUrl, seriesUrl: seriesUrl,
    isAdult: isAdult, formatExpire: formatExpire, strOr: strOr
  };
})();
