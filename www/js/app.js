// ============================================================
//  LOLLIFLIX Android - Controlador da interface (SPA)
//  Celular, tablet, TV Box e Android TV (toque + controle remoto)
// ============================================================
(function () {
  var CFG = window.APP_CONFIG;
  var APP_VERSION = '1.1.0';
  var appEl, toastEl, clockTimer = null;

  var state = {
    servers: [],
    branding: {},
    server: null,      // activeServer {name,host,user,pass}
    userInfo: {},
    adultUnlocked: false
  };

  var nav = [];            // pilha de telas: {fn, params, restore}
  var viewFresh = false;   // tela acabou de ser desenhada (aguardando foco/rolagem inicial)
  var pendingRestore = null;
  var modalClose = null;   // fecha o modal aberto (PIN), se houver
  var lastBackAt = 0;
  var liveCtx = null;      // {list, idx} do canal em reproducao (troca de canal pelo controle)
  var focusBeforePlayer = null;

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
  function each(root, sel, fn) { Array.prototype.forEach.call(root.querySelectorAll(sel), fn); }
  function img(cls, src, ph) {
    return '<img ' + (cls ? 'class="' + cls + '" ' : '') + 'loading="lazy" decoding="async" src="' + esc(src || ph) + '" onerror="this.onerror=null;this.src=\'' + ph + '\'"/>';
  }
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastEl._t); toastEl._t = setTimeout(function () { toastEl.classList.remove('show'); }, 2400);
  }
  function nowClock() { var d = new Date(); function p(n) { return (n < 10 ? '0' : '') + n; } return p(d.getHours()) + ':' + p(d.getMinutes()); }
  function plugin(name) { var C = window.Capacitor; return (C && C.Plugins && C.Plugins[name]) || null; }

  // Cache em memoria (categorias/listas): voltar de uma tela fica instantaneo
  var memo = {};
  function cached(key, fn) {
    var c = memo[key];
    if (c && Date.now() - c.t < 10 * 60 * 1000) return Promise.resolve(c.v);
    return fn().then(function (v) { if (v && v.length) memo[key] = { t: Date.now(), v: v }; return v; });
  }
  function getCategories(kind) { return cached('cat:' + kind, function () { return window.API.categories(state.server, kind); }); }
  function getStreams(kind, catId) { return cached('str:' + kind + ':' + catId, function () { return window.API.streams(state.server, kind, catId); }); }

  // ============================================================
  //  Navegacao entre telas (pilha) + botao VOLTAR
  // ============================================================
  var SCROLLERS = '.scroll, .cat .side, .cat .main, .rail, .login-wrap';

  function go(fn, params) { saveView(); nav.push({ fn: fn, params: params || {} }); render(); }
  function replace(fn, params) { nav = [{ fn: fn, params: params || {} }]; render(); }
  function render() {
    var t = nav[nav.length - 1];
    pendingRestore = t.restore || null; t.restore = null;
    viewFresh = true;
    t.fn(t.params);
  }

  // Guarda rolagem e item focado da tela atual, para restaurar ao voltar
  function saveView() {
    var t = nav[nav.length - 1];
    if (!t) return;
    t.restore = {
      scroll: qsa(SCROLLERS).map(function (n) { return [n.scrollTop, n.scrollLeft]; }),
      focus: focusables(appEl).indexOf(document.activeElement)
    };
  }

  // Chamado quando o conteudo principal da tela terminou de carregar
  function viewReady(def) {
    if (!viewFresh) return;
    viewFresh = false;
    var r = pendingRestore; pendingRestore = null;
    if (r) {
      qsa(SCROLLERS).forEach(function (n, i) { if (r.scroll[i]) { n.scrollTop = r.scroll[i][0]; n.scrollLeft = r.scroll[i][1]; } });
      var f = r.focus >= 0 ? focusables(appEl)[r.focus] : null;
      if (f && !isTextInput(f)) { focusEl(f); return; }
    }
    if (def && kbdMode && !isTyping()) focusEl(def);
  }

  // Botao VOLTAR (aparelho, gesto ou controle): volta DENTRO do app.
  // So sai do app na tela inicial, e pedindo confirmacao (2 toques).
  function handleBack() {
    if (modalClose) { modalClose(); return; }
    if (window.Player.isOpen()) { closePlayer(); return; }
    if (nav.length > 1) { nav.pop(); render(); return; }
    var now = Date.now();
    if (now - lastBackAt < 2500) { exitApp(); return; }
    lastBackAt = now;
    toast('Pressione VOLTAR novamente para sair');
  }
  function exitApp() {
    var App = plugin('App');
    try { if (App && App.exitApp) App.exitApp(); } catch (e) {}
  }

  // ============================================================
  //  Splash + boot
  // ============================================================
  function boot() {
    appEl = document.getElementById('app');
    toastEl = document.getElementById('toast');
    setKbd(looksLikeTv());
    wireStage();
    wireNative();
    wirePlayer();
    wireKeys();
    splash();
    loadConfig();
  }

  function looksLikeTv() {
    var ua = navigator.userAgent || '';
    if (/\bTV\b|AFT[A-Z]|BRAVIA|SMART-TV|GoogleTV|Android TV|MiBOX|SHIELD/i.test(ua)) return true;
    return navigator.maxTouchPoints === 0 && !('ontouchstart' in window);
  }

  // ------------------------------------------------------------
  //  Palco adaptavel: a interface e desenhada em um "palco" que e
  //  escalado para preencher a tela inteira, sempre em PAISAGEM.
  //  - TVs/tablets: palco ~1280x720 (como antes)
  //  - Celulares: escala minima maior => letras e botoes maiores
  //  - Se o sistema entregar a janela em retrato (bug do aparelho,
  //    Android 16 em tela grande, tela dividida), giramos o conteudo
  //    para continuar de lado.
  // ------------------------------------------------------------
  var DESIGN_H = 720, DESIGN_MIN_W = 1040, MIN_SCALE = 0.8, ABS_MIN_W = 700;
  var stage = { s: 1, w: 1280, h: 720, rot: false };
  var baseVp = { w: 0, h: 0 };
  var probe = null;

  function safeInsets() {
    if (!probe) return { t: 0, r: 0, b: 0, l: 0 };
    var cs = window.getComputedStyle(probe);
    return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
  }

  function fitStage() {
    var pw = window.innerWidth, ph = window.innerHeight;
    if (!pw || !ph) return;
    try { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); } catch (e) {}

    var rot = ph > pw;
    var bs = document.body.style;
    if (rot) {
      bs.position = 'absolute'; bs.top = '0'; bs.left = '0';
      bs.width = ph + 'px'; bs.height = pw + 'px';
      bs.transformOrigin = '0 0';
      bs.transform = 'translateX(' + pw + 'px) rotate(90deg)';
    } else if (stage.rot) {
      bs.position = bs.top = bs.left = bs.width = bs.height = bs.transformOrigin = bs.transform = '';
    }
    var W = rot ? ph : pw, H = rot ? pw : ph;

    // Teclado aberto: a janela encolhe. Mantemos o tamanho do palco (nada de "encolher tudo")
    // e apenas deslocamos para o campo digitado continuar visivel.
    var kb = isTyping() && rot === stage.rot && baseVp.w === W && H < baseVp.h - 60;
    if (kb) H = baseVp.h; else { baseVp.w = W; baseVp.h = H; }
    stage.rot = rot;

    var ins = rot ? { t: 0, r: 0, b: 0, l: 0 } : safeInsets();
    var aw = Math.max(200, W - ins.l - ins.r), ah = Math.max(120, H - ins.t - ins.b);
    var s = Math.min(ah / DESIGN_H, aw / DESIGN_MIN_W);
    s = Math.max(s, MIN_SCALE);
    s = Math.min(s, aw / ABS_MIN_W);
    if (!isFinite(s) || s <= 0) s = 1;

    stage.s = s; stage.w = Math.round(aw / s); stage.h = Math.round(ah / s);
    appEl.style.width = stage.w + 'px';
    appEl.style.height = stage.h + 'px';
    document.documentElement.classList.toggle('compact', stage.h < 600);
    appEl.style.transform = 'translate(' + ins.l + 'px,' + ins.t + 'px) scale(' + s + ')';

    if (kb && !rot) {
      var a = document.activeElement;
      if (a && appEl.contains(a)) {
        var r = a.getBoundingClientRect();
        var dy = Math.min(Math.max(0, r.bottom + 14 - ph), Math.max(0, r.top - 8));
        if (dy > 0) appEl.style.transform = 'translate(' + ins.l + 'px,' + (ins.t - dy) + 'px) scale(' + s + ')';
      }
    }
  }

  function wireStage() {
    probe = document.createElement('div');
    probe.id = 'safeProbe';
    document.body.appendChild(probe);

    function later() { fitStage(); setTimeout(fitStage, 120); setTimeout(fitStage, 400); setTimeout(fitStage, 900); }
    fitStage();
    window.addEventListener('resize', later);
    window.addEventListener('orientationchange', later);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', fitStage);
    try { if (window.screen && screen.orientation) screen.orientation.addEventListener('change', later); } catch (e) {}
    document.addEventListener('visibilitychange', function () { if (!document.hidden) later(); });
    document.addEventListener('focusin', function () { setTimeout(fitStage, 60); setTimeout(fitStage, 400); });
    document.addEventListener('focusout', function () { setTimeout(fitStage, 60); setTimeout(fitStage, 400); });
    // area segura (notch) chega de forma assincrona do sistema
    try { if (window.ResizeObserver) new ResizeObserver(fitStage).observe(probe); } catch (e) {}
  }

  // Integracao nativa (Capacitor): botao voltar + pausa ao sair do app
  function wireNative() {
    var App = plugin('App');
    if (!App || !App.addListener) return;
    try {
      App.addListener('backButton', function () { handleBack(); });
      App.addListener('pause', function () { window.Player.pause(); });
      App.addListener('resume', function () { fitStage(); if (window.Player.isLive()) window.Player.resume(); });
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
      state.loginMode = res.loginMode || 'direct';
      applyBranding();
      var sess = window.Store.getSession();
      var canAuto = sess && sess.user && sess.pass && (state.loginMode !== 'code' || sess.code);
      if (canAuto) {
        splashMsg('Entrando como ' + sess.user + '...');
        connect(sess.user, sess.pass, sess.code).then(function (lr) {
          if (lr.ok) { onLoggedIn(lr, sess.code); } else { replace(screenLogin, { error: lr.blocked ? lr.error : '' }); }
        });
      } else {
        replace(screenLogin, {});
      }
    });
  }

  // Dados do aparelho enviados ao painel (contagem de dispositivos por plataforma)
  function deviceInfo(user) {
    var ua = navigator.userAgent || '';
    var m = /;\s*([^;()]+?)\s+Build\//.exec(ua) || /\(Linux; Android [^;]+;\s*([^)]+)\)/.exec(ua);
    var id = window.Store.getDeviceId();
    return { device_id: id, mac: id, platform: 'android', model: m ? m[1].trim().slice(0, 60) : '', app_version: APP_VERSION, username: user || '' };
  }

  // Login: no modo "codigo" primeiro troca o codigo de parceria pela DNS do parceiro
  function connect(user, pass, code) {
    if (state.loginMode !== 'code') return window.API.login(state.servers, user, pass);
    code = String(code || '').replace(/\D+/g, '');
    if (!code) return Promise.resolve({ ok: false, error: 'Informe o codigo de parceria.' });
    return window.API.partnerLogin(code, deviceInfo(user)).then(function (pl) {
      if (!pl.ok) return { ok: false, error: pl.error, blocked: pl.code === 'blocked' || pl.code === 'limit' };
      return window.API.login(pl.servers, user, pass);
    });
  }

  function onLoggedIn(lr, code) {
    state.server = lr.server;
    state.userInfo = lr.userInfo || {};
    state.code = state.loginMode === 'code' ? String(code || '') : '';
    memo = {}; searchCache = null;
    window.Store.setSession({ user: lr.server.user, pass: lr.server.pass, code: state.code });
    window.Store.addProfile(lr.server.user, lr.server.pass, CFG.maxProfiles, state.code);
    startHeartbeat();
    replace(screenHome, {});
  }

  // Sinal de vida para o painel (a cada 2 min). Se o painel bloquear o aparelho, sai da conta.
  var hbTimer = null;
  function sendHeartbeat() {
    if (!state.server) return;
    var p = deviceInfo(state.server.user);
    if (state.code) p.code = state.code; else p.host = state.server.host;
    window.API.heartbeat(p).then(function (r) {
      if (r && r.blocked && state.server) logout(r.message);
    });
  }
  function startHeartbeat() {
    if (hbTimer) clearInterval(hbTimer);
    sendHeartbeat();
    hbTimer = setInterval(sendHeartbeat, 120000);
  }
  function logout(message) {
    if (window.Player.isOpen()) window.Player.close();
    if (modalClose) modalClose();
    if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
    window.Store.clearSession(); state.server = null; state.userInfo = {}; state.adultUnlocked = false; state.code = '';
    memo = {}; searchCache = null; liveCtx = null;
    if (clockTimer) clearInterval(clockTimer);
    replace(screenLogin, { error: message || '' });
  }

  // ============================================================
  //  Login
  // ============================================================
  function screenLogin(params) {
    params = params || {};
    var b = state.branding || {};
    var useCode = state.loginMode === 'code';
    var lastCode = (window.Store.getJson('lastCode', '') || '');
    // no modo codigo so mostra contas salvas que ja tem codigo
    var profiles = window.Store.getProfiles().filter(function (p) { return !useCode || p.code; });
    var profHtml = '';
    if (profiles.length) {
      profHtml = '<div class="profiles"><div class="ptitle">Contas salvas</div>' +
        profiles.map(function (p, i) {
          return '<div class="profile-row"><button class="btn ghost" data-prof="' + i + '">' + esc(p.user) + '</button>' +
            '<button class="profile-del" data-del="' + i + '" title="Remover">&#10005;</button></div>';
        }).join('') + '</div>';
    }
    var logo = b.logologin ? ('<img src="' + esc(b.logologin) + '" onerror="this.style.display=\'none\'"/>') : esc(CFG.brand);
    var codeHtml = useCode ? ('<div class="field"><label>Codigo de parceria</label><input id="inCode" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="12" autocomplete="off" enterkeyhint="next" placeholder="Somente numeros" value="' + esc(lastCode) + '"/></div>') : '';
    h('<div class="view login-wrap"><div class="login-card' + (useCode ? ' with-code' : '') + '">' +
      '<div class="login-logo">' + logo + '</div>' +
      '<h2>ENTRAR</h2><div class="welcome">' + esc(b.welcome || 'BEM-VINDO!') + '</div>' +
      codeHtml +
      '<div class="field"><label>Usuario</label><input id="inUser" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next"/></div>' +
      '<div class="field"><label>Senha</label><input id="inPass" type="password" autocomplete="off" enterkeyhint="go"/></div>' +
      '<button class="btn" id="btnLogin">ENTRAR</button>' +
      '<div class="login-error" id="loginErr"></div>' +
      profHtml +
      '</div></div>');

    qs('#btnLogin').addEventListener('click', doLogin);
    qs('#inPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doLogin(); } });
    qs('#inUser').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); qs('#inPass').focus(); } });
    var inCode = qs('#inCode');
    if (inCode) {
      inCode.addEventListener('input', function () { var v = inCode.value.replace(/\D+/g, ''); if (v !== inCode.value) inCode.value = v; });
      inCode.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); qs('#inUser').focus(); } });
    }
    on('[data-prof]', 'click', function (e) {
      var p = profiles[+e.currentTarget.getAttribute('data-prof')];
      if (p) doLoginWith(p.user, p.pass, p.code);
    });
    on('[data-del]', 'click', function (e) {
      var p = profiles[+e.currentTarget.getAttribute('data-del')];
      if (p) { window.Store.removeProfile(p.user); screenLogin(); }
    });
    if (params.error) qs('#loginErr').textContent = params.error;
    viewFresh = false;
    if (kbdMode) focusEl(qs('[data-prof]') || inCode || qs('#inUser'));
  }

  function doLogin() {
    var c = qs('#inCode');
    doLoginWith((qs('#inUser').value || '').trim(), (qs('#inPass').value || '').trim(), c ? c.value : '');
  }
  function doLoginWith(user, pass, code) {
    var err = qs('#loginErr');
    var useCode = state.loginMode === 'code';
    code = String(code || '').replace(/\D+/g, '');
    if (useCode && !code) { if (err) err.textContent = 'Informe o codigo de parceria.'; return; }
    if (!user || !pass) { if (err) err.textContent = 'Informe usuario e senha.'; return; }
    if (err) err.textContent = '';
    var btn = qs('#btnLogin'); if (btn) { btn.disabled = true; btn.textContent = 'ENTRANDO...'; }
    try { if (isTyping()) document.activeElement.blur(); } catch (e) {}
    if (useCode) window.Store.setJson('lastCode', code);
    connect(user, pass, code).then(function (lr) {
      if (lr.ok) { onLoggedIn(lr, code); }
      else { if (err) err.textContent = lr.error || 'Falha no login.'; if (btn) { btn.disabled = false; btn.textContent = 'ENTRAR'; } }
    }).catch(function () {
      if (err) err.textContent = 'Sem conexao. Tente novamente.'; if (btn) { btn.disabled = false; btn.textContent = 'ENTRAR'; }
    });
  }

  // ============================================================
  //  Home
  // ============================================================
  function headerHtml() {
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
      headerHtml() +
      '<div class="home-grid">' +
        '<button class="tile big" data-nav="live"><span>' + IC.live + '</span><span class="lbl">TV AO VIVO</span></button>' +
        '<div class="grid2">' +
          '<button class="tile sm" data-nav="movies">' + IC.movies + '<span class="lbl">FILMES</span></button>' +
          '<button class="tile sm" data-nav="series">' + IC.series + '<span class="lbl">SERIES</span></button>' +
          '<button class="tile sm" data-nav="settings">' + IC.settings + '<span class="lbl">AJUSTES</span></button>' +
          '<button class="tile sm" data-nav="reload">' + IC.reload + '<span class="lbl">ATUALIZAR</span></button>' +
        '</div>' +
      '</div>' +
      '<div id="contBox" class="hide"><div class="section-title">CONTINUAR ASSISTINDO</div><div class="rail" id="contRail"></div></div>' +
      '<div class="section-title">FILMES RECEM ADICIONADOS</div>' +
      '<div class="rail" id="recentRail"></div>' +
      '<div class="empty-note hide" id="recentEmpty">Nenhum filme disponivel no momento.</div>' +
      '</div></div>');

    startClock();
    on('[data-nav]', 'click', function (e) { onNav(e.currentTarget.getAttribute('data-nav')); });

    renderContinue();
    // recentes: cache instantaneo + atualizacao em segundo plano
    renderRecent(window.Store.getRecentCache());
    viewReady(qs('.tile.big'));
    loadRecent();
  }

  function onNav(dest) {
    if (dest === 'live') go(screenLive, {});
    else if (dest === 'movies') go(screenCatalog, { kind: 'movie', title: 'FILMES' });
    else if (dest === 'series') go(screenCatalog, { kind: 'series', title: 'SERIES' });
    else if (dest === 'favorites') go(screenFavorites, {});
    else if (dest === 'search') go(screenSearch, {});
    else if (dest === 'settings') go(screenSettings, {});
    else if (dest === 'reload') { memo = {}; searchCache = null; toast('Atualizando lista de conteudo...'); loadRecent(); }
  }

  // Fileira "Continuar assistindo": filmes e episodios parados no meio
  function renderContinue() {
    var box = document.getElementById('contBox'), rail = document.getElementById('contRail');
    if (!box || !rail) return;
    // so itens da conta atual (o endereco do video leva o usuario)
    var mine = state.server ? '/' + state.server.user + '/' : '';
    var list = window.Store.getContinue(40).filter(function (r) { return mine && r.url.indexOf(mine) >= 0; }).slice(0, 20);
    box.classList.toggle('hide', !list.length);
    rail.innerHTML = list.map(function (r, i) {
      var pct = r.d ? Math.min(100, Math.round(r.t / r.d * 100)) : 0;
      return '<div class="cover" tabindex="0" data-cont="' + i + '">' + img('', r.poster, POSTER_PH) +
        '<div class="ctitle">' + esc(r.title) + '</div><div class="prog"><i style="width:' + pct + '%"></i></div></div>';
    }).join('');
    each(rail, '[data-cont]', function (n) {
      n.addEventListener('click', function () {
        var r = list[+n.getAttribute('data-cont')];
        if (r) playVod({ key: r.key, url: r.url, title: r.title, poster: r.poster, kind: r.kind }, 'resume');
      });
    });
  }

  function loadRecent() {
    if (!state.server) return;
    window.API.recent(state.server, 14, !state.adultUnlocked).then(function (list) {
      if (list && list.length) {
        window.Store.setRecentCache(list);
        // nao redesenha se o usuario ja esta navegando pelas capas (evita perder o foco)
        var rail = document.getElementById('recentRail');
        if (rail && !rail.contains(document.activeElement)) renderRecent(list);
      }
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
      return '<div class="cover" tabindex="0" data-rec="' + i + '">' + img('', m.poster, POSTER_PH) + '</div>';
    }).join('');
    each(rail, '[data-rec]', function (n) {
      n.addEventListener('click', function () { go(screenDetails, { item: list[+n.getAttribute('data-rec')] }); });
    });
  }

  // ============================================================
  //  Catalogo (Filmes / Series)
  // ============================================================
  function catShell(title) {
    return '<div class="view col"><div class="subhdr"><button class="back-btn" data-back>' + IC.back + '</button><h2>' + esc(title) + '</h2></div>' +
      '<div class="cat"><div class="side" id="side"><h3>CATEGORIAS</h3><div id="catList"></div></div>' +
      '<div class="main" id="main"><div class="center-mid"><div class="spinner"></div></div></div></div></div>';
  }

  function screenCatalog(params) {
    var kind = params.kind;
    h(catShell(params.title));
    qs('[data-back]').addEventListener('click', handleBack);

    var cats = [{ id: '@fav', name: 'Favoritos', virtual: 'fav' }];
    var pick = function (cat, idx) { params.catIdx = idx; openCat(kind, cat); };
    getCategories(kind).then(function (list) {
      if (!qs('#catList')) return;
      (list || []).forEach(function (c) { cats.push({ id: c.id, name: c.name, virtual: '' }); });
      renderCats(cats, pick);
      var start = (params.catIdx != null && cats[params.catIdx]) ? params.catIdx : (cats.length > 1 ? 1 : 0);
      selectCat(start, cats, pick);
    }).catch(function () { var m = qs('#main'); if (m) m.innerHTML = '<div class="empty-note">Erro ao carregar. Verifique a conexao.</div>'; });
  }

  function renderCats(cats, onPick) {
    var list = qs('#catList');
    list.innerHTML = cats.map(function (c, i) { return '<div class="cat-item" tabindex="0" data-ci="' + i + '">' + esc(c.name) + '</div>'; }).join('');
    each(list, '[data-ci]', function (n) {
      n.addEventListener('click', function () { selectCat(+n.getAttribute('data-ci'), cats, onPick); });
    });
  }
  function selectCat(idx, cats, onPick) {
    qsa('.cat-item').forEach(function (n, i) { n.classList.toggle('active', i === idx); });
    if (cats[idx]) onPick(cats[idx], idx);
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

  // modal simples de PIN (fecha tambem pelo botao VOLTAR)
  function askPin() {
    return new Promise(function (resolve) {
      var prev = document.activeElement;
      var ov = document.createElement('div');
      ov.className = 'modal-ov';
      ov.innerHTML = '<div class="modal"><h3>Conteudo adulto</h3><p>Digite o PIN para continuar</p>' +
        '<input id="mPin" type="password" maxlength="8" inputmode="numeric" autocomplete="off"/>' +
        '<div class="modal-actions"><button class="btn ghost" id="mCancel">Cancelar</button>' +
        '<button class="btn" id="mOk">OK</button></div></div>';
      document.body.appendChild(ov);
      var inp = ov.querySelector('#mPin');
      function done(val) {
        if (!modalClose) return;
        modalClose = null;
        document.body.removeChild(ov);
        try { if (prev && prev.focus) prev.focus({ preventScroll: true }); } catch (e) {}
        resolve(val);
      }
      modalClose = function () { done(null); };
      ov.querySelector('#mOk').addEventListener('click', function () { done(inp.value || ''); });
      ov.querySelector('#mCancel').addEventListener('click', function () { done(null); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); done(inp.value || ''); } });
      setTimeout(function () { try { inp.focus(); } catch (e) {} }, 50);
    });
  }

  var catReq = 0;
  function openCat(kind, cat) {
    var main = qs('#main');
    if (!main) return;
    guardAdult(cat).then(function (ok) { if (ok) openCatDo(kind, cat, main); else viewReady(qs('.cat-item.active')); });
  }

  function gridHtml(items) {
    return '<div class="pgrid">' + items.map(function (it, i) {
      return '<div class="pcard" tabindex="0" data-gi="' + i + '">' + img('', it.poster, POSTER_PH) + '<div class="cap">' + esc(it.title) + '</div></div>';
    }).join('') + '</div>';
  }

  function openCatDo(kind, cat, main) {
    var req = ++catReq;
    main.innerHTML = '<div class="center-mid"><div class="spinner"></div></div>';
    main.scrollTop = 0;
    var p;
    if (cat.virtual === 'fav') {
      var favs = window.Store.getFavorites().filter(function (f) { return f.kind === kind; });
      p = Promise.resolve(favs);
    } else {
      p = getStreams(kind, cat.id);
    }
    p.then(function (items) {
      if (req !== catReq || !main.isConnected) return;
      items = items || [];
      if (!items.length) { main.innerHTML = '<div class="empty-note">Nenhum item nesta categoria.</div>'; viewReady(qs('.cat-item.active')); return; }
      main.innerHTML = gridHtml(items);
      each(main, '[data-gi]', function (n) {
        n.addEventListener('click', function () { go(screenDetails, { item: items[+n.getAttribute('data-gi')] }); });
      });
      viewReady(main.querySelector('.pcard'));
    }).catch(function () {
      if (req !== catReq || !main.isConnected) return;
      main.innerHTML = '<div class="empty-note">Erro ao carregar. Verifique a conexao.</div>'; viewReady(qs('.cat-item.active'));
    });
  }

  function screenFavorites() {
    h('<div class="view col"><div class="subhdr"><button class="back-btn" data-back>' + IC.back + '</button><h2>FAVORITOS</h2></div>' +
      '<div class="main scroll pad" id="main"></div></div>');
    qs('[data-back]').addEventListener('click', handleBack);
    var favs = window.Store.getFavorites();
    var main = qs('#main');
    if (!favs.length) { main.innerHTML = '<div class="empty-note">Voce ainda nao tem favoritos.</div>'; viewReady(qs('[data-back]')); return; }
    main.innerHTML = gridHtml(favs);
    var lives = favs.filter(function (f) { return f.kind === 'live'; });
    each(main, '[data-gi]', function (n) {
      n.addEventListener('click', function () {
        var it = favs[+n.getAttribute('data-gi')];
        if (it.kind === 'live') playLive(it, lives, lives.indexOf(it)); else go(screenDetails, { item: it });
      });
    });
    viewReady(main.querySelector('.pcard'));
  }

  // ============================================================
  //  TV ao vivo
  // ============================================================
  function screenLive(params) {
    h(catShell('TV AO VIVO'));
    qs('[data-back]').addEventListener('click', handleBack);

    var cats = [{ id: '@fav', name: 'Favoritos', virtual: 'fav' }];
    var pick = function (cat, idx) { params.catIdx = idx; openLiveCat(cat); };
    getCategories('live').then(function (list) {
      if (!qs('#catList')) return;
      (list || []).forEach(function (c) { cats.push({ id: c.id, name: c.name, virtual: '' }); });
      renderCats(cats, pick);
      var start = (params.catIdx != null && cats[params.catIdx]) ? params.catIdx : (cats.length > 1 ? 1 : 0);
      selectCat(start, cats, pick);
    }).catch(function () { var m = qs('#main'); if (m) m.innerHTML = '<div class="empty-note">Erro ao carregar canais. Verifique a conexao.</div>'; });
  }

  function openLiveCat(cat) {
    var main = qs('#main'); if (!main) return;
    guardAdult(cat).then(function (ok) { if (ok) openLiveCatDo(cat, main); else viewReady(qs('.cat-item.active')); });
  }

  function openLiveCatDo(cat, main) {
    var req = ++catReq;
    main.innerHTML = '<div class="center-mid"><div class="spinner"></div></div>';
    main.scrollTop = 0;
    var p;
    if (cat.virtual === 'fav') p = Promise.resolve(window.Store.getFavorites().filter(function (f) { return f.kind === 'live'; }));
    else p = getStreams('live', cat.id);
    p.then(function (chs) {
      if (req !== catReq || !main.isConnected) return;
      chs = chs || [];
      if (!chs.length) { main.innerHTML = '<div class="empty-note">Nenhum canal.</div>'; viewReady(qs('.cat-item.active')); return; }
      // guia (EPG) fixo no topo; lista de canais rola por baixo
      main.innerHTML = '<div class="epg-box" id="epgBox"><div><div class="h">NO AR AGORA</div><div class="now" id="epgNow">-</div></div>' +
        '<div><div class="h">A SEGUIR</div><div class="next" id="epgNext">-</div></div></div>' +
        '<div class="chan-list" id="chanList"></div>';
      var listEl = qs('#chanList');
      listEl.innerHTML = chs.map(function (c, i) {
        var fav = window.Store.isFavorite(c);
        return '<div class="chan-row"><div class="chan" tabindex="0" data-ch="' + i + '">' +
          '<div class="num">' + esc(c.num || (i + 1)) + '</div>' +
          img('logo', c.poster, LOGO_PH) +
          '<div class="nm">' + esc(c.title) + '</div></div>' +
          '<button class="fav-btn' + (fav ? ' on' : '') + '" data-favch="' + i + '" title="Favoritar">' + (fav ? '&#9733;' : '&#9734;') + '</button></div>';
      }).join('');
      each(listEl, '.chan', function (n) {
        var i = +n.getAttribute('data-ch');
        n.addEventListener('mouseenter', function () { loadEpg(chs[i]); });
        n.addEventListener('focus', function () { loadEpg(chs[i]); });
        n.addEventListener('click', function () { playLive(chs[i], chs, i); });
      });
      each(listEl, '[data-favch]', function (n) {
        n.addEventListener('click', function () {
          var i = +n.getAttribute('data-favch');
          var f = window.Store.toggleFavorite(chs[i]);
          n.innerHTML = f ? '&#9733;' : '&#9734;';
          n.classList.toggle('on', f);
          toast(f ? 'Canal favoritado' : 'Removido dos favoritos');
        });
      });
      _epgId = null;
      loadEpg(chs[0]);
      viewReady(listEl.querySelector('.chan'));
    }).catch(function () {
      if (req !== catReq || !main.isConnected) return;
      main.innerHTML = '<div class="empty-note">Erro ao carregar canais. Verifique a conexao.</div>'; viewReady(qs('.cat-item.active'));
    });
  }

  var _epgTimer = null, _epgId = null;
  function loadEpg(ch) {
    var now = document.getElementById('epgNow'), next = document.getElementById('epgNext');
    if (!now || !ch) return;
    var id = ch.streamId || ch.id;
    if (id === _epgId) return;
    _epgId = id;
    now.textContent = 'Carregando...'; next.textContent = '-';
    if (_epgTimer) clearTimeout(_epgTimer);
    _epgTimer = setTimeout(function () { doLoadEpg(ch, id, now, next); }, 300);
  }
  function doLoadEpg(ch, id, now, next) {
    window.API.epg(state.server, id).then(function (list) {
      if (id !== _epgId) return;
      if (!list || !list.length) { now.textContent = 'Sem informacao de programacao.'; next.textContent = '-'; return; }
      now.textContent = list[0].title || '-';
      next.textContent = list[1] ? (list[1].title || '-') : '-';
    }).catch(function () { if (id === _epgId) now.textContent = '-'; });
  }

  // ---------- Reproducao ----------
  function openPlayer(url, title, opts) {
    if (!window.Player.isOpen()) focusBeforePlayer = document.activeElement;
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
    window.Player.open(url, title, opts);
  }
  function closePlayer() {
    window.Player.close();
    liveCtx = null;
    refreshProgressUi();
    var f = focusBeforePlayer; focusBeforePlayer = null;
    if (f && f.isConnected) focusEl(f);
  }
  function playLive(ch, list, idx) {
    window.Store.addHistory(ch);
    liveCtx = (list && idx >= 0) ? { list: list, idx: idx } : null;
    openPlayer(window.API.liveUrl(state.server, ch.streamId || ch.id), ch.title, { live: true });
  }

  function fmtTime(t) {
    t = Math.max(0, Math.floor(t || 0));
    var hh = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (hh ? hh + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function progressOf(key) {
    var p = window.Store.getProgress(key);
    return (p && p.t > 20 && (!p.d || p.t < p.d * 0.95)) ? p : null;
  }
  function progHtml(key) {
    var p = progressOf(key);
    if (!p || !p.d) return '';
    return '<div class="prog"><i style="width:' + Math.min(100, Math.round(p.t / p.d * 100)) + '%"></i></div>';
  }

  // Filmes e episodios: retoma de onde parou.
  // meta: { key, url, title, poster, kind, next() opcional (proximo episodio) }
  // mode: 'ask' (pergunta), 'resume' (continua direto), 'start' (do inicio)
  function playVod(meta, mode) {
    liveCtx = null;
    var saved = progressOf(meta.key);
    if (saved && (mode || 'ask') === 'ask') {
      askChoice('Continuar assistindo?', meta.title + ' - voce parou em ' + fmtTime(saved.t) + '.',
        ['Continuar de ' + fmtTime(saved.t), 'Assistir do inicio']).then(function (i) {
          if (i === 0) playVod(meta, 'resume'); else if (i === 1) playVod(meta, 'start');
        });
      return;
    }
    var startAt = (saved && mode !== 'start') ? Math.max(0, saved.t - 3) : 0;
    if (mode === 'start') window.Store.clearProgress(meta.key);
    openPlayer(meta.url, meta.title, {
      live: false, startAt: startAt,
      onProgress: function (t, d) {
        if (d > 60 && t >= d * 0.95) { window.Store.clearProgress(meta.key); return; }   // terminou
        if (t < 20) return;
        window.Store.setProgress(meta.key, { t: Math.floor(t), d: Math.floor(d), title: meta.title, poster: meta.poster || '', kind: meta.kind || 'movie', url: meta.url });
      },
      onEnded: function () {
        window.Store.clearProgress(meta.key);
        var nx = meta.next ? meta.next() : null;
        if (nx) { toast('Proximo episodio...'); playVod(nx, 'start'); }
        else closePlayer();
      }
    });
  }

  // modal de escolha; retorna Promise<indice do botao> (-1 = cancelou/voltar)
  function askChoice(title, text, buttons) {
    return new Promise(function (resolve) {
      var prev = document.activeElement;
      var ov = document.createElement('div');
      ov.className = 'modal-ov';
      ov.innerHTML = '<div class="modal choice"><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p><div class="modal-actions">' +
        buttons.map(function (b, i) { return '<button class="btn' + (i ? ' ghost' : '') + '" data-i="' + i + '">' + esc(b) + '</button>'; }).join('') + '</div></div>';
      document.body.appendChild(ov);
      function done(i) {
        if (!modalClose) return;
        modalClose = null;
        document.body.removeChild(ov);
        try { if (prev && prev.focus) prev.focus({ preventScroll: true }); } catch (e) {}
        resolve(i);
      }
      modalClose = function () { done(-1); };
      each(ov, '[data-i]', function (n) { n.addEventListener('click', function () { done(+n.getAttribute('data-i')); }); });
      ov.addEventListener('click', function (e) { if (e.target === ov) done(-1); });
      setTimeout(function () { try { ov.querySelector('[data-i]').focus(); } catch (e) {} }, 40);
    });
  }

  // Atualiza barras de progresso / fileira "Continuar assistindo" da tela atual
  function refreshProgressUi() {
    var top = nav[nav.length - 1];
    if (!top) return;
    if (top.fn === screenHome) renderContinue();
    else if (top.fn === screenEpisodes || top.fn === screenDetails) {
      each(appEl, '[data-pkey]', function (n) {
        var old = n.querySelector('.prog'); if (old) old.parentNode.removeChild(old);
        var html = progHtml(n.getAttribute('data-pkey'));
        if (html) n.insertAdjacentHTML('beforeend', html);
      });
      var b = qs('#dPrimary[data-vkey]');
      if (b) { var p = progressOf(b.getAttribute('data-vkey')); b.textContent = p ? 'CONTINUAR (' + fmtTime(p.t) + ')' : 'ASSISTIR'; }
    }
  }
  // Troca de canal com o player aberto (controle: cima/baixo ou CH+/CH-)
  function zap(delta) {
    if (!liveCtx || liveCtx.list.length < 2) return;
    var n = liveCtx.list.length, i = (liveCtx.idx + delta + n) % n;
    playLive(liveCtx.list[i], liveCtx.list, i);
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
      '<div class="content"><div class="cover-big">' + img('', it.poster, POSTER_PH) + '</div>' +
      '<div class="meta"><div class="tag">' + (isSeries ? 'SERIE' : 'FILME') + '</div>' +
      '<h1>' + esc(it.title) + '</h1>' +
      '<div class="sub" id="dSub">' + (it.rating ? ('Nota ' + esc(it.rating)) : '') + '</div>' +
      '<div class="plot" id="dPlot">' + esc(it.plot || '') + '</div>' +
      '<div class="actions">' +
      '<button class="btn" id="dPrimary">' + primary + '</button>' +
      '<button class="btn ghost" id="dFav">' + favLabel + '</button>' +
      '<button class="btn ghost" id="dBack">VOLTAR</button>' +
      '</div></div></div></div>');

    qs('#dBack').addEventListener('click', handleBack);
    qs('#dFav').addEventListener('click', function () {
      var f = window.Store.toggleFavorite(it);
      qs('#dFav').textContent = f ? 'REMOVER DOS FAVORITOS' : 'ADICIONAR AOS FAVORITOS';
      toast(f ? 'Adicionado aos favoritos.' : 'Removido dos favoritos.');
    });

    if (isSeries) {
      var btn = qs('#dPrimary');
      var seasons = params.seasons || null;
      var openEps = function () {
        if (!seasons) return;
        if (!seasons.length) { toast('Nenhum episodio encontrado.'); return; }
        window.Store.addHistory(it);
        go(screenEpisodes, { item: it, seasons: seasons });
      };
      btn.addEventListener('click', openEps);
      var applyInfo = function (info) {
        if (!btn.isConnected) return;
        if (info && info.info) {
          params.info = info.info;
          if (info.info.plot) qs('#dPlot').textContent = info.info.plot;
          var parts = [];
          if (info.info.genre) parts.push(info.info.genre);
          if (info.info.rating) parts.push('Nota ' + info.info.rating);
          if (info.info.releaseDate) parts.push(info.info.releaseDate);
          if (parts.length) qs('#dSub').textContent = parts.join('   |   ');
        }
        btn.textContent = 'VER EPISODIOS'; btn.disabled = false;
      };
      if (seasons) {
        applyInfo({ info: params.info });
      } else {
        btn.textContent = 'CARREGANDO...'; btn.disabled = true;
        window.API.seriesInfo(state.server, it.seriesId || it.id).then(function (info) {
          seasons = params.seasons = (info && info.seasons) || [];
          applyInfo(info);
          if (kbdMode && btn.isConnected && (document.activeElement === document.body || !document.activeElement)) focusEl(btn);
        }).catch(function () { seasons = []; applyInfo(null); });
      }
    } else {
      var vkey = 'movie:' + (it.streamId || it.id);
      var bp = qs('#dPrimary');
      bp.setAttribute('data-vkey', vkey);
      var sp = progressOf(vkey);
      if (sp) bp.textContent = 'CONTINUAR (' + fmtTime(sp.t) + ')';
      bp.addEventListener('click', function () {
        window.Store.addHistory(it);
        playVod({ key: vkey, url: it.url || window.API.vodUrl(state.server, it.streamId || it.id, it.ext), title: it.title, poster: it.poster, kind: 'movie' }, 'ask');
      });
    }
    viewReady(qs('#dPrimary:not([disabled])') || qs('#dFav'));
  }

  // ============================================================
  //  Episodios
  // ============================================================
  function screenEpisodes(params) {
    var it = params.item, seasons = params.seasons || [];
    h('<div class="view col"><div class="subhdr"><button class="back-btn" data-back>' + IC.back + '</button><h2>' + esc(it.title) + '</h2></div>' +
      '<div class="main scroll pad"><div class="seasons-tabs" id="seasonTabs"></div><div class="ep-list" id="epList"></div></div></div>');
    qs('[data-back]').addEventListener('click', handleBack);

    var tabs = qs('#seasonTabs');
    tabs.innerHTML = seasons.map(function (s, i) { return '<button class="season-tab" data-se="' + i + '">Temporada ' + esc(s.season) + '</button>'; }).join('');
    each(tabs, '[data-se]', function (n) {
      n.addEventListener('click', function () { params.seasonIdx = +n.getAttribute('data-se'); selSeason(params.seasonIdx, seasons, it); });
    });
    if (seasons.length) selSeason(seasons[params.seasonIdx] ? params.seasonIdx : 0, seasons, it);
    else qs('#epList').innerHTML = '<div class="empty-note">Nenhum episodio.</div>';
    viewReady(qs('.ep') || qs('[data-back]'));
  }

  function selSeason(idx, seasons, it) {
    qsa('.season-tab').forEach(function (n, i) { n.classList.toggle('active', i === idx); });
    var eps = (seasons[idx] && seasons[idx].episodes) || [];
    var list = qs('#epList');
    if (!eps.length) { list.innerHTML = '<div class="empty-note">Nenhum episodio nesta temporada.</div>'; return; }
    // dados para tocar um episodio (com "proximo episodio" automatico ao terminar)
    function epMeta(i) {
      var ep = eps[i];
      if (!ep) return null;
      return {
        key: 'episode:' + ep.id, url: ep.url, kind: 'episode',
        title: (it && it.title ? it.title + ' - ' : '') + 'T' + seasons[idx].season + ' E' + (ep.episodeNum || (i + 1)) + ' ' + ep.title,
        poster: ep.poster || (it && it.poster) || '',
        next: function () { return epMeta(i + 1); }
      };
    }
    list.innerHTML = eps.map(function (ep, i) {
      var key = 'episode:' + ep.id;
      return '<div class="ep" tabindex="0" data-ep="' + i + '" data-pkey="' + esc(key) + '">' + img('', ep.poster, POSTER_PH) +
        '<div class="txt"><b>' + esc(ep.episodeNum ? (ep.episodeNum + '. ') : '') + esc(ep.title) + '</b><span>' + esc((ep.plot || '').slice(0, 140)) + '</span></div>' + progHtml(key) + '</div>';
    }).join('');
    each(list, '[data-ep]', function (n) {
      n.addEventListener('click', function () { playVod(epMeta(+n.getAttribute('data-ep')), 'ask'); });
    });
  }

  // ============================================================
  //  Busca (filmes + series)
  // ============================================================
  function screenSearch(params) {
    h('<div class="view col"><div class="subhdr"><button class="back-btn" data-back>' + IC.back + '</button>' +
      '<input class="search-input" id="q" placeholder="Buscar filmes e series..." autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"/>' +
      '<button class="btn" id="btnQ">Buscar</button></div>' +
      '<div class="main scroll pad" id="main"><div class="empty-note">Digite um termo e pressione Buscar.</div></div></div>');
    qs('[data-back]').addEventListener('click', handleBack);
    qs('#btnQ').addEventListener('click', function () { doSearch(params); });
    qs('#q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSearch(params); } });
    if (params.term) { qs('#q').value = params.term; doSearch(params); }
    else { viewFresh = false; setTimeout(function () { var q = qs('#q'); if (q) q.focus(); }, 60); }
  }

  var searchCache = null;
  function doSearch(params) {
    var q = qs('#q');
    var term = (q.value || '').trim().toLowerCase();
    var main = qs('#main');
    if (term.length < 2) { main.innerHTML = '<div class="empty-note">Digite pelo menos 2 letras.</div>'; return; }
    params.term = term;
    try { q.blur(); } catch (e) {}
    main.innerHTML = '<div class="center-mid"><div class="spinner"></div></div>';
    var ready = searchCache ? Promise.resolve(searchCache) : Promise.all([
      window.API.streams(state.server, 'movie', ''),
      window.API.streams(state.server, 'series', '')
    ]).then(function (r) { searchCache = (r[0] || []).concat(r[1] || []); return searchCache; });

    ready.then(function (all) {
      if (!main.isConnected) return;
      var hideAdult = !state.adultUnlocked;
      var res = all.filter(function (it) {
        if (hideAdult && window.API.isAdult(it.title)) return false;
        return (it.title || '').toLowerCase().indexOf(term) >= 0;
      }).slice(0, 120);
      if (!res.length) { main.innerHTML = '<div class="empty-note">Nada encontrado.</div>'; viewFresh = false; return; }
      main.innerHTML = gridHtml(res);
      each(main, '[data-gi]', function (n) {
        n.addEventListener('click', function () { go(screenDetails, { item: res[+n.getAttribute('data-gi')] }); });
      });
      var first = main.querySelector('.pcard');
      if (viewFresh) viewReady(first); else if (kbdMode) focusEl(first);
    }).catch(function () { if (main.isConnected) main.innerHTML = '<div class="empty-note">Erro na busca. Verifique a conexao.</div>'; });
  }

  // ============================================================
  //  Ajustes
  // ============================================================
  function screenSettings() {
    var pin = window.Store.getAdultPin();
    h('<div class="view col"><div class="subhdr"><button class="back-btn" data-back>' + IC.back + '</button><h2>AJUSTES</h2></div>' +
      '<div class="main scroll pad"><div class="settings">' +
      '<div class="field"><label>PIN de conteudo adulto (vazio = sem bloqueio)</label><input id="pin" type="text" inputmode="numeric" autocomplete="off" value="' + esc(pin) + '" maxlength="8"/></div>' +
      '<button class="btn" id="savePin">Salvar PIN</button>' +
      '<div class="gap"></div>' +
      '<div class="field"><label>Conta</label><div class="acct">' + esc(state.server ? state.server.user : '') + ' - ' + esc(state.server ? state.server.host : '') + '</div></div>' +
      '<button class="btn ghost" id="logout">SAIR DA CONTA</button>' +
      '<div class="gap"></div>' +
      '<div class="ver">' + esc(CFG.brand) + ' v' + APP_VERSION + '</div>' +
      '</div></div></div>');
    qs('[data-back]').addEventListener('click', handleBack);
    qs('#savePin').addEventListener('click', function () {
      window.Store.setAdultPin((qs('#pin').value || '').trim()); state.adultUnlocked = false; toast('PIN salvo.');
    });
    qs('#logout').addEventListener('click', function () { logout(''); });
    viewReady(qs('#savePin'));
  }

  // ============================================================
  //  Player (toque) + teclado / controle remoto
  // ============================================================
  function wirePlayer() {
    window.Player.setHandlers({ zap: zap });
    document.getElementById('plBack').addEventListener('click', closePlayer);
    document.getElementById('plPlay').addEventListener('click', function () { window.Player.togglePlay(); window.Player.resetHideTimer(); });
    document.getElementById('plPrev').addEventListener('click', function () { window.Player.step(-1); window.Player.resetHideTimer(); });
    document.getElementById('plNext').addEventListener('click', function () { window.Player.step(1); window.Player.resetHideTimer(); });
    document.getElementById('plMute').addEventListener('click', function () { window.Player.toggleMute(); window.Player.resetHideTimer(); });
    var pl = document.getElementById('player');
    pl.addEventListener('mousemove', function () { window.Player.resetHideTimer(); });
    // toque na tela: mostra/esconde os controles. Toque duplo nas laterais: -10s / +10s
    var v = document.getElementById('videoEl'), lastTap = 0;
    v.addEventListener('click', function (e) {
      var nowT = Date.now(), dbl = nowT - lastTap < 320;
      lastTap = nowT;
      if (dbl && !window.Player.isLive()) {
        var r = v.getBoundingClientRect(), x = (e.clientX - r.left) / Math.max(1, r.width);
        if (x < 0.4) { window.Player.seek(-10); toast('- 10s'); }
        else if (x > 0.6) { window.Player.seek(10); toast('+ 10s'); }
        window.Player.resetHideTimer();
        return;
      }
      if (window.Player.barHidden()) window.Player.resetHideTimer();
      else document.getElementById('plUi').classList.add('hidden');
    });
    document.getElementById('plUi').addEventListener('touchstart', function () { window.Player.resetHideTimer(); }, { passive: true });
  }

  // ---------- Navegacao por foco (D-pad do controle / setas do teclado) ----------
  var kbdMode = false;
  function setKbd(on) {
    if (kbdMode === on) return;
    kbdMode = on;
    document.documentElement.classList.toggle('kbd', on);
  }
  function isTextInput(n) { return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA'); }
  function isTyping() { return isTextInput(document.activeElement); }
  function layerRoot() { return document.querySelector('.modal-ov') || appEl; }

  function focusables(root) {
    return Array.prototype.filter.call(root.querySelectorAll('button, input, [tabindex="0"]'), function (n) {
      if (n.disabled) return false;
      var r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }

  // Rola os containers ate o elemento focado aparecer (funciona com o palco escalado)
  function ensureVisible(el) {
    var p = el.parentElement;
    while (p && p !== document.body && p !== document.documentElement) {
      if (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1) {
        var cs = window.getComputedStyle(p);
        var oy = /auto|scroll/.test(cs.overflowY), ox = /auto|scroll/.test(cs.overflowX);
        if (oy || ox) {
          var pr = p.getBoundingClientRect(), er = el.getBoundingClientRect();
          var k = (p.offsetHeight ? pr.height / p.offsetHeight : 1) || 1;
          var m = 16 * k;
          var top = pr.top;
          var sticky = p.querySelector('.epg-box');
          if (sticky && oy) top = Math.max(top, sticky.getBoundingClientRect().bottom);
          if (oy) {
            if (er.top < top + m) p.scrollTop -= (top + m - er.top) / k;
            else if (er.bottom > pr.bottom - m) p.scrollTop += (er.bottom - pr.bottom + m) / k;
          }
          if (ox) {
            if (er.left < pr.left + m) p.scrollLeft -= (pr.left + m - er.left) / k;
            else if (er.right > pr.right - m) p.scrollLeft += (er.right - pr.right + m) / k;
          }
        }
      }
      p = p.parentElement;
    }
  }

  function focusEl(el) {
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
    if (!stage.rot) ensureVisible(el);
    else { try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} }
  }

  function moveFocus(dir) {
    var root = layerRoot();
    var list = focusables(root);
    if (!list.length) return;
    var cur = document.activeElement;
    if (!cur || cur === document.body || !root.contains(cur)) {
      focusEl(root.querySelector('.cat-item.active') || list[0]);
      return;
    }
    var a = cur.getBoundingClientRect();
    var acx = a.left + a.width / 2, acy = a.top + a.height / 2;
    var best = null, bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n === cur) continue;
      var b = n.getBoundingClientRect();
      var bcx = b.left + b.width / 2, bcy = b.top + b.height / 2;
      var gap, ortho, drift;
      if (dir === 'left' || dir === 'right') {
        gap = dir === 'right' ? b.left - a.right : a.left - b.right;
        if (dir === 'right' ? bcx <= acx : bcx >= acx) continue;
        ortho = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
        drift = Math.abs(bcy - acy);
      } else {
        gap = dir === 'down' ? b.top - a.bottom : a.top - b.bottom;
        if (dir === 'down' ? bcy <= acy : bcy >= acy) continue;
        ortho = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
        drift = Math.abs(bcx - acx);
      }
      if (gap < -8) continue;
      var score = Math.max(0, gap) + ortho * 3 + drift * 0.08;
      if (score < bestScore) { bestScore = score; best = n; }
    }
    if (best) focusEl(best);
  }

  var ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

  function playerKey(e) {
    var k = e.key;
    var errBox = document.getElementById('playerError');
    if (errBox && errBox.style.display === 'flex' && (k === 'Enter' || k === ' ')) { e.preventDefault(); document.getElementById('plRetry').click(); return; }
    if (k === 'Enter' || k === ' ' || k === 'MediaPlayPause' || k === 'MediaPlay' || k === 'MediaPause') { e.preventDefault(); window.Player.togglePlay(); }
    else if (k === 'ArrowRight' || k === 'MediaFastForward') { e.preventDefault(); window.Player.seek(10); }
    else if (k === 'ArrowLeft' || k === 'MediaRewind') { e.preventDefault(); window.Player.seek(-10); }
    else if (k === 'ArrowUp' || k === 'ChannelUp' || k === 'PageUp') { e.preventDefault(); zap(1); }
    else if (k === 'ArrowDown' || k === 'ChannelDown' || k === 'PageDown') { e.preventDefault(); zap(-1); }
    else if (k === 'MediaStop') { e.preventDefault(); closePlayer(); return; }
    else if (k && k.toLowerCase() === 'm') { window.Player.toggleMute(); }
    window.Player.resetHideTimer();
  }

  function wireKeys() {
    // toque/mouse: esconde o destaque de foco; controle/teclado: mostra
    document.addEventListener('touchstart', function () { setKbd(false); }, { passive: true, capture: true });
    document.addEventListener('mousedown', function () { setKbd(false); }, true);

    document.addEventListener('keydown', function (e) {
      var k = e.key;
      var typing = isTextInput(e.target);

      if (k === 'Escape' || k === 'GoBack' || k === 'BrowserBack' || (k === 'Backspace' && !typing)) {
        e.preventDefault(); handleBack(); return;
      }
      if (window.Player.isOpen() && !modalClose) { playerKey(e); return; }

      var dir = ARROWS[k];
      if (dir) {
        // dentro de um campo de texto, esquerda/direita movem o cursor
        if (typing && (dir === 'left' || dir === 'right') && e.target.type !== 'range') return;
        e.preventDefault();
        setKbd(true);
        moveFocus(dir);
        return;
      }
      if (k === 'Enter' && !typing) {
        var t = document.activeElement;
        if (t && t.tagName !== 'BUTTON' && t.getAttribute && t.getAttribute('tabindex') === '0') { e.preventDefault(); t.click(); }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
