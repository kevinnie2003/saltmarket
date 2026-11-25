import { Rng } from '../engine/rng.js';
import { parseTalk } from '../talk/parse.js';
import type { InterpretMeta } from './interpreter.js';
import { counterJson, type MerchantMeta } from './merchant.js';
import type { CompletionRequest, CompletionResult, LLMProvider } from './provider.js';

/**
 * An offline stand-in for a model that speaks the same JSON protocols, so the
 * whole LLM path (prompts, parsing, validation, repair, fallback) runs and is
 * tested without a key. Its brain is the rule parser and the built-in
 * merchant. `noise` makes it send broken or rule-breaking replies sometimes.
 */
export class MockLLMProvider implements LLMProvider {
  readonly name = 'mock';
  private rng: Rng;

  constructor(
    readonly noise = 0,
    seed = 1,
  ) {
    this.rng = new Rng(seed);
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const usage = { inputTokens: Math.round((req.system.length + req.messages.reduce((a, m) => a + m.content.length, 0)) / 4), outputTokens: 50 };
    if (this.noise && this.rng.chance(this.noise)) {
      const bad = this.rng.pick([
        'Sure thing!',
        '{"to": "Captain Nobody", "intent": {"kind": "offer"}}',
        '{"say": "Done!", "decision": "accept"}',
        '{"say": "Have it all for free.", "decision": "counter", "counter": {"i_give": {"amber": 99}, "you_give": {}}}',
        '{"intent": {"kind": "teleport"}}',
      ]);
      return { text: bad, usage };
    }
    const meta = req.meta as InterpretMeta | MerchantMeta | undefined;
    if (meta?.kind === 'interpret') {
      const p = parseTalk(meta.state, meta.text, meta.stall);
      const name = p.to ? meta.state.merchants.find((m) => m.id === p.to)?.name ?? '' : '';
      return { text: JSON.stringify({ to: name, intent: p.intent }), usage };
    }
    if (meta?.kind === 'merchant') {
      const a = meta.advice;
      const decision = a.traded ? 'accept' : a.offer && (meta.intent.kind === 'offer' || meta.intent.kind === 'accept') ? 'counter' : meta.intent.kind === 'offer' ? 'reject' : 'talk';
      const out: Record<string, unknown> = { say: a.say, decision };
      if (decision === 'counter' && a.offer) out.counter = counterJson(a.offer);
      return { text: JSON.stringify(out), usage };
    }
    return { text: '{}', usage };
  }
}
