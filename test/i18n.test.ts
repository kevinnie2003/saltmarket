import { describe, expect, it } from 'vitest';
import { HUMAN, describeBundle, describeOffer, merchant, offerProblems, standings } from '../src/engine/game.js';
import type { GameState } from '../src/engine/types.js';
import { endDay, newGame } from '../src/agents/session.js';
import { talk } from '../src/agents/talk.js';
import { PACKS } from '../src/agents/voice.js';
import { asLang, hasCjk } from '../src/i18n/lang.js';
import { spaceMixed } from '../src/i18n/spacing.js';
import { bundleText, num, signed } from '../src/i18n/words.js';
import { LLMMerchant } from '../src/llm/merchant.js';
import { MockLLMProvider } from '../src/llm/mock.js';
import { stallTalk } from '../src/llm/stall.js';
import { LLMInterpreter } from '../src/llm/interpreter.js';
import { playDay } from '../src/sim/bot.js';
import { parseTalk } from '../src/talk/parse.js';

/** Everything in a game that is a number or a choice, with the words left out. */
function numbers(g: GameState) {
  return {
    day: g.day,
    over: g.over,
    rng: g.rng,
    prices: g.prices,
    merchants: g.merchants.map((m) => ({ id: m.id, coin: m.coin, goods: m.goods, trust: m.trust, mood: m.mood, heard: m.heard, contract: m.contract.needs, reward: m.contract.reward })),
    promises: g.promises,
    trades: g.trades,
    pending: g.pending,
    rumors: g.rumors.map(({ text: _t, ...r }) => r),
    events: g.events.map(({ text: _t, ...e }) => e),
    log: g.log.map((l) => [l.day, l.kind, l.who, l.private]),
    standings: g.over ? standings(g).map((s) => [s.id, s.profit, s.contractMet]) : [],
  };
}

async function playOutWith(seed: number, lang: 'en' | 'zh') {
  const g = newGame({ seed, lang });
  while (!g.over) {
    await playDay(g, 'trader');
    endDay(g);
  }
  return g;
}

describe('one market, two languages', () => {
  it('voice packs hold the same number of lines everywhere, so the same line is picked', () => {
    for (const p of ['fair', 'hard', 'sly'] as const)
      for (const [moment, lines] of Object.entries(PACKS.en[p])) expect(PACKS.zh[p][moment as keyof typeof PACKS.en.fair].length, `${p}.${moment}`).toBe(lines.length);
  });

  it('plays out identically in English and Chinese from the same seed', async () => {
    for (const seed of [1, 5, 42, 2024]) {
      const en = await playOutWith(seed, 'en');
      const zh = await playOutWith(seed, 'zh');
      expect(numbers(zh)).toEqual(numbers(en));
      expect(en.trades.length).toBeGreaterThan(0);
      expect(en.log.some((l) => hasCjk(l.text))).toBe(false);
      expect(zh.log.filter((l) => l.kind !== 'say').every((l) => hasCjk(l.text))).toBe(true);
    }
  });

  it('gives the same outcomes for the same words typed in either language', () => {
    const en = newGame({ seed: 5, lang: 'en', talkPerDay: 20 });
    const zh = newGame({ seed: 5, lang: 'zh', talkPerDay: 20 });
    const said: [string, string][] = [
      ['Marta, what do you need?', '玛塔，你缺什么？'],
      ['10 coin for 2 wool', '10 个钱买 2 份羊毛'],
      ['any news?', '有什么消息？'],
      ['3 coin for 3 wool', '3 文换 3 捆羊毛'],
      ['how about 9', '9 怎么样'],
      ['deal', '成交'],
      ["give me 1 wool now and I'll pay you 8 coin tomorrow", '先给我 1 捆羊毛，明天付你 8 枚'],
      ['yes', '好'],
    ];
    for (const [a, b] of said) {
      const pa = parseTalk(en, a, 'm1');
      const pb = parseTalk(zh, b, 'm1');
      expect(pb, b).toEqual(pa);
      const ra = talk(en, pa.to!, pa.intent);
      const rb = talk(zh, pb.to!, pb.intent);
      expect(!!rb.traded, b).toBe(!!ra.traded);
      expect(rb.offer, b).toEqual(ra.offer);
      expect(hasCjk(rb.say), rb.say).toBe(true);
    }
    endDay(en);
    endDay(zh);
    expect(numbers(zh)).toEqual(numbers(en));
  });
});

describe('text in Chinese', () => {
  it('names goods, amounts and deals', () => {
    expect(bundleText({ wool: 2, salt: 3, coin: 10 }, 'zh')).toBe('3 袋盐、2 捆羊毛和 10 文');
    expect(describeBundle({ iron: 1 }, 'zh')).toBe('1 锭铁');
    expect(describeBundle({}, 'zh')).toBe('没什么');
    const g = newGame({ seed: 5, lang: 'zh' });
    expect(describeOffer(g, { from: 'm1', to: HUMAN, give: { wool: 2 }, get: { coin: 9 } }, '')).toBe('Pell Dorran 给出 2 捆羊毛，你给出 9 文');
    expect(offerProblems(g, { from: HUMAN, to: 'm1', give: { coin: 500 }, get: {} }, 'zh')[0]).toBe('你没有 500 文');
  });

  it('writes the day, events, rumours and replies in the game’s language', () => {
    const g = newGame({ seed: 5, lang: 'zh', talkPerDay: 20 });
    expect(g.log[0].text).toBe('第 1 天（共 8 天）。');
    const r = talk(g, 'm1', { kind: 'needs' });
    expect(hasCjk(r.say)).toBe(true);
    expect(g.log.at(-1)!.text.startsWith('Pell Dorran：')).toBe(true);
    endDay(g);
    expect(g.log.find((l) => l.kind === 'event' && l.day === 2)!.text).toMatch(/[一-鿿]/);
  });

  it('keeps old lines as written when the language changes, and writes new ones in the new language', () => {
    const g = newGame({ seed: 5, talkPerDay: 20 });
    talk(g, 'm1', { kind: 'hello' });
    const before = g.log.map((l) => l.text);
    g.lang = 'zh';
    talk(g, 'm1', { kind: 'needs' });
    expect(g.log.slice(0, before.length).map((l) => l.text)).toEqual(before);
    expect(hasCjk(g.log.at(-1)!.text)).toBe(true);
  });

  it('treats old saves without a language as English', () => {
    const g = newGame({ seed: 5 });
    delete (g as Partial<GameState>).lang;
    expect(asLang(g.lang)).toBe('en');
    expect(talk(g, 'm1', { kind: 'hello' }).say).not.toMatch(/[一-鿿]/);
  });

  it('spaces Chinese against Latin letters and figures, and uses a true minus', () => {
    expect(spaceMixed('Marta Vey说：给你10文')).toBe('Marta Vey 说：给你 10 文');
    expect(num(-3)).toBe('−3');
    expect(signed(4)).toBe('+4');
    expect(signed(-4)).toBe('−4');
  });
});

describe('the model path in Chinese', () => {
  it('tells the model which language to speak, and the stand-in answers in it', async () => {
    const g = newGame({ seed: 5, lang: 'zh', talkPerDay: 20 });
    const seen: string[] = [];
    const mock = new MockLLMProvider();
    const spy = { name: 'spy', complete: (req: Parameters<MockLLMProvider['complete']>[0]) => (seen.push(req.system), mock.complete(req)) };
    const r = await stallTalk(g, '玛塔，你缺什么？', 'm1', { interpreter: new LLMInterpreter(spy), merchant: new LLMMerchant(spy) });
    expect(r.to).toBe('m2');
    expect(r.readBy).toBe('llm');
    expect(r.answeredBy).toBe('llm');
    expect(hasCjk(r.say)).toBe(true);
    expect(seen.some((s) => /Simplified Chinese/.test(s))).toBe(true);
    expect(merchant(g, 'm2').name).toBe('Marta Vey');
  });
});
