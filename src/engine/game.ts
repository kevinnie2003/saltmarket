// Game state and the rules that move it: trades, promises, days and the close.
import { BASE_PRICE, RIVALS, makeMerchant, makeRumor, makeSchedule, round2 } from './market.js';
import { Rng, hashSeed } from './rng.js';
import { ASSETS, GOODS, type Asset, type Bundle, type GameState, type Good, type LogEntry, type Merchant, type Offer, type Promise } from './types.js';

export const HUMAN = 'you';

export interface GameOptions {
  seed?: number | string;
  days?: number;
  rivals?: number;
  talkPerDay?: number;
  playerName?: string;
  /** All seats played by AI (for simulations). */
  noHuman?: boolean;
}

/** Decisions the engine needs from whoever plays a merchant. */
export interface Brains {
  /** Keep a promise that is due? Only asked when the debtor can pay. */
  honor(state: GameState, debtor: Merchant, promise: Promise): boolean;
}

export const ALWAYS_HONOR: Brains = { honor: () => true };

export function createGame(opts: GameOptions = {}): GameState {
  const seed = typeof opts.seed === 'string' ? hashSeed(opts.seed) : (opts.seed ?? Date.now()) >>> 0;
  const rng = new Rng(seed);
  const days = clamp(opts.days ?? 8, 3, 20);
  const rivals = clamp(opts.rivals ?? 3, 1, RIVALS.length);
  const merchants: Merchant[] = [];
  if (!opts.noHuman) {
    const you = makeMerchant(rng, HUMAN, {
      name: opts.playerName ?? 'You',
      personality: 'human',
      blurb: 'A newcomer with a cart, a little coin and one good order.',
      stock: rng.shuffle([...GOODS]).slice(0, 2),
    });
    merchants.push(you);
  }
  const picks = opts.noHuman ? RIVALS.slice(0, Math.max(2, rivals)) : rng.shuffle(RIVALS).slice(0, rivals);
  picks.forEach((t, i) => merchants.push(makeMerchant(rng, `m${i + 1}`, t)));
  for (const m of merchants) {
    for (const o of merchants) {
      if (o.id === m.id) continue;
      m.trust[o.id] = 0.7;
      m.mood[o.id] = 0;
    }
  }
  const prices = { ...BASE_PRICE };
  for (const m of merchants) {
    let v = m.coin;
    for (const g of GOODS) v += m.goods[g] * prices[g] * m.taste[g];
    m.opening = Math.round(v);
  }
  const state: GameState = {
    version: 1,
    seed,
    rng: rng.state,
    day: 1,
    days,
    prices,
    openingPrices: { ...prices },
    merchants,
    promises: [],
    events: makeSchedule(rng, days),
    rumors: [],
    log: [],
    talkPerDay: clamp(opts.talkPerDay ?? 6, 1, 20),
    talksLeft: 0,
    pending: {},
    trades: [],
    over: false,
    nextId: 1,
  };
  state.rng = rng.state;
  openDay(state, ALWAYS_HONOR);
  return state;
}

// ---------- helpers ----------

export function merchant(state: GameState, id: string): Merchant {
  const m = state.merchants.find((x) => x.id === id);
  if (!m) throw new Error(`no merchant ${id}`);
  return m;
}

export function amount(m: Merchant, a: Asset): number {
  return a === 'coin' ? m.coin : m.goods[a];
}

export function has(m: Merchant, b: Bundle | undefined): boolean {
  if (!b) return true;
  return ASSETS.every((a) => (b[a] ?? 0) <= amount(m, a) + 1e-9);
}

function shift(m: Merchant, a: Asset, n: number): void {
  if (a === 'coin') m.coin = round2(m.coin + n);
  else m.goods[a] += n;
}

export function transfer(from: Merchant, to: Merchant, b: Bundle | undefined): void {
  if (!b) return;
  for (const a of ASSETS) {
    const n = b[a] ?? 0;
    if (!n) continue;
    shift(from, a, -n);
    shift(to, a, n);
  }
}

export function isEmpty(b: Bundle | undefined): boolean {
  return !b || ASSETS.every((a) => !(b[a] ?? 0));
}

export function clean(b: Bundle | undefined): Bundle {
  const out: Bundle = {};
  if (!b) return out;
  for (const a of ASSETS) {
    const n = b[a] ?? 0;
    if (n) out[a] = a === 'coin' ? round2(n) : Math.round(n);
  }
  return out;
}

/** Market value of a bundle at today's prices. */
export function marketValue(state: GameState, b: Bundle | undefined): number {
  if (!b) return 0;
  let v = b.coin ?? 0;
  for (const g of GOODS) v += (b[g] ?? 0) * state.prices[g];
  return v;
}

export function describeBundle(b: Bundle | undefined): string {
  if (!b || isEmpty(b)) return 'nothing';
  const parts: string[] = [];
  for (const g of GOODS) if (b[g]) parts.push(`${b[g]} ${g}`);
  if (b.coin) parts.push(`${fmtCoin(b.coin)} coin`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
}

export function fmtCoin(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function describeOffer(state: GameState, o: Offer, viewer = o.from): string {
  const who = (id: string) => (id === viewer ? 'I' : id === HUMAN ? 'you' : merchant(state, id).name);
  const parts: string[] = [];
  if (!isEmpty(o.give) || !isEmpty(o.get)) {
    if (isEmpty(o.get)) parts.push(`${who(o.from)} give${s(o.from, viewer)} ${describeBundle(o.give)}`);
    else if (isEmpty(o.give)) parts.push(`${who(o.to)} give${s(o.to, viewer)} ${describeBundle(o.get)}`);
    else if (viewer !== o.from && viewer !== o.to) parts.push(`${who(o.from)} give${s(o.from, viewer)} ${describeBundle(o.give)} and ${who(o.to)} give${s(o.to, viewer)} ${describeBundle(o.get)}`);
    else parts.push(`${describeBundle(viewer === o.from ? o.give : o.get)} for ${describeBundle(viewer === o.from ? o.get : o.give)}`);
  }
  if (o.later) {
    if (!isEmpty(o.later.give)) parts.push(`${who(o.from)} deliver${s(o.from, viewer)} ${describeBundle(o.later.give)} on day ${o.later.due}`);
    if (!isEmpty(o.later.get)) parts.push(`${who(o.to)} deliver${s(o.to, viewer)} ${describeBundle(o.later.get)} on day ${o.later.due}`);
  }
  return parts.join(', then ') || 'nothing';
}

/** How a merchant puts a deal to the person they're talking to. */
export function pitch(state: GameState, o: Offer): string {
  const parts: string[] = [];
  const give = !isEmpty(o.give);
  const get = !isEmpty(o.get);
  if (give && get) parts.push(`I give ${describeBundle(o.give)} for your ${describeBundle(o.get)}`);
  else if (give) parts.push(`I give you ${describeBundle(o.give)}`);
  else if (get) parts.push(`you give me ${describeBundle(o.get)}`);
  if (o.later) {
    if (!isEmpty(o.later.give)) parts.push(`I deliver ${describeBundle(o.later.give)} on day ${o.later.due}`);
    if (!isEmpty(o.later.get)) parts.push(`you deliver ${describeBundle(o.later.get)} on day ${o.later.due}`);
  }
  return parts.join(', and ') || 'nothing';
}

function s(id: string, viewer: string): string {
  return id === viewer || id === HUMAN ? '' : 's';
}

/** The same deal seen from the other side. */
export function flip(o: Offer): Offer {
  return {
    from: o.to,
    to: o.from,
    give: { ...o.get },
    get: { ...o.give },
    later: o.later ? { give: o.later.get ? { ...o.later.get } : undefined, get: o.later.give ? { ...o.later.give } : undefined, due: o.later.due } : undefined,
  };
}

// ---------- trades ----------

export function offerProblems(state: GameState, o: Offer): string[] {
  const out: string[] = [];
  if (state.over) return ['the market has closed'];
  const a = state.merchants.find((m) => m.id === o.from);
  const b = state.merchants.find((m) => m.id === o.to);
  if (!a || !b) return ['unknown merchant'];
  if (a.id === b.id) return ['a merchant cannot trade with themselves'];
  for (const part of [o.give, o.get, o.later?.give, o.later?.get]) {
    if (!part) continue;
    for (const [k, v] of Object.entries(part)) {
      if (!(ASSETS as readonly string[]).includes(k)) out.push(`unknown good "${k}"`);
      else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) out.push(`bad amount for ${k}`);
      else if (k !== 'coin' && !Number.isInteger(v)) out.push(`${k} comes in whole units`);
    }
  }
  if (out.length) return out;
  if (isEmpty(o.give) && isEmpty(o.get) && isEmpty(o.later?.give) && isEmpty(o.later?.get)) out.push('the deal is empty');
  const lacks = (m: Merchant, x: Bundle) => (m.id === HUMAN ? `you don't have ${describeBundle(x)}` : `${m.name} doesn't have ${describeBundle(x)}`);
  if (!has(a, o.give)) out.push(lacks(a, o.give));
  if (!has(b, o.get)) out.push(lacks(b, o.get));
  if (o.later) {
    if (!Number.isInteger(o.later.due) || o.later.due <= state.day) out.push('a later delivery must be due on a later day');
    else if (o.later.due > state.days) out.push(`the market closes after day ${state.days}`);
  }
  return out;
}

/** Carry out a deal. Throws if it isn't valid. */
export function executeOffer(state: GameState, o: Offer): void {
  const problems = offerProblems(state, o);
  if (problems.length) throw new Error(problems.join('; '));
  const a = merchant(state, o.from);
  const b = merchant(state, o.to);
  transfer(a, b, o.give);
  transfer(b, a, o.get);
  if (o.later) {
    if (!isEmpty(o.later.give)) addPromise(state, a.id, b.id, clean(o.later.give), o.later.due);
    if (!isEmpty(o.later.get)) addPromise(state, b.id, a.id, clean(o.later.get), o.later.due);
  }
  state.trades.push({ day: state.day, offer: structuredClone(o) });
  delete state.pending[a.id];
  delete state.pending[b.id];
  log(state, 'trade', `${a.name} and ${b.name} trade: ${describeOffer(state, o, '')}.`, [a.id, b.id]);
}

function addPromise(state: GameState, from: string, to: string, bundle: Bundle, due: number): void {
  state.promises.push({ id: `p${state.nextId++}`, from, to, bundle, due, status: 'open' });
}

// ---------- days ----------

export function log(state: GameState, kind: LogEntry['kind'], text: string, who?: string[], priv?: boolean): void {
  state.log.push({ day: state.day, kind, text, who, private: priv || undefined });
}

/** Apply today's event, settle promises due today, and spread rumours about tomorrow. */
export function openDay(state: GameState, brains: Brains): void {
  const rng = new Rng(state.rng);
  log(state, 'day', `Day ${state.day} of ${state.days}.`);
  if (state.day > 1) {
    for (const g of GOODS) {
      let p = state.prices[g];
      p += (BASE_PRICE[g] - p) * 0.2;
      p *= 1 + (rng.next() - 0.5) * 0.1;
      state.prices[g] = Math.max(1, round2(p));
    }
  }
  const ev = state.events.find((e) => e.day === state.day);
  if (ev) {
    for (const [g, m] of Object.entries(ev.effect)) state.prices[g as Good] = round2(state.prices[g as Good] * (m as number));
    log(state, 'event', ev.text);
  }
  for (const m of state.merchants) {
    m.haggle = {};
    for (const id of Object.keys(m.mood)) m.mood[id] = round2(m.mood[id] * 0.7);
  }
  settlePromises(state, brains);
  const next = state.events.find((e) => e.day === state.day + 1);
  if (next) {
    for (const m of state.merchants) {
      if (!rng.chance(m.id === HUMAN ? 0.6 : 0.55)) continue;
      const r = makeRumor(rng, `r${state.nextId++}`, next, rng.chance(0.75));
      state.rumors.push(r);
      m.heard.push(r.id);
      if (m.id === HUMAN) log(state, 'rumor', `A dockhand whispers: ${r.text}`, [HUMAN], true);
    }
  }
  state.talksLeft = state.talkPerDay;
  state.rng = rng.state;
}

export function settlePromises(state: GameState, brains: Brains): void {
  for (const p of state.promises) {
    if (p.status !== 'open' || p.due !== state.day) continue;
    const debtor = merchant(state, p.from);
    const creditor = merchant(state, p.to);
    const can = has(debtor, p.bundle);
    const keep = can && brains.honor(state, debtor, p);
    if (keep) {
      transfer(debtor, creditor, p.bundle);
      p.status = 'kept';
      creditor.trust[debtor.id] = Math.min(1, (creditor.trust[debtor.id] ?? 0.7) + 0.1);
      creditor.mood[debtor.id] = Math.min(1, (creditor.mood[debtor.id] ?? 0) + 0.15);
      log(state, 'promise', `${debtor.name} delivers ${describeBundle(p.bundle)} to ${creditor.name} as promised.`, [debtor.id, creditor.id]);
    } else {
      p.status = 'broken';
      creditor.trust[debtor.id] = (creditor.trust[debtor.id] ?? 0.7) * 0.3;
      creditor.mood[debtor.id] = Math.max(-1, (creditor.mood[debtor.id] ?? 0) - 0.7);
      // Word gets around the quay.
      for (const m of state.merchants) {
        if (m.id === debtor.id || m.id === creditor.id) continue;
        m.trust[debtor.id] = Math.max(0, (m.trust[debtor.id] ?? 0.7) - 0.15);
      }
      log(state, 'broken', `${debtor.name} fails to deliver ${describeBundle(p.bundle)} to ${creditor.name}${can ? '' : ' (they did not have it)'}.`, [debtor.id, creditor.id]);
    }
  }
}

/** Move to the next day, or close the market after the last one. */
export function advanceDay(state: GameState, brains: Brains): void {
  if (state.over) return;
  state.pending = {};
  if (state.day >= state.days) {
    closeMarket(state);
    return;
  }
  state.day++;
  openDay(state, brains);
}

// ---------- the close ----------

export interface ScoreLine {
  id: string;
  name: string;
  coin: number;
  contractMet: boolean;
  reward: number;
  goodsValue: number;
  total: number;
  /** Total minus what the stall was worth on the first morning. */
  profit: number;
}

export function contractMet(m: Merchant): boolean {
  return Object.entries(m.contract.needs).every(([g, n]) => m.goods[g as Good] >= (n as number));
}

/** What a merchant would end with if the market closed now. */
export function scoreOf(state: GameState, m: Merchant): ScoreLine {
  const met = contractMet(m);
  const left = { ...m.goods };
  if (met) for (const [g, n] of Object.entries(m.contract.needs)) left[g as Good] -= n as number;
  let goodsValue = 0;
  for (const g of GOODS) goodsValue += left[g] * state.prices[g] * m.taste[g];
  goodsValue = round2(goodsValue);
  const reward = met ? m.contract.reward : 0;
  const total = Math.round(m.coin + reward + goodsValue);
  return { id: m.id, name: m.name, coin: m.coin, contractMet: met, reward, goodsValue, total, profit: total - m.opening };
}

export function standings(state: GameState): ScoreLine[] {
  return state.merchants.map((m) => scoreOf(state, m)).sort((a, b) => b.profit - a.profit);
}

export function closeMarket(state: GameState): void {
  // Promises still open at the close are void; nothing more changes hands.
  for (const p of state.promises) if (p.status === 'open') p.status = 'broken';
  state.over = true;
  const lines = standings(state);
  log(state, 'close', `The market closes. ${lines.map((l, i) => `${i + 1}. ${l.name} ${signed(l.profit)}`).join(', ')}.`);
}

export function signed(n: number): string {
  return n >= 0 ? `+${n}` : `−${-n}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export { GOODS };
