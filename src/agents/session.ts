// The day's rhythm around the human: morning offers, the merchants' own
// haggling at dusk, and moving to the next day.
import { HUMAN, advanceDay, createGame, executeOffer, log, merchant, offerProblems, pitch, type GameOptions } from '../engine/game.js';
import type { GameState, Merchant, Offer } from '../engine/types.js';
import { langOf } from '../i18n/lang.js';
import { logWords, talkWords } from '../i18n/words.js';
import { MIND_BRAINS, propose, respond, roll } from './mind.js';
import { line } from './voice.js';

export function newGame(opts: GameOptions = {}): GameState {
  const state = createGame(opts);
  postOffers(state);
  return state;
}

export function rivals(state: GameState): Merchant[] {
  return state.merchants.filter((m) => m.id !== HUMAN);
}

/** Some merchants come to the human's stall in the morning with a deal. */
export function postOffers(state: GameState): void {
  if (state.over || !state.merchants.some((m) => m.id === HUMAN)) return;
  const you = merchant(state, HUMAN);
  for (const m of rivals(state)) {
    if (roll(state, m.id, state.day, 'post') > 0.6) continue;
    if ((m.mood[HUMAN] ?? 0) < -0.3) continue;
    const o = propose(state, m, you);
    if (!o) continue;
    state.pending[m.id] = o;
    const lang = langOf(state);
    const said = talkWords(lang).withDeal(line(m.personality, 'offer', roll(state, m.id, state.day, 'o') * 1000, lang), pitch(state, o, lang));
    log(state, 'say', logWords(lang).says(m.name, said), [m.id, HUMAN], true);
  }
}

export interface Haggle {
  a: string;
  b: string;
  steps: { by: string; offer: Offer; verdict: string }[];
  done: boolean;
}

/** Two AI merchants try to strike one deal. */
export function negotiate(state: GameState, a: Merchant, b: Merchant, maxRounds = 4): Haggle {
  const h: Haggle = { a: a.id, b: b.id, steps: [], done: false };
  let offer = propose(state, a, b);
  let receiver = b;
  for (let i = 0; offer && i < maxRounds; i++) {
    const v = respond(state, receiver, offer);
    h.steps.push({ by: receiver.id, offer, verdict: v.kind });
    if (v.kind === 'accept') {
      if (!offerProblems(state, offer).length) {
        executeOffer(state, offer);
        h.done = true;
      }
      break;
    }
    if (v.kind === 'reject') break;
    offer = v.offer;
    receiver = receiver.id === a.id ? b : a;
  }
  return h;
}

/** At dusk every AI merchant tries a deal with another AI merchant. */
export function duskRound(state: GameState): Haggle[] {
  const ais = rivals(state);
  const out: Haggle[] = [];
  const order = [...ais].sort((x, y) => roll(state, x.id, state.day, 'ord') - roll(state, y.id, state.day, 'ord'));
  for (const a of order) {
    const others = ais.filter((m) => m.id !== a.id);
    if (!others.length) break;
    const b = others[Math.floor(roll(state, a.id, state.day, 'partner') * others.length)];
    out.push(negotiate(state, a, b));
  }
  return out;
}

/** End the human's day: dusk trading, then the next morning (or the close). */
export function endDay(state: GameState): Haggle[] {
  if (state.over) return [];
  const h = duskRound(state);
  advanceDay(state, MIND_BRAINS);
  postOffers(state);
  return h;
}

/** Play a whole game with no human, for simulations. */
export function playOut(state: GameState): GameState {
  while (!state.over) endDay(state);
  return state;
}
