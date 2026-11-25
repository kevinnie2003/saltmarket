import { describe, expect, it } from 'vitest';
import { ALWAYS_HONOR, HUMAN, advanceDay, createGame, executeOffer, merchant, offerProblems, scoreOf, standings } from '../src/engine/game.js';
import type { Brains } from '../src/engine/game.js';

const game = (seed = 1) => createGame({ seed });

describe('market engine', () => {
  it('starts every merchant with goods, coin and a contract', () => {
    const g = game();
    expect(g.merchants).toHaveLength(4);
    expect(g.merchants[0].id).toBe(HUMAN);
    for (const m of g.merchants) {
      expect(m.coin).toBe(40);
      expect(Object.keys(m.contract.needs).length).toBeGreaterThanOrEqual(2);
      expect(m.contract.reward).toBeGreaterThan(0);
      expect(m.opening).toBeGreaterThan(40);
    }
    expect(g.events).toHaveLength(g.days);
    expect(g.talksLeft).toBe(g.talkPerDay);
  });

  it('is the same game for the same seed', () => {
    expect(JSON.stringify(createGame({ seed: 'harbour' }))).toBe(JSON.stringify(createGame({ seed: 'harbour' })));
  });

  it('moves goods and coin when a deal goes through', () => {
    const g = game();
    const you = merchant(g, HUMAN);
    const them = g.merchants[1];
    const good = (Object.keys(them.goods) as (keyof typeof them.goods)[]).find((k) => them.goods[k] > 0)!;
    const before = { you: you.coin, theirs: them.goods[good] };
    executeOffer(g, { from: HUMAN, to: them.id, give: { coin: 5 }, get: { [good]: 1 } });
    expect(you.coin).toBe(before.you - 5);
    expect(them.goods[good]).toBe(before.theirs - 1);
    expect(g.trades).toHaveLength(1);
  });

  it('refuses deals nobody can pay for', () => {
    const g = game();
    expect(offerProblems(g, { from: HUMAN, to: 'm1', give: { coin: 500 }, get: {} })[0]).toMatch(/you don't have 500 coin/);
    expect(offerProblems(g, { from: HUMAN, to: 'm1', give: {}, get: {} })).toContain('the deal is empty');
    expect(offerProblems(g, { from: HUMAN, to: 'm1', give: { coin: 1 }, get: {}, later: { get: { coin: 2 }, due: 99 } })[0]).toMatch(/closes after day/);
    expect(offerProblems(g, { from: HUMAN, to: 'm1', give: { salt: 0.5 }, get: {} })[0]).toMatch(/whole units/);
  });

  it('settles a promise on its day, or records it broken and spreads the word', () => {
    const g = game(2);
    executeOffer(g, { from: HUMAN, to: 'm1', give: { coin: 1 }, get: {}, later: { get: { coin: 6 }, due: 2 } });
    const debtor = merchant(g, 'm1');
    const coinBefore = debtor.coin;
    advanceDay(g, ALWAYS_HONOR);
    expect(g.promises[0].status).toBe('kept');
    expect(debtor.coin).toBe(coinBefore - 6);

    const h = game(3);
    executeOffer(h, { from: HUMAN, to: 'm1', give: { coin: 1 }, get: {}, later: { get: { coin: 6 }, due: 2 } });
    const never: Brains = { honor: () => false };
    const bystander = merchant(h, 'm2');
    const before = bystander.trust.m1;
    advanceDay(h, never);
    expect(h.promises[0].status).toBe('broken');
    expect(merchant(h, HUMAN).trust.m1).toBeLessThan(0.3);
    expect(bystander.trust.m1).toBeLessThan(before);
    expect(h.log.some((l) => l.kind === 'broken')).toBe(true);
  });

  it('closes after the last day and ranks by profit', () => {
    const g = game();
    for (let i = 0; i < g.days; i++) advanceDay(g, ALWAYS_HONOR);
    expect(g.over).toBe(true);
    const s = standings(g);
    expect(s).toHaveLength(4);
    expect(s[0].profit).toBeGreaterThanOrEqual(s[3].profit);
    expect(g.log.at(-1)!.kind).toBe('close');
  });

  it('pays a contract only when every need is met', () => {
    const g = game();
    const you = merchant(g, HUMAN);
    expect(scoreOf(g, you).contractMet).toBe(Object.entries(you.contract.needs).every(([k, n]) => you.goods[k as 'salt'] >= (n as number)));
    for (const [k, n] of Object.entries(you.contract.needs)) you.goods[k as 'salt'] = n as number;
    const s = scoreOf(g, you);
    expect(s.contractMet).toBe(true);
    expect(s.reward).toBe(you.contract.reward);
  });

  it('applies the day\'s event to prices', () => {
    const g = game(4);
    const ev = g.events.find((e) => e.kind !== 'quiet' && e.day === 2) ?? g.events.find((e) => e.kind !== 'quiet')!;
    while (g.day < ev.day) advanceDay(g, ALWAYS_HONOR);
    const [good, mult] = Object.entries(ev.effect)[0] as [keyof typeof g.prices, number];
    if (mult > 1) expect(g.prices[good]).toBeGreaterThan(g.openingPrices[good] * 0.95);
    else expect(g.prices[good]).toBeLessThan(g.openingPrices[good] * 1.05);
  });
});
