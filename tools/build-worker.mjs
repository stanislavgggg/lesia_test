/**
 * Генерує самодостатній _worker.js із шаблона + текстів із assets/content.js.
 *
 * Навіщо: Pages Advanced mode вимагає ОДИН файл без імпортів, тому тексти
 * для листа доводиться вбудовувати. Щоб не тримати їх у двох місцях,
 * вони автоматично витягуються з content.js — єдиного джерела істини.
 *
 * Запуск: npm run build   (обов'язково після будь-якої правки текстів)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, LOW_RESULT, MIXED_RESULT, INVITATION, CONFIG } from '../assets/content.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Для листа потрібні лише title / hook / steps — решта полів не вбудовується. */
const scenarios = Object.fromEntries(
  Object.entries(SCENARIOS).map(([key, s]) => [key, { name: s.name, title: s.title, hook: s.hook, steps: s.steps }])
);

const copy = `/* ── Згенеровано build-worker.mjs з assets/content.js. Не редагувати вручну. ── */

const SCENARIOS = ${JSON.stringify(scenarios, null, 2)};

const LOW_RESULT = ${JSON.stringify({ title: LOW_RESULT.title, hook: LOW_RESULT.hook, steps: LOW_RESULT.steps }, null, 2)};

const MIXED_RESULT = ${JSON.stringify({ title: MIXED_RESULT.title, hookTemplate: MIXED_RESULT.hookTemplate, steps: MIXED_RESULT.steps }, null, 2)};

const INVITATION = ${JSON.stringify({ title: INVITATION.title, text: INVITATION.text, note: INVITATION.note }, null, 2)};

const CONFIG = ${JSON.stringify({
  resultCtaLabel: CONFIG.resultCtaLabel,
  resultCtaUrl: CONFIG.resultCtaUrl,
  privacyConsentVersion: CONFIG.privacyConsentVersion
}, null, 2)};
`;

const template = fs.readFileSync(path.join(ROOT, 'tools/worker-template.js'), 'utf8');
if (!template.includes('/* __COPY__ */')) {
  throw new Error('У шаблоні немає плейсхолдера /* __COPY__ */');
}

const out = template.replace('/* __COPY__ */', copy);
fs.writeFileSync(path.join(ROOT, '_worker.js'), out);

console.log(`_worker.js зібрано — ${(out.length / 1024).toFixed(1)} КБ`);
