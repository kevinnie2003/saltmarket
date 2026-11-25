// The built-in merchant AI: answers offers, haggles, proposes deals, keeps or
// breaks promises and trades news. Personality changes the numbers, not the code.
import { HUMAN, describeBundle, flip, has, isEmpty, merchant, offerProblems, type Brains } from '../engine/game.js';
import { list, makeRumor, rumorText } from '../engine/market.js';
import { hashSeed } from '../engine/rng.js';
import { GOODS, type Bundle, type EventKind, type GameState, type Good, type Merchant, type Offer, type Promise } from '../engine/types.js';
import { STYLES, dealSize, expectedPrice, gain, short, spare, unitValue, wanted } from './value.js';
import { line } from './voice.js';

export type Verdict =
  | { kind: 'accept'; say: string; gain: number }
  | { kind: 'counter'; say: string; offer: Offer; gain: number }
  | { kind: 'reject'; say: string; reason: string };

/** A stable number for picking lines and rolls without touching the game's RNG. */
export function roll(state: GameState, ...parts: (string | number)[]): number {
  return hashSeed(`${state.seed}:${parts.join(':')}`) / 4294967296;
}

function pickN(state: GameState, ...parts: (string | number)[]): number {
  return Math.floor(roll(state, ...parts) * 1000);
}

/** Answer an offer made to `me`. Counts a haggling round and may sour the mood. */
export function respond(state: GameState, me: Merchant, offer: Offer): Verdict {
  const partner = offer.from === me.id ? offer.to : offer.from;
  const st = STYLES[me.personality];
  const tag = [me.id, partner, state.day, me.haggle[partner] ?? 0];
  const mood = me.mood[partner] ?? 0;
  if (mood <= st.sulkAt) return { kind: 'reject', say: line(me.personality, 'sulk', pickN(state, ...tag)), reason: 'sulking' };
  const mine = offer.from === me.id ? offer : flip(offer);
  if (!isEmpty(mine.later?.get) && (me.trust[partner] ?? 0.7) < 0.3) {
    const now = withoutCredit(state, me, mine);
    if (now) return verdictFor(state, me, now, tag, 'noCredit');
    return { kind: 'reject', say: line(me.personality, 'noCredit', pickN(state, ...tag)), reason: 'no credit' };
  }
  const g = gain(state, me, mine, { honorOwn: honorWeight(me) });
  const rounds = me.haggle[partner] ?? 0;
  const need = wanted(state, me, mine, rounds);
  if (g >= need) return { kind: 'accept', say: line(me.personality, 'accept', pickN(state, ...tag)), gain: g };
  me.haggle[partner] = rounds + 1;
  if (g < -0.35 * dealSize(state, mine) - 2) me.mood[partner] = Math.max(-1, mood - 0.2);
  const c = counter(state, me, mine, need);
  const insulted = g < -0.35 * dealSize(state, mine) - 2;
  if (c) {
    const say = `${insulted ? line(me.personality, 'insulted', pickN(state, ...tag)) + ' ' : ''}${line(me.personality, 'counter', pickN(state, ...tag, 'c'))}`;
    return { kind: 'counter', say, offer: c, gain: gain(state, me, c, { honorOwn: honorWeight(me) }) };
  }
  return { kind: 'reject', say: line(me.personality, insulted ? 'insulted' : 'reject', pickN(state, ...tag)), reason: 'not enough' };
}

function verdictFor(state: GameState, me: Merchant, o: Offer, tag: (string | number)[], moment: 'noCredit'): Verdict {
  const g = gain(state, me, o, { honorOwn: honorWeight(me) });
  return { kind: 'counter', say: line(me.personality, moment, pickN(state, ...tag)), offer: o, gain: g };
}

/** The same deal with the other side's promise turned into payment now, if they can pay. */
function withoutCredit(state: GameState, me: Merchant, mine: Offer): Offer | null {
  const other = merchant(state, mine.to);
  const get = addBundles(mine.get, mine.later?.get);
  if (!has(other, get)) return null;
  const o: Offer = { from: me.id, to: other.id, give: { ...mine.give }, get, later: mine.later?.give ? { give: mine.later.give, due: mine.later.due } : undefined };
  return offerProblems(state, o).length ? null : o;
}

function honorWeight(me: Merchant): number {
  return 1 - STYLES[me.personality].defaultRate * 0.6;
}

/**
 * Turn an offer `me` doesn't like into one it would take: give less, ask for
 * coin, or ask for more of what they were already giving. Null if it can't.
 */
export function counter(state: GameState, me: Merchant, mine: Offer, need: number): Offer | null {
  const other = merchant(state, mine.to);
  const o: Offer = structuredClone(mine);
  o.give = { ...o.give };
  o.get = { ...o.get };
  const ok = () => gain(state, me, o, { honorOwn: honorWeight(me) }) >= need;
  const legal = () => offerProblems(state, o).length === 0 && !(isEmpty(o.give) && isEmpty(o.get) && isEmpty(o.later?.give) && isEmpty(o.later?.get));
  // 1. Give less coin, then fewer goods, keeping at least something on my side if there was.
  if ((o.give.coin ?? 0) > 0) {
    while (!ok() && (o.give.coin ?? 0) > 0) o.give.coin = Math.max(0, (o.give.coin ?? 0) - 1);
    if (!o.give.coin) delete o.give.coin;
  }
  const mineGoods = GOODS.filter((g) => (o.give[g] ?? 0) > 0).sort((a, b) => unitValue(state, me, b, -1) - unitValue(state, me, a, -1));
  for (const g of mineGoods) {
    while (!ok() && (o.give[g] ?? 0) > 1) o.give[g] = (o.give[g] ?? 0) - 1;
  }
  // 2. Ask for coin to close the gap.
  if (!ok()) {
    const gap = need - gain(state, me, o, { honorOwn: honorWeight(me) });
    const room = other.coin - (o.get.coin ?? 0);
    const ask = Math.ceil(gap + 0.01);
    if (ask > 0 && ask <= room) o.get.coin = (o.get.coin ?? 0) + ask;
  }
  // 3. Ask for one or two more of what they were giving.
  for (const g of GOODS) {
    let tries = 2;
    while (!ok() && (o.get[g] ?? 0) > 0 && other.goods[g] > (o.get[g] ?? 0) && tries-- > 0) o.get[g] = (o.get[g] ?? 0) + 1;
  }
  if (!ok() || !legal()) return null;
  if (same(o, mine)) return null;
  return o;
}

function same(a: Offer, b: Offer): boolean {
  return JSON.stringify(a.give) === JSON.stringify(b.give) && JSON.stringify(a.get) === JSON.stringify(b.get) && JSON.stringify(a.later) === JSON.stringify(b.later);
}

export function addBundles(a: Bundle | undefined, b: Bundle | undefined): Bundle {
  const out: Bundle = { ...(a ?? {}) };
  for (const [k, v] of Object.entries(b ?? {})) out[k as keyof Bundle] = (out[k as keyof Bundle] ?? 0) + (v as number);
  return out;
}

/**
 * A deal `me` would like with `partner`: buy something it is short of, or
 * sell something it can spare. Null when nothing makes sense.
 */
export function propose(state: GameState, me: Merchant, partner: Merchant): Offer | null {
  const wants = GOODS.filter((g) => short(me, g) > 0 && partner.goods[g] > 0).sort((a, b) => short(me, b) - short(me, a));
  for (const g of wants) {
    const q = Math.min(short(me, g), partner.goods[g], 3);
    const want: Bundle = { [g]: q };
    const target = expectedPrice(state, me, g) * q * 1.05;
    for (const pay of payments(state, me, target, g)) {
      const o: Offer = { from: me.id, to: partner.id, give: pay.now, get: want };
      if (pay.later) o.later = { give: pay.later, due: Math.min(state.days, state.day + 2) };
      if (offerProblems(state, o).length) continue;
      if (gain(state, me, o) >= wanted(state, me, o, 0)) return o;
    }
  }
  // Nothing to buy: sell a spare good for coin at a markup.
  const sell = GOODS.filter((g) => spare(me, g) > 0).sort((a, b) => spare(me, b) * state.prices[b] - spare(me, a) * state.prices[a]);
  for (const g of sell) {
    const q = Math.min(spare(me, g), 2);
    const price = Math.ceil(expectedPrice(state, me, g) * me.taste[g] * q * 1.25 + 1);
    if (partner.coin < price) continue;
    const o: Offer = { from: me.id, to: partner.id, give: { [g]: q }, get: { coin: price } };
    if (!offerProblems(state, o).length && gain(state, me, o) >= wanted(state, me, o, 0)) return o;
  }
  return null;
}

/** Ways to pay about `target` in market value: coin, spare goods, or part now and the rest later. */
function payments(state: GameState, me: Merchant, target: number, buying: Good): { now: Bundle; later?: Bundle }[] {
  const out: { now: Bundle; later?: Bundle }[] = [];
  const coin = Math.ceil(target);
  if (me.coin >= coin) out.push({ now: { coin } });
  const spares = GOODS.filter((g) => g !== buying && spare(me, g) > 0).sort((a, b) => state.prices[b] - state.prices[a]);
  for (const g of spares) {
    const n = Math.ceil(target / state.prices[g]);
    if (n <= spare(me, g)) out.push({ now: { [g]: n } });
    else if (me.coin > 0) {
      const rest = Math.ceil(target - spare(me, g) * state.prices[g]);
      if (rest <= me.coin) out.push({ now: { [g]: spare(me, g), coin: rest } });
    }
  }
  // Short of coin: pay what I can now and promise the rest, a little extra for the wait.
  if (me.coin < coin && state.day + 2 <= state.days) {
    const now = Math.floor(me.coin / 2);
    const later = Math.ceil((coin - now) * 1.1);
    out.push({ now: now > 0 ? { coin: now } : {}, later: { coin: later } });
  }
  return out;
}

/** A price for selling some of a good, or null if it isn't for sale. */
export function quote(state: GameState, me: Merchant, buyer: Merchant, g: Good, q = 1): Offer | null {
  const avail = spare(me, g);
  if (avail <= 0) return null;
  const n = Math.min(q, avail);
  const base = unitValue(state, me, g, -1) * n;
  const st = STYLES[me.personality];
  const price = Math.ceil(base + st.minGain + st.share * 2 * state.prices[g] * n + 0.5);
  const o: Offer = { from: me.id, to: buyer.id, give: { [g]: n }, get: { coin: Math.min(price, Math.max(0, Math.floor(buyer.coin))) } };
  if (o.get.coin! < price) o.get.coin = price; // quote stands even if they can't afford it
  return o;
}

/** A price this merchant would pay for some of a good, or null. */
export function bid(state: GameState, me: Merchant, seller: Merchant, g: Good, q = 1): Offer | null {
  const n = Math.min(q, seller.goods[g]);
  if (n <= 0) return null;
  let value = 0;
  for (let i = 0; i < n; i++) value += unitValue(state, me, g, 1);
  const st = STYLES[me.personality];
  const price = Math.floor(value - st.minGain - st.share * state.prices[g] * n);
  if (price <= 0 || price > me.coin) return null;
  return { from: me.id, to: seller.id, give: { coin: price }, get: { [g]: n } };
}

/** What this merchant admits to needing, depending on who asks. */
export function admitNeeds(state: GameState, me: Merchant, asker: Merchant): Good[] {
  const needs = GOODS.filter((g) => short(me, g) > 0);
  if (me.personality === 'fair') return needs;
  if (me.personality === 'hard') return needs.slice(0, 1);
  // Sly mentions one real need and one decoy.
  const decoy = GOODS.find((g) => !needs.includes(g) && spare(me, g) === 0 && g !== needs[0]);
  return [...needs.slice(0, 1), ...(decoy && (me.trust[asker.id] ?? 0.7) < 0.9 ? [decoy] : [])];
}

export interface News {
  say: string;
  rumorId?: string;
  lie: boolean;
}

/** Pass on a rumour, keep quiet, or (for some) make one up. */
export function shareNews(state: GameState, me: Merchant, asker: Merchant): News {
  const st = STYLES[me.personality];
  const tag = [me.id, asker.id, state.day, 'news'];
  const future = state.rumors.filter((r) => me.heard.includes(r.id) && r.day > state.day).sort((a, b) => a.day - b.day);
  if (st.lieRate > 0 && roll(state, ...tag) < st.lieRate && state.day < state.days) {
    // Talk up a good I can sell, so the asker buys it from me.
    const g = GOODS.filter((x) => spare(me, x) > 0).sort((a, b) => spare(me, b) - spare(me, a))[0];
    if (g) {
      const day = Math.min(state.days, state.day + 1 + Math.floor(roll(state, ...tag, 'd') * 2));
      const kinds: EventKind[] = ['storm', 'guild', 'fair'];
      const kind = kinds[Math.floor(roll(state, ...tag, 'k') * kinds.length)];
      const r = makeFakeRumor(state, kind, [g], day);
      asker.heard.push(r.id);
      return { say: `${line(me.personality, 'news', pickN(state, ...tag))} ${r.text}`, rumorId: r.id, lie: true };
    }
  }
  if ((me.trust[asker.id] ?? 0.7) < st.shareTrust || (me.mood[asker.id] ?? 0) < -0.3) return { say: line(me.personality, 'secret', pickN(state, ...tag)), lie: false };
  const r = future[0];
  if (!r) return { say: line(me.personality, 'noNews', pickN(state, ...tag)), lie: false };
  if (!asker.heard.includes(r.id)) asker.heard.push(r.id);
  return { say: `${line(me.personality, 'news', pickN(state, ...tag))} ${r.text}`, rumorId: r.id, lie: false };
}

function makeFakeRumor(state: GameState, kind: EventKind, goods: Good[], day: number) {
  const id = `r${state.nextId++}`;
  const r = { id, day, kind, goods, text: rumorText(kind, goods, day), truth: false, direction: kind === 'storm' ? 1.4 : kind === 'guild' ? 1.45 : 1.3 };
  state.rumors.push(r);
  return r;
}

/** Keep a promise? Honest merchants always do. Sly ones break the ones worth breaking. */
export function honor(state: GameState, debtor: Merchant, p: Promise): boolean {
  const st = STYLES[debtor.personality];
  if (st.defaultRate <= 0) return true;
  let value = p.bundle.coin ?? 0;
  for (const g of GOODS) value += (p.bundle[g] ?? 0) * state.prices[g];
  const late = state.day >= state.days - 1 ? 1.5 : 0.6;
  const big = value > 8 ? 1 : 0.3;
  return roll(state, p.id, 'honor') >= st.defaultRate * late * big;
}

export const MIND_BRAINS: Brains = {
  honor(state, debtor, p) {
    // The human's promises are settled by the human's own choice in the UI;
    // the engine treats an absent choice as kept if they can pay.
    if (debtor.id === HUMAN) return true;
    return honor(state, debtor, p);
  },
};

export function describeNeeds(goods: Good[]): string {
  return goods.length ? list(goods) : 'nothing in particular';
}

export { describeBundle, makeRumor };
