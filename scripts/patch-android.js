// ============================================================
//  LOLLIFLIX - Ajustes nativos do projeto Android (Capacitor)
//  Rode DEPOIS de "npx cap add android" (e do capacitor-assets).
//  Pode rodar quantas vezes quiser: e idempotente.
//
//  O que faz:
//   - Trava o app em PAISAGEM (manifest + MainActivity)
//   - Modo imersivo (esconde barras do sistema) e tela ligada durante o video
//   - Tamanho de fonte fixo (ignora a "fonte do sistema" que quebrava o layout)
//   - Suporte a TV Box / Android TV (controle remoto, launcher leanback, banner)
//   - Requisitos Play Store: sem backup de credenciais, versao, assinatura release
// ============================================================
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const appId = cfg.appId;
const androidDir = path.join(root, 'android');
const mainDir = path.join(androidDir, 'app', 'src', 'main');

if (!fs.existsSync(mainDir)) {
  console.error('[patch] Pasta android/ nao existe. Rode "npx cap add android" antes.');
  process.exit(1);
}

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }
function must(cond, msg) { if (!cond) { console.error('[patch] ERRO: ' + msg); process.exit(1); } }

// Define (ou substitui) um atributo logo apos a ancora informada
function setAttr(xml, anchor, name, value) {
  const re = new RegExp('\\s+' + name.replace(/[.:]/g, '\\$&') + '="[^"]*"', 'g');
  const start = xml.indexOf(anchor);
  must(start >= 0, 'ancora nao encontrada no manifest: ' + anchor);
  const end = xml.indexOf('>', start);
  let tag = xml.slice(start, end).replace(re, '');
  // re-localiza a ancora dentro da tag (o replace pode ter mexido antes dela)
  const a = tag.indexOf(anchor) + anchor.length;
  tag = tag.slice(0, a) + '\n            ' + name + '="' + value + '"' + tag.slice(a);
  return xml.slice(0, start) + tag + xml.slice(end);
}

// ---------- 1) AndroidManifest.xml ----------
const manifestPath = path.join(mainDir, 'AndroidManifest.xml');
let mf = read(manifestPath);

mf = setAttr(mf, '<application', 'android:allowBackup', 'false');
mf = setAttr(mf, '<application', 'android:usesCleartextTraffic', 'true');
mf = setAttr(mf, '<application', 'android:hardwareAccelerated', 'true');
mf = setAttr(mf, '<application', 'android:banner', '@drawable/tv_banner');
mf = setAttr(mf, 'android:name=".MainActivity"', 'android:screenOrientation', 'sensorLandscape');

if (mf.indexOf('LEANBACK_LAUNCHER') < 0) {
  mf = mf.replace(
    '<category android:name="android.intent.category.LAUNCHER" />',
    '<category android:name="android.intent.category.LAUNCHER" />\n' +
    '                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />'
  );
}
must(mf.indexOf('LEANBACK_LAUNCHER') >= 0, 'nao foi possivel adicionar LEANBACK_LAUNCHER');

// Android 16+ (API 36) ignora a trava de orientacao em telas grandes (tablets/dobraveis).
// Esta propriedade mantem a trava em paisagem enquanto o sistema permitir.
if (mf.indexOf('PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY') < 0) {
  mf = mf.replace(
    /(<activity[\s\S]*?android:name="\.MainActivity"[\s\S]*?>)/,
    '$1\n\n            <property\n' +
    '                android:name="android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY"\n' +
    '                android:value="true" />'
  );
}

if (mf.indexOf('android.software.leanback') < 0) {
  mf = mf.replace(
    '</manifest>',
    '\n    <!-- Funciona em celular, tablet, TV Box e Android TV (touch e controle) -->\n' +
    '    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />\n' +
    '    <uses-feature android:name="android.software.leanback" android:required="false" />\n' +
    '</manifest>'
  );
}
write(manifestPath, mf);
console.log('[patch] AndroidManifest.xml ok');

// ---------- 2) MainActivity.java ----------
const activityPath = path.join(mainDir, 'java', ...appId.split('.'), 'MainActivity.java');
must(fs.existsSync(activityPath), 'MainActivity.java nao encontrada em ' + activityPath);
write(activityPath, `package ${appId};

import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

// Gerado por scripts/patch-android.js - nao edite aqui, edite o script.
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        lockLandscape();
        super.onCreate(savedInstanceState);

        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null) {
            // Layout proprio (palco escalado): ignora a "fonte do sistema" para nao quebrar/encolher textos
            webView.getSettings().setTextZoom(100);
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            webView.setVerticalScrollBarEnabled(false);
            webView.setHorizontalScrollBarEnabled(false);
            webView.addJavascriptInterface(new NativeUi(), "LolliNative");
        }
        enterImmersive();
    }

    @Override
    public void onResume() {
        super.onResume();
        lockLandscape();
        enterImmersive();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enterImmersive();
        }
    }

    // App sempre de lado (aceita os dois lados da paisagem, nunca retrato)
    private void lockLandscape() {
        try {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        } catch (Exception ignored) {}
    }

    // Tela cheia: esconde barra de status e de navegacao (voltam com um deslize)
    private void enterImmersive() {
        try {
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            controller.hide(WindowInsetsCompat.Type.systemBars());
        } catch (Exception ignored) {}
    }

    private class NativeUi {

        // Mantem a tela ligada apenas enquanto um video esta tocando
        @JavascriptInterface
        public void keepAwake(final boolean on) {
            runOnUiThread(() -> {
                if (on) {
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }
    }
}
`);
console.log('[patch] MainActivity.java ok');

// ---------- 3) Banner para Android TV ----------
write(path.join(mainDir, 'res', 'drawable', 'tv_banner.xml'), `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item>
        <shape android:shape="rectangle">
            <size android:width="320dp" android:height="180dp" />
            <solid android:color="#0B0B12" />
        </shape>
    </item>
    <item
        android:width="132dp"
        android:height="132dp"
        android:gravity="center"
        android:drawable="@mipmap/ic_launcher" />
</layer-list>
`);
console.log('[patch] tv_banner.xml ok');

// ---------- 4) Tema: fundo preto (sem "flash" branco ao abrir) ----------
const stylesPath = path.join(mainDir, 'res', 'values', 'styles.xml');
let st = read(stylesPath);
if (st.indexOf('android:windowBackground') < 0) {
  st = st.replace(
    '<item name="android:background">@null</item>',
    '<item name="android:background">@null</item>\n        <item name="android:windowBackground">@android:color/black</item>'
  );
  write(stylesPath, st);
}
console.log('[patch] styles.xml ok');

// ---------- 5) app/build.gradle: versao + assinatura release ----------
const gradlePath = path.join(androidDir, 'app', 'build.gradle');
let gr = read(gradlePath);
const v = String(pkg.version || '1.0.0').split('.').map(function (n) { return parseInt(n, 10) || 0; });
const versionCode = parseInt(process.env.VERSION_CODE, 10) || (v[0] * 10000 + v[1] * 100 + v[2]);
gr = gr.replace(/versionCode \d+/, 'versionCode ' + versionCode);
gr = gr.replace(/versionName "[^"]*"/, 'versionName "' + pkg.version + '"');

if (gr.indexOf('signingConfigs') < 0) {
  must(gr.indexOf('    buildTypes {') >= 0, 'bloco buildTypes nao encontrado no build.gradle');
  gr = gr.replace('    buildTypes {',
    '    signingConfigs {\n' +
    '        release {\n' +
    '            // Assinatura para a Play Store (definida por variaveis de ambiente / secrets)\n' +
    '            def ksFile = System.getenv("LOLLI_KEYSTORE_FILE")\n' +
    '            if (ksFile) {\n' +
    '                storeFile file(ksFile)\n' +
    '                storePassword System.getenv("LOLLI_KEYSTORE_PASSWORD")\n' +
    '                keyAlias System.getenv("LOLLI_KEY_ALIAS")\n' +
    '                keyPassword System.getenv("LOLLI_KEY_PASSWORD")\n' +
    '            }\n' +
    '        }\n' +
    '    }\n' +
    '    buildTypes {');
  gr = gr.replace(/(buildTypes \{\s*release \{)/,
    '$1\n            if (System.getenv("LOLLI_KEYSTORE_FILE")) {\n' +
    '                signingConfig signingConfigs.release\n' +
    '            }');
}
write(gradlePath, gr);
console.log('[patch] app/build.gradle ok (versionCode ' + versionCode + ', versionName ' + pkg.version + ')');
console.log('[patch] concluido.');
