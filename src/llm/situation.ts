// Text pictures of the market for prompts. Each one only holds what that
// merchant could know: its own books, public prices and stalls, rumours it heard.
import { HUMAN, describeBundle, merchant, pitch } from '../engine/game.js';
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
  const rumours = state.rumors.filter((r) => me.heard.includes(r.id) && r.day > state.day).map((r) => `- ${r.text}`);
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
  return pitch(state, o);
}
