// ============================================================
//  LOLLIFLIX PC - Controlador da interface (SPA)
// ============================================================
(function () {
  var CFG = window.APP_CONFIG;
  var appEl, toastEl, clockTimer = null;

  var state = {
    servers: [],
    branding: {},
    server: null,      // activeServer {name,host,user,pass}
    userInfo: {},
    adultUnlocked: false
  };

  var nav = []; // pilha de telas

  // ---------- Icones (SVG) ----------
  var IC = {
    live: svg('<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M8 3l4 3 4-3" fill="none"/><polygon points="11,10 11,17 16.5,13.5" fill="currentColor" stroke="none"/>'),
    movies: svg('<rect x="4" y="4" width="16" height="16" rx="2.5"/><line x1="12" y1="4" x2="12" y2="20"/><circle cx="7.5" cy="8" r="0.9" fill="currentColor" stroke="none"/><circle cx="7.5" cy="12" r="0.9" fill="currentColor" stroke="none"/><circle cx="7.5" cy="16" r="0.9" fill="currentColor" stroke="none"/><circle cx="16.5" cy="8" r="0.9" fill="currentColor" stroke="none"/><circle cx="16.5" cy="12" r="0.9" fill="currentColor" stroke="none"/><circle cx="16.5" cy="16" r="0.9" fill="currentColor" stroke="none"/>'),
    series: svg('<rect x="6" y="3" width="14" height="14" rx="2.5"/><path d="M4 8v11a2 2 0 0 0 2 2h11" fill="none"/><polygon points="11,7 11,13 16,10" fill="currentColor" stroke="none"/>'),
    fav: svg('<polygon points="12,3 14.6,9 21,9.5 16,13.8 17.6,20 12,16.5 6.4,20 8,13.8 3,9.5 9.4,9" fill="none"/>'),
    settings: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19" fill="none"/>'),
    reload: svg('<path d="M20 11a8 8 0 1 0-1.9 6.3" fill="none"/><polyline points="20,4 20,11 13,11" fill="none"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><line x1="16.2" y1="16.2" x2="21" y2="21"/>'),
    back: svg('<line x1="20" y1="12" x2="5" y2="12"/><polyline points="12,19 5,12 12,5" fill="none"/>')
  };
  function svg(inner) {
    return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }
  var POSTER_PH = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#12151f"/><text x="100" y="155" font-size="15" text-anchor="middle" fill="#5a627a">LOLLIFLIX</text></svg>');
  var LOGO_PH = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="92" height="52"><rect width="92" height="52" rx="8" fill="#0b0e16"/><text x="46" y="31" fill="#667" font-size="12" text-anchor="middle">TV</text></svg>');

  // ---------- Helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function h(html) { appEl.innerHTML = html; }
  function qs(sel) { return appEl.querySelector(sel); }
  function qsa(sel) { return Array.prototype.slice.call(appEl.querySelectorAll(sel)); }
  function on(sel, ev, fn) { qsa(sel).forEach(function (n) { n.addEventListener(ev, fn); }); }
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastEl._t); toastEl._t = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }
  function nowClock() { var d = new Date(); function p(n) { return (n < 10 ? '0' : '') + n; } return p(d.getHours()) + ':' + p(d.getMinutes()); }

  function go(fn, params) { nav.push({ fn: fn, params: params }); fn(params); }
  function replace(fn, params) { nav = [{ fn: fn, params: params }]; fn(params); }
  function back() {
    if (window.Player.isOpen()) { window.Player.close(); return; }
    if (nav.length > 1) { nav.pop(); var t = nav[nav.length - 1]; t.fn(t.params); }
  }

  // ============================================================
  //  Splash + boot
  // ============================================================
  function boot() {
    appEl = document.getElementById('app');
    toastEl = document.getElementById('toast');
    setupNativeUI();
    fitStage();
    window.addEventListener('resize', fitStage);
    window.addEventListener('orientationchange', function () { setTimeout(fitStage, 250); });
    wireWindow();
    wirePlayer();
    wireKeys();
    splash();
    loadConfig();
  }

  // Palco fixo 1280x720 escalado para caber em qualquer tela (layout identico em todos os aparelhos)
  function fitStage() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var s = Math.min(vw / 1280, vh / 720);
    if (!isFinite(s) || s <= 0) s = 1;
    var offx = Math.round((vw - 1280 * s) / 2);
    var offy = Math.round((vh - 720 * s) / 2);
    appEl.style.transform = 'translate(' + offx + 'px,' + offy + 'px) scale(' + s + ')';
  }

  // Android: tela cheia + travar em PAISAGEM (o app inteiro abre de lado)
  function setupNativeUI() {
    try {
      var C = window.Capacitor;
      if (C && C.Plugins && C.Plugins.StatusBar) {
        var SB = C.Plugins.StatusBar;
        if (SB.setOverlaysWebView) SB.setOverlaysWebView({ overlay: true });
        if (SB.hide) SB.hide();
      }
      if (C && C.Plugins && C.Plugins.ScreenOrientation && C.Plugins.ScreenOrientation.lock) {
        C.Plugins.ScreenOrientation.lock({ orientation: 'landscape' });
      }
    } catch (e) {}
  }

  // Aplica o fundo (e marca) definidos no painel
  function applyBranding() {
    var b = state.branding || {};
    var bg = document.getElementById('appbg');
    if (bg && b.fondo) bg.style.backgroundImage = "url('" + b.fondo + "')";
    if (b.title) { try { document.title = b.title; } catch (e) {} }
  }

  function splash(msg) {
    h('<div class="view splash"><h1>' + esc(CFG.brand) + '</h1><div class="spinner"></div><p id="splashMsg">' + esc(msg || 'Conectando ao servidor...') + '</p></div>');
  }
  function splashMsg(m) { var e = document.getElementById('splashMsg'); if (e) e.textContent = m; }

  function loadConfig(retry) {
    retry = retry || 0;
    window.API.getConfig().then(function (res) {
      if (!res.ok) {
        splashMsg((res.error || 'Falha ao conectar') + ' - nova tentativa ' + (retry + 1));
        setTimeout(function () { loadConfig(retry + 1); }, 4000);
        return;
      }
      state.servers = res.servers;
      state.branding = res.branding;
      applyBranding();
      var sess = window.Store.getSession();
      if (sess && sess.user && sess.pass) {
        splashMsg('Entrando como ' + sess.user + '...');
        window.API.login(state.servers, sess.user, sess.pass).then(function (lr) {
          if (lr.ok) { onLoggedIn(lr); } else { screenLogin(); }
        });
      } else {
        screenLogin();
      }
    });
  }

  function onLoggedIn(lr) {
    state.server = lr.server;
    state.userInfo = lr.userInfo || {};
    window.Store.setSession({ user: lr.server.user, pass: lr.server.pass });
    window.Store.addProfile(lr.server.user, lr.server.pass, CFG.maxProfiles);
    replace(screenHome, {});
  }

  // ============================================================
  //  Login
  // ============================================================
  function screenLogin() {
    var b = state.branding || {};
    var profiles = window.Store.getProfiles();
    var profHtml = '';
    if (profiles.length) {
      profHtml = '<div class="profiles"><div class="ptitle">Contas salvas</div>' +
        profiles.map(function (p, i) {
          return '<div class="profile-row"><button class="btn ghost" data-prof="' + i + '">' + esc(p.user) + '</button>' +
            '<button class="profile-del" data-del="' + i + '" title="Remover">&#10005;</button></div>';
        }).join('') + '</div>';
    }
    var logo = b.logologin ? ('<img src="' + esc(b.logologin) + '" style="max-height:80px;display:block;margin:0 auto" onerror="this.style.display=\'none\'"/>') : esc(CFG.brand);
    h('<div class="view login-wrap"><div class="login-card">' +
      '<div class="login-logo">' + logo + '</div>' +
      '<h2>ENTRAR</h2><div class="welcome">' + esc(b.welcome || 'BEM-VINDO!') + '</div>' +
      '<div class="field"><label>Usuario</label><input id="inUser" type="text" autocomplete="off" spellcheck="false"/></div>' +
      '<div class="field"><label>Senha</label><input id="inPass" type="password" autocomplete="off"/></div>' +
      '<button class="btn" id="btnLogin">ENTRAR</button>' +
      '<div class="login-error" id="loginErr"></div>' +
      profHtml +
      '</div></div>');

    qs('#btnLogin').addEventListener('click', doLogin);
    qs('#inPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    qs('#inUser').addEventListener('keydown', function (e) { if (e.key === 'Enter') qs('#inPass').focus(); });
    on('[data-prof]', 'click', function (e) {
      var p = profiles[+e.currentTarget.getAttribute('data-prof')];
      if (p) doLoginWith(p.user, p.pass);
    });
    on('[data-del]', 'click', function (e) {
      var p = profiles[+e.currentTarget.getAttribute('data-del')];
      if (p) { window.Store.removeProfile(p.user); screenLogin(); }
    });
    setTimeout(function () { var u = qs('#inUser'); if (u) u.focus(); }, 60);
  }

  function doLogin() { doLoginWith((qs('#inUser').value || '').trim(), (qs('#inPass').value || '').trim()); }
  function doLoginWith(user, pass) {
    var err = qs('#loginErr');
    if (!user || !pass) { if (err) err.textContent = 'Informe usuario e senha.'; return; }
    if (err) err.textContent = '';
    var btn = qs('#btnLogin'); if (btn) { btn.disabled = true; btn.textContent = 'ENTRANDO...'; }
    window.API.login(state.servers, user, pass).then(function (lr) {
      if (lr.ok) { onLoggedIn(lr); }
      else { if (err) err.textContent = lr.error || 'Falha no login.'; if (btn) { btn.disabled = false; btn.textContent = 'ENTRAR'; } }
    });
  }

  // ============================================================
  //  Home
  // ============================================================
  function headerHtml(withHome) {
    var b = state.branding || {};
    var brand = b.logomenu ? ('<img src="' + esc(b.logomenu) + '" onerror="this.replaceWith(document.createTextNode(\'' + esc(CFG.brand) + '\'))"/>') : esc(CFG.brand);
    var exp = window.API.formatExpire(state.userInfo && state.userInfo.expire);
    return '<div class="hdr">' +
      '<div class="brand">' + brand + '</div>' +
      '<div class="spacer"></div>' +
      '<button class="icon-btn" data-nav="favorites" title="Favoritos">' + IC.fav + '</button>' +
      '<button class="icon-btn" data-nav="search" title="Buscar">' + IC.search + '</button>' +
      '<div class="info"><div class="clock" id="clock">' + nowClock() + '</div>' +
      '<div class="exp">EXPIRACAO: ' + esc(exp) + '</div>' +
      '<div class="user">' + esc(state.server ? ('Usuario: ' + state.server.user) : '') + '</div></div>' +
      '</div>';
  }

  function startClock() {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(function () { var c = document.getElementById('clock'); if (c) c.textContent = nowClock(); }, 20000);
  }

  function screenHome() {
    h('<div class="view scroll"><div class="home">' +
      headerHtml(false) +
      '<div class="home-grid">' +
        '<button class="tile big" data-nav="live"><span>' + IC.live + '</span><span class="lbl">TV AO VIVO</span></button>' +
        '<div class="grid2">' +
          '<button class="tile sm" data-nav="movies">' + IC.movies + '<span class="lbl">FILMES</span></button>' +
          '<button class="tile sm" data-nav="series">' + IC.series + '<span class="lbl">SERIES</span></button>' +
          '<button class="tile sm" data-nav="settings">' + IC.settings + '<span class="lbl">AJUSTES</span></button>' +
          '<button class="tile sm" data-nav="reload">' + IC.reload + '<span class="lbl">ATUALIZAR</span></button>' +
        '</div>' +
      '</div>' +
      '<div class="section-title">FILMES RECEM ADICIONADOS</div>' +
      '<div class="rail" id="recentRail"></div>' +
      '<div class="empty-note hide" id="recentEmpty">Nenhum filme disponivel no momento.</div>' +
      '</div></div>');

    startClock();
    on('[data-nav]', 'click', function (e) { onNav(e.currentTarget.getAttribute('data-nav')); });

    // recentes: cache instantaneo + atualizacao em segundo plano
    renderRecent(window.Store.getRecentCache());
    loadRecent();
  }

  function onNav(dest) {
    if (dest === 'live') go(screenLive, {});
    else if (dest === 'movies') go(screenCatalog, { kind: 'movie', title: 'FILMES' });
    else if (dest === 'series') go(screenCatalog, { kind: 'series', title: 'SERIES' });
    else if (dest === 'favorites') go(screenFavorites, {});
    else if (dest === 'search') go(screenSearch, {});
    else if (dest === 'settings') go(screenSettings, {});
    else if (dest === 'reload') { toast('Atualizando lista de conteudo...'); loadRecent(); }
  }

  function loadRecent() {
    if (!state.server) return;
    window.API.recent(state.server, 14, !state.adultUnlocked).then(function (list) {
      if (list && list.length) { window.Store.setRecentCache(list); renderRecent(list); }
      else { var e = document.getElementById('recentEmpty'); if (e && (!window.Store.getRecentCache().length)) e.classList.remove('hide'); }
    }).catch(function () {});
  }

  function renderRecent(list) {
    var rail = document.getElementById('recentRail');
    if (!rail) return;
    list = list || [];
    var em = document.getElementById('recentEmpty');
    if (!list.length) { rail.innerHTML = ''; return; }
    if (em) em.classList.add('hide');
    rail.innerHTML = list.map(function (m, i) {
      return '<div class="cover" tabindex="0" data-rec="' + i + '"><img src="' + esc(m.poster || '') + '" onerror="this.src=\'' + POSTER_PH + '\'"/></div>';
    }).join('');
    Array.prototype.forEach.call(rail.querySelectorAll('[data-rec]'), function (n) {
      n.addEventListener('click', function () { go(screenDetails, { item: list[+n.getAttribute('data-rec')] }); });
      n.addEventListener('keydown', function (e) { if (e.key === 'Enter') n.click(); });
    });
  }

  // ============================================================
  //  Catalogo (Filmes / Series)
  // ============================================================
  function screenCatalog(params) {
    var kind = params.kind, title = params.title;
    h('<div class="view"><div class="subhdr"><button class="back-btn" data-back>' + IC.back + '</button><h2>' + esc(title) + '</h2></div>' +
      '<div class="cat"><div class="side" id="side"><h3>CATEGORIAS</h3><div id="catList"></div></div>' +
      '<div class="main" id="main"><div class="center-mid"><div class="spinner"></div></div></div></div></div>');
    qs('[data-back]').addEventListener('click', back);

    var cats = [{ id: '@fav', name: 'Favoritos', virtual: 'fav' }];
    window.API.categories(state.server, kind).then(function (list) {
      (list || []).forEach(function (c) { cats.push({ id: c.id, name: c.name, virtual: '' }); });
      renderCats(cats, function (cat) { openCat(kind, cat); });
      if (cats.length > 1) selectCat(1, cats, function (cat) { openCat(kind, cat); });
      else selectCat(0, cats, function (cat) { openCat(kind, cat); });
    });
  }

  function renderCats(cats, onPick) {
    var list = qs('#catList');
    list.innerHTML = cats.map(function (c, i) { return '<div class="cat-item" data-ci="' + i + '">' + esc(c.name) + '</div>'; }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('[data-ci]'), function (n) {
      n.addEventListener('click', function () { selectCat(+n.getAttribute('data-ci'), cats, onPick); });
    });
  }
  function selectCat(idx, cats, onPick) {
    qsa('.cat-item').forEach(function (n, i) { n.classList.toggle('active', i === idx); });
    if (cats[idx]) onPick(cats[idx]);
  }

  // retorna Promise<boolean>
  function guardAdult(cat) {
    if (state.adultUnlocked) return Promise.resolve(true);
    if (!window.API.isAdult(cat.name)) return Promise.resolve(true);
    var pin = window.Store.getAdultPin();
    if (!pin) return Promise.resolve(true);
    return askPin().then(function (typed) {
      if (typed === null) return false;
      if (typed === pin) { state.adultUnlocked = true; return true; }
      toast('PIN incorreto.'); return false;
    });
  }

  // modal simples (Electron nao suporta window.prompt)
  function askPin() {
    return new Promise(function (resolve) {
      var ov = document.createElement('div');
      ov.className = 'modal-ov';
      ov.innerHTML = '<div class="modal"><h3>Conteudo adulto</h3><p>Digite o PIN para continuar</p>' +
        '<input id="mPin" type="password" maxlength="8" inputmode="numeric"/>' +
        '<div class="modal-actions"><button class="btn ghost" id="mCancel" style="width:auto;padding:0 22px">Cancelar</button>' +
        '<button class="btn" id="mOk" style="width:auto;padding:0 28px">OK</button></div></div>';
      document.body.appendChild(ov);
      var inp = ov.querySelector('#mPin');
      function done(val) { document.body.removeChild(ov); resolve(val); }
      ov.querySelector('#mOk').addEventListener('click', function () { done(inp.value || ''); });
      ov.querySelector('#mCancel').addEventListener('click', function () { done(null); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') done(inp.value || ''); if (e.key === 'Escape') done(null); });
      setTimeout(function () { inp.focus(); }, 50);
    });
  }

  function openCat(kind, cat) {
    var main = qs('#main');
    if (!main) return;
    guardAdult(cat).then(function (ok) { if (ok) openCatDo(kind, cat, main); });
  }

  function openCatDo(kind, cat, main) {
    main.innerHTML = '<div class="center-mid"><div class="spinner"></div></div>';
    var p;
    if (cat.virtual === 'fav') {
      var favs = window.Store.getFavorites().filter(function (f) { return f.kind === kind; });
      p = Promise.resolve(favs);
    } else {
      p = window.API.streams(state.server, kind, cat.id);
    }
    p.then(function (items) {
      items = items || [];
      if (!items.length) { main.innerHTML = '<div class="empty-note">Nenhum item nesta categoria.</div>'; return; }
      main.innerHTML = '<div class="pgrid">' + items.map(function (it, i) {
        return '<div class="pcard" tabindex="0" data-gi="' + i + '"><img src="' + esc(it.poster || '') + '" onerror="this.src=\'' + POSTER_PH + '\'"/><div class="cap">' + esc(it.title) + '</div></div>';
      }).join('') + '</div>';
      Array.prototype.forEach.call(main.querySelectorAll('[data-gi]'), function (n) {
        n.addEventListener('click', function () { go(screenDetails, { item: items[+n.getAttribute('data-gi')] }); });
        n.addEventListener('keydown', function (e) { if (e.key === 'Enter') n.click(); });
      });
    }).catch(function () { main.innerHTML = '<div class="empty-note">Erro ao carregar.</div>'; });
  }

  function screenFavorites() {
    h('<div class="view"><div class="subhdr"><button class="back-btn" data-back>' + IC.back + '</button><h2>FAVORITOS</h2></div>' +
      '<div class="main scroll" id="main" style="padding:24px 30px"></div></div>');
    qs('[data-back]').addEventListener('click', back);
    var favs = window.Store.getFavorites();
    var main = qs('#main');
    if (!favs.length) { main.innerHTML = '<div class="empty-note">Voce ainda nao tem favoritos.</div>'; return; }
    main.innerHTML = '<div class="pgrid">' + favs.map(function (it, i) {
      return '<div class="pcard" tabindex="0" data-gi="' + i + '"><img src="' + esc(it.poster || '') + '" onerror="this.src=\'' + POSTER_PH + '\'"/><div class="cap">' + esc(it.title) + '</div></div>';
    }).join('') + '</div>';
    Array.prototype.forEach.call(main.querySelectorAll('[data-gi]'), function (n) {
      n.addEventListener('click', function () {
        var it = favs[+n.getAttribute('data-gi')];
        if (it.kind === 'live') playLive(it); else go(screenDetails, { item: it });
      });
    });
  }

  // ============================================================
  //  TV ao vivo
  // ============================================================
  function screenLive() {
    h('<div class="view"><div class="subhdr"><button class="back-btn" data-back>' + IC.back + '</button><h2>TV AO VIVO</h2></div>' +
      '<div class="cat"><div class="side"><h3>CATEGORIAS</h3><div id="catList"></div></div>' +
      '<div class="main" id="main"><div class="center-mid"><div class="spinner"></div></div></div></div></div>');
    qs('[data-back]').addEventListener('click', back);

    var cats = [{ id: '@fav', name: 'Favoritos', virtual: 'fav' }];
    window.API.categories(state.server, 'live').then(function (list) {
      (list || []).forEach(function (c) { cats.push({ id: c.id, name: c.name, virtual: '' }); });
      renderCats(cats, function (cat) { openLiveCat(cat); });
      if (cats.length > 1) selectCat(1, cats, function (cat) { openLiveCat(cat); });
      else selectCat(0, cats, function (cat) { openLiveCat(cat); });
    });
  }

  function openLiveCat(cat) {
    var main = qs('#main'); if (!main) return;
    guardAdult(cat).then(function (ok) { if (ok) openLiveCatDo(cat, main); });
  }

  function openLiveCatDo(cat, main) {
    main.innerHTML = '<div class="center-mid"><div class="spinner"></div></div>';
    var p;
    if (cat.virtual === 'fav') p = Promise.resolve(window.Store.getFavorites().filter(function (f) { return f.kind === 'live'; }));
    else p = window.API.streams(state.server, 'live', cat.id);
    p.then(function (chs) {
      chs = chs || [];
      if (!chs.length) { main.innerHTML = '<div class="empty-note">Nenhum canal.</div>'; return; }
      main.innerHTML = '<div class="chan-list" id="chanList"></div><div class="epg-box" id="epgBox"><div class="h">NO AR AGORA</div><div class="now" id="epgNow">-</div><div class="h">A SEGUIR</div><div id="epgNext">-</div></div>';
      var listEl = qs('#chanList');
      listEl.innerHTML = chs.map(function (c, i) {
        var star = window.Store.isFavorite(c) ? '&#9733;' : '';
        return '<div class="chan" tabindex="0" data-ch="' + i + '">' +
          '<div class="num">' + esc(c.num || (i + 1)) + '</div>' +
          '<img class="logo" src="' + esc(c.poster || '') + '" onerror="this.src=\'' + LOGO_PH + '\'"/>' +
          '<div class="nm">' + esc(c.title) + '</div>' +
          '<div class="fav" data-favch="' + i + '">' + star + '</div></div>';
      }).join('');
      Array.prototype.forEach.call(listEl.querySelectorAll('.chan'), function (n) {
        var i = +n.getAttribute('data-ch');
        n.addEventListener('mouseenter', function () { loadEpg(chs[i]); });
        n.addEventListener('focus', function () { loadEpg(chs[i]); });
        n.addEventListener('click', function () { playLive(chs[i]); });
        n.addEventListener('keydown', function (e) { if (e.key === 'Enter') playLive(chs[i]); });
      });
      Array.prototype.forEach.call(listEl.querySelectorAll('[data-favch]'), function (n) {
        n.addEventListener('click', function (e) {
          e.stopPropagation();
          var i = +n.getAttribute('data-favch');
          var f = window.Store.toggleFavorite(chs[i]);
          n.innerHTML = f ? '&#9733;' : '';
          toast(f ? 'Canal favoritado' : 'Removido dos favoritos');
        });
      });
      loadEpg(chs[0]);
    }).catch(function () { main.innerHTML = '<div class="empty-note">Erro ao carregar canais.</div>'; });
  }

  var _epgTimer = null, _epgId = null;
  function loadEpg(ch) {
    var now = document.getElementById('epgNow'), next = document.getElementById('epgNext');
    if (!now) return;
    var id = ch.streamId || ch.id;
    if (id === _epgId) return;
    _epgId = id;
    now.textContent = 'Carregando...'; next.textContent = '-';
    if (_epgTimer) clearTimeout(_epgTimer);
    _epgTimer = setTimeout(function () { doLoadEpg(ch, now, next); }, 250);
  }
  function doLoadEpg(ch, now, next) {
    window.API.epg(state.server, ch.streamId || ch.id).then(function (list) {
      if (!list || !list.length) { now.textContent = 'Sem informacao de programacao.'; next.textContent = '-'; return; }
      now.textContent = list[0].title || '-';
      next.textContent = list[1] ? (list[1].title || '-') : '-';
    }).catch(function () { now.textContent = '-'; });
  }

  function playLive(ch) {
    window.Store.addHistory(ch);
    window.Player.open(window.API.liveUrl(state.server, ch.streamId || ch.id), ch.title);
  }

  // ============================================================
  //  Detalhes (filme / serie)
  // ============================================================
  function screenDetails(params) {
    var it = params.item;
    var isSeries = it.kind === 'series';
    var favLabel = window.Store.isFavorite(it) ? 'REMOVER DOS FAVORITOS' : 'ADICIONAR AOS FAVORITOS';
    var primary = isSeries ? 'VER EPISODIOS' : 'ASSISTIR';
    h('<div class="view details">' +
      '<div class="backdrop" style="background-image:url(\'' + esc(it.poster || '') + '\')"></div><div class="scrim"></div>' +
      '<div class="content"><div class="cover-big"><img src="' + esc(it.poster || '') + '" onerror="this.src=\'' + POSTER_PH + '\'"/></div>' +
      '<div class="meta"><div class="tag">' + (isSeries ? 'SERIE' : 'FILME') + '</div>' +
      '<h1>' + esc(it.title) + '</h1>' +
      '<div class="sub" id="dSub">' + (it.rating ? ('Nota ' + esc(it.rating)) : '') + '</div>' +
      '<div class="plot" id="dPlot">' + esc(it.plot || '') + '</div>' +
      '<div class="actions">' +
      '<button class="btn" id="dPrimary">' + primary + '</button>' +
      '<button class="btn ghost" id="dFav" style="width:auto;padding:0 24px">' + favLabel + '</button>' +
      '<button class="btn ghost" id="dBack" style="width:auto;padding:0 24px">VOLTAR</button>' +
      '</div></div></div></div>');

    qs('#dBack').addEventListener('click', back);
    qs('#dFav').addEventListener('click', function () {
      var f = window.Store.toggleFavorite(it);
      qs('#dFav').textContent = f ? 'REMOVER DOS FAVORITOS' : 'ADICIONAR AOS FAVORITOS';
      toast(f ? 'Adicionado aos favoritos.' : 'Removido dos favoritos.');
    });

    if (isSeries) {
      qs('#dPrimary').textContent = 'CARREGANDO...';
      qs('#dPrimary').disabled = true;
      window.API.seriesInfo(state.server, it.seriesId || it.id).then(function (info) {
        if (info.info) {
          if (info.info.plot) qs('#dPlot').textContent = info.info.plot;
          var parts = [];
          if (info.info.genre) parts.push(info.info.genre);
          if (info.info.rating) parts.push('Nota ' + info.info.rating);
          if (info.info.releaseDate) parts.push(info.info.releaseDate);
          if (parts.length) qs('#dSub').textContent = parts.join('   |   ');
        }
        var seasons = info.seasons || [];
        var btn = qs('#dPrimary');
        btn.textContent = 'VER EPISODIOS'; btn.disabled = false;
        btn.addEventListener('click', function () {
          if (!seasons.length) { toast('Nenhum episodio encontrado.'); return; }
          window.Store.addHistory(it);
          go(screenEpisodes, { item: it, seasons: seasons });
        });
      }).catch(function () { var btn = qs('#dPrimary'); btn.textContent = 'VER EPISODIOS'; btn.disabled = false; });
    } else {
      qs('#dPrimary').addEventListener('click', function () {
        window.Store.addHistory(it);
        window.Player.open(it.url || window.API.vodUrl(state.server, it.streamId || it.id, it.ext), it.title);
      });
    }
  }

  // ============================================================
  //  Episodios
  // ============================================================
  function screenEpisodes(params) {
    var it = params.item, seasons = params.seasons || [];
    h('<div class="view"><div class="subhdr"><button class="back-btn" data-back>' + IC.back + '</button><h2>' + esc(it.title) + '</h2></div>' +
      '<div class="main scroll" style="padding:22px 30px"><div class="seasons-tabs" id="seasonTabs"></div><div class="ep-list" id="epList"></div></div></div>');
    qs('[data-back]').addEventListener('click', back);

    var tabs = qs('#seasonTabs');
    tabs.innerHTML = seasons.map(function (s, i) { return '<button class="season-tab" data-se="' + i + '">Temporada ' + esc(s.season) + '</button>'; }).join('');
    Array.prototype.forEach.call(tabs.querySelectorAll('[data-se]'), function (n) {
      n.addEventListener('click', function () { selSeason(+n.getAttribute('data-se'), seasons); });
    });
    if (seasons.length) selSeason(0, seasons);
    else qs('#epList').innerHTML = '<div class="empty-note">Nenhum episodio.</div>';
  }

  function selSeason(idx, seasons) {
    qsa('.season-tab').forEach(function (n, i) { n.classList.toggle('active', i === idx); });
    var eps = (seasons[idx] && seasons[idx].episodes) || [];
    var list = qs('#epList');
    list.innerHTML = eps.map(function (ep, i) {
      return '<div class="ep" data-ep="' + i + '"><img src="' + esc(ep.poster || '') + '" onerror="this.src=\'' + POSTER_PH + '\'"/>' +
        '<div class="txt"><b>' + esc(ep.episodeNum ? (ep.episodeNum + '. ') : '') + esc(ep.title) + '</b><span>' + esc((ep.plot || '').slice(0, 140)) + '</span></div></div>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('[data-ep]'), function (n) {
      n.addEventListener('click', function () {
        var ep = eps[+n.getAttribute('data-ep')];
        window.Player.open(ep.url, ep.title);
      });
    });
  }

  // ============================================================
  //  Busca (filmes + series)
  // ============================================================
  function screenSearch() {
    h('<div class="view"><div class="subhdr"><button class="back-btn" data-back>' + IC.back + '</button>' +
      '<input class="search-input" id="q" placeholder="Buscar filmes e series..." />' +
      '<button class="btn" id="btnQ" style="width:auto;padding:0 24px;height:46px">Buscar</button></div>' +
      '<div class="main scroll" id="main" style="padding:22px 30px"><div class="empty-note">Digite um termo e pressione Buscar.</div></div></div>');
    qs('[data-back]').addEventListener('click', back);
    qs('#btnQ').addEventListener('click', doSearch);
    qs('#q').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
    setTimeout(function () { qs('#q').focus(); }, 60);
  }

  var searchCache = null;
  function doSearch() {
    var term = (qs('#q').value || '').trim().toLowerCase();
    var main = qs('#main');
    if (term.length < 2) { main.innerHTML = '<div class="empty-note">Digite pelo menos 2 letras.</div>'; return; }
    main.innerHTML = '<div class="center-mid"><div class="spinner"></div></div>';
    var ready = searchCache ? Promise.resolve(searchCache) : Promise.all([
      window.API.streams(state.server, 'movie', ''),
      window.API.streams(state.server, 'series', '')
    ]).then(function (r) { searchCache = (r[0] || []).concat(r[1] || []); return searchCache; });

    ready.then(function (all) {
      var hideAdult = !state.adultUnlocked;
      var res = all.filter(function (it) {
        if (hideAdult && window.API.isAdult(it.title)) return false;
        return (it.title || '').toLowerCase().indexOf(term) >= 0;
      }).slice(0, 120);
      if (!res.length) { main.innerHTML = '<div class="empty-note">Nada encontrado.</div>'; return; }
      main.innerHTML = '<div class="pgrid">' + res.map(function (it, i) {
        return '<div class="pcard" tabindex="0" data-gi="' + i + '"><img src="' + esc(it.poster || '') + '" onerror="this.src=\'' + POSTER_PH + '\'"/><div class="cap">' + esc(it.title) + '</div></div>';
      }).join('') + '</div>';
      Array.prototype.forEach.call(main.querySelectorAll('[data-gi]'), function (n) {
        n.addEventListener('click', function () { go(screenDetails, { item: res[+n.getAttribute('data-gi')] }); });
      });
    }).catch(function () { main.innerHTML = '<div class="empty-note">Erro na busca.</div>'; });
  }

  // ============================================================
  //  Ajustes
  // ============================================================
  function screenSettings() {
    var pin = window.Store.getAdultPin();
    h('<div class="view"><div class="subhdr"><button class="back-btn" data-back>' + IC.back + '</button><h2>AJUSTES</h2></div>' +
      '<div class="main scroll" style="padding:30px;max-width:640px">' +
      '<div class="field"><label>PIN de conteudo adulto (vazio = sem bloqueio)</label><input id="pin" type="text" value="' + esc(pin) + '" maxlength="8"/></div>' +
      '<button class="btn" id="savePin" style="max-width:260px">Salvar PIN</button>' +
      '<div style="height:22px"></div>' +
      '<div class="field"><label>Conta</label><div class="user" style="font-size:16px">' + esc(state.server ? state.server.user : '') + ' - ' + esc(state.server ? state.server.host : '') + '</div></div>' +
      '<button class="btn ghost" id="logout" style="max-width:260px">SAIR DA CONTA</button>' +
      '<div style="height:22px"></div>' +
      '<div class="user" style="font-size:13px;color:var(--mute)">' + esc(CFG.brand) + ' v1.0.0</div>' +
      '</div></div>');
    qs('[data-back]').addEventListener('click', back);
    qs('#savePin').addEventListener('click', function () {
      window.Store.setAdultPin((qs('#pin').value || '').trim()); toast('PIN salvo.');
    });
    qs('#logout').addEventListener('click', function () {
      window.Store.clearSession(); state.server = null; state.userInfo = {};
      if (clockTimer) clearInterval(clockTimer);
      replace(screenLogin, {});
    });
  }

  // ============================================================
  //  Janela + player + teclado
  // ============================================================
  function wireWindow() {
    // Barra de titulo existe so no desktop (Electron). No Android nao ha esses botoes.
    var min = document.getElementById('tbMin');
    var max = document.getElementById('tbMax');
    var cls = document.getElementById('tbClose');
    if (min) min.addEventListener('click', function () { safeWin('minimize'); });
    if (max) max.addEventListener('click', function () { safeWin('maximize'); });
    if (cls) cls.addEventListener('click', function () { safeWin('close'); });
  }
  function safeWin(fn) { try { if (window.native && window.native.win && window.native.win[fn]) window.native.win[fn](); } catch (e) {} }

  function wirePlayer() {
    document.getElementById('plBack').addEventListener('click', function () { window.Player.close(); });
    document.getElementById('plPlay').addEventListener('click', function () { window.Player.togglePlay(); });
    document.getElementById('plMute').addEventListener('click', function () { window.Player.toggleMute(); });
    document.getElementById('plFull').addEventListener('click', function () {
      try { if (window.native && window.native.win && window.native.win.fullscreen) window.native.win.fullscreen(true); } catch (e) {}
      // Android/WebView: fullscreen do proprio elemento de video
      try { var v = document.getElementById('videoEl'); if (v && v.requestFullscreen) v.requestFullscreen(); } catch (e) {}
    });
    var pl = document.getElementById('player');
    pl.addEventListener('mousemove', function () { window.Player.resetHideTimer(); });
    document.getElementById('videoEl').addEventListener('click', function () { window.Player.togglePlay(); });
  }

  function wireKeys() {
    document.addEventListener('keydown', function (e) {
      if (window.Player.isOpen()) {
        if (e.key === 'Escape') { window.Player.close(); }
        else if (e.key === ' ') { e.preventDefault(); window.Player.togglePlay(); }
        else if (e.key === 'ArrowRight') { window.Player.seek(10); }
        else if (e.key === 'ArrowLeft') { window.Player.seek(-10); }
        else if (e.key.toLowerCase() === 'm') { window.Player.toggleMute(); }
        window.Player.resetHideTimer();
        return;
      }
      if (e.key === 'Escape' || e.key === 'Backspace') {
        var tag = (e.target && e.target.tagName) || '';
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); back(); }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
