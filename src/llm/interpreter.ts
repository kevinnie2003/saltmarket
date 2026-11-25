// A model reads what the player typed and turns it into an Intent. Anything
// it returns is checked; bad output gets one repair round, then the rule parser.
import { HUMAN } from '../engine/game.js';
import { ASSETS, GOODS, type Bundle, type GameState, type Good } from '../engine/types.js';
import { merchantNamed, parseTalk, type Intent, type Parsed } from '../talk/parse.js';
import { extractJson } from './parse.js';
import { ProviderError, UsageMeter, type ChatMessage, type LLMProvider } from './provider.js';
import { PLAYER_LANGUAGES, RULES, goodsLine, pricesLine } from './situation.js';

export interface Reading extends Parsed {
  source: 'llm' | 'rules';
  fallbackReason?: string;
}

export interface InterpretMeta {
  kind: 'interpret';
  state: GameState;
  text: string;
  stall?: string;
}

const FORMAT = `Reply with exactly one JSON object and nothing else:
{"to": "<merchant name, or empty to keep the open stall>", "intent": {"kind": "<kind>", ...}}
Kinds:
- "offer": {"give": {<what the player hands over now>}, "get": {<what the player receives now>}, "later": {"give": {...}, "get": {...}, "due": <day>}} (later is optional)
- "accept" (take the deal the merchant has on the table), "reject"
- "price": {"good": "<good>", "qty": <n>} (the player asks what the merchant wants for some of a good)
- "bid": {"good": "<good>", "qty": <n>} (the player asks what the merchant would pay for some of the player's good)
- "needs" (asks what the merchant is after), "news" (asks for rumours), "hello", "unknown"
Bundles use the keys salt, amber, dye, wool, spice, iron, coin with whole numbers. "give" and "get" are always from the player's side. Translate only what the player said; never improve the deal for either side.`;

export class LLMInterpreter {
  constructor(
    readonly provider: LLMProvider,
    readonly meter = new UsageMeter(),
    readonly maxRepairs = 1,
  ) {}

  async interpret(state: GameState, text: string, stall?: string): Promise<Reading> {
    const you = state.merchants.find((m) => m.id === HUMAN);
    const names = state.merchants.filter((m) => m.id !== HUMAN).map((m) => m.name);
    const system = `${RULES}\n\nYour job: read what the player says at a market stall and turn it into one intent.\n${FORMAT}\n${PLAYER_LANGUAGES}`;
    const context = [
      `Day ${state.day}. Prices: ${pricesLine(state)}.`,
      `Merchants: ${names.join(', ')}. The open stall is ${stall ? state.merchants.find((m) => m.id === stall)?.name : 'none'}.`,
      you ? `The player's stall: ${goodsLine(you)}, ${Math.floor(you.coin)} coin.` : '',
      stall && state.pending[stall] ? `On the table from that merchant: ${JSON.stringify(state.pending[stall])}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const messages: ChatMessage[] = [{ role: 'user', content: `${context}\n\nThe player says: "${text.replace(/"/g, "'")}"` }];
    let lastError = '';
    for (let attempt = 0; attempt <= this.maxRepairs; attempt++) {
      let reply: string;
      try {
        const res = await this.provider.complete({ system, messages, maxTokens: 400, meta: { kind: 'interpret', state, text, stall } satisfies InterpretMeta });
        this.meter.record(res);
        reply = res.text;
      } catch (err) {
        this.meter.failures++;
        return this.fallback(state, text, stall, err instanceof ProviderError ? err.message : String(err));
      }
      try {
        const parsed = readingFromRaw(state, extractJson(reply), stall);
        return { ...parsed, source: 'llm' };
      } catch (err) {
        lastError = (err as Error).message;
      }
      messages.push({ role: 'assistant', content: reply }, { role: 'user', content: `That reply had problems: ${lastError}. Reply again with the corrected JSON object only.` });
    }
    return this.fallback(state, text, stall, `model output was invalid: ${lastError}`);
  }

  private fallback(state: GameState, text: string, stall: string | undefined, reason: string): Reading {
    return { ...parseTalk(state, text, stall), source: 'rules', fallbackReason: reason };
  }
}

/** Check a model's intent JSON against the rules. Throws with a readable reason. */
export function readingFromRaw(state: GameState, raw: unknown, stall?: string): Parsed {
  if (!raw || typeof raw !== 'object') throw new Error('reply must be a JSON object');
  const o = raw as { to?: unknown; intent?: unknown };
  let to = stall;
  if (typeof o.to === 'string' && o.to.trim()) {
    const id = merchantNamed(state, o.to);
    if (!id) throw new Error(`no merchant called "${o.to}"`);
    to = id;
  }
  const i = o.intent as Record<string, unknown> | undefined;
  if (!i || typeof i !== 'object' || typeof i.kind !== 'string') throw new Error('missing "intent.kind"');
  return { to, intent: intentFromRaw(i) };
}

export function intentFromRaw(i: Record<string, unknown>): Intent {
  switch (i.kind) {
    case 'offer': {
      const give = bundle(i.give, 'give');
      const get = bundle(i.get, 'get');
      let later: Extract<Intent, { kind: 'offer' }>['later'];
      if (i.later && typeof i.later === 'object') {
        const l = i.later as Record<string, unknown>;
        const due = Number(l.due);
        if (!Number.isInteger(due)) throw new Error('later.due must be a day number');
        later = { give: bundle(l.give, 'later.give'), get: bundle(l.get, 'later.get'), due };
      }
      if (!Object.keys(give).length && !Object.keys(get).length && !later) throw new Error('the offer is empty');
      return { kind: 'offer', give, get, later };
    }
    case 'price':
    case 'bid': {
      const good = String(i.good ?? '').toLowerCase();
      if (!(GOODS as readonly string[]).includes(good)) throw new Error(`unknown good "${i.good}"`);
      const qty = i.qty === undefined ? 1 : Number(i.qty);
      if (!Number.isInteger(qty) || qty < 1) throw new Error('qty must be a whole number of at least 1');
      return { kind: i.kind, good: good as Good, qty };
    }
    case 'accept':
    case 'reject':
    case 'needs':
    case 'news':
    case 'hello':
      return { kind: i.kind };
    case 'unknown':
      return { kind: 'unknown', text: String(i.text ?? '') };
    default:
      throw new Error(`unknown intent kind "${i.kind}"`);
  }
}

function bundle(raw: unknown, label: string): Bundle {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} must be an object`);
  const out: Bundle = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(ASSETS as readonly string[]).includes(k)) throw new Error(`${label} has unknown good "${k}"`);
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw new Error(`${label}.${k} must be a whole number`);
    if (n) out[k as keyof Bundle] = n;
  }
  return out;
}
