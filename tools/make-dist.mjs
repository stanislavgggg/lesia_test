/**
 * Збирає теку dist/ — рівно те, що треба перетягнути в Cloudflare Pages.
 * Тести, README, package.json і tools/ у деплой не потрапляють:
 * Pages роздає будь-який завантажений файл публічно.
 *
 * Запуск: npm run dist
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const INCLUDE = ['index.html', '_worker.js', '_headers', 'og.jpg', 'robots.txt', 'sitemap.xml', 'assets'];

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

for (const entry of INCLUDE) {
  const from = path.join(ROOT, entry);
  if (!fs.existsSync(from)) {
    console.warn(`пропущено (немає): ${entry}`);
    continue;
  }
  fs.cpSync(from, path.join(DIST, entry), { recursive: true });
}

const files = [];
const walk = (dir, prefix = '') => {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, prefix + name + '/');
    else files.push(prefix + name + '  ' + (fs.statSync(full).size / 1024).toFixed(1) + ' КБ');
  }
};
walk(DIST);

console.log('dist/ зібрано:\n  ' + files.join('\n  '));
