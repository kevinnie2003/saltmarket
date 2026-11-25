// One exchange at a stall: read the player's words, then let the merchant
// answer. Each half can be a model or the built-in rules.
import type { GameState } from '../engine/types.js';
import { talk, type TalkResult } from '../agents/talk.js';
import { parseTalk, type Intent } from '../talk/parse.js';
import type { LLMInterpreter } from './interpreter.js';
import type { LLMMerchant } from './merchant.js';

export interface StallReply extends TalkResult {
  to?: string;
  intent: Intent;
  readBy: 'llm' | 'rules';
  answeredBy: 'llm' | 'rules';
  /** Why a model step fell back to the rules, if it did. */
  fallback?: string[];
}

export async function stallTalk(
  state: GameState,
  text: string,
  stall: string | undefined,
  opts: { interpreter?: LLMInterpreter; merchant?: LLMMerchant } = {},
): Promise<StallReply> {
  const fallback: string[] = [];
  let reading: { to?: string; intent: Intent; source: 'llm' | 'rules'; fallbackReason?: string };
  if (opts.interpreter) reading = await opts.interpreter.interpret(state, text, stall);
  else reading = { ...parseTalk(state, text, stall), source: 'rules' };
  if (reading.fallbackReason) fallback.push(`reading: ${reading.fallbackReason}`);
  const to = reading.to ?? stall;
  if (!to) return { say: 'Pick a stall first, or start with a merchant’s name.', spent: false, intent: reading.intent, readBy: reading.source, answeredBy: 'rules', fallback };
  if (opts.merchant) {
    const r = await opts.merchant.reply(state, to, reading.intent, text);
    if (r.fallbackReason) fallback.push(`answer: ${r.fallbackReason}`);
    return { ...r, to, intent: reading.intent, readBy: reading.source, answeredBy: r.source, fallback };
  }
  return { ...talk(state, to, reading.intent), to, intent: reading.intent, readBy: reading.source, answeredBy: 'rules', fallback };
}
