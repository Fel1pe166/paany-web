// Monta a pasta que a Vercel publica: só as telas do painel (sem dados, sem segredos).
//   vercel-dist/painel/index.html, app.js, app.css, i18n.js, manifest.webmanifest, logo.png
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'vercel-dist');
const painel = join(out, 'painel');

rmSync(out, { recursive: true, force: true });
mkdirSync(painel, { recursive: true });

const pub = join(root, 'src', 'web', 'public');
for (const f of readdirSync(pub)) copyFileSync(join(pub, f), join(painel, f));
copyFileSync(join(root, 'assets', 'logo.png'), join(painel, 'logo.png'));
copyFileSync(join(root, 'assets', 'logo.png'), join(out, 'favicon.ico'));
writeFileSync(join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

console.log(`✔ Painel pronto em vercel-dist/ (${readdirSync(painel).length} arquivos)`);
