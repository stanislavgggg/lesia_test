/**
 * Збирає теку public/ — чисту статику для деплою через Wrangler
 * (wrangler.jsonc: assets.directory = "./public").
 *
 * На відміну від dist/ (для drag-and-drop у Pages), тут навмисно НЕМАЄ
 * _worker.js: Wrangler бере його окремо, з поля "main" у wrangler.jsonc,
 * і не варто, щоб той самий файл ще й роздавався як статичний на /_worker.js.
 *
 * Запуск: npm run build:public   (або весь цикл — npm run deploy)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');

const INCLUDE = ['index.html', '_headers', 'og.jpg', 'robots.txt', 'sitemap.xml', 'assets'];

fs.rmSync(PUBLIC, { recursive: true, force: true });
fs.mkdirSync(PUBLIC, { recursive: true });

for (const entry of INCLUDE) {
  const from = path.join(ROOT, entry);
  if (!fs.existsSync(from)) {
    console.warn(`пропущено (немає): ${entry}`);
    continue;
  }
  fs.cpSync(from, path.join(PUBLIC, entry), { recursive: true });
}

const files = [];
const walk = (dir, prefix = '') => {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, prefix + name + '/');
    else files.push(prefix + name + '  ' + (fs.statSync(full).size / 1024).toFixed(1) + ' КБ');
  }
};
walk(PUBLIC);

console.log('public/ зібрано (без _worker.js — він деплоїться окремо як "main"):\n  ' + files.join('\n  '));
