// Stand-in players for simulations. They talk to stalls through the same
// path as a person, so the sim measures the game the player actually gets.
import { HUMAN, merchant, offerProblems } from '../engine/game.js';
import type { GameState } from '../engine/types.js';
import { propose } from '../agents/mind.js';
import { rivals } from '../agents/session.js';
import { talk } from '../agents/talk.js';
import { gain } from '../agents/value.js';
import type { LLMMerchant } from '../llm/merchant.js';
import type { Intent } from '../talk/parse.js';

export type BotKind = 'idle' | 'taker' | 'trader';

type Say = (state: GameState, to: string, intent: Intent) => Promise<{ traded?: boolean; offer?: unknown }>;

/**
 * idle: never trades. taker: accepts any morning offer that helps it.
 * trader: also chases its contract, haggling up to two rounds per stall.
 */
export async function playDay(state: GameState, kind: BotKind, voice?: LLMMerchant): Promise<void> {
  if (kind === 'idle') return;
  const say: Say = voice ? (s, to, i) => voice.reply(s, to, i, JSON.stringify(i)) : async (s, to, i) => talk(s, to, i);
  const you = merchant(state, HUMAN);
  for (const m of rivals(state)) {
    if (state.talksLeft <= 0) return;
    const p = state.pending[m.id];
    if (p && !offerProblems(state, p).length && gain(state, you, p) > 0.5) await say(state, m.id, { kind: 'accept' });
  }
  if (kind !== 'trader') return;
  for (const m of rivals(state)) {
    for (let round = 0; round < 2 && state.talksLeft > 0; round++) {
      const o = propose(state, you, m);
      if (!o) break;
      const r = await say(state, m.id, { kind: 'offer', give: o.give, get: o.get, later: o.later });
      if (r.traded) continue;
      const c = state.pending[m.id];
      if (c && !offerProblems(state, c).length && gain(state, you, c) > 0) {
        await say(state, m.id, { kind: 'accept' });
        break;
      }
    }
  }
}
