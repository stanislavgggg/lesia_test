/**
 * Алгоритм підрахунку (ТЗ v1.2, розділ 6).
 * Чистий детермінований модуль без DOM — використовується і в браузері, і в юніт-тестах.
 */

export const SCENARIO_KEYS = ['perfectionism', 'impostor', 'hypercontrol', 'self_reliance'];
export const QUESTION_IDS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10'];

export class IncompleteAnswersError extends Error {
  constructor(missing) {
    super('Incomplete answers: ' + missing.join(', '));
    this.name = 'IncompleteAnswersError';
    this.missing = missing;
  }
}

/** Повертає список питань без валідної відповіді 0..4. */
export function missingAnswers(a) {
  const source = a || {};
  return QUESTION_IDS.filter((id) => {
    const v = source[id];
    return !Number.isInteger(v) || v < 0 || v > 4;
  });
}

/** typeScore для чотирьох сценаріїв, 0..8 кожен. */
export function computeScores(a) {
  return {
    perfectionism: a.q1 + a.q2,
    impostor: a.q3 + a.q4,
    hypercontrol: a.q5 + a.q6,
    self_reliance: a.q7 + a.q8
  };
}

/** Негнучкість / автопілот: (4−Q9) + (4−Q10), 0..8. Не бере участі в ранжуванні. */
export function computeFlexibilityScore(a) {
  return (4 - a.q9) + (4 - a.q10);
}

/** overallIntensity = сума всіх десяти значень (Q9/Q10 реверсовані) / 10. */
export function computeOverall(a) {
  const sum =
    a.q1 + a.q2 + a.q3 + a.q4 + a.q5 + a.q6 + a.q7 + a.q8 +
    (4 - a.q9) + (4 - a.q10);
  return sum / 10;
}

export function intensityLevel(overall) {
  if (overall < 1) return 'low';
  if (overall < 2) return 'situational';
  if (overall < 3) return 'noticeable';
  return 'high';
}

/**
 * Вибір результату (розділ 6.3).
 * Порядок перевірок:
 *  1. low — тільки за одночасного overall < 1.00 І max typeScore <= 2 (AND, розділ 18.1).
 *  2. mixed — другий результат >= 4 і різниця з першим <= 1.
 *  3. mixed по нічиї — рівні максимальні бали ніколи не розв'язуються прихованим пріоритетом.
 *  4. single — інакше; другий сценарій з >= 4 балів виводиться як «Також може вмикатися».
 */
export function computeResult(answers) {
  const missing = missingAnswers(answers);
  if (missing.length) throw new IncompleteAnswersError(missing);

  const scores = computeScores(answers);
  const overall = computeOverall(answers);
  const ranked = Object.entries(scores).sort((x, y) => y[1] - x[1]);
  const max = ranked[0][1];

  const nearTop = ranked.filter(([, score]) => max - score <= 1 && score >= 4);
  const tiedAtMax = ranked.filter(([, score]) => score === max);

  let base;
  if (overall < 1 && max <= 2) {
    base = { type: 'low' };
  } else if (nearTop.length >= 2) {
    base = { type: 'mixed', scenarios: nearTop.map((x) => x[0]) };
  } else if (tiedAtMax.length >= 2) {
    base = { type: 'mixed', scenarios: tiedAtMax.map((x) => x[0]) };
  } else {
    base = {
      type: 'single',
      primary: ranked[0][0],
      secondary: ranked[1][1] >= 4 ? ranked[1][0] : null
    };
  }

  return {
    ...base,
    scores,
    flexibilityScore: computeFlexibilityScore(answers),
    overallIntensity: Math.round(overall * 100) / 100,
    intensityLevel: intensityLevel(overall)
  };
}
