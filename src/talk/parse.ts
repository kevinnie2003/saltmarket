// Turns what the player types at a stall into an intent. Rule based, so the
// game works offline; the LLM interpreter produces the same Intent shape.
import { HUMAN, merchant } from '../engine/game.js';
import { GOODS, type Bundle, type GameState, type Good, type Offer } from '../engine/types.js';

export type Intent =
  | { kind: 'offer'; give: Bundle; get: Bundle; later?: { give?: Bundle; get?: Bundle; due: number } }
  | { kind: 'accept' }
  | { kind: 'reject' }
  | { kind: 'price'; good: Good; qty: number }
  | { kind: 'bid'; good: Good; qty: number }
  | { kind: 'needs' }
  | { kind: 'news' }
  | { kind: 'hello' }
  | { kind: 'unknown'; text: string };

export interface Parsed {
  /** Merchant the words were addressed to, if they named one. */
  to?: string;
  intent: Intent;
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, single: 1, two: 2, pair: 2, couple: 2, three: 3, few: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};

const GOOD_WORDS: Record<string, Good> = {
  salt: 'salt', salts: 'salt',
  amber: 'amber', ambers: 'amber',
  dye: 'dye', dyes: 'dye',
  wool: 'wool', wools: 'wool', fleece: 'wool', fleeces: 'wool',
  spice: 'spice', spices: 'spice', pepper: 'spice',
  iron: 'iron', irons: 'iron',
};
const COIN_WORDS = ['coin', 'coins', 'silver', 'crown', 'crowns', 'mark', 'marks', 'money', 'gold', 'cash'];
const UNIT_WORDS = ['sack', 'sacks', 'lump', 'lumps', 'jar', 'jars', 'bale', 'bales', 'pouch', 'pouches', 'bar', 'bars', 'units', 'unit', 'pieces', 'piece', 'of', 'your', 'my', 'some', 'the', 'more'];

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/(\d+)\s*c\b/g, '$1 coin')
    .replace(/[!?.;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Who the message is for: a name at the start or after a greeting. */
export function addressee(state: GameState, text: string): { to?: string; rest: string } {
  const t = text.trim();
  for (const m of state.merchants) {
    if (m.id === HUMAN) continue;
    const first = m.name.split(' ')[0].toLowerCase();
    const full = m.name.toLowerCase();
    const re = new RegExp(`^(?:(?:hey|hi|ok|okay|so|well)[, ]+)?(${escape(full)}|${escape(first)})\\b[,:]?\\s*`, 'i');
    const mm = t.match(re);
    if (mm) return { to: m.id, rest: t.slice(mm[0].length) };
  }
  return { rest: t };
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Read "3 salt and 10 coin", "two jars of dye", "a sack of salt", "12". */
export function readBundle(text: string, bareNumberIs: 'coin' | null = 'coin'): Bundle | null {
  const words = text.replace(/,/g, ' , ').split(/\s+/).filter(Boolean);
  const out: Bundle = {};
  let pending: number | null = null;
  let found = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[^a-z0-9.]/g, '').replace(/\.+$/, '');
    if (!w) continue;
    if (/^\d+(\.\d+)?$/.test(w)) {
      pending = Number(w);
      continue;
    }
    if (w in NUMBER_WORDS && !(w === 'a' && pending !== null)) {
      pending = w === 'dozen' && (words[i - 1] === 'half' || words[i - 2] === 'half') ? 6 : NUMBER_WORDS[w];
      continue;
    }
    if (w in GOOD_WORDS) {
      const g = GOOD_WORDS[w];
      out[g] = (out[g] ?? 0) + (pending ?? 1);
      pending = null;
      found = true;
      continue;
    }
    if (COIN_WORDS.includes(w)) {
      if (pending !== null) {
        out.coin = (out.coin ?? 0) + pending;
        found = true;
      }
      pending = null;
      continue;
    }
    if (UNIT_WORDS.includes(w) || w === 'and' || w === 'plus' || w === 'half') continue;
    // Some other word ends a number that had no good after it.
    if (pending !== null && bareNumberIs === 'coin') {
      out.coin = (out.coin ?? 0) + pending;
      found = true;
    }
    pending = null;
  }
  if (pending !== null && bareNumberIs === 'coin') {
    out.coin = (out.coin ?? 0) + pending;
    found = true;
  }
  return found ? out : null;
}

function firstGood(text: string): { good: Good; qty: number } | null {
  const b = readBundle(text, null);
  if (!b) return null;
  const g = GOODS.find((x) => (b[x] ?? 0) > 0);
  return g ? { good: g, qty: b[g] ?? 1 } : null;
}

/** Pull a "... on day 5" / "tomorrow" delivery clause out of the text. */
function readLater(state: GameState, text: string): { rest: string; later?: { give?: Bundle; get?: Bundle; due: number } } {
  const when = String.raw`(?:on\s+day\s+(\d+)|tomorrow|in\s+(\w+)\s+days?|(?:at|by)\s+(?:the\s+)?(?:close|end))`;
  const mine = new RegExp(String.raw`(?:,|\band\b|\bthen\b)?\s*(?:i'?ll|i\s+will|i\s+can|i'?d|i)\s+(?:pay|give|deliver|bring|send)\s+(?:you\s+)?(?:the\s+rest,?\s*)?(.+?)\s+${when}`);
  const theirs = new RegExp(String.raw`(?:,|\band\b|\bthen\b)?\s*(?:you\s+(?:can\s+|could\s+)?(?:pay|give|deliver|bring|send)(?:\s+me)?)\s+(.+?)\s+${when}`);
  const rest = new RegExp(String.raw`\b(?:and|plus|then)\s+(?:the\s+rest\s*,?\s*)?((?:\d+|\w+)\s*(?:coin|coins|salt|amber|dye|wool|spice|iron)?)\s+${when}`);
  for (const [re, side] of [
    [theirs, 'get'],
    [rest, 'give'],
    [mine, 'give'],
  ] as const) {
    const m = text.match(re);
    if (!m) continue;
    const b = readBundle(m[1]);
    if (!b) continue;
    let due = state.day + 1;
    if (m[2]) due = Number(m[2]);
    else if (m[3]) due = state.day + (Number(m[3]) || NUMBER_WORDS[m[3]] || 1);
    else if (/close|end/.test(m[0])) due = state.days;
    const rest = (text.slice(0, m.index) + text.slice((m.index ?? 0) + m[0].length)).trim().replace(/(?:,|\band|\bthen|\bnow)+\s*$/, '').trim();
    return { rest, later: side === 'give' ? { give: b, due } : { get: b, due } };
  }
  return { rest: text };
}

/** Parse a line typed at a stall. `to` is the stall the player has open. */
export function parseTalk(state: GameState, raw: string, to?: string): Parsed {
  const named = addressee(state, raw);
  const target = named.to ?? to;
  const text = normalise(named.rest);
  const intent = readIntent(state, text, target);
  return { to: target, intent };
}

function readIntent(state: GameState, text: string, to?: string): Intent {
  if (!text) return { kind: 'hello' };
  if (/^(deal|yes|yep|yeah|ok|okay|agreed|accept(ed)?|done|sure|fine|sold|shake on it|you'?ve got a deal|i'?ll take (it|that)|sounds good|let'?s do it)\b/.test(text) && !/\bfor\b|\d/.test(text))
    return { kind: 'accept' };
  if (/^(no|nope|nah|pass|reject|not interested|no deal|no thanks|too (much|high|steep|dear|expensive|pricey|rich)|that'?s too (much|high|steep|dear|expensive)|forget it|never mind|bye|goodbye|good ?bye|see you|farewell|later|thanks|thank you|cheers)\b/.test(text) && !/\bfor\b/.test(text))
    return { kind: 'reject' };
  if (/\b(news|rumou?rs?|gossip|heard anything|hear anything|what'?s going on|anything new|what'?s the word)\b/.test(text)) return { kind: 'news' };
  if (/\b(what do you (need|want)(?! for)|what are you (after|looking for|buying)|need anything|want anything|what'?s on your list|what are you short)\b/.test(text))
    return { kind: 'needs' };
  const bidM = text.match(/\b(?:what would you pay|how much would you (?:pay|give)|what will you (?:pay|give)|would you buy|want to buy|buy (?:some of )?my)\b(.*)/);
  if (bidM) {
    const g = firstGood(bidM[1]);
    if (g) return { kind: 'bid', ...g };
  }
  const priceM = text.match(/\b(?:how much (?:for|is|are|do you want for)?|what'?s your price (?:for|on)?|price (?:for|of|on)|what would you (?:take|want|charge) for|what do you want for|cost)\b(.*)/);
  if (priceM && !/\bfor\b.*\bfor\b/.test(text)) {
    let g = firstGood(priceM[1]);
    if (!g) {
      const any = firstGood(text);
      const n = priceM[1].match(/\b(\d+)\b/);
      if (any) g = { good: any.good, qty: n ? Number(n[1]) : any.qty };
    }
    if (g) return { kind: 'price', ...g };
  }
  const bump = readBump(state, text, to);
  if (bump) return bump;
  const offer = readOffer(state, text, to);
  if (offer) return offer;
  const ask = text.match(/^(?:do you (?:have|sell|carry|stock|got)|got any|have you got|any|i'?d like|i want|i need|i'?m after|looking for|can i have)\b(.*)$|^(.*)\bplease$/);
  if (ask) {
    const g = firstGood(ask[1] ?? ask[2] ?? '');
    if (g) return { kind: 'price', ...g };
  }
  const sellM = text.match(/^(?:can i |could i |i'?d like to |i want to )?(?:buy|get)\s+(.+)$/);
  if (sellM) {
    const g = firstGood(sellM[1]);
    if (g) return { kind: 'price', ...g };
  }
  if (/^(hi|hello|hey|morning|good (morning|day|evening)|greetings|ahoy)\b/.test(text)) return { kind: 'hello' };
  return { kind: 'unknown', text };
}

/**
 * "how about 14", "ok 16 then", "make it 12": a new coin figure for the deal
 * on the table, with everything else kept.
 */
function readBump(state: GameState, text: string, to?: string): Intent | null {
  const m = text.match(/^(?:how about|what about|ok(?:ay)?|fine|make it|say|would you take|will you take|i'?ll (?:do|pay|give you|take)|i can do|i could do|meet me at|let'?s say)?[,\s]*(\d+)(?:\s*(?:coin|coins|silver|crowns))?(?:\s+then)?(?:\s*(?:for it|for that|instead))?$/);
  if (!m || !to) return null;
  const o = state.pending[to];
  if (!o) return null;
  const n = Number(m[1]);
  // From the player's side: the merchant's `get` is what the player gives.
  let give = { ...o.get };
  let get = { ...o.give };
  let later: Offer['later'] = o.later ? { give: o.later.get, get: o.later.give, due: o.later.due } : undefined;
  // After a counter, a new figure most likely re-prices the player's own terms,
  // as long as the coin sits on the same side in both.
  const mine = state.asked?.[to];
  if (mine && ((give.coin && mine.give.coin) || (get.coin && mine.get.coin))) {
    give = { ...mine.give };
    get = { ...mine.get };
    later = mine.later ? { ...mine.later } : undefined;
  }
  if (give.coin) give.coin = n;
  else if (get.coin) get.coin = n;
  else return null;
  return { kind: 'offer', give, get, later };
}

function readOffer(state: GameState, text0: string, to?: string): Intent | null {
  const { rest, later } = readLater(state, text0);
  const text = rest.replace(/^(?:how about|what about|would you take|would you do|will you take|i propose|i offer|counter:?|ok(?:ay)?,?|fine,?|then)\s+/, '').trim();
  // "my 3 salt for your 2 amber", "3 salt for 2 amber", "I'll give you 3 salt for 2 amber"
  const split = text.split(/\s+(?:for|in exchange for|in return for|and you give me|if you give me|against)\s+/);
  let give: Bundle | null = null;
  let get: Bundle | null = null;
  if (split.length >= 2) {
    let left = split[0];
    const right = split.slice(1).join(' for ');
    const buying = /\b(?:sell me|give me|let me have|i'?ll (?:buy|take)|i (?:want|need|would like|'?d like)|can i (?:buy|have|get)|i'?d (?:buy|take))\b/.test(left);
    left = left.replace(/^.*?\b(?:i'?ll|i will|i can|i could|let me|i'?d)?\s*(?:give|offer|pay|trade|swap|sell|buy|take|want|need|like|have|get)(?:\s+(?:you|me))?\s+/, '');
    const a = readBundle(left);
    const b = readBundle(right);
    if (!a || !b) return null;
    if (buying) {
      get = a;
      give = b;
    } else {
      give = a;
      get = b;
    }
    // "your amber for my salt" reads the other way round.
    if (/^\s*your\b/.test(left) || /^\s*my\b/.test(right)) [give, get] = [get, give];
    // "amber for 15" said to someone who has amber, by a player who has none, is a purchase.
    if (to && give && get && onlyGoods(give) && onlyCoin(get)) {
      const you = state.merchants.find((m) => m.id === HUMAN);
      const them = state.merchants.find((m) => m.id === to);
      const g = GOODS.find((x) => (give![x] ?? 0) > 0)!;
      if (you && them && you.goods[g] < (give[g] ?? 0) && them.goods[g] >= (give[g] ?? 0)) [give, get] = [get, give];
    }
  } else {
    // "I'll pay 20 coin on day 5 for nothing" makes no sense, but "sell you 3 salt" alone is a price ask.
    const sell = text.match(/^(?:i'?ll |i can |i could )?(?:sell|give|offer)\s+(?!me\b)(?:you\s+)?(.+)$/);
    if (sell && !later) {
      const b = readBundle(sell[1], null);
      const g = b && GOODS.find((x) => (b[x] ?? 0) > 0);
      if (g) return { kind: 'bid', good: g, qty: b![g]! };
    }
    if (later) {
      // "give me 2 amber now, I'll pay you 30 coin tomorrow"
      const now = text.match(/(?:give|sell|let me have)\s+me\s+(.+?)(?:\s+now)?$/);
      const b = now ? readBundle(now[1]) : null;
      if (b) return { kind: 'offer', give: {}, get: b, later };
    }
    return null;
  }
  return { kind: 'offer', give: give ?? {}, get: get ?? {}, later };
}

function onlyGoods(b: Bundle): boolean {
  return !b.coin && GOODS.some((g) => (b[g] ?? 0) > 0);
}

function onlyCoin(b: Bundle): boolean {
  return (b.coin ?? 0) > 0 && GOODS.every((g) => !(b[g] ?? 0));
}

/** For display: who the player is talking to by name. */
export function nameOf(state: GameState, id?: string): string {
  return id ? merchant(state, id).name : 'nobody';
}
