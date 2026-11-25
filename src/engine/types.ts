// Core data types. Everything in GameState is plain JSON so the browser can
// hold the whole game and send it to a stateless server.

export const GOODS = ['salt', 'amber', 'dye', 'wool', 'spice', 'iron'] as const;
export type Good = (typeof GOODS)[number];
export type Asset = Good | 'coin';
export const ASSETS: readonly Asset[] = [...GOODS, 'coin'];

/** Some amount of goods and coin. Missing keys mean zero. */
export type Bundle = Partial<Record<Asset, number>>;

export type Personality = 'fair' | 'hard' | 'sly' | 'human';

export interface Contract {
  /** Who placed the order, for flavour. */
  client: string;
  needs: Partial<Record<Good, number>>;
  reward: number;
}

export interface Merchant {
  id: string;
  name: string;
  personality: Personality;
  /** One line about them, shown in the UI. */
  blurb: string;
  coin: number;
  goods: Record<Good, number>;
  contract: Contract;
  /** Private resale multiplier per good at the close (where they can sell it). */
  taste: Record<Good, number>;
  /** How much they trust each other merchant to keep a promise, 0..1. */
  trust: Record<string, number>;
  /** How they feel about each merchant right now, -1..1. Lowballs and broken promises sour it. */
  mood: Record<string, number>;
  /** Rumours this merchant has heard, by id. */
  heard: string[];
  /** What their stall was worth on the first morning, so scores measure profit. */
  opening: number;
  /** Haggling rounds with each merchant today. Resets each morning. */
  haggle: Record<string, number>;
}

/** A deferred delivery agreed as part of a deal. */
export interface Promise {
  id: string;
  from: string;
  to: string;
  bundle: Bundle;
  due: number;
  status: 'open' | 'kept' | 'broken';
}

/**
 * A proposed deal. `give` moves from `from` to `to` now, `get` moves from `to`
 * to `from` now. `later` holds parts that are delivered on day `due`.
 */
export interface Offer {
  from: string;
  to: string;
  give: Bundle;
  get: Bundle;
  later?: { give?: Bundle; get?: Bundle; due: number };
}

export type EventKind = 'ship' | 'storm' | 'guild' | 'fair' | 'blight' | 'quiet';

export interface MarketEvent {
  day: number;
  kind: EventKind;
  text: string;
  /** Price multipliers applied on the day it lands. */
  effect: Partial<Record<Good, number>>;
}

export interface Rumor {
  id: string;
  /** The day the rumour is about. */
  day: number;
  text: string;
  /** Whether it matches what will happen. Hidden from players. */
  truth: boolean;
  kind: EventKind;
  goods: Good[];
  /** Above 1 means prices are said to rise. */
  direction: number;
}

export type LogKind = 'day' | 'event' | 'trade' | 'say' | 'promise' | 'broken' | 'rumor' | 'system' | 'close';

export interface LogEntry {
  day: number;
  kind: LogKind;
  text: string;
  /** Merchant ids involved. */
  who?: string[];
  /** True when only the human player saw it (private chat). */
  private?: boolean;
}

export interface GameState {
  version: 1;
  seed: number;
  rng: number;
  day: number;
  days: number;
  prices: Record<Good, number>;
  /** Prices at the start of the game, for the board. */
  openingPrices: Record<Good, number>;
  merchants: Merchant[];
  promises: Promise[];
  /** The whole event schedule, one per day. Players only see past events. */
  events: MarketEvent[];
  rumors: Rumor[];
  log: LogEntry[];
  talkPerDay: number;
  talksLeft: number;
  /** An offer an AI merchant has put to the human, by merchant id. */
  pending: Record<string, Offer | undefined>;
  /** The player's own last offer at a stall, while the merchant's counter to it is on the table. */
  asked?: Record<string, Offer | undefined>;
  /** Trades made, for stats. */
  trades: { day: number; offer: Offer }[];
  over: boolean;
  nextId: number;
  /** Promises the player has chosen not to keep, by id. */
  breaking?: string[];
}
