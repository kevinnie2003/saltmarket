// A merchant's answer to what the player says at their stall.
import { HUMAN, executeOffer, log, merchant, offerProblems, pitch } from '../engine/game.js';
import { langOf } from '../i18n/lang.js';
import { logWords, rumorText, talkWords } from '../i18n/words.js';
import type { GameState, Merchant, Offer } from '../engine/types.js';
import type { Intent } from '../talk/parse.js';
import { admitNeeds, bid, describeNeeds, propose, quote, respond, roll, shareNews } from './mind.js';
import { line } from './voice.js';

export interface TalkResult {
  say: string;
  /** An offer the merchant now has on the table for the player. */
  offer?: Offer;
  traded?: boolean;
  /** False when the words were refused before reaching the merchant (no talk used). */
  spent: boolean;
}

export function offerFromIntent(state: GameState, to: string, i: Extract<Intent, { kind: 'offer' }>): Offer {
  const o: Offer = { from: HUMAN, to, give: { ...i.give }, get: { ...i.get } };
  if (i.later) o.later = { ...i.later };
  return o;
}

/** Reply to the player at `to`'s stall. Uses one of the day's talks when it reaches the merchant. */
export function talk(state: GameState, to: string, intent: Intent): TalkResult {
  const w = talkWords(langOf(state));
  if (state.over) return { say: w.closed, spent: false };
  if (state.talksLeft <= 0) return { say: w.bell, spent: false };
  const m = merchant(state, to);
  if (m.id === HUMAN) return { say: w.self, spent: false };
  const r = answer(state, m, intent);
  if (r.spent) state.talksLeft--;
  if (r.offer) state.pending[m.id] = r.offer;
  else if (r.traded || intent.kind === 'reject') delete state.pending[m.id];
  if (r.traded || intent.kind === 'reject' || (r.offer && intent.kind !== 'offer')) delete state.asked?.[m.id];
  if (r.spent) log(state, 'say', logWords(langOf(state)).says(m.name, r.say), [m.id, HUMAN], true);
  return r;
}

function answer(state: GameState, m: Merchant, intent: Intent): TalkResult {
  const you = merchant(state, HUMAN);
  const lang = langOf(state);
  const w = talkWords(lang);
  const pick = (k: string) => roll(state, m.id, state.day, state.talksLeft, k) * 1000;
  const say = (moment: Parameters<typeof line>[1], k: string) => line(m.personality, moment, pick(k), lang);
  const show = (o: Offer) => pitch(state, o, lang);
  switch (intent.kind) {
    case 'offer': {
      const o = offerFromIntent(state, m.id, intent);
      const problems = offerProblems(state, o, lang);
      if (problems.length) return { say: w.wontWork(problems.join(lang === 'zh' ? '；' : '; ')), spent: false };
      const v = respond(state, m, o);
      if (v.kind === 'accept') {
        executeOffer(state, o);
        return { say: v.say, traded: true, spent: true };
      }
      if (v.kind === 'counter') {
        (state.asked ??= {})[m.id] = o;
        return { say: w.withDeal(v.say, show(v.offer)), offer: v.offer, spent: true };
      }
      return { say: v.say, spent: true };
    }
    case 'accept': {
      const o = state.pending[m.id];
      if (!o) return { say: w.acceptWhat, spent: false };
      const problems = offerProblems(state, o, lang);
      if (problems.length) {
        delete state.pending[m.id];
        return { say: w.cantGoThrough(problems.join(lang === 'zh' ? '；' : '; ')), spent: true };
      }
      executeOffer(state, o);
      return { say: say('accept', 'a'), traded: true, spent: true };
    }
    case 'reject':
      // Walking away with nothing on the table costs no talk.
      return { say: say('bye', 'b'), spent: !!state.pending[m.id] };
    case 'price': {
      const q = quote(state, m, you, intent.good, intent.qty);
      if (!q) return { say: say('notForSale', 'n'), spent: true };
      const n = q.give[intent.good] ?? 0;
      const few = n < intent.qty ? w.onlySpare(n) : '';
      return { say: few + w.withDeal(say('quote', 'q'), show(q)), offer: q, spent: true };
    }
    case 'bid': {
      if (you.goods[intent.good] <= 0) return { say: w.noneToSell(intent.good), spent: false };
      const b = bid(state, m, you, intent.good, intent.qty);
      if (!b) return { say: m.coin < 1 ? say('cantAfford', 'c') : w.dontNeed(intent.good), spent: true };
      return { say: w.withDeal(say('bid', 'q'), show(b)), offer: b, spent: true };
    }
    case 'needs': {
      const needs = admitNeeds(state, m, you);
      const o = propose(state, m, you);
      const tail = o ? w.withDeal(say('offer', 'o'), show(o)) : '';
      return { say: w.then(w.sentence(say('want', 'w'), describeNeeds(needs, lang)), tail).trim(), offer: o ?? undefined, spent: true };
    }
    case 'news': {
      const n = shareNews(state, m, you);
      if (n.rumorId) {
        const r = state.rumors.find((x) => x.id === n.rumorId)!;
        log(state, 'rumor', logWords(lang).heardFrom(m.name, rumorText(r.kind, r.goods, r.day, lang)), [m.id, HUMAN], true, r.id);
      }
      return { say: n.say, spent: true };
    }
    case 'hello': {
      const o = propose(state, m, you);
      const tail = o ? w.withDeal(say('offer', 'o'), show(o)) : '';
      return { say: w.then(say('greet', 'g'), tail).trim(), offer: o ?? undefined, spent: true };
    }
    default:
      return { say: w.didntFollow, spent: false };
  }
}
