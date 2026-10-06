// ============================================================
//  LOLLIFLIX PC - CONFIGURACAO PRINCIPAL
//  >>> PARA TROCAR DE PAINEL OU FAZER OUTRO APP, EDITE AQUI <<<
// ============================================================
window.APP_CONFIG = {
  // Nome/marca do app (aparece na tela e no login)
  brand: 'LOLLIFLIX',

  // >>> CAMINHO DO PAINEL DE CONEXAO <<<
  // Endpoint que devolve os servidores + branding (mesmo do app Roku).
  // Troque esta URL para apontar para outro painel / gerar outro app.
  configEndpoint: 'https://lolliflixsmarts.dexdown.shop/api2.php?cliente=admin',

  // Tempo limite das requisicoes (ms)
  requestTimeoutMs: 20000,

  // Quantas contas salvas manter
  maxProfiles: 5,

  // Palavras que marcam conteudo adulto (bloqueio por PIN)
  adultKeywords: ['adult', 'adulto', 'xxx', 'porn', '+18', '18+', 'erotic', 'sexy', 'sex', 'porno']
};
