import { describe, expect, it } from 'vitest';
import { HUMAN, merchant } from '../src/engine/game.js';
import { newGame } from '../src/agents/session.js';
import { LLMInterpreter, readingFromRaw } from '../src/llm/interpreter.js';
import { LLMMerchant } from '../src/llm/merchant.js';
import { MockLLMProvider } from '../src/llm/mock.js';
import { extractJson } from '../src/llm/parse.js';
import type { CompletionRequest, LLMProvider } from '../src/llm/provider.js';
import { ProviderError } from '../src/llm/provider.js';
import { stallTalk } from '../src/llm/stall.js';

class Scripted implements LLMProvider {
  readonly name = 'scripted';
  calls: CompletionRequest[] = [];
  constructor(private replies: (string | Error)[]) {}
  async complete(req: CompletionRequest) {
    this.calls.push(structuredClone({ system: req.system, messages: req.messages, maxTokens: req.maxTokens }));
    const r = this.replies.shift() ?? '{}';
    if (r instanceof Error) throw r;
    return { text: r, usage: { inputTokens: 10, outputTokens: 5 } };
  }
}

const game = () => newGame({ seed: 5, talkPerDay: 20 });

describe('LLM interpreter', () => {
  it('accepts a valid intent and maps merchant names', () => {
    const g = game();
    expect(readingFromRaw(g, { to: 'Marta', intent: { kind: 'offer', give: { coin: 10 }, get: { wool: 2 } } }, 'm1')).toEqual({
      to: 'm2',
      intent: { kind: 'offer', give: { coin: 10 }, get: { wool: 2 }, later: undefined },
    });
    expect(() => readingFromRaw(g, { intent: { kind: 'offer', give: { gold: 3 } } })).toThrow(/unknown good/);
    expect(() => readingFromRaw(g, { to: 'Zed', intent: { kind: 'hello' } })).toThrow(/no merchant/);
  });

  it('repairs once, then falls back to the rules', async () => {
    const g = game();
    const p = new Scripted(['not json', '{"intent": {"kind": "price", "good": "wool"}}']);
    const r = await new LLMInterpreter(p).interpret(g, 'how much is your wool', 'm1');
    expect(r.source).toBe('llm');
    expect(r.intent).toEqual({ kind: 'price', good: 'wool', qty: 1 });
    expect(p.calls[1].messages.at(-1)!.content).toMatch(/had problems/);

    const bad = new Scripted(['nope', 'still nope']);
    const f = await new LLMInterpreter(bad).interpret(g, 'how much is your wool', 'm1');
    expect(f.source).toBe('rules');
    expect(f.intent.kind).toBe('price');
    const down = await new LLMInterpreter(new Scripted([new ProviderError('rate limited', true)])).interpret(g, 'any news', 'm1');
    expect(down.fallbackReason).toBe('rate limited');
  });
});

describe('LLM merchant', () => {
  it('can accept a good deal and speaks in its own words', async () => {
    const g = game();
    const p = new Scripted(['{"say": "Lovely, done.", "decision": "accept"}']);
    const r = await new LLMMerchant(p).reply(g, 'm1', { kind: 'offer', give: { coin: 10 }, get: { wool: 2 } }, '10 coin for 2 wool');
    expect(r.source).toBe('llm');
    expect(r.traded).toBe(true);
    expect(merchant(g, HUMAN).goods.wool).toBe(2);
    expect(g.log.at(-1)!.text).toBe('Pell Dorran: Lovely, done.');
    expect(p.calls[0].messages[0].content).toMatch(/changes your worth by/);
  });

  it('is not allowed to accept a deal that loses it value', async () => {
    const g = game();
    const p = new Scripted(['{"say": "Sure!", "decision": "accept"}', '{"say": "Not for that.", "decision": "reject"}']);
    const r = await new LLMMerchant(p).reply(g, 'm1', { kind: 'offer', give: { coin: 1 }, get: { wool: 5 } }, '1 coin for 5 wool');
    expect(r.traded).toBeFalsy();
    expect(p.calls[1].messages.at(-1)!.content).toMatch(/worse off/);
    expect(merchant(g, HUMAN).goods.wool).toBe(0);
    expect(g.talksLeft).toBe(19);
  });

  it('puts a legal counter on the table', async () => {
    const g = game();
    const p = new Scripted(['{"say": "Two wool for 14.", "decision": "counter", "counter": {"i_give": {"wool": 2}, "you_give": {"coin": 14}}}']);
    const r = await new LLMMerchant(p).reply(g, 'm1', { kind: 'offer', give: { coin: 3 }, get: { wool: 2 } }, '3 coin for 2 wool');
    expect(r.offer).toEqual({ from: 'm1', to: HUMAN, give: { wool: 2 }, get: { coin: 14 } });
    expect(g.pending.m1).toEqual(r.offer);
    expect(merchant(g, 'm1').haggle[HUMAN]).toBe(1);
  });

  it('keeps the built-in facts for questions but uses the model\'s voice', async () => {
    const g = game();
    const p = new Scripted(['{"say": "Wool, friend? Six coin a bale.", "decision": "talk"}']);
    const r = await new LLMMerchant(p).reply(g, 'm1', { kind: 'price', good: 'wool', qty: 1 }, 'how much for wool');
    expect(r.say).toMatch(/Six coin/);
    expect(r.offer).toMatchObject({ give: { wool: 1 } });
    expect(g.pending.m1).toEqual(r.offer);
  });

  it('falls back to the built-in merchant when the model fails', async () => {
    const g = game();
    const r = await new LLMMerchant(new Scripted([new ProviderError('down', true)])).reply(g, 'm1', { kind: 'hello' }, 'hi');
    expect(r.source).toBe('rules');
    expect(r.fallbackReason).toBe('down');
    expect(r.say.length).toBeGreaterThan(3);
  });
});

describe('mock provider and the stall pipeline', () => {
  it('runs a whole exchange offline through both model steps', async () => {
    const g = game();
    const mock = new MockLLMProvider();
    const r = await stallTalk(g, 'Pell, 10 coin for 2 wool', undefined, { interpreter: new LLMInterpreter(mock), merchant: new LLMMerchant(mock) });
    expect(r.readBy).toBe('llm');
    expect(r.answeredBy).toBe('llm');
    expect(r.to).toBe('m1');
    expect(r.traded).toBe(true);
  });

  it('survives a noisy model without breaking a rule', async () => {
    const mock = new MockLLMProvider(0.4, 3);
    for (let s = 1; s <= 10; s++) {
      const g = newGame({ seed: s, talkPerDay: 20 });
      for (const t of ['hello', '3 coin for 1 wool', 'deal', 'how much for amber', 'any news?', 'what do you need?']) {
        await stallTalk(g, t, 'm1', { interpreter: new LLMInterpreter(mock), merchant: new LLMMerchant(mock) });
      }
      for (const m of g.merchants) {
        expect(m.coin).toBeGreaterThanOrEqual(0);
        for (const n of Object.values(m.goods)) expect(n).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('extracts JSON from fenced replies', () => {
    expect(extractJson('Here:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });
});
