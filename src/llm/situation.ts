// Text pictures of the market for prompts. Each one only holds what that
// merchant could know: its own books, public prices and stalls, rumours it heard.
// Prompts are written in English whatever the game's language; the model is
// told separately which language to speak in.
import { HUMAN, describeBundle, merchant, pitch } from '../engine/game.js';
import { rumorText } from '../engine/market.js';
import type { Lang } from '../i18n/lang.js';
import { GOODS, type Bundle, type GameState, type Merchant, type Offer } from '../engine/types.js';

export const RULES = `Saltmarket is a harbour trading game. Merchants trade six goods (salt, amber, dye, wool, spice, iron) and coin over a few market days.
Each merchant has a private contract: deliver certain goods at the close for a big reward, all or nothing. Goods left over sell at the closing price times that merchant's own resale rate. Scores are profit over what the stall was worth on the first morning.
Deals can include deliveries promised for a later day. Promises can be broken, and broken promises are remembered.
Events (ships, storms, guild orders, fairs, bad harvests) move prices each morning. Rumours about tomorrow go round; some are false.`;

export function stalls(state: GameState, viewer: string): string {
  const lines = state.merchants
    .filter((m) => m.id !== viewer)
    .map((m) => `- ${m.id === HUMAN ? 'the newcomer (the player)' : m.name}: ${goodsLine(m)}, ${Math.floor(m.coin)} coin`);
  return lines.join('\n');
}

export function goodsLine(m: Merchant): string {
  const parts = GOODS.filter((g) => m.goods[g] > 0).map((g) => `${m.goods[g]} ${g}`);
  return parts.length ? parts.join(', ') : 'no goods';
}

export function pricesLine(state: GameState): string {
  return GOODS.map((g) => `${g} ${state.prices[g]}`).join(', ');
}

export function books(state: GameState, me: Merchant): string {
  const needs = Object.entries(me.contract.needs)
    .map(([g, n]) => `${n} ${g} (you have ${me.goods[g as keyof typeof me.goods]})`)
    .join(', ');
  const rumours = state.rumors.filter((r) => me.heard.includes(r.id) && r.day > state.day).map((r) => `- ${rumorText(r.kind, r.goods, r.day, 'en')}`);
  const owed = state.promises
    .filter((p) => p.status === 'open' && (p.from === me.id || p.to === me.id))
    .map((p) => (p.from === me.id ? `- you owe ${name(state, p.to)} ${describeBundle(p.bundle)} on day ${p.due}` : `- ${name(state, p.from)} owes you ${describeBundle(p.bundle)} on day ${p.due}`));
  return [
    `Day ${state.day} of ${state.days}. Prices today: ${pricesLine(state)}.`,
    `Your stall: ${goodsLine(me)}, ${Math.floor(me.coin)} coin.`,
    `Your contract for ${me.contract.client}: ${needs}. Reward ${me.contract.reward} coin, paid only if all of it is delivered at the close.`,
    `Your resale rates at the close: ${GOODS.map((g) => `${g} ${me.taste[g]}`).join(', ')}.`,
    rumours.length ? `Rumours you heard:\n${rumours.join('\n')}` : 'You have heard no rumours about the days ahead.',
    owed.length ? `Promises:\n${owed.join('\n')}` : '',
    `Other stalls (anyone can see these):\n${stalls(state, me.id)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function name(state: GameState, id: string): string {
  return id === HUMAN ? 'the newcomer' : merchant(state, id).name;
}

export function bundleJson(b: Bundle | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(b ?? {})) if (v) out[k] = v as number;
  return out;
}

export function offerLine(state: GameState, o: Offer): string {
  return pitch(state, o, 'en');
}

/** Tells a model which language its words must be in. */
export const LANGUAGE: Record<Lang, string> = {
  en: 'LANGUAGE: Write everything the player will read in English.',
  zh: 'LANGUAGE: Write everything the player will read (the "say" field) in natural Simplified Chinese (简体中文). Keep merchant personal names in Latin letters (Marta Vey, Oskar Brine, Ilse Tamm, Pell Dorran), write figures as Arabic numerals, and call coin 文 (for example 15 文). JSON keys, decisions and good names inside bundles stay in English.',
};

/** How the player may write, for the interpreter. */
export const PLAYER_LANGUAGES = `The player may write in English or in Simplified Chinese, or mix the two. Chinese goods: 盐 salt, 琥珀 amber, 染料 dye, 羊毛 wool, 香料 spice, 铁 iron; coin is 钱, 文, 枚 or 钱币. Chinese numerals (两, 三, 十五, 二十) and full-width digits are numbers. Names may be written in Chinese (玛塔 is Marta, 奥斯卡 is Oskar, 伊尔莎 is Ilse, 佩尔 is Pell). 第4天 means on day 4, 明天 tomorrow, 后天 the day after.`;
