import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { newGame } from '../src/agents/session.js';
import { startServer, stateFrom } from '../src/server/server.js';

describe('local server', () => {
  it('checks the shape of the state it is sent', () => {
    const g = newGame({ seed: 1 });
    expect(stateFrom(JSON.parse(JSON.stringify(g))).day).toBe(1);
    expect(() => stateFrom({ ...g, version: 2 })).toThrow(/bad state/);
    expect(() => stateFrom({ ...g, merchants: [] })).toThrow(/bad merchants/);
    const bad = structuredClone(g);
    bad.merchants[1].goods.salt = -3;
    expect(() => stateFrom(bad)).toThrow(/bad goods/);
  });

  it('answers health and a talk request with the new state', async () => {
    const server = startServer(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const h = await (await fetch(`${base}/api/health`)).json();
      expect(h.providers).toContain('mock');
      const g = newGame({ seed: 5 });
      const res = await fetch(`${base}/api/talk`, { method: 'POST', body: JSON.stringify({ state: g, text: 'Pell, 10 coin for 2 wool', provider: 'mock' }) });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.reply.traded).toBe(true);
      expect(body.state.merchants[0].goods.wool).toBe(2);
      const nope = await fetch(`${base}/api/talk`, { method: 'POST', body: JSON.stringify({ state: g, text: 'hi', provider: 'anthropic' }) });
      if (!process.env.ANTHROPIC_API_KEY) expect(nope.status).toBe(400);
      const junk = await fetch(`${base}/api/talk`, { method: 'POST', body: '{"state": 3}' });
      expect(junk.status).toBe(400);
    } finally {
      server.close();
    }
  });
});
