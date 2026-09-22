/**
 * Тести обробника POST /api/checkup/lead (_worker.js, Pages Advanced mode).
 * Запуск: node --test tests/lead-function.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLead } from '../_worker.js';

const req = (body, headers = {}) => new Request('https://x/api/checkup/lead', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body)
});

const ENV = { PRIVACY_VERSION: 'pp-2026-09-01' };

const lead = (over = {}) => ({
  sessionId: 's-' + Math.random(),
  firstName: 'Оля',
  email: 'A@B.CO',
  privacyConsent: true,
  marketingConsent: false,
  utm: { utm_source: 'ig', evil: 'x' },
  resultPayload: { type: 'single', primary: 'perfectionism', secondary: null, intensityLevel: 'high', scores: { a: 1 } },
  ...over
});

test('Валідація відхиляє неповні та некоректні запити', async () => {
  const cases = [
    [{ privacyConsent: false }, 'consent_required'],
    [{ email: 'bad@@x' }, 'email_invalid'],
    [{ email: 'a'.repeat(250) + '@b.co' }, 'email_invalid'],
    [{ firstName: '<b>x</b>' }, 'name_invalid'],
    [{ firstName: 'Я' }, 'name_invalid'],
    [{ sessionId: '' }, 'session_required']
  ];
  for (const [over, expected] of cases) {
    const res = await handleLead({ request: req(lead(over)), env: ENV });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, expected);
  }
});

test('Валідний лід приймається навіть без налаштованих інтеграцій', async () => {
  const res = await handleLead({ request: req(lead()), env: ENV });
  const data = await res.json();
  assert.equal(res.status, 201);
  assert.equal(data.ok, true);
  assert.ok(data.leadId);
  // Відповідь не несе статус CRM/email/Telegram — вони йдуть у фоні, після цієї відповіді
  assert.equal(data.emailStatus, undefined);
  assert.equal(data.crmStatus, undefined);
});

test('З ctx.waitUntil відповідь не чекає на CRM, лист і Telegram', async () => {
  let releaseBackground;
  const gate = new Promise((r) => { releaseBackground = r; });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { await gate; return { ok: true, json: async () => ({}) }; };

  let backgroundSettled = false;
  try {
    const res = await handleLead({
      request: req(lead()),
      env: {
        ...ENV,
        CRM_WEBHOOK_URL: 'https://crm.test/hook',
        RESEND_API_KEY: 'k', EMAIL_FROM: 'a@b.co',
        TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1'
      },
      ctx: { waitUntil: (promise) => { promise.then(() => { backgroundSettled = true; }); } }
    });
    assert.equal(res.status, 201);
    assert.equal(backgroundSettled, false, 'фонова робота не мала встигнути завершитись до відповіді');

    releaseBackground();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(backgroundSettled, true, 'після звільнення gate фонова робота таки завершується');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Без ctx (локальний тестовий виклик) фонова робота все одно виконується — не губиться', async () => {
  let sent = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => { sent = JSON.parse(opts.body); return { ok: true, json: async () => ({}) }; };
  try {
    const res = await handleLead({
      request: req(lead()),
      env: { ...ENV, CRM_WEBHOOK_URL: 'https://crm.test/hook' }
      // ctx відсутній навмисно
    });
    assert.equal(res.status, 201);
    assert.ok(sent, 'без ctx.waitUntil обробник сам дочекався фонової роботи');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Ідемпотентність: подвійний tap не створює другий лід', async () => {
  const body = lead({ sessionId: 'fixed-session' });
  const first = await (await handleLead({ request: req(body), env: ENV })).json();
  const second = await (await handleLead({ request: req(body), env: ENV })).json();
  assert.equal(second.duplicate, true);
  assert.equal(second.leadId, first.leadId);
});

test('У CRM не йдуть сирі відповіді, бали та сторонні поля', async () => {
  let captured = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => { captured = JSON.parse(opts.body); return { ok: true }; };
  try {
    await handleLead({
      request: req(lead()),
      env: { ...ENV, CRM_WEBHOOK_URL: 'https://crm.test/hook' }
    });
    assert.equal(captured.emailNormalized, 'A@b.co');       // домен у нижньому регістрі
    assert.equal(captured.privacyConsentVersion, 'pp-2026-09-01'); // серверне значення
    assert.equal(captured.utm.utm_source, 'ig');
    assert.equal(captured.utm.evil, undefined);
    assert.equal(captured.scenarioKey, undefined);
    assert.equal(captured.answers, undefined);
    assert.equal(captured.scores, undefined);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('STORE_SCENARIO=true дозволяє передати scenarioKey', async () => {
  let captured = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => { captured = JSON.parse(opts.body); return { ok: true }; };
  try {
    await handleLead({
      request: req(lead()),
      env: { ...ENV, CRM_WEBHOOK_URL: 'https://crm.test/hook', STORE_SCENARIO: 'true' }
    });
    assert.equal(captured.scenarioKey, 'perfectionism');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Транзакційний лист збирається для всіх типів результату', async () => {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true }; };
  const env = { ...ENV, RESEND_API_KEY: 'k', EMAIL_FROM: 'Леся <a@b.co>' };
  try {
    const payloads = [
      { type: 'single', primary: 'hypercontrol', intensityLevel: 'high' },
      { type: 'mixed', scenarios: ['perfectionism', 'self_reliance'], intensityLevel: 'noticeable' },
      { type: 'low', intensityLevel: 'low' }
    ];
    for (const resultPayload of payloads) {
      await handleLead({ request: req(lead({ resultPayload })), env });
    }
    assert.equal(sent.length, 3);
    assert.ok(sent[0].subject.includes('твій результат чекапу'));
    assert.ok(sent[0].html.includes('Гіперконтролерка'));
    assert.ok(sent[1].html.includes('Перфекціоністка і «Я сама»'));
    assert.ok(sent[2].text.includes('Зараз сценарій не керує тобою постійно'));
    // Без marketingConsent реклами і посилання на відписку в листі немає
    assert.ok(!sent[0].html.includes('unsubscribe_url'));
    assert.ok(sent[0].html.includes('не є медичною діагностикою'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('При marketingConsent=true в лист додається відписка', async () => {
  let sent = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => { sent = JSON.parse(opts.body); return { ok: true }; };
  try {
    await handleLead({
      request: req(lead({ marketingConsent: true })),
      env: { ...ENV, RESEND_API_KEY: 'k', EMAIL_FROM: 'Леся <a@b.co>' }
    });
    assert.ok(sent.html.includes('Відписатися'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Роутер віддає статику через ASSETS і відхиляє не-POST на ендпоінті', async () => {
  const { default: worker } = await import('../_worker.js');
  const env = { ...ENV, ASSETS: { fetch: async () => new Response('<html>static</html>', { status: 200 }) } };

  const asset = await worker.fetch(new Request('https://x/assets/styles.css'), env);
  assert.equal(await asset.text(), '<html>static</html>');

  const root = await worker.fetch(new Request('https://x/'), env);
  assert.equal(root.status, 200);

  const wrongMethod = await worker.fetch(new Request('https://x/api/checkup/lead'), env);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('Allow'), 'POST');

  // Ендпоінт працює і з кінцевим слешем — HTML handling auto-trailing-slash його додає
  const withSlash = await worker.fetch(
    new Request('https://x/api/checkup/lead/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lead())
    }), env);
  assert.equal(withSlash.status, 201);
});

test('SPA-маршрути (/q/N, /form, /result, /error) віддають index.html, а не 404', async () => {
  const { default: worker } = await import('../_worker.js');
  let requestedPath = null;
  const env = {
    ...ENV,
    ASSETS: {
      fetch: async (req) => {
        requestedPath = new URL(req.url).pathname;
        return new Response('<html>index</html>', { status: 200 });
      }
    }
  };

  for (const path of ['/', '/q/1', '/q/10', '/q/10/', '/form', '/result', '/error']) {
    requestedPath = null;
    const res = await worker.fetch(new Request('https://x' + path), env);
    assert.equal(res.status, 200, path + ' має віддати 200');
    assert.equal(await res.text(), '<html>index</html>', path + ' має віддати вміст index.html');
    assert.equal(requestedPath, '/index.html', path + ' має бути перенаправлений на /index.html усередині');
  }

  // Некоректний номер питання й довільний шлях — не SPA-маршрут, іде як звичайна статика
  // (у продакшені це означає честню 404, бо такого файлу немає)
  requestedPath = null;
  await worker.fetch(new Request('https://x/q/11'), env);
  assert.equal(requestedPath, '/q/11', '/q/11 не підмінюється на index.html');

  requestedPath = null;
  await worker.fetch(new Request('https://x/random/path'), env);
  assert.equal(requestedPath, '/random/path', 'невідомий шлях не підмінюється на index.html');
});

test('Telegram-сповіщення надсилається з ім’ям, email і без сирих відповідей', async () => {
  let sent = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    sent = { url: String(url), body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ ok: true }) };
  };
  try {
    await handleLead({
      request: req(lead({ firstName: 'Оля', marketingConsent: true })),
      env: { ...ENV, TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_CHAT_ID: '12345' }
    });
    assert.ok(sent, 'запит до Telegram Bot API пішов');
    assert.equal(sent.url, 'https://api.telegram.org/botbot-token/sendMessage');
    assert.equal(sent.body.chat_id, '12345');
    assert.ok(sent.body.text.includes('Оля'));
    assert.ok(sent.body.text.includes('A@b.co') || sent.body.text.includes('a@b.co'));
    // За замовчуванням (STORE_SCENARIO не встановлено) сценарій у повідомлення не потрапляє
    assert.ok(!sent.body.text.includes('Результат:'));
    assert.ok(!sent.body.text.includes('perfectionism'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Telegram: STORE_SCENARIO=true додає рядок з типом сценарію', async () => {
  let sent = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => { sent = JSON.parse(opts.body); return { ok: true, json: async () => ({}) }; };
  try {
    await handleLead({
      request: req(lead({ resultPayload: { type: 'single', primary: 'hypercontrol', intensityLevel: 'high' } })),
      env: { ...ENV, TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_CHAT_ID: '12345', STORE_SCENARIO: 'true' }
    });
    assert.ok(sent.text.includes('hypercontrol'));
    assert.ok(sent.text.includes('high'));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Telegram: без TELEGRAM_BOT_TOKEN/CHAT_ID запит не йде', async () => {
  let called = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.telegram.org')) called = true;
    return { ok: true, json: async () => ({}) };
  };
  try {
    await handleLead({ request: req(lead()), env: ENV });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Telegram: збій Bot API не ламає створення ліда', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const res = await handleLead({
      request: req(lead()),
      env: { ...ENV, TELEGRAM_BOT_TOKEN: 'bot-token', TELEGRAM_CHAT_ID: '12345' }
    });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).ok, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Honeypot: заповнене поле "website" — фейковий успіх без запису й без фонових завдань', async () => {
  let called = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  try {
    const res = await handleLead({
      request: req(lead({ website: 'https://spam.example' })),
      env: { ...ENV, CRM_WEBHOOK_URL: 'https://crm.test/hook', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' }
    });
    const data = await res.json();
    assert.equal(res.status, 201);
    assert.equal(data.ok, true);
    assert.ok(data.leadId);
    assert.equal(called, false, 'жодного зовнішнього запиту (CRM/Telegram/лист) не пішло');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Honeypot: порожнє поле "website" — звичайна обробка ліда', async () => {
  const res = await handleLead({ request: req(lead({ website: '' })), env: ENV });
  assert.equal(res.status, 201);
});

test('Rate limit: більше 8 запитів з однієї IP за вікно — 429', async () => {
  const headers = { 'cf-connecting-ip': '203.0.113.9' };
  const results = [];
  for (let i = 0; i < 10; i++) {
    const res = await handleLead({ request: req(lead(), headers), env: ENV });
    results.push(res.status);
  }
  const ok = results.filter((s) => s === 201).length;
  const limited = results.filter((s) => s === 429).length;
  assert.equal(ok, 8, 'перші 8 запитів з цієї IP проходять');
  assert.equal(limited, 2, 'наступні впираються в rate limit');
});

test('Rate limit: різні IP не впливають одна на одну', async () => {
  const a = await handleLead({ request: req(lead(), { 'cf-connecting-ip': '198.51.100.1' }), env: ENV });
  const b = await handleLead({ request: req(lead(), { 'cf-connecting-ip': '198.51.100.2' }), env: ENV });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
});
