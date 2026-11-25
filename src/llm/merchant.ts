// A model plays a merchant at its stall. It speaks in character and decides on
// offers, inside guardrails: it can't accept or propose a deal that loses it
// value by its own books, and every deal is checked against the rules. Facts
// (prices, news, needs) still come from the built-in merchant, so the model
// can't invent stock or rumours; it decides and it talks.
import { HUMAN, executeOffer, log, merchant, offerProblems } from '../engine/game.js';
import type { Bundle, GameState, Merchant, Offer } from '../engine/types.js';
import { gain, wanted } from '../agents/value.js';
import { talk, offerFromIntent, type TalkResult } from '../agents/talk.js';
import type { Intent } from '../talk/parse.js';
import { extractJson } from './parse.js';
import { ProviderError, UsageMeter, type ChatMessage, type LLMProvider } from './provider.js';
import { RULES, books, bundleJson, offerLine } from './situation.js';

export interface MerchantMeta {
  kind: 'merchant';
  state: GameState;
  me: string;
  intent: Intent;
  /** What the built-in merchant would do, for the offline mock. */
  advice: TalkResult;
}

export interface LLMTalkResult extends TalkResult {
  source: 'llm' | 'rules';
  fallbackReason?: string;
}

const PERSONA: Record<string, string> = {
  fair: 'You are honest and friendly, you like steady partners, and you keep your word.',
  hard: 'You are blunt and tight-fisted. You rarely give ground and you never pay over the odds.',
  sly: 'You are charming and well informed, and you are not above flattery or a little misdirection to get a better deal. You never reveal your contract.',
};

const FORMAT = `Reply with exactly one JSON object and nothing else:
{"say": "<what you say to the player, one or two sentences, in character>", "decision": "accept" | "counter" | "reject" | "talk",
 "counter": {"i_give": {...}, "you_give": {...}, "later": {"i_give": {...}, "you_give": {...}, "due": <day>}}}
"accept" takes the deal on the table. "counter" puts a new deal on the table (give "counter"). "reject" turns it down. "talk" is for anything that is not a decision about a deal.
Bundles use salt, amber, dye, wool, spice, iron and coin, in whole numbers. Never accept or offer a deal that leaves you worse off by your own books. Keep any numbers you say equal to the deal you put on the table.`;

export class LLMMerchant {
  constructor(
    readonly provider: LLMProvider,
    readonly meter = new UsageMeter(),
    readonly maxRepairs = 1,
  ) {}

  async reply(state: GameState, to: string, intent: Intent, said: string): Promise<LLMTalkResult> {
    const me = state.merchants.find((m) => m.id === to);
    // Refusals that need no judgement go straight to the rules.
    if (!me || me.id === HUMAN || state.over || state.talksLeft <= 0) return { ...talk(state, to, intent), source: 'rules' };
    const trial = structuredClone(state);
    const advice = talk(trial, to, intent);
    if (!advice.spent) return { ...talk(state, to, intent), source: 'rules' };

    const onTable = intent.kind === 'offer' ? offerFromIntent(state, to, intent) : intent.kind === 'accept' ? state.pending[to] : undefined;
    const system = `${RULES}\n\nYou are ${me.name}, a merchant at the harbour market. ${PERSONA[me.personality] ?? ''}\n${FORMAT}`;
    const messages: ChatMessage[] = [{ role: 'user', content: prompt(state, me, intent, said, advice, onTable) }];
    let lastError = '';
    for (let attempt = 0; attempt <= this.maxRepairs; attempt++) {
      let text: string;
      try {
        const res = await this.provider.complete({ system, messages, maxTokens: 500, meta: { kind: 'merchant', state, me: me.id, intent, advice } satisfies MerchantMeta });
        this.meter.record(res);
        text = res.text;
      } catch (err) {
        this.meter.failures++;
        return { ...talk(state, to, intent), source: 'rules', fallbackReason: err instanceof ProviderError ? err.message : String(err) };
      }
      try {
        return this.apply(state, trial, me, intent, onTable, advice, extractJson(text));
      } catch (err) {
        lastError = (err as Error).message;
      }
      messages.push({ role: 'assistant', content: text }, { role: 'user', content: `That reply had problems: ${lastError}. Reply again with the corrected JSON object only.` });
    }
    return { ...talk(state, to, intent), source: 'rules', fallbackReason: `model output was invalid: ${lastError}` };
  }

  /** Check the model's decision and carry it out on the real game. Throws when it breaks a rule. */
  private apply(state: GameState, trial: GameState, me: Merchant, intent: Intent, onTable: Offer | undefined, advice: TalkResult, raw: unknown): LLMTalkResult {
    if (!raw || typeof raw !== 'object') throw new Error('reply must be a JSON object');
    const r = raw as { say?: unknown; decision?: unknown; counter?: unknown };
    const say = typeof r.say === 'string' ? r.say.trim().slice(0, 400) : '';
    if (!say) throw new Error('missing "say"');
    const decision = String(r.decision ?? 'talk');
    if (!['accept', 'counter', 'reject', 'talk'].includes(decision)) throw new Error(`unknown decision "${decision}"`);

    // Not a deal decision: the built-in merchant's facts stand, in the model's words.
    if (intent.kind !== 'offer' && intent.kind !== 'accept') {
      const real = talk(state, me.id, intent);
      relabelLast(state, me, say);
      return { ...real, say, source: 'llm' };
    }

    let result: TalkResult;
    if (decision === 'accept') {
      if (!onTable) throw new Error('there is no deal on the table to accept');
      const problems = offerProblems(state, onTable);
      if (problems.length) throw new Error(`that deal can't go through: ${problems.join('; ')}`);
      if (gain(state, me, onTable) < 0) throw new Error('accepting would leave you worse off by your own books; counter or reject instead');
      executeOffer(state, onTable);
      result = { say, traded: true, spent: true };
    } else if (decision === 'counter') {
      const o = counterFromRaw(state, me, r.counter);
      const problems = offerProblems(state, o);
      if (problems.length) throw new Error(`the counter isn't possible: ${problems.join('; ')}`);
      if (gain(state, me, o) < 0) throw new Error('that counter would leave you worse off by your own books');
      state.pending[me.id] = o;
      result = { say, offer: o, spent: true };
    } else {
      result = { say, spent: true };
    }
    // Haggling rounds and mood follow what was offered, whoever answers.
    const t = merchant(trial, me.id);
    me.haggle = { ...t.haggle };
    me.mood = { ...t.mood };
    state.talksLeft--;
    log(state, 'say', `${me.name}: ${say}`, [me.id, HUMAN], true);
    void advice;
    return { ...result, source: 'llm' };
  }
}

function relabelLast(state: GameState, me: Merchant, say: string): void {
  const last = state.log.at(-1);
  if (last && last.kind === 'say' && last.who?.[0] === me.id) last.text = `${me.name}: ${say}`;
}

function prompt(state: GameState, me: Merchant, intent: Intent, said: string, advice: TalkResult, onTable: Offer | undefined): string {
  const lines = [books(state, me), '', `The player (a newcomer) says to you: "${said.replace(/"/g, "'")}"`, `That reads as: ${JSON.stringify(intent)}.`];
  if (onTable) {
    const mine = onTable.from === me.id ? onTable : undefined;
    const g = gain(state, me, onTable);
    const need = wanted(state, me, mine ?? { ...onTable }, me.haggle[HUMAN] ?? 0);
    lines.push(`The deal on the table, from your side: ${offerLine(state, onTable.from === me.id ? onTable : flipForMe(onTable))}.`);
    lines.push(`By your books it changes your worth by ${g.toFixed(1)} coin. Your usual walk-away gain for a deal this size is about ${need.toFixed(1)}.`);
  }
  lines.push(`Your instinct: ${advice.say}${advice.offer ? ` (deal: ${offerLine(state, advice.offer)})` : ''}`);
  lines.push('You may follow your instinct or decide differently, within the rules.');
  return lines.join('\n');
}

function flipForMe(o: Offer): Offer {
  return { from: o.to, to: o.from, give: o.get, get: o.give, later: o.later ? { give: o.later.get, get: o.later.give, due: o.later.due } : undefined };
}

function counterFromRaw(state: GameState, me: Merchant, raw: unknown): Offer {
  if (!raw || typeof raw !== 'object') throw new Error('a counter needs "counter" with "i_give" and "you_give"');
  const c = raw as Record<string, unknown>;
  const o: Offer = { from: me.id, to: HUMAN, give: bundle(c.i_give, 'i_give'), get: bundle(c.you_give, 'you_give') };
  if (c.later && typeof c.later === 'object') {
    const l = c.later as Record<string, unknown>;
    const due = Number(l.due);
    if (!Number.isInteger(due)) throw new Error('later.due must be a day number');
    o.later = { give: bundle(l.i_give, 'later.i_give'), get: bundle(l.you_give, 'later.you_give'), due };
  }
  void state;
  return o;
}

function bundle(raw: unknown, label: string): Bundle {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} must be an object`);
  const out: Bundle = {};
  const keys = ['salt', 'amber', 'dye', 'wool', 'spice', 'iron', 'coin'];
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!keys.includes(k)) throw new Error(`${label} has unknown good "${k}"`);
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${label}.${k} must be a whole number`);
    if (n) out[k as keyof Bundle] = n;
  }
  return out;
}

/** The deal as JSON from the merchant's side, for the mock and for prompts. */
export function counterJson(o: Offer): Record<string, unknown> {
  const out: Record<string, unknown> = { i_give: bundleJson(o.give), you_give: bundleJson(o.get) };
  if (o.later) out.later = { i_give: bundleJson(o.later.give), you_give: bundleJson(o.later.get), due: o.later.due };
  return out;
}
