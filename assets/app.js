/**
 * Чекап «Характер чи сценарій» — клієнтська логіка.
 * ТЗ v1.2: розділи 3, 4, 7, 9, 10, 11, 12, 13.
 */

import { CONFIG, SCALE, QUESTIONS, SCENARIOS, LOW_RESULT, MIXED_RESULT, INTENSITY, INVITATION, UI } from './content.js';
import { computeResult, missingAnswers } from './scoring.js';

/* ======================================================== DOM-хелпери === */

const $ = (id) => document.getElementById(id);
const on = (el, ev, fn) => el && el.addEventListener(ev, fn);
const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };
const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : ''));

/* ============================================== Сховище (fail-safe) ===== */
/* localStorage може бути недоступний (приватний режим, вимкнені cookies).  */

const memoryStore = new Map();
const storage = {
  get(key) {
    try { return window.localStorage.getItem(key); }
    catch { return memoryStore.get(key) ?? null; }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, value); }
    catch { memoryStore.set(key, value); }
  },
  remove(key) {
    try { window.localStorage.removeItem(key); }
    catch { memoryStore.delete(key); }
  }
};

/* ====================================================== Аналітика ======= */
/* PII, відповіді, бали та назви сценаріїв у сторонні системи не йдуть.     */

function track(event, params = {}) {
  if (!CONFIG.analyticsEnabled) return;
  const payload = { event, ...params };
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(payload);
    if (typeof window.gtag === 'function') window.gtag('event', event, params);
  } catch { /* аналітика ніколи не ламає чекап */ }
}

function durationBucket(startedAt) {
  const sec = (Date.now() - new Date(startedAt).getTime()) / 1000;
  if (sec < 60) return '0-60';
  if (sec < 120) return '60-120';
  if (sec < 300) return '120-300';
  return '300+';
}

/* ========================================================= Стан ========= */

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

function newSessionId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function readAttribution() {
  const out = {};
  try {
    const q = new URLSearchParams(window.location.search);
    UTM_KEYS.forEach((k) => {
      const v = q.get(k);
      if (v) out[k] = v.slice(0, 200);
    });
    if (document.referrer) out.referrer = document.referrer.slice(0, 300);
  } catch { /* ignore */ }
  return out;
}

function freshState() {
  return {
    version: CONFIG.version,
    sessionId: newSessionId(),
    startedAt: new Date().toISOString(),
    currentQuestion: 1,
    answers: {},
    attribution: readAttribution()
  };
}

function loadState() {
  const raw = storage.get(CONFIG.storageKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== CONFIG.version) return null;
    if (typeof parsed.sessionId !== 'string' || typeof parsed.answers !== 'object') return null;
    // Відкидаємо все, що не є валідною відповіддю 0..4
    const answers = {};
    for (const q of QUESTIONS) {
      const v = parsed.answers?.[q.id];
      if (Number.isInteger(v) && v >= 0 && v <= 4) answers[q.id] = v;
    }
    parsed.answers = answers;
    const cur = Number(parsed.currentQuestion);
    parsed.currentQuestion = Number.isInteger(cur) && cur >= 1 && cur <= 10 ? cur : 1;
    return parsed;
  } catch {
    // Пошкоджене збереження: тиха нова сесія, без технічної помилки для користувача
    storage.remove(CONFIG.storageKey);
    return null;
  }
}

function saveState() {
  try { storage.set(CONFIG.storageKey, JSON.stringify(state)); }
  catch { /* сховище повне або недоступне — чекап продовжує працювати */ }
}

let state = loadState() || freshState();
let submitting = false;
let submitted = false;

/* ======================================================== Екрани ======== */

const SCREENS = ['start', 'question', 'form', 'result', 'error'];
let currentScreen = 'start';

function showScreen(name, { push = true } = {}) {
  SCREENS.forEach((s) => {
    const el = $('screen-' + s);
    if (el) el.dataset.active = String(s === name);
  });
  currentScreen = name;

  const inQuiz = name === 'question';
  $('railbar').hidden = !inQuiz;

  // Маршрути питань і результату — noindex (розділ 16 ТЗ)
  const robots = $('robots-meta');
  if (robots) robots.setAttribute('content', name === 'start' ? 'index, follow' : 'noindex, follow');

  if (push) {
    try { history.pushState({ screen: name, q: state.currentQuestion }, '', window.location.href); }
    catch { /* ignore */ }
  }
  try { window.scrollTo(0, 0); } catch { /* ignore */ }
}

/* ===================================================== Вступний екран === */

function initStartScreen() {
  setText('intro-eyebrow', UI.introEyebrow);
  setText('start-title', UI.introTitle);
  setText('intro-text', UI.introText);
  setText('intro-note', UI.introNote);
  setText('start-btn', UI.introButton);
  setText('intro-meta', UI.introMeta);
  setText('resume-title', UI.resumeTitle);
  setText('resume-continue', UI.resumeContinue);
  setText('resume-restart', UI.resumeRestart);

  const answered = Object.keys(state.answers).length;
  const resume = $('resume');
  if (answered > 0 && answered < QUESTIONS.length) {
    setText('resume-text', fill(UI.resumeTextTemplate, { n: String(state.currentQuestion) }));
    resume.hidden = false;
  } else {
    resume.hidden = true;
  }

  track('checkup_view', {
    source: state.attribution?.utm_source,
    campaign: state.attribution?.utm_campaign,
    content: state.attribution?.utm_content
  });
}

function startCheckup(fromQuestion = 1) {
  state.currentQuestion = fromQuestion;
  if (!state.startedAt) state.startedAt = new Date().toISOString();
  saveState();
  track('checkup_start', {
    source: state.attribution?.utm_source,
    campaign: state.attribution?.utm_campaign,
    content: state.attribution?.utm_content
  });
  renderQuestion();
  showScreen('question');
}

/* ======================================================== Питання ======= */

function buildRail() {
  const rail = $('rail');
  rail.innerHTML = '';
  for (let i = 0; i < QUESTIONS.length; i++) {
    const seg = document.createElement('span');
    seg.className = 'rail__seg';
    rail.appendChild(seg);
  }
}

function updateRail() {
  const n = state.currentQuestion;
  const segs = $('rail').children;
  for (let i = 0; i < segs.length; i++) {
    const idx = i + 1;
    const answered = state.answers[QUESTIONS[i].id] !== undefined;
    segs[i].dataset.state = idx === n ? 'current' : (answered ? 'done' : 'todo');
  }
  const answeredCount = Object.keys(state.answers).length;
  const rail = $('rail');
  rail.setAttribute('aria-valuenow', String(answeredCount));
  rail.setAttribute('aria-valuetext', fill(UI.questionCounterTemplate, { n: String(n) }));
  setText('rail-count', n + '/' + QUESTIONS.length);
}

function renderQuestion() {
  const n = state.currentQuestion;
  const q = QUESTIONS[n - 1];
  const counter = fill(UI.questionCounterTemplate, { n: String(n) });

  setText('q-counter', counter);
  setText('q-legend', counter + '. ' + q.text);
  setText('q-text', q.text);
  setText('q-error', '');

  const box = $('answers');
  box.querySelectorAll('.opt').forEach((el) => el.remove());

  const saved = state.answers[q.id];

  SCALE.forEach((opt) => {
    const id = `${q.id}_${opt.value}`;
    const label = document.createElement('label');
    label.className = 'opt';
    label.setAttribute('for', id);

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = q.id;
    input.id = id;
    input.value = String(opt.value);
    if (saved === opt.value) {
      input.checked = true;
      label.classList.add('is-selected');
    }
    input.addEventListener('change', () => {
      box.querySelectorAll('.opt').forEach((el) => el.classList.remove('is-selected'));
      label.classList.add('is-selected');
      selectAnswer(q.id, opt.value);
    });
    input.addEventListener('focus', () => label.classList.add('is-focus'));
    input.addEventListener('blur', () => label.classList.remove('is-focus'));

    const dot = document.createElement('span');
    dot.className = 'opt__dot';
    dot.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'opt__label';
    text.textContent = opt.label;

    const ticks = document.createElement('span');
    ticks.className = 'opt__ticks';
    ticks.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < opt.value; i++) ticks.appendChild(document.createElement('i'));

    label.append(input, dot, text, ticks);
    box.appendChild(label);
  });

  const isLast = n === QUESTIONS.length;
  const next = $('next-btn');
  next.textContent = isLast ? UI.nextLast : UI.next;
  next.disabled = saved === undefined;

  const back = $('back-btn');
  back.textContent = UI.back;
  back.hidden = n === 1;

  updateRail();

  // Фокус переводиться на заголовок нового питання (розділ 15 ТЗ)
  $('q-text').focus({ preventScroll: true });

  track('question_view', { question_number: n });
}

function selectAnswer(questionId, value) {
  state.answers[questionId] = value;
  saveState();
  $('next-btn').disabled = false;
  setText('q-error', '');
  updateRail();
  // Без тексту та значення відповіді
  track('answer_selected', { question_number: state.currentQuestion });
}

function goNext() {
  const q = QUESTIONS[state.currentQuestion - 1];
  if (state.answers[q.id] === undefined) {
    setText('q-error', UI.answerRequired);
    const first = $('answers').querySelector('input');
    if (first) first.focus();
    return;
  }

  if (state.currentQuestion < QUESTIONS.length) {
    state.currentQuestion += 1;
    saveState();
    renderQuestion();
    showScreen('question');
    return;
  }

  // Q10 заповнене → реєстраційна форма
  track('questions_complete', { duration_bucket: durationBucket(state.startedAt) });
  openForm();
}

function goBack() {
  if (state.currentQuestion <= 1) return;
  track('question_back', { from_question: state.currentQuestion });
  state.currentQuestion -= 1;
  saveState();
  renderQuestion();
  showScreen('question');
}

/* ========================================================== Форма ======= */

function initFormTexts() {
  setText('form-eyebrow', UI.formEyebrow);
  setText('form-title', UI.formTitle);
  setText('form-text', UI.formText);
  setText('name-label', UI.nameLabel);
  setText('email-label', UI.emailLabel);
  $('firstName').placeholder = UI.namePlaceholder;
  $('email').placeholder = UI.emailPlaceholder;
  setText('submit-btn', UI.formSubmit);
  setText('form-note', UI.formNote);

  const privacy = $('privacy-text');
  privacy.textContent = '';
  privacy.append(document.createTextNode(UI.privacyConsentPre));
  const link = document.createElement('a');
  link.href = CONFIG.privacyPolicyUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = UI.privacyConsentLink;
  privacy.appendChild(link);
  privacy.append(document.createTextNode(UI.privacyConsentPost));

  setText('marketing-text', UI.marketingConsent);
}

function openForm() {
  showScreen('form');
  $('form-title').focus({ preventScroll: true });
  track('registration_view');
}

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M}\s'’\-]{1,49}$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function normalizeEmail(raw) {
  const value = String(raw).trim();
  const at = value.lastIndexOf('@');
  if (at < 0) return value;
  return value.slice(0, at) + '@' + value.slice(at + 1).toLowerCase();
}

function setFieldError(inputId, errorId, message) {
  const input = $(inputId);
  setText(errorId, message || '');
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

async function handleSubmit(event) {
  event.preventDefault();
  if (submitting || submitted) return;

  const firstName = $('firstName').value.trim();
  const emailRaw = $('email').value.trim();
  const privacy = $('privacyConsent').checked;
  const marketing = $('marketingConsent').checked;

  setText('form-error', '');
  setFieldError('firstName', 'name-error', '');
  setFieldError('email', 'email-error', '');
  setText('privacy-error', '');

  if (!NAME_RE.test(firstName)) {
    setFieldError('firstName', 'name-error', UI.errName);
    $('firstName').focus();
    track('registration_error', { error_type: 'name_invalid' });
    return;
  }
  if (emailRaw.length > 254 || !EMAIL_RE.test(emailRaw)) {
    setFieldError('email', 'email-error', UI.errEmail);
    $('email').focus();
    track('registration_error', { error_type: 'email_invalid' });
    return;
  }
  if (!privacy) {
    setText('privacy-error', UI.errPrivacy);
    $('privacyConsent').focus();
    track('registration_error', { error_type: 'privacy_consent_missing' });
    return;
  }

  // Результат рахується локально й детерміновано
  let result;
  try {
    if (missingAnswers(state.answers).length) throw new Error('incomplete');
    result = computeResult(state.answers);
  } catch {
    showResultError();
    return;
  }

  const now = new Date().toISOString();
  state.result = result;
  state.lead = {
    firstName,
    email: normalizeEmail(emailRaw),
    privacyConsent: true,
    privacyConsentVersion: CONFIG.privacyConsentVersion,
    privacyConsentAt: now,
    marketingConsent: marketing,
    ...(marketing ? { marketingConsentAt: now } : {})
  };
  state.completedAt = now;
  saveState();

  submitting = true;
  const btn = $('submit-btn');
  btn.disabled = true;
  btn.textContent = UI.formSubmitting;

  try {
    const response = await fetch(CONFIG.leadEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: state.sessionId,            // ключ ідемпотентності
        firstName,
        email: state.lead.email,
        privacyConsent: true,
        privacyConsentVersion: CONFIG.privacyConsentVersion,
        marketingConsent: marketing,
        utm: state.attribution || {},
        resultPayload: {
          type: result.type,
          primary: result.primary ?? null,
          secondary: result.secondary ?? null,
          scenarios: result.scenarios ?? null,
          intensityLevel: result.intensityLevel
        }
      })
    });

    if (!response.ok) throw new Error('http_' + response.status);
    await response.json().catch(() => ({ ok: true }));

    // Лід збережено — результат на екрані вже не чекає на лист.
    // Сервер відправляє транзакційний лист, CRM і Telegram-сповіщення у фоні
    // (ctx.waitUntil), тому на момент цієї відповіді ще невідомо, чи лист дійшов:
    // подію result_email_sent тут не шлемо, щоб не звітувати про статус, якого не знаємо.
    submitted = true;
    track('registration_submit', { marketing_opt_in: marketing });

    renderResult();
    showScreen('result');
    track('checkup_complete', { duration_bucket: durationBucket(state.startedAt) });
    track('result_view');
  } catch (err) {
    // Лишається в консолі браузера для діагностики (Network/Console у DevTools) —
    // сам текст на екрані для користувачки залишається нейтральним.
    console.error('checkup: не вдалося надіслати лід', err);
    setText('form-error', UI.errSubmit);
    $('form-error').focus?.();
    track('registration_error', { error_type: 'submit_failed' });
  } finally {
    submitting = false;
    btn.disabled = false;
    btn.textContent = UI.formSubmit;
  }
}

/* ======================================================= Результат ====== */

function scenarioListText(keys) {
  const names = keys.map((k) => SCENARIOS[k].name);
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' і ' + names[names.length - 1];
}

function makeCard(key) {
  const card = document.createElement('div');
  card.className = 'card';
  const h = document.createElement('h4');
  h.textContent = SCENARIOS[key].name;
  const p = document.createElement('p');
  p.textContent = SCENARIOS[key].hook;
  card.append(h, p);
  return card;
}

function renderSteps(personalSteps) {
  const list = $('steps-list');
  list.innerHTML = '';
  personalSteps.forEach((text) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = text;
    li.appendChild(span);
    list.appendChild(li);
  });
  // Третій крок — блок сесії-розбору нижче, він рахується як крок 3
  const li = document.createElement('li');
  const span = document.createElement('span');
  span.textContent = INVITATION.title;
  li.appendChild(span);
  list.appendChild(li);
}

function renderResult() {
  const r = state.result;
  const name = state.lead?.firstName;

  setText('result-eyebrow', name
    ? fill(UI.resultEyebrowTemplate, { firstName: name })
    : UI.resultEyebrowFallback);

  // Індикатор вираженості
  const intensityKey = (r.type !== 'low' && r.intensityLevel === 'low') ? 'focused' : r.intensityLevel;
  setText('result-intensity', INTENSITY[intensityKey]);

  const signsBlock = $('block-signs');
  const purposeBlock = $('block-purpose');
  const secondaryBlock = $('block-secondary');
  const cards = $('result-cards');

  signsBlock.hidden = true;
  purposeBlock.hidden = true;
  secondaryBlock.hidden = true;
  cards.hidden = true;
  cards.innerHTML = '';

  setText('signs-title', UI.signsTitle);
  setText('purpose-title', UI.purposeTitle);
  setText('secondary-title', UI.secondaryTitle);
  setText('steps-title', UI.stepsTitle);

  if (r.type === 'single') {
    const s = SCENARIOS[r.primary];
    setText('result-title', s.title);
    setText('result-hook', s.hook);

    const ul = $('signs-list');
    ul.innerHTML = '';
    s.signs.forEach((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      ul.appendChild(li);
    });
    signsBlock.hidden = false;

    setText('purpose-text', s.purpose);
    purposeBlock.hidden = false;

    if (r.secondary) {
      const box = $('secondary-cards');
      box.innerHTML = '';
      box.appendChild(makeCard(r.secondary));
      secondaryBlock.hidden = false;
    }

    renderSteps(s.steps);

  } else if (r.type === 'mixed') {
    setText('result-title', MIXED_RESULT.title);
    setText('result-hook', fill(MIXED_RESULT.hookTemplate, {
      scenario_list: scenarioListText(r.scenarios)
    }));
    r.scenarios.forEach((key) => cards.appendChild(makeCard(key)));
    cards.hidden = false;
    renderSteps(MIXED_RESULT.steps);

  } else {
    setText('result-title', LOW_RESULT.title);
    setText('result-hook', LOW_RESULT.hook);
    renderSteps(LOW_RESULT.steps);
  }

  // Запрошення на сесію-розбір (третій крок)
  setText('invite-eyebrow', name
    ? fill(INVITATION.eyebrowTemplate, { firstName: name })
    : INVITATION.eyebrowFallback);
  setText('invite-title', INVITATION.title);
  setText('invite-text', INVITATION.text);
  setText('invite-note', INVITATION.note);

  const cta = $('cta-btn');
  cta.textContent = CONFIG.resultCtaLabel;
  cta.href = safeCtaUrl(CONFIG.resultCtaUrl);

  const fallback = $('cta-fallback');
  fallback.href = safeCtaUrl(CONFIG.resultCtaFallbackUrl);
  fallback.textContent = UI.ctaFallback;
  fallback.hidden = true;

  setText('restart-btn', UI.restart);
  setText('disclaimer', UI.disclaimer);
}

/** Дозволені лише https та домени з білого списку (розділ 13 ТЗ). */
function safeCtaUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return CONFIG.resultCtaFallbackUrl;
    if (!CONFIG.allowedCtaHosts.includes(url.hostname)) return CONFIG.resultCtaFallbackUrl;
    return url.toString();
  } catch {
    return CONFIG.resultCtaFallbackUrl;
  }
}

function showResultError() {
  setText('error-title', UI.errResult);
  setText('error-text', '');
  setText('retry-btn', UI.errResultButton);
  showScreen('error');
  $('error-title').focus({ preventScroll: true });
}

function restart() {
  track('checkup_restart');
  const attribution = state.attribution; // UTM зберігаємо до кінця вкладки
  state = freshState();
  state.attribution = attribution;
  submitted = false;
  saveState();

  $('lead-form').reset();
  setFieldError('firstName', 'name-error', '');
  setFieldError('email', 'email-error', '');
  setText('privacy-error', '');
  setText('form-error', '');
  $('resume').hidden = true;

  showScreen('start');
  $('start-btn').focus({ preventScroll: true });
}

/* ========================================================= Запуск ======= */

function init() {
  buildRail();
  initStartScreen();
  initFormTexts();

  on($('start-btn'), 'click', () => startCheckup(1));
  on($('resume-continue'), 'click', () => startCheckup(state.currentQuestion));
  on($('resume-restart'), 'click', restart);
  on($('next-btn'), 'click', goNext);
  on($('back-btn'), 'click', goBack);
  on($('lead-form'), 'submit', handleSubmit);
  on($('restart-btn'), 'click', restart);
  on($('retry-btn'), 'click', () => {
    if (state.result || missingAnswers(state.answers).length === 0) {
      try {
        state.result = state.result || computeResult(state.answers);
        renderResult();
        showScreen('result');
        return;
      } catch { /* падаємо у форму нижче */ }
    }
    showScreen('form');
  });

  // CTA: після кліку показуємо резервне посилання на профіль
  on($('cta-btn'), 'click', () => {
    track('result_cta_click', { cta_id: 'direct_primary' });
    window.setTimeout(() => { $('cta-fallback').hidden = false; }, 1200);
  });
  on($('cta-fallback'), 'click', () => {
    track('result_cta_click', { cta_id: 'direct_fallback' });
  });

  // Системна кнопка «Назад» не викидає користувача з тесту
  window.addEventListener('popstate', () => {
    if (currentScreen === 'question' && state.currentQuestion > 1) {
      goBack();
    } else if (currentScreen === 'form') {
      renderQuestion();
      showScreen('question', { push: false });
    } else if (currentScreen === 'question') {
      showScreen('start', { push: false });
    }
  });

  try { history.replaceState({ screen: 'start' }, '', window.location.href); } catch { /* ignore */ }
  showScreen('start', { push: false });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
