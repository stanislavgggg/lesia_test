/**
 * Юніт-тести алгоритму — кейси T-01…T-09 із розділу 18.1 ТЗ.
 * Запуск: node --test tests/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeResult,
  computeOverall,
  intensityLevel,
  missingAnswers,
  IncompleteAnswersError
} from '../assets/scoring.js';

/** Хелпер: заповнює всі 10 питань нулями, потім застосовує overrides. */
const A = (overrides = {}) => ({
  q1: 0, q2: 0, q3: 0, q4: 0, q5: 0,
  q6: 0, q7: 0, q8: 0, q9: 0, q10: 0,
  ...overrides
});

test('T-01 — усі відповіді 0 → low, overall 0.8, max typeScore 0', () => {
  const r = computeResult(A());
  assert.equal(r.type, 'low');
  assert.equal(r.overallIntensity, 0.8);
  assert.equal(Math.max(...Object.values(r.scores)), 0);
});

test('T-02 — Q1=Q2=4, Q9=Q10=4 → single/perfectionism, score 8, overall 0.8', () => {
  const r = computeResult(A({ q1: 4, q2: 4, q9: 4, q10: 4 }));
  assert.equal(r.type, 'single');
  assert.equal(r.primary, 'perfectionism');
  assert.equal(r.scores.perfectionism, 8);
  assert.equal(r.overallIntensity, 0.8);
  assert.equal(r.secondary, null);
});

test('T-03 — два типи по 6 балів → mixed з обома', () => {
  const r = computeResult(A({ q1: 3, q2: 3, q5: 3, q6: 3 }));
  assert.equal(r.type, 'mixed');
  assert.deepEqual([...r.scenarios].sort(), ['hypercontrol', 'perfectionism']);
});

test('T-04 — перший 7, другий 5 → single + secondary «Також може вмикатися»', () => {
  const r = computeResult(A({ q1: 4, q2: 3, q3: 3, q4: 2 }));
  assert.equal(r.type, 'single');
  assert.equal(r.primary, 'perfectionism');
  assert.equal(r.secondary, 'impostor');
});

test('T-05 — пропущене питання → розрахунок не виконується', () => {
  const broken = A({ q1: 3 });
  delete broken.q7;
  assert.deepEqual(missingAnswers(broken), ['q7']);
  assert.throws(() => computeResult(broken), IncompleteAnswersError);
});

test('T-09 — три сценарії в межах 1 бала → mixed із трьома', () => {
  const r = computeResult(A({ q1: 3, q2: 3, q3: 3, q4: 2, q5: 3, q6: 2 }));
  assert.equal(r.type, 'mixed');
  assert.equal(r.scenarios.length, 3);
  assert.deepEqual([...r.scenarios].sort(), ['hypercontrol', 'impostor', 'perfectionism']);
});

test('Гранична логіка low використовує AND, а не OR', () => {
  // overall < 1, але max typeScore = 8 → не low
  const r = computeResult(A({ q1: 4, q2: 4, q9: 4, q10: 4 }));
  assert.notEqual(r.type, 'low');

  // max typeScore = 2, але overall рівно 1.00 → не low
  const r2 = computeResult(A({
    q1: 1, q2: 1, q3: 1, q4: 1, q5: 1, q6: 1, q7: 1, q8: 1, q9: 3, q10: 3
  }));
  assert.equal(r2.overallIntensity, 1);
  assert.equal(Math.max(...Object.values(r2.scores)), 2);
  assert.notEqual(r2.type, 'low');
});

test('Нічия не розв’язується прихованим пріоритетом сценаріїв', () => {
  const r = computeResult(A({ q1: 2, q2: 1, q7: 2, q8: 1, q9: 2, q10: 2 }));
  assert.equal(r.type, 'mixed');
  assert.deepEqual([...r.scenarios].sort(), ['perfectionism', 'self_reliance']);
});

test('Реверсивне кодування Q9/Q10 працює', () => {
  assert.equal(computeOverall(A({ q9: 4, q10: 4 })), 0);
  assert.equal(computeOverall(A({ q9: 0, q10: 0 })), 0.8);
});

test('Рівні вираженості відповідають таблиці 6.2', () => {
  assert.equal(intensityLevel(0.99), 'low');
  assert.equal(intensityLevel(1.0), 'situational');
  assert.equal(intensityLevel(1.99), 'situational');
  assert.equal(intensityLevel(2.0), 'noticeable');
  assert.equal(intensityLevel(2.99), 'noticeable');
  assert.equal(intensityLevel(3.0), 'high');
  assert.equal(intensityLevel(4.0), 'high');
});

test('Некоректні значення відповідей відхиляються', () => {
  assert.deepEqual(missingAnswers(A({ q3: 5 })), ['q3']);
  assert.deepEqual(missingAnswers(A({ q3: -1 })), ['q3']);
  assert.deepEqual(missingAnswers(A({ q3: 2.5 })), ['q3']);
});
