// How an AI merchant values goods, coin and deals. Each merchant only uses
// what it can know: its own books, today's prices and the rumours it heard.
import { HUMAN, flip } from '../engine/game.js';
import { ASSETS, GOODS, type Bundle, type GameState, type Good, type Merchant, type Offer, type Personality } from '../engine/types.js';

export interface Style {
  /** Gain wanted from a deal: a flat amount plus a share of what changes hands. */
  minGain: number;
  share: number;
  /** How much the wanted share drops per haggling round with the same partner today. */
  concession: number;
  /** How far the share falls by the last day (0..1 of share). */
  lateDiscount: number;
  /** Chance of breaking a promise worth breaking. */
  defaultRate: number;
  /** Chance of passing on a made-up rumour instead of a real one. */
  lieRate: number;
  /** Trust needed before sharing what they heard. */
  shareTrust: number;
  /** Lowest mood at which they still deal. */
  sulkAt: number;
}

export const STYLES: Record<Personality, Style> = {
  fair: { minGain: 0.5, share: 0.05, concession: 0.25, lateDiscount: 0.5, defaultRate: 0, lieRate: 0, shareTrust: 0.4, sulkAt: -0.6 },
  hard: { minGain: 2, share: 0.15, concession: 0.12, lateDiscount: 0.7, defaultRate: 0, lieRate: 0, shareTrust: 0.85, sulkAt: -0.4 },
  sly: { minGain: 1, share: 0.08, concession: 0.2, lateDiscount: 0.5, defaultRate: 0.45, lieRate: 0.5, shareTrust: 0.3, sulkAt: -0.7 },
  human: { minGain: 0, share: 0, concession: 0, lateDiscount: 0, defaultRate: 0, lieRate: 0, shareTrust: 0, sulkAt: -1 },
};

/** What this merchant expects each good to fetch at the close. */
export function expectedPrice(state: GameState, m: Merchant, g: Good): number {
  let p = state.prices[g];
  for (const id of m.heard) {
    const r = state.rumors.find((x) => x.id === id);
    if (!r || r.day <= state.day || !r.goods.includes(g)) continue;
    // Believed by half, and part of a jump fades before the close.
    const fade = Math.pow(0.8, Math.max(0, state.days - r.day));
    p *= 1 + (r.direction - 1) * 0.5 * fade;
  }
  return p;
}

export interface Holdings {
  coin: number;
  goods: Record<Good, number>;
}

/**
 * Smooth worth of holdings to a merchant. Units that count toward the contract
 * are valued through it; the rest at expected resale.
 */
export function worth(state: GameState, m: Merchant, h: Holdings): number {
  const needs = m.contract.needs;
  let needTotal = 0;
  let haveTotal = 0;
  for (const [g, n] of Object.entries(needs)) {
    needTotal += n as number;
    haveTotal += Math.min(h.goods[g as Good], n as number);
  }
  const frac = needTotal ? haveTotal / needTotal : 0;
  // Late in the game an unfinished contract is worth less, since it pays all or nothing.
  const late = state.day / state.days;
  const curve = 1.3 + late * 1.2;
  let v = h.coin + m.contract.reward * Math.pow(frac, curve);
  for (const g of GOODS) {
    const spare = h.goods[g] - Math.min(h.goods[g], needs[g] ?? 0);
    v += Math.max(0, spare) * expectedPrice(state, m, g) * m.taste[g];
  }
  return v;
}

export function holdingsOf(m: Merchant): Holdings {
  return { coin: m.coin, goods: { ...m.goods } };
}

function apply(h: Holdings, b: Bundle | undefined, sign: number, weight = 1): void {
  if (!b) return;
  for (const a of ASSETS) {
    const n = (b[a] ?? 0) * sign * weight;
    if (!n) continue;
    if (a === 'coin') h.coin += n;
    else h.goods[a] = h.goods[a] + n;
  }
}

/**
 * How much better off `me` is after the deal, from `me`'s side. Things owed to
 * me later are discounted by how much I trust the other side to deliver.
 */
export function gain(state: GameState, me: Merchant, offer: Offer, opts: { honorOwn?: number } = {}): number {
  const o = offer.from === me.id ? offer : flip(offer);
  const other = o.to;
  const before = worth(state, me, holdingsOf(me));
  const h = holdingsOf(me);
  apply(h, o.give, -1);
  apply(h, o.get, +1);
  if (o.later) {
    const trust = me.trust[other] ?? 0.7;
    apply(h, o.later.get, +1, trust);
    apply(h, o.later.give, -1, opts.honorOwn ?? 1);
  }
  for (const g of GOODS) if (h.goods[g] < 0) return -Infinity;
  // Honest merchants keep enough back to pay what they already owe.
  if (STYLES[me.personality].defaultRate === 0) {
    const owed = owedBy(state, me.id);
    if (h.coin < (owed.coin ?? 0) - 1e-9) return -Infinity;
    for (const g of GOODS) if (h.goods[g] < (owed[g] ?? 0)) return -Infinity;
  }
  return worth(state, me, h) - before;
}

/** Everything a merchant has promised and not yet delivered. */
export function owedBy(state: GameState, id: string): Bundle {
  const out: Bundle = {};
  for (const p of state.promises) {
    if (p.status !== 'open' || p.from !== id) continue;
    for (const [k, v] of Object.entries(p.bundle)) out[k as keyof Bundle] = (out[k as keyof Bundle] ?? 0) + (v as number);
  }
  return out;
}

/** Market value of everything that changes hands, used to size the wanted gain. */
export function dealSize(state: GameState, o: Offer): number {
  let v = 0;
  for (const b of [o.give, o.get, o.later?.give, o.later?.get]) {
    if (!b) continue;
    v += b.coin ?? 0;
    for (const g of GOODS) v += (b[g] ?? 0) * state.prices[g];
  }
  return v / 2;
}

/** The gain this merchant needs before saying yes, after `rounds` of haggling. */
export function wanted(state: GameState, me: Merchant, o: Offer, rounds: number): number {
  const st = STYLES[me.personality];
  const lateness = state.days > 1 ? (state.day - 1) / (state.days - 1) : 1;
  let share = st.share * (1 - st.lateDiscount * lateness);
  share *= Math.max(0, 1 - st.concession * rounds);
  const partner = o.from === me.id ? o.to : o.from;
  const mood = me.mood[partner] ?? 0;
  // A bad mood raises the price; a good one lowers it a little.
  share *= 1 - mood * 0.5;
  const base = st.minGain * Math.max(0.3, 1 - st.concession * rounds);
  return base + share * dealSize(state, o);
}

/** Units of a good this merchant can spare without hurting its contract. */
export function spare(m: Merchant, g: Good): number {
  return Math.max(0, m.goods[g] - (m.contract.needs[g] ?? 0));
}

/** Units of a good this merchant still lacks for its contract. */
export function short(m: Merchant, g: Good): number {
  return Math.max(0, (m.contract.needs[g] ?? 0) - m.goods[g]);
}

/** What one more unit of a good is worth to me, and what giving one up costs. */
export function unitValue(state: GameState, m: Merchant, g: Good, dir: 1 | -1): number {
  const h = holdingsOf(m);
  const before = worth(state, m, h);
  h.goods[g] += dir;
  if (h.goods[g] < 0) return Infinity;
  return Math.abs(worth(state, m, h) - before);
}

export function isHuman(id: string): boolean {
  return id === HUMAN;
}
