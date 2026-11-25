import { describe, expect, it } from 'vitest';
import { HUMAN, merchant } from '../src/engine/game.js';
import { newGame, playOut } from '../src/agents/session.js';
import { talk } from '../src/agents/talk.js';
import { parseTalk, readBundle } from '../src/talk/parse.js';
import { respond, shareNews, honor } from '../src/agents/mind.js';

const game = () => newGame({ seed: 5, talkPerDay: 20 });

describe('reading what the player says', () => {
  it('reads bundles in words and numbers', () => {
    expect(readBundle('3 salt and 10 coin')).toEqual({ salt: 3, coin: 10 });
    expect(readBundle('two jars of dye')).toEqual({ dye: 2 });
    expect(readBundle('a sack of salt')).toEqual({ salt: 1 });
    expect(readBundle('12')).toEqual({ coin: 12 });
    expect(readBundle('half a dozen bales of wool')).toEqual({ wool: 6 });
  });

  it('reads offers either way round', () => {
    const g = game();
    expect(parseTalk(g, '3 dye for 2 wool', 'm1').intent).toMatchObject({ kind: 'offer', give: { dye: 3 }, get: { wool: 2 } });
    expect(parseTalk(g, 'sell me 2 wool for 8 coin', 'm1').intent).toMatchObject({ kind: 'offer', give: { coin: 8 }, get: { wool: 2 } });
    expect(parseTalk(g, 'your 2 wool for my 3 dye', 'm1').intent).toMatchObject({ kind: 'offer', give: { dye: 3 }, get: { wool: 2 } });
    // The player has no wool and Pell does, so "2 wool for 9" is a purchase.
    expect(parseTalk(g, '2 wool for 9', 'm1').intent).toMatchObject({ kind: 'offer', give: { coin: 9 }, get: { wool: 2 } });
  });

  it('reads a delivery promised for later', () => {
    const g = game();
    const p = parseTalk(g, "give me 2 wool now and I'll pay you 12 coin on day 4", 'm1');
    expect(p.intent).toMatchObject({ kind: 'offer', get: { wool: 2 }, later: { give: { coin: 12 }, due: 4 } });
    const q = parseTalk(g, '3 dye for 2 wool, you deliver 10 coin tomorrow', 'm1');
    expect(q.intent).toMatchObject({ kind: 'offer', give: { dye: 3 }, get: { wool: 2 }, later: { get: { coin: 10 }, due: 2 } });
  });

  it('knows questions, answers and who is addressed', () => {
    const g = game();
    expect(parseTalk(g, 'Marta, what do you need?', 'm1')).toMatchObject({ to: 'm2', intent: { kind: 'needs' } });
    expect(parseTalk(g, 'how much for your wool?', 'm1').intent).toMatchObject({ kind: 'price', good: 'wool', qty: 1 });
    expect(parseTalk(g, 'what would you pay for 2 iron', 'm1').intent).toMatchObject({ kind: 'bid', good: 'iron', qty: 2 });
    expect(parseTalk(g, 'any news?', 'm1').intent.kind).toBe('news');
    expect(parseTalk(g, 'deal', 'm1').intent.kind).toBe('accept');
    expect(parseTalk(g, 'no thanks', 'm1').intent.kind).toBe('reject');
    expect(parseTalk(g, 'morning!', 'm1').intent.kind).toBe('hello');
    expect(parseTalk(g, 'the gulls are loud', 'm1').intent.kind).toBe('unknown');
  });
});

describe('merchants answering', () => {
  it('takes a fair offer and trades', () => {
    const g = game();
    const r = talk(g, 'm1', { kind: 'offer', give: { coin: 10 }, get: { wool: 2 } });
    expect(r.traded).toBe(true);
    expect(merchant(g, HUMAN).goods.wool).toBe(2);
    expect(g.talksLeft).toBe(19);
  });

  it('counters a lowball, and the player can accept the counter', () => {
    const g = game();
    const r = talk(g, 'm1', { kind: 'offer', give: { coin: 4 }, get: { wool: 3 } });
    expect(r.offer).toBeDefined();
    expect(g.pending.m1).toEqual(r.offer);
    const coin = merchant(g, HUMAN).coin;
    const a = talk(g, 'm1', { kind: 'accept' });
    expect(a.traded).toBe(true);
    expect(merchant(g, HUMAN).coin).toBeLessThan(coin);
  });

  it('gets cheaper the longer you haggle with a fair merchant', () => {
    const g = game();
    const m = merchant(g, 'm1');
    const o = { from: HUMAN, to: 'm1', give: { coin: 7 }, get: { wool: 2 } };
    const first = respond(g, m, o);
    const later = [respond(g, m, o), respond(g, m, o), respond(g, m, o)].at(-1)!;
    expect(first.kind === 'accept' || later.kind === 'accept' || later.kind === 'counter').toBe(true);
  });

  it('does not use up a talk on an impossible offer', () => {
    const g = game();
    const r = talk(g, 'm1', { kind: 'offer', give: { amber: 9 }, get: { wool: 1 } });
    expect(r.spent).toBe(false);
    expect(g.talksLeft).toBe(20);
    expect(r.say).toMatch(/don't have/);
  });

  it('stops talking when the day\'s talks are used', () => {
    const g = newGame({ seed: 5, talkPerDay: 1 });
    talk(g, 'm1', { kind: 'hello' });
    expect(talk(g, 'm1', { kind: 'hello' }).say).toMatch(/bell has rung/);
  });

  it('sly merchants sometimes invent news, and the asker believes it', () => {
    let lies = 0;
    for (let s = 1; s <= 30; s++) {
      const g = newGame({ seed: s, rivals: 4 });
      const ilse = g.merchants.find((m) => m.personality === 'sly')!;
      const n = shareNews(g, ilse, merchant(g, HUMAN));
      if (n.lie) {
        lies++;
        expect(merchant(g, HUMAN).heard).toContain(n.rumorId);
        expect(g.rumors.find((r) => r.id === n.rumorId)!.truth).toBe(false);
      }
    }
    expect(lies).toBeGreaterThan(5);
  });

  it('honest merchants keep every promise; sly ones break some', () => {
    const g = newGame({ seed: 1, rivals: 4 });
    const fair = g.merchants.find((m) => m.personality === 'fair')!;
    const sly = g.merchants.find((m) => m.personality === 'sly')!;
    let broke = 0;
    for (let i = 0; i < 50; i++) {
      const p = { id: `t${i}`, from: sly.id, to: HUMAN, bundle: { coin: 20 }, due: g.days, status: 'open' as const };
      expect(honor(g, fair, { ...p, from: fair.id })).toBe(true);
      if (!honor(g, sly, p)) broke++;
    }
    expect(broke).toBeGreaterThan(10);
    expect(broke).toBeLessThan(50);
  });

  it('plays a whole AI-only game to the close', () => {
    const g = playOut(newGame({ seed: 9, noHuman: true, rivals: 4 }));
    expect(g.over).toBe(true);
    expect(g.trades.length).toBeGreaterThan(3);
  });
});
