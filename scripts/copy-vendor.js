// Copia o hls.js do node_modules para dentro do app (www/js/vendor).
// Assim o player nao depende de CDN externa (exigencia de boas praticas da Play Store
// e o app abre mesmo se a CDN estiver fora do ar).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'node_modules', 'hls.js', 'dist', 'hls.min.js');
const destDir = path.join(root, 'www', 'js', 'vendor');
const dest = path.join(destDir, 'hls.min.js');

if (!fs.existsSync(src)) {
  console.error('[vendor] hls.js nao encontrado. Rode "npm install" antes.');
  process.exit(1);
}
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('[vendor] hls.min.js copiado para www/js/vendor (' + fs.statSync(dest).size + ' bytes)');
