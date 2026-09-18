/**
 * Наскрізні перевірки користувацького шляху в jsdom.
 * Покривають кейси T-01…T-16 та вимоги FR-03…FR-17 із ТЗ v1.2.
 *
 * Передумова:  npm i -D jsdom
 * Запуск:      npm run test:e2e
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const APP = path.join(ROOT, 'assets/app.js');

let failures = 0;
const ok = (cond, msg) => {
  console.log((cond ? '\u2713 ' : '\u2717 ') + msg);
  if (!cond) failures++;
};

/** Піднімає чистий екземпляр застосунку в новому DOM. */
async function boot({ url = 'https://example.com/', seed = null, fetchImpl = null } = {}) {
  const dom = new JSDOM(HTML, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  global.history = window.history;
  if (seed) window.localStorage.setItem('checkup_character_scenario_v1_2', seed);
  window.fetch = global.fetch = fetchImpl || (async () => ({
    ok: true, json: async () => ({ ok: true, leadId: 'test' })
  }));
  if (!window.crypto?.randomUUID) {
    Object.defineProperty(window, 'crypto', { value: { randomUUID: () => 'uuid-' + Math.random() } });
  }
  await import(APP + '?v=' + Math.random());
  const $ = (id) => window.document.getElementById(id);
  return { $, window };
}

const answer = ($, window, qid, value) => {
  const input = $(`${qid}_${value}`);
  input.checked = true;
  input.dispatchEvent(new window.Event('change'));
};

const submitForm = ($, window) =>
  $('lead-form').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));

/** Проходить увесь чекап за планом відповідей і надсилає форму. */
async function runFull(plan, { name = 'Оля', email = 'a@b.co', marketing = false, fetchImpl = null } = {}) {
  const ctx = await boot({ fetchImpl });
  const { $, window } = ctx;
  $('start-btn').click();
  for (let i = 1; i <= 10; i++) {
    answer($, window, 'q' + i, plan['q' + i]);
    $('next-btn').click();
  }
  $('firstName').value = name;
  $('email').value = email;
  $('privacyConsent').checked = true;
  $('marketingConsent').checked = marketing;
  submitForm($, window);
  await new Promise((r) => setTimeout(r, 40));
  return ctx;
}

/* ============================ 1. Основний шлях ============================ */
{
  console.log('\n— Основний шлях —');
  const calls = [];
  const { $, window } = await boot({
    url: 'https://example.com/?utm_source=ig&utm_medium=social&utm_content=link_in_bio',
    fetchImpl: async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ ok: true, leadId: 'test' }) };
    }
  });

  ok($('screen-start').dataset.active === 'true', 'Відкривається вступний екран');
  ok($('railbar').hidden === true, 'На вступному екрані прогрес-рейка прихована');
  ok($('robots-meta').getAttribute('content') === 'index, follow', 'Вступний екран індексується');

  $('start-btn').click();
  ok($('screen-question').dataset.active === 'true', 'Кнопка «Почати» відкриває питання 1');
  ok($('robots-meta').getAttribute('content') === 'noindex, follow', 'Маршрут питань — noindex, follow');
  ok($('rail').children.length === 10, 'FR-02: прогрес-рейка має 10 сегментів');
  ok($('answers').querySelectorAll('.opt').length === 5, 'П’ять варіантів відповіді');
  ok($('q-text').textContent.startsWith('Я відкладаю початок справи'), 'Текст Q1 збігається з ТЗ');
  ok($('next-btn').disabled === true, 'FR-03: «Далі» заблокована без відповіді');
  ok($('back-btn').hidden === true, 'На Q1 кнопки «Назад» немає');

  $('next-btn').disabled = false;
  $('next-btn').click();
  ok($('q-error').textContent.includes('Обери відповідь'), 'Спроба продовжити без відповіді показує підказку');
  ok($('screen-question').dataset.active === 'true', 'Перехід без відповіді заблоковано');

  const plan = { q1: 4, q2: 3, q3: 3, q4: 2, q5: 1, q6: 0, q7: 1, q8: 0, q9: 1, q10: 1 };
  for (let i = 1; i <= 10; i++) {
    answer($, window, 'q' + i, plan['q' + i]);
    if (i === 3) {
      $('back-btn').click();
      ok($('q-text').textContent.startsWith('Навіть хороший результат'), 'FR-04: «Назад» повертає на Q2');
      ok($('q2_3').checked === true, 'FR-04: відповідь Q2 збережена при поверненні');
      $('next-btn').click();
    }
    if (i === 10) ok($('next-btn').textContent === 'ПРОДОВЖИТИ', 'На Q10 кнопка «ПРОДОВЖИТИ»');
    $('next-btn').click();
  }

  ok($('screen-form').dataset.active === 'true', 'Після Q10 відкривається реєстраційна форма');

  submitForm($, window);
  await new Promise((r) => setTimeout(r, 10));
  ok($('name-error').textContent.includes('Вкажи'), 'T-10: порожнє ім’я — помилка під полем');
  ok($('firstName').getAttribute('aria-invalid') === 'true', 'T-10: aria-invalid на полі імені');

  $('firstName').value = '  Оля  ';
  $('email').value = 'oly@@bad';
  submitForm($, window);
  await new Promise((r) => setTimeout(r, 10));
  ok($('email-error').textContent.includes('Перевір email'), 'T-11: невалідний email — зрозуміла помилка');
  ok($('firstName').value === '  Оля  ', 'T-11: поля не очищаються');

  $('email').value = 'Oly.Test@Example.COM';
  submitForm($, window);
  await new Promise((r) => setTimeout(r, 10));
  ok($('privacy-error').textContent.includes('Підтвердь згоду'), 'T-12: без згоди форма не надсилається');
  ok(calls.length === 0, 'T-12: запит на сервер не пішов');

  $('privacyConsent').checked = true;
  submitForm($, window);
  await new Promise((r) => setTimeout(r, 40));

  ok(calls.length === 1, 'FR-15: надіслано рівно один запит');
  ok(calls[0].email === 'Oly.Test@example.com', 'Доменна частина email у нижньому регістрі');
  ok(calls[0].marketingConsent === false, 'T-13: marketing opt-in вимкнено');
  ok(calls[0].utm.utm_source === 'ig', 'FR-10: UTM передані');
  ok(calls[0].resultPayload.scores === undefined, 'У запит не потрапляють бали');
  ok(typeof calls[0].sessionId === 'string' && calls[0].sessionId.length > 0, 'Передано sessionId для ідемпотентності');

  ok($('screen-result').dataset.active === 'true', 'FR-08: результат після успішного submit');
  ok($('result-eyebrow').textContent === 'Оля, твій результат готовий', 'FR-17: персоналізація по імені з trim');
  ok($('result-title').textContent === 'Твій сценарій — Перфекціоністка', 'Правильний провідний сценарій');
  ok($('block-secondary').hidden === false, 'T-04: показано блок «Також може вмикатися»');
  ok($('secondary-cards').textContent.includes('Самозванка'), 'T-04: додатковий сценарій — Самозванка');
  ok($('steps-list').children.length === 3, 'На результаті рівно три кроки');
  ok($('cta-btn').getAttribute('href') === 'https://ig.me/m/aaaleksa.novi', 'FR-11: CTA веде в Instagram Direct');
  ok($('cta-fallback').hidden === true, 'Резервне посилання приховане до кліку');
  ok($('disclaimer').textContent.includes('не є медичною діагностикою'), 'Дисклеймер на місці');

  const events = window.dataLayer.map((e) => e.event);
  ['checkup_view', 'checkup_start', 'question_view', 'answer_selected', 'question_back',
   'questions_complete', 'registration_view', 'registration_error', 'registration_submit',
   'checkup_complete', 'result_view'].forEach((name) => {
    ok(events.includes(name), `Аналітика: подія ${name}`);
  });
  const dump = JSON.stringify(window.dataLayer).toLowerCase();
  ok(!dump.includes('оля') && !dump.includes('example.com') && !dump.includes('perfectionism'),
    'Приватність: ім’я, email і сценарій не йдуть в аналітику');

  $('restart-btn').click();
  const saved = JSON.parse(window.localStorage.getItem('checkup_character_scenario_v1_2'));
  ok($('screen-start').dataset.active === 'true', 'T-08: «Пройти ще раз» повертає на вступний екран');
  ok(Object.keys(saved.answers).length === 0, 'T-08: відповіді очищено');
  ok(saved.result === undefined, 'T-08: результат очищено');
  ok(saved.attribution.utm_source === 'ig', 'T-08: UTM збережені до кінця вкладки');
}

/* ========================= 2. Варіанти результату ========================= */
{
  console.log('\n— Варіанти результату —');

  let { $ } = await runFull({ q1: 0, q2: 0, q3: 0, q4: 0, q5: 0, q6: 0, q7: 0, q8: 0, q9: 0, q10: 0 }, { name: 'Іра' });
  ok($('result-title').textContent === 'Зараз сценарій не керує тобою постійно', 'T-01: усі нулі — результат low');
  ok($('block-signs').hidden && $('block-purpose').hidden, 'low: блоки проявів приховані');
  ok($('result-intensity').textContent.includes('не перехоплюють'), 'low: нейтральний індикатор вираженості');
  ok($('steps-list').children.length === 3, 'low: три кроки');

  ({ $ } = await runFull({ q1: 4, q2: 4, q3: 0, q4: 0, q5: 0, q6: 0, q7: 0, q8: 0, q9: 4, q10: 4 }));
  ok($('result-title').textContent.includes('Перфекціоністка'), 'T-02: виражений одиничний сценарій не падає в low');
  ok($('result-intensity').textContent.includes('фон спокійний'), 'T-02: індикатор для крайового випадку');

  ({ $ } = await runFull({ q1: 3, q2: 3, q3: 0, q4: 0, q5: 3, q6: 3, q7: 0, q8: 0, q9: 2, q10: 2 }));
  ok($('result-title').textContent === 'Тобою керує не один сценарій', 'T-03: два типи по 6 балів — mixed');
  ok($('result-cards').children.length === 2, 'T-03: дві картки сценаріїв');
  ok($('result-hook').textContent.includes('Перфекціоністка і Гіперконтролерка'), 'T-03: список сценаріїв підставлено');

  ({ $ } = await runFull({ q1: 3, q2: 3, q3: 3, q4: 2, q5: 3, q6: 2, q7: 0, q8: 0, q9: 0, q10: 0 }));
  ok($('result-cards').children.length === 3, 'T-09: три сценарії — три короткі картки');

  ({ $ } = await runFull({ q1: 4, q2: 4, q3: 0, q4: 0, q5: 0, q6: 0, q7: 0, q8: 0, q9: 0, q10: 0 },
    { name: '<img src=x onerror=alert(1)>Оля' }));
  ok($('screen-form').dataset.active === 'true', 'T-15: ім’я з HTML відхиляється валідацією');
  ok($('name-error').textContent.length > 0, 'T-15: показана помилка поля імені');

  ({ $ } = await runFull({ q1: 4, q2: 4, q3: 0, q4: 0, q5: 0, q6: 0, q7: 0, q8: 0, q9: 0, q10: 0 },
    { name: 'Анна-Марія О’Лір' }));
  ok($('screen-result').dataset.active === 'true', 'Складене ім’я з дефісом і апострофом приймається');
  ok($('result-eyebrow').textContent.startsWith('Анна-Марія О’Лір, твій результат'), 'Ім’я виводиться як текст');

  ({ $ } = await runFull({ q1: 2, q2: 2, q3: 0, q4: 0, q5: 0, q6: 0, q7: 0, q8: 0, q9: 0, q10: 0 },
    { marketing: true }));
  ok($('screen-result').dataset.active === 'true', 'T-14: marketing opt-in не блокує результат');
}

/* =================== 3. Збереження стану та збої мережі =================== */
{
  console.log('\n— Стан і збої —');

  const seed = JSON.stringify({
    version: '1.2', sessionId: 's1', startedAt: new Date().toISOString(),
    currentQuestion: 6, answers: { q1: 1, q2: 2, q3: 3, q4: 4, q5: 0 }, attribution: { utm_source: 'ig' }
  });

  let { $ } = await boot({ seed });
  ok($('resume').hidden === false, 'FR-06: запропоновано продовжити з останнього питання');
  ok($('resume-text').textContent.includes('питанні 6'), 'FR-06: вказано правильний номер питання');
  $('resume-continue').click();
  ok($('q-text').textContent.startsWith('Коли щось іде не за планом'), 'T-06: відкрито Q6');
  $('back-btn').click();
  ok($('q5_0').checked === true, 'T-06: відповідь Q5 відновлена');

  ({ $ } = await boot({ seed: '{{{ not json' }));
  ok($('screen-start').dataset.active === 'true', 'Пошкоджене збереження: тихий старт нової сесії');
  ok($('resume').hidden === true, 'Пошкоджене збереження: блок продовження не показано');

  ({ $ } = await boot({ seed: JSON.stringify({ version: '1.0', answers: { q1: 4 }, currentQuestion: 5 }) }));
  ok($('resume').hidden === true, 'Стара версія сховища не використовується');

  const ctx = await boot({ fetchImpl: async () => { throw new Error('offline'); } });
  ctx.$('start-btn').click();
  for (let i = 1; i <= 10; i++) {
    answer(ctx.$, ctx.window, 'q' + i, 2);
    ctx.$('next-btn').click();
  }
  ctx.$('firstName').value = 'Оля';
  ctx.$('email').value = 'a@b.co';
  ctx.$('privacyConsent').checked = true;
  submitForm(ctx.$, ctx.window);
  await new Promise((r) => setTimeout(r, 40));
  ok(ctx.$('form-error').textContent.includes('Не вдалося зберегти'), 'T-16: показано помилку надсилання');
  ok(ctx.$('screen-form').dataset.active === 'true', 'T-16: користувач залишився на формі');
  ok(ctx.$('firstName').value === 'Оля' && ctx.$('email').value === 'a@b.co', 'T-16: поля збережені');
  ok(ctx.$('submit-btn').disabled === false, 'T-16: submit можна повторити');
  ok(ctx.$('submit-btn').textContent === 'ПОКАЗАТИ МІЙ РЕЗУЛЬТАТ', 'T-16: підпис кнопки відновлено');
}

console.log(failures === 0 ? '\nУсі перевірки пройдено.' : `\nПровалено перевірок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
