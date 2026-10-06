# LOLLIFLIX — App Android (APK) + Painel

App Android do LOLLIFLIX, empacotado com **Capacitor 8** (target API 36), para
celular, tablet, TV Box e Android TV. Conecta em painéis Xtream Codes / XUI.

- **App ID:** `com.lolliflix.app`
- **Painel de conexão:** `www/js/config.js` (`configEndpoint`). Para fazer outro app,
  edite essa URL (`.../api2.php?cliente=USUARIO_DO_PAINEL`) antes de gerar.
- **Painel de gerenciamento (PHP):** pasta `PAINELPHP/` — vai para a **hospedagem**,
  não para o repositório do app (já está no `.gitignore`).

## O que o app faz
- **Sempre em paisagem** (manifest + código nativo + giro automático da interface se o
  sistema entregar a janela em pé).
- **Botão VOLTAR** (aparelho, gesto ou controle) volta dentro do app; só sai na tela
  inicial, com dois toques.
- **Controle remoto / D-pad** em todas as telas; CH+/CH- ou ↑/↓ trocam de canal.
- **Letras adaptáveis:** a interface é escalada pelo tamanho real da tela (maior em
  celulares) e ignora a "fonte do sistema".
- **Login por código de parceria** (quando ativado no painel) ou direto com usuário e senha.
- **Continuar assistindo** filmes e episódios de onde parou; próximo episódio automático.
- **Player com anti-travamento:** detecta vídeo parado e recupera sozinho (pula buraco do
  buffer → religa o stream → reabre no mesmo ponto), com reconexão quando a internet volta.

---

## Gerar o APK na nuvem (recomendado)

1. Crie um repositório no GitHub e envie **o conteúdo desta pasta** para a raiz
   (incluindo `.github`, `scripts`, `www`, `resources`). A pasta `PAINELPHP` não vai.
2. Aba **Actions** > **Build LOLLIFLIX APK** > **Run workflow**.
3. Baixe o APK em **Artifacts** (`LOLLIFLIX-APK`).

### AAB assinado para a Play Store
Cadastre em *Settings > Secrets and variables > Actions*:
`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`.
O workflow passa a gerar também o artefato `LOLLIFLIX-RELEASE` (`.aab` + `.apk`).
A cada envio, aumente `version` no `package.json` (vira versionName/versionCode).

## Gerar localmente
Pré-requisitos: Node.js 22+, JDK 21 e Android Studio (SDK 36).

```bash
npm install
npm run vendor
npx cap add android
npx --yes @capacitor/assets@3 generate --android
node scripts/patch-android.js
npx cap sync android
cd android && gradlew assembleDebug
```
`scripts/patch-android.js` aplica os ajustes nativos (paisagem, tela cheia, TV, versão,
assinatura). Rode sempre depois de `cap add android`.

---

## Painel (pasta `PAINELPHP`)

1. Envie a pasta para a hospedagem (PHP 7.4+ e MySQL/MariaDB).
2. Preencha os dados do banco em `includes/db_helper.php`.
3. Instalação nova: importe `Banco_de_Dados.sql`. Banco já existente: **não precisa
   importar nada** — o painel cria as colunas/tabelas novas no primeiro acesso.
4. Entre no painel. Senhas antigas continuam valendo e são convertidas para um formato
   seguro no primeiro login.

### Níveis
| Nível | Pode |
|---|---|
| **ADMIN** | Tudo: usuários, todas as DNS, dispositivos, modo de login do app |
| **MASTER** | Criar revendas e gerenciar DNS/dispositivos da própria árvore |
| **REVENDA** | Gerenciar apenas as próprias DNS, códigos e dispositivos |

Em cada usuário o ADMIN/MASTER define **limite de DNS** e **limite de dispositivos ativos**
(0 = ilimitado).

### Código de parceria
Cada DNS criada recebe um **código numérico único**. Em *Configurações > Modo de login do
app* o ADMIN escolhe:
- **Código + usuário e senha:** o cliente digita o código e o app conecta só naquela DNS.
- **Direto:** somente usuário e senha (funcionamento antigo).

### Dispositivos
A tela *Dispositivos* mostra plataforma (Android, Roku, Samsung, LG), MAC/ID, cliente,
DNS, IP, último acesso e quem está **conectado agora**; permite bloquear ou remover.
O Android não libera o MAC real para apps, então o app gera um ID fixo no formato de MAC.

### API para os outros apps (Roku / Samsung / LG)
Veja *URLs e API* no painel. Resumo:
- `GET api2.php?cliente=USUARIO` → aparência + `login_mode` + `servidores` (modo direto).
- `POST api2.php?action=partner_login` (`code`, `device_id`, `mac`, `platform`, `username`).
- `POST api2.php?action=heartbeat` a cada 2 min (`code` ou `cliente`+`host`, `device_id`…).

Apps antigos continuam funcionando no modo direto e aparecem como "sem ID".

---

## Play Store
- Target API 36, permissões mínimas (apenas Internet), sem anúncios/rastreadores.
- Login e preferências ficam só no aparelho; backup em nuvem desativado.
- Publique a política de privacidade (`PRIVACY.md`) e informe a URL no cadastro.
- **Atenção:** apps de IPTV passam por análise rígida. Publique apenas com conteúdo que
  você tenha direito de distribuir e forneça uma conta de teste ao revisor.
