/**
 * АВТОЗГЕНЕРОВАНО — не редагувати цей файл.
 * Джерело: tools/worker-template.js + assets/content.js
 * Перегенерувати:  npm run build
 *
 * _worker.js бере на себе весь трафік і сам віддає статику через env.ASSETS.fetch().
 * Деплоїться Wrangler'ом (wrangler.jsonc: main + assets.directory) — саме це дає
 * Worker зі скриптом, а не "тільки статику", тому в дашборді з'являються Variables
 * and secrets. Drag-and-drop у новому дашборді Workers такий скрипт не підхоплює.
 *
 * Змінні оточення (Dashboard → Worker → Settings → Variables and secrets,
 * або `wrangler secret put NAME`):
 *   RESEND_API_KEY     — ключ Resend для транзакційного листа (опційно)
 *   EMAIL_FROM         — "Леся Новікова <checkup@домен>"
 *   EMAIL_REPLY_TO     — адреса для відповіді (опційно)
 *   CRM_WEBHOOK_URL    — куди віддавати лід (опційно)
 *   CRM_WEBHOOK_SECRET — секрет, іде заголовком X-Webhook-Secret (опційно)
 *   TELEGRAM_BOT_TOKEN — токен бота від @BotFather (опційно)
 *   TELEGRAM_CHAT_ID   — chat_id, куди слати сповіщення про новий лід (опційно)
 *   PRIVACY_VERSION    — версія тексту згоди; перекриває значення з клієнта
 *   STORE_SCENARIO     — "true", якщо потрібно передавати тип сценарію в CRM і Telegram
 *
 * KV-біндинг (опційно, для ідемпотентності між ізолятами):  LEADS_KV
 *
 * Результат показується на сторінці одразу після відповіді на POST.
 * Лист, CRM і Telegram-сповіщення йдуть ПІСЛЯ відповіді, через ctx.waitUntil —
 * користувач не чекає на Resend/CRM/Telegram, вони працюють паралельно у фоні
 * (до 30 с вікна виконання).
 */

const LEAD_PATH = '/api/checkup/lead';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === LEAD_PATH || url.pathname === LEAD_PATH + '/') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
      }
      return handleLead({ request, env, ctx });
    }

    // Усе інше — статика проєкту. Без цього рядка жоден файл не віддасться.
    return env.ASSETS.fetch(request);
  }
};

/* ── Згенеровано build-worker.mjs з assets/content.js. Не редагувати вручну. ── */

const SCENARIOS = {
  "perfectionism": {
    "name": "Перфекціоністка",
    "title": "Твій сценарій — Перфекціоністка",
    "hook": "Ти не просто хочеш зробити добре. Тобі важливо не дати собі права на помилку — тому планка постійно рухається вгору.",
    "steps": [
      "Перед початком визнач: як виглядає «достатньо добре» саме для цього завдання.",
      "Дозволь першій версії бути чернеткою, а не доказом твоєї цінності."
    ]
  },
  "impostor": {
    "name": "Самозванка",
    "title": "Твій сценарій — Самозванка",
    "hook": "Результати в тебе є. Але всередині ніби досі триває перевірка: чи справді ти маєш право бути на своєму місці.",
    "steps": [
      "Фіксуй конкретні факти: що саме ти зробила, вирішила або створила.",
      "Порівнюй себе не з чужою вітриною, а зі своєю попередньою точкою."
    ]
  },
  "hypercontrol": {
    "name": "Гіперконтролерка",
    "title": "Твій сценарій — Гіперконтролерка",
    "hook": "Контроль допоміг тобі багато чого втримати. Але тепер навіть відпочинок може перетворюватися на ще один пункт, який потрібно виконати правильно.",
    "steps": [
      "Розділи: що справді залежить від тебе, а що — ні.",
      "Потренуйся залишати невизначеним те, що не потребує рішення сьогодні."
    ]
  },
  "self_reliance": {
    "name": "«Я сама»",
    "title": "Твій сценарій — «Я сама»",
    "hook": "Ти вмієш справлятися. Питання лише в тому, чому навіть підтримку доводиться заслужити виснаженням.",
    "steps": [
      "Прийми підтримку без негайної спроби «віддати борг».",
      "Заміни питання «чи можу я сама?» на «чи маю я робити це сама?»."
    ]
  }
};

const LOW_RESULT = {
  "title": "Зараз сценарій не керує тобою постійно",
  "hook": "Схоже, ти здатна помічати свої звичні реакції та змінювати спосіб дій залежно від ситуації. Це не означає, що перфекціонізм, сумніви чи контроль ніколи не з’являються — але вони не перехоплюють керування автоматично.",
  "steps": [
    "Поміть, у яких ситуаціях ти все ж переходиш у режим «треба».",
    "Визнач, як зберігати цю гнучкість у періоди сильного навантаження."
  ]
};

const MIXED_RESULT = {
  "title": "Тобою керує не один сценарій",
  "hookTemplate": "У твоїх відповідях однаково сильно проявилися: {{scenario_list}}. Вони можуть вмикатися по черзі або підтримувати одна одну. Наприклад, контроль допомагає перфекціоністці не допустити помилки, а «Я сама» не дозволяє попросити підтримку.",
  "steps": [
    "Поміть, у якій ситуації кожен сценарій вмикається першим.",
    "Обери одну реакцію, яку готова спробувати змінити цього тижня."
  ]
};

const INVITATION = {
  "title": "Перестати платити за цей сценарій своїм життям",
  "text": "Він уже може коштувати тобі сил, близькості, можливостей і відчуття себе. На сесії-розборі ми побачимо, де саме ти втрачаєш своє, і визначимо конкретний напрям змін.",
  "note": "Напиши слово «РОЗБІР» — я відповім особисто."
};

const CONFIG = {
  "resultCtaLabel": "ЗНАЙТИ ТОЧКУ ЗМІН",
  "resultCtaUrl": "https://ig.me/m/aaaleksa.novi",
  "privacyConsentVersion": "{{PRIVACY_VERSION}}"
};


const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s'’\-]{1,49}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const SCENARIO_KEYS = ['perfectionism', 'impostor', 'hypercontrol', 'self_reliance'];

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/** Ідемпотентність у межах ізоляту, якщо KV не підключено. */
const seen = new Map();

export async function handleLead({ request, env, ctx }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const sessionId = String(payload?.sessionId || '').slice(0, 64);
  const firstName = String(payload?.firstName || '').trim();
  const emailRaw = String(payload?.email || '').trim();
  const privacyConsent = payload?.privacyConsent === true;
  const marketingConsent = payload?.marketingConsent === true;

  if (!sessionId) return json({ ok: false, error: 'session_required' }, 400);
  if (!NAME_RE.test(firstName)) return json({ ok: false, error: 'name_invalid' }, 400);
  if (emailRaw.length > 254 || !EMAIL_RE.test(emailRaw)) return json({ ok: false, error: 'email_invalid' }, 400);
  if (!privacyConsent) return json({ ok: false, error: 'consent_required' }, 400);

  const email = normalizeEmail(emailRaw);
  const result = sanitizeResult(payload?.resultPayload);

  // --- Ідемпотентність: подвійний tap не створює двох лідів і двох листів ---
  const idemKey = 'lead:' + sessionId;
  const prior = await readIdem(env, idemKey);
  if (prior) return json({ ok: true, leadId: prior.leadId, duplicate: true });

  const now = new Date().toISOString();
  const leadId = crypto.randomUUID();

  const lead = {
    leadId,
    firstName,
    emailNormalized: email,
    source: 'checkup_character_scenario',
    privacyConsent: true,
    privacyConsentVersion: env.PRIVACY_VERSION || String(payload?.privacyConsentVersion || CONFIG.privacyConsentVersion),
    privacyConsentAt: now,
    marketingConsent,
    ...(marketingConsent ? { marketingConsentAt: now } : {}),
    utm: sanitizeUtm(payload?.utm),
    createdAt: now,
    updatedAt: now,
    // Сирі відповіді та бали в CRM не передаються. scenarioKey — лише за явним прапорцем.
    ...(env.STORE_SCENARIO === 'true' && result ? { scenarioKey: result.primary || result.type } : {})
  };

  // Записуємо ідемпотентність одразу — до фонових завдань, щоб подвійний tap
  // під час відправки листа теж коректно розпізнався як дублікат.
  await writeIdem(env, idemKey, { leadId });

  // Лист, CRM і Telegram — у фоні. Користувач бачить результат одразу після цієї
  // відповіді, не чекаючи на Resend, вебхук CRM чи Telegram Bot API.
  const background = (async () => {
    if (env.CRM_WEBHOOK_URL) await pushToCrm(env, lead);
    if (env.RESEND_API_KEY && env.EMAIL_FROM && result) {
      await sendResultEmail(env, { firstName, email, result, marketingConsent });
    }
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      await sendTelegramNotification(env, { lead, result });
    }
  })();

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(background);
  } else {
    // Локальний запуск/тести без ExecutionContext: не губимо фонову роботу.
    await background;
  }

  // Клієнту не повідомляємо, чи вже був такий email у базі.
  return json({ ok: true, leadId }, 201);
}

/* ----------------------------------------------------------- helpers --- */

function normalizeEmail(value) {
  const at = value.lastIndexOf('@');
  if (at < 0) return value;
  return value.slice(0, at) + '@' + value.slice(at + 1).toLowerCase();
}

function sanitizeUtm(utm) {
  if (!utm || typeof utm !== 'object') return {};
  const allowed = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer'];
  const out = {};
  for (const key of allowed) {
    if (typeof utm[key] === 'string' && utm[key]) out[key] = utm[key].slice(0, 300);
  }
  return out;
}

function sanitizeResult(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = ['low', 'single', 'mixed'].includes(raw.type) ? raw.type : null;
  if (!type) return null;
  const key = (v) => (SCENARIO_KEYS.includes(v) ? v : null);
  return {
    type,
    primary: key(raw.primary),
    secondary: key(raw.secondary),
    scenarios: Array.isArray(raw.scenarios) ? raw.scenarios.map(key).filter(Boolean).slice(0, 4) : null,
    intensityLevel: ['low', 'situational', 'noticeable', 'high'].includes(raw.intensityLevel) ? raw.intensityLevel : null
  };
}

async function readIdem(env, key) {
  if (env.LEADS_KV) {
    const raw = await env.LEADS_KV.get(key);
    return raw ? JSON.parse(raw) : null;
  }
  return seen.get(key) || null;
}

async function writeIdem(env, key, value) {
  if (env.LEADS_KV) {
    await env.LEADS_KV.put(key, JSON.stringify(value), { expirationTtl: 60 * 60 * 24 });
    return;
  }
  seen.set(key, value);
  if (seen.size > 500) seen.delete(seen.keys().next().value);
}

async function pushToCrm(env, lead) {
  try {
    const res = await fetch(env.CRM_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.CRM_WEBHOOK_SECRET ? { 'X-Webhook-Secret': env.CRM_WEBHOOK_SECRET } : {})
      },
      body: JSON.stringify(lead)
    });
    return res.ok ? 'sent' : 'failed_' + res.status;
  } catch {
    return 'failed';
  }
}

/* ------------------------------------------------ сповіщення в Telegram --- */

/** Одна коротка UTM-мітка, безпечна для тексту Telegram-повідомлення. */
function scenarioLabel(result) {
  if (!result) return null;
  if (result.type === 'single') return result.primary || 'single';
  if (result.type === 'mixed') return (result.scenarios || []).join(' + ') || 'mixed';
  return 'низька вираженість';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function sendTelegramNotification(env, { lead, result }) {
  try {
    const lines = [
      '🆕 <b>Новий лід — «Характер чи сценарій»</b>',
      '',
      `Ім'я: ${escapeHtml(lead.firstName)}`,
      `Email: ${escapeHtml(lead.emailNormalized)}`,
      `Розсилка: ${lead.marketingConsent ? 'так' : 'ні'}`
    ];

    const utmEntries = Object.entries(lead.utm || {});
    if (utmEntries.length) {
      lines.push(`UTM: ${escapeHtml(utmEntries.map(([k, v]) => `${k}=${v}`).join(', '))}`);
    }

    // Тип сценарію — лише за тим самим прапорцем, що й передача в CRM (розділ 13 ТЗ).
    if (env.STORE_SCENARIO === 'true') {
      const label = scenarioLabel(result);
      if (label) lines.push(`Результат: ${escapeHtml(label)} (${escapeHtml(result.intensityLevel || '—')})`);
    }

    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: lines.join('\n'),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });
    return res.ok ? 'sent' : 'failed_' + res.status;
  } catch {
    return 'failed';
  }
}

/* ------------------------------------------------- транзакційний лист --- */

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function resultCopy(result) {
  if (result.type === 'single' && result.primary) {
    const s = SCENARIOS[result.primary];
    return { title: s.title, hook: s.hook, steps: s.steps };
  }
  if (result.type === 'mixed' && result.scenarios?.length) {
    const names = result.scenarios.map((k) => SCENARIOS[k].name);
    const list = names.length > 1
      ? names.slice(0, -1).join(', ') + ' і ' + names[names.length - 1]
      : names[0];
    return {
      title: MIXED_RESULT.title,
      hook: MIXED_RESULT.hookTemplate.replace('{{scenario_list}}', list),
      steps: MIXED_RESULT.steps
    };
  }
  return { title: LOW_RESULT.title, hook: LOW_RESULT.hook, steps: LOW_RESULT.steps };
}

function buildEmailHtml({ firstName, result, marketingConsent }) {
  const copy = resultCopy(result);
  const name = esc(firstName);
  const unsubscribe = marketingConsent
    ? `<p style="margin:16px 0 0;font-size:12px;color:#8a8397">
         Ти підписалася на корисні матеріали. <a href="{{unsubscribe_url}}" style="color:#8a8397">Відписатися</a> можна будь-коли.
       </p>`
    : '';

  const steps = copy.steps
    .map((text, i) => `
      <tr><td style="padding:0 0 14px">
        <span style="display:inline-block;font-size:12px;font-weight:700;letter-spacing:.08em;color:#c3a3e0">КРОК ${i + 1}</span>
        <div style="font-size:16px;line-height:1.55;color:#d7d0e2;margin-top:4px">${esc(text)}</div>
      </td></tr>`)
    .join('');

  return `<!doctype html>
<html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#14111a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#14111a;padding:28px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#1b1723;border:1px solid #332b44;border-radius:16px;padding:28px 24px;font-family:Helvetica,Arial,sans-serif">

  <tr><td style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#a79fb6;padding:0 0 10px">
    ${name}, твій результат
  </td></tr>

  <tr><td style="font-size:26px;line-height:1.2;color:#f3eff7;font-weight:600;padding:0 0 14px">
    ${esc(copy.title)}
  </td></tr>

  <tr><td style="font-size:16px;line-height:1.6;color:#cdc5da;border-left:2px solid #c3a3e0;padding:0 0 0 14px">
    ${esc(copy.hook)}
  </td></tr>

  <tr><td style="height:26px"></td></tr>

  <tr><td style="font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:#a79fb6;padding:0 0 12px">
    З чого почати: 3 кроки
  </td></tr>

  <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${steps}
    <tr><td style="padding:0">
      <span style="display:inline-block;font-size:12px;font-weight:700;letter-spacing:.08em;color:#c3a3e0">КРОК 3</span>
      <div style="font-size:16px;line-height:1.55;color:#d7d0e2;margin-top:4px">${esc(INVITATION.text)}</div>
    </td></tr>
  </table></td></tr>

  <tr><td style="height:26px"></td></tr>

  <tr><td align="center">
    <a href="${esc(CONFIG.resultCtaUrl)}"
       style="display:inline-block;background:#f3eff7;color:#17131f;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:.08em;padding:15px 28px;border-radius:999px">
      ${esc(CONFIG.resultCtaLabel)}
    </a>
    <div style="font-size:13px;color:#a79fb6;margin-top:10px">${esc(INVITATION.note)}</div>
  </td></tr>

  <tr><td style="height:26px"></td></tr>

  <tr><td style="border-top:1px solid #332b44;padding-top:16px;font-size:12px;line-height:1.6;color:#8a8397">
    Цей чекап створений для самоспостереження та не є медичною діагностикою.
    Лист надіслано, бо ти попросила копію свого результату.
    ${unsubscribe}
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

function buildEmailText({ firstName, result }) {
  const copy = resultCopy(result);
  const steps = copy.steps.map((t, i) => `Крок ${i + 1}: ${t}`).join('\n');
  return [
    `${firstName}, твій результат — ${copy.title}`,
    '',
    copy.hook,
    '',
    'З чого почати: 3 кроки',
    steps,
    `Крок 3: ${INVITATION.text}`,
    '',
    `${CONFIG.resultCtaLabel}: ${CONFIG.resultCtaUrl}`,
    INVITATION.note,
    '',
    'Цей чекап створений для самоспостереження та не є медичною діагностикою.'
  ].join('\n');
}

async function sendResultEmail(env, { firstName, email, result, marketingConsent }) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [email],
        ...(env.EMAIL_REPLY_TO ? { reply_to: env.EMAIL_REPLY_TO } : {}),
        subject: `${firstName}, твій результат чекапу`,
        html: buildEmailHtml({ firstName, result, marketingConsent }),
        text: buildEmailText({ firstName, result }),
        headers: { 'X-Entity-Ref-ID': crypto.randomUUID() }
      })
    });
    return res.ok ? 'sent' : 'failed_' + res.status;
  } catch {
    return 'failed';
  }
}
