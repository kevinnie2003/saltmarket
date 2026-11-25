// A merchant's answer to what the player says at their stall.
import { HUMAN, executeOffer, log, merchant, offerProblems, pitch } from '../engine/game.js';
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
  if (state.over) return { say: 'The market has closed.', spent: false };
  if (state.talksLeft <= 0) return { say: 'The bell has rung. Trading talk is done for today; end the day to carry on.', spent: false };
  const m = merchant(state, to);
  if (m.id === HUMAN) return { say: 'Talking to yourself won’t move any goods.', spent: false };
  const r = answer(state, m, intent);
  if (r.spent) state.talksLeft--;
  if (r.offer) state.pending[m.id] = r.offer;
  else if (r.traded || intent.kind === 'reject') delete state.pending[m.id];
  if (r.traded || intent.kind === 'reject' || (r.offer && intent.kind !== 'offer')) delete state.asked?.[m.id];
  if (r.spent) log(state, 'say', `${m.name}: ${r.say}`, [m.id, HUMAN], true);
  return r;
}

function answer(state: GameState, m: Merchant, intent: Intent): TalkResult {
  const you = merchant(state, HUMAN);
  const pick = (k: string) => roll(state, m.id, state.day, state.talksLeft, k) * 1000;
  const show = (o: Offer) => pitch(state, o);
  switch (intent.kind) {
    case 'offer': {
      const o = offerFromIntent(state, m.id, intent);
      const problems = offerProblems(state, o);
      if (problems.length) return { say: `That won’t work: ${problems.join('; ')}.`, spent: false };
      const v = respond(state, m, o);
      if (v.kind === 'accept') {
        executeOffer(state, o);
        return { say: v.say, traded: true, spent: true };
      }
      if (v.kind === 'counter') {
        (state.asked ??= {})[m.id] = o;
        return { say: `${v.say} ${show(v.offer)}.`, offer: v.offer, spent: true };
      }
      return { say: v.say, spent: true };
    }
    case 'accept': {
      const o = state.pending[m.id];
      if (!o) return { say: 'Accept what? I haven’t offered you anything yet.', spent: false };
      const problems = offerProblems(state, o);
      if (problems.length) {
        delete state.pending[m.id];
        return { say: `That deal can’t go through any more: ${problems.join('; ')}.`, spent: true };
      }
      executeOffer(state, o);
      return { say: line(m.personality, 'accept', pick('a')), traded: true, spent: true };
    }
    case 'reject':
      // Walking away with nothing on the table costs no talk.
      return { say: line(m.personality, 'bye', pick('b')), spent: !!state.pending[m.id] };
    case 'price': {
      const q = quote(state, m, you, intent.good, intent.qty);
      if (!q) return { say: line(m.personality, 'notForSale', pick('n')), spent: true };
      const n = q.give[intent.good] ?? 0;
      const few = n < intent.qty ? `I can only spare ${n}. ` : '';
      return { say: `${few}${line(m.personality, 'quote', pick('q'))} ${show(q)}.`, offer: q, spent: true };
    }
    case 'bid': {
      if (you.goods[intent.good] <= 0) return { say: `You don’t have any ${intent.good} to sell.`, spent: false };
      const b = bid(state, m, you, intent.good, intent.qty);
      if (!b) return { say: m.coin < 1 ? line(m.personality, 'cantAfford', pick('c')) : `I don’t need ${intent.good}.`, spent: true };
      return { say: `${line(m.personality, 'bid', pick('q'))} ${show(b)}.`, offer: b, spent: true };
    }
    case 'needs': {
      const needs = admitNeeds(state, m, you);
      const o = propose(state, m, you);
      const tail = o ? ` ${line(m.personality, 'offer', pick('o'))} ${show(o)}.` : '';
      return { say: `${line(m.personality, 'want', pick('w'))} ${describeNeeds(needs)}.${tail}`, offer: o ?? undefined, spent: true };
    }
    case 'news': {
      const n = shareNews(state, m, you);
      if (n.rumorId) log(state, 'rumor', `${m.name} says: ${state.rumors.find((r) => r.id === n.rumorId)!.text}`, [m.id, HUMAN], true);
      return { say: n.say, spent: true };
    }
    case 'hello': {
      const o = propose(state, m, you);
      const tail = o ? ` ${line(m.personality, 'offer', pick('o'))} ${show(o)}.` : '';
      return { say: `${line(m.personality, 'greet', pick('g'))}${tail}`, offer: o ?? undefined, spent: true };
    }
    default:
      return {
        say: 'I didn’t follow that. Try "3 salt for 2 amber", "how much for your spice?", "what do you need?" or "any news?".',
        spent: false,
      };
  }
}
