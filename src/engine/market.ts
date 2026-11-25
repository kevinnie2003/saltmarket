// The market: goods, starting prices, merchants, events and rumours.
import { Rng } from './rng.js';
import { GOODS, type Contract, type EventKind, type Good, type MarketEvent, type Merchant, type Personality, type Rumor } from './types.js';

export const BASE_PRICE: Record<Good, number> = { salt: 4, amber: 14, dye: 9, wool: 5, spice: 12, iron: 7 };

export const GOOD_INFO: Record<Good, { label: string; unit: string }> = {
  salt: { label: 'salt', unit: 'sack' },
  amber: { label: 'amber', unit: 'lump' },
  dye: { label: 'dye', unit: 'jar' },
  wool: { label: 'wool', unit: 'bale' },
  spice: { label: 'spice', unit: 'pouch' },
  iron: { label: 'iron', unit: 'bar' },
};

export interface MerchantTemplate {
  name: string;
  personality: Personality;
  blurb: string;
  /** Goods they tend to start with. */
  stock: Good[];
}

/** The AI merchants of the harbour. Original characters. */
export const RIVALS: MerchantTemplate[] = [
  { name: 'Marta Vey', personality: 'fair', blurb: 'Wool and dye from the hill farms. Keeps her word and remembers who kept theirs.', stock: ['wool', 'dye'] },
  { name: 'Oskar Brine', personality: 'hard', blurb: 'Salt pans and an iron smithy. Haggles every coin and rarely moves first.', stock: ['salt', 'iron'] },
  { name: 'Ilse Tamm', personality: 'sly', blurb: 'Amber and spice off the night boats. Charming, well informed, not always truthful.', stock: ['amber', 'spice'] },
  { name: 'Pell Dorran', personality: 'fair', blurb: 'A river barge of mixed cargo. Patient, plain spoken, likes a quick deal.', stock: ['iron', 'wool'] },
];

const CLIENTS = ['the abbey', 'the shipwright', 'the duke’s steward', 'a glassworks', 'the dyers’ guild', 'a caravan master', 'the lighthouse keeper'];

export function emptyGoods(): Record<Good, number> {
  return Object.fromEntries(GOODS.map((g) => [g, 0])) as Record<Good, number>;
}

/** A contract that needs two or three goods, mostly ones the merchant doesn't start with. */
export function makeContract(rng: Rng, avoid: Good[]): Contract {
  const pool = rng.shuffle(GOODS.filter((g) => !avoid.includes(g)));
  const kinds = 2 + rng.int(2);
  const needs: Partial<Record<Good, number>> = {};
  let worth = 0;
  for (const g of pool.slice(0, kinds)) {
    const n = 2 + rng.int(3);
    needs[g] = n;
    worth += n * BASE_PRICE[g];
  }
  // Pays well over market value, so filling it is worth chasing.
  return { client: rng.pick(CLIENTS), needs, reward: Math.round(worth * (1.5 + rng.next() * 0.3)) };
}

export function makeMerchant(rng: Rng, id: string, t: MerchantTemplate): Merchant {
  const goods = emptyGoods();
  for (const g of t.stock) goods[g] += 5 + rng.int(4);
  for (const g of rng.shuffle(GOODS.filter((x) => !t.stock.includes(x))).slice(0, 2)) goods[g] += 1 + rng.int(2);
  const taste = Object.fromEntries(GOODS.map((g) => [g, round2(0.8 + rng.next() * 0.4)])) as Record<Good, number>;
  // Nobody is paid well at the close for their own home goods.
  for (const g of t.stock) taste[g] = round2(Math.min(taste[g], 0.9));
  return {
    id,
    name: t.name,
    personality: t.personality,
    blurb: t.blurb,
    coin: 40,
    goods,
    contract: makeContract(rng, t.stock),
    taste,
    trust: {},
    mood: {},
    heard: [],
    haggle: {},
    opening: 0,
  };
}

const EVENT_TEXT: Record<EventKind, (g: Good[]) => string> = {
  ship: (g) => `A cargo ship from the south ties up, heavy with ${list(g)}. Prices drop.`,
  storm: (g) => `Storm on the strait. No boats get through, and ${list(g)} climbs.`,
  guild: (g) => `The guild posts a big order for ${list(g)}. Buyers line the quay.`,
  fair: (g) => `Fair day in town. Everyone wants ${list(g)}.`,
  blight: (g) => `Bad news from the farms: ${list(g)} will be short this season.`,
  quiet: () => 'A quiet morning on the quay.',
};

const EVENT_GOODS: Record<EventKind, Good[][]> = {
  ship: [['spice'], ['amber'], ['dye'], ['salt', 'iron']],
  storm: [['spice', 'dye'], ['amber'], ['salt']],
  guild: [['iron'], ['salt'], ['iron', 'wool']],
  fair: [['wool', 'dye'], ['spice'], ['amber', 'dye']],
  blight: [['wool'], ['dye']],
  quiet: [[]],
};

const EVENT_MULT: Record<EventKind, number> = { ship: 0.65, storm: 1.4, guild: 1.45, fair: 1.3, blight: 1.5, quiet: 1 };

export function eventFor(kind: EventKind, goods: Good[], day: number): MarketEvent {
  const effect: Partial<Record<Good, number>> = {};
  for (const g of goods) effect[g] = EVENT_MULT[kind];
  return { day, kind, text: EVENT_TEXT[kind](goods), effect };
}

/** One event per day after the first. Day 1 is always quiet. */
export function makeSchedule(rng: Rng, days: number): MarketEvent[] {
  const out: MarketEvent[] = [eventFor('quiet', [], 1)];
  const kinds: EventKind[] = ['ship', 'storm', 'guild', 'fair', 'blight', 'quiet'];
  for (let d = 2; d <= days; d++) {
    const kind = rng.pick(kinds);
    out.push(eventFor(kind, rng.pick(EVENT_GOODS[kind]), d));
  }
  return out;
}

export function rumorText(kind: EventKind, goods: Good[], day: number): string {
  const when = `on day ${day}`;
  switch (kind) {
    case 'ship':
      return `A ship loaded with ${list(goods)} is due ${when}.`;
    case 'storm':
      return `Fishermen say a storm will close the strait ${when}, and ${list(goods)} will be scarce.`;
    case 'guild':
      return `The guild means to buy up ${list(goods)} ${when}.`;
    case 'fair':
      return `The fair ${when} will want ${list(goods)}.`;
    case 'blight':
      return `Word from the farms: ${list(goods)} will run short ${when}.`;
    default:
      return `Nothing much is expected ${when}.`;
  }
}

/** A true rumour about an event, or a false one about something that won't happen. */
export function makeRumor(rng: Rng, id: string, real: MarketEvent, truthful: boolean): Rumor {
  let kind = real.kind;
  let goods = Object.keys(real.effect) as Good[];
  if (!truthful) {
    const kinds: EventKind[] = ['ship', 'storm', 'guild', 'fair', 'blight'];
    do {
      kind = rng.pick(kinds);
      goods = rng.pick(EVENT_GOODS[kind]);
    } while (kind === real.kind && same(goods, Object.keys(real.effect) as Good[]));
  }
  return { id, day: real.day, kind, goods, text: rumorText(kind, goods, real.day), truth: truthful, direction: EVENT_MULT[kind] };
}

export function list(goods: Good[]): string {
  if (goods.length === 0) return 'nothing';
  if (goods.length === 1) return goods[0];
  return `${goods.slice(0, -1).join(', ')} and ${goods[goods.length - 1]}`;
}

function same(a: Good[], b: Good[]): boolean {
  return a.length === b.length && a.every((g) => b.includes(g));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
