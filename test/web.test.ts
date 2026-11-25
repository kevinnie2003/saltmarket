// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { startServer } from '../src/server/server.js';

const html = readFileSync(resolve(__dirname, '../src/web/index.html'), 'utf8');

async function boot() {
  document.documentElement.innerHTML = html.replace(/<!doctype html>/i, '');
  localStorage.clear();
  vi.resetModules();
  return (await import('../src/web/main.js')) as typeof import('../src/web/main.js');
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const until = async (cond: () => boolean, ms = 5000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const type = (text: string) => {
  const ta = $<HTMLTextAreaElement>('input');
  ta.value = text;
  ta.dispatchEvent(new Event('input'));
};
const enter = () => $('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

describe('web client', () => {
  it('opens a stall with three rivals, prices and a contract', async () => {
    await boot();
    $<HTMLInputElement>('seed').value = 'quay';
    $('start').click();
    expect($('game').classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('#stalls .stall')).toHaveLength(3);
    expect(document.querySelectorAll('#prices tbody tr')).toHaveLength(6);
    expect($('contract').textContent).toMatch(/Pays \d+ coin/);
    expect($('dayline').textContent).toBe('Day 1 of 8');
    expect($('talks').textContent).toMatch(/6 of 6/);
  });

  it('previews what a line means, then trades and shows it in the conversation', async () => {
    const web = await boot();
    $<HTMLInputElement>('seed').value = '5';
    $('start').click();
    const ui = web.getUI();
    const stall = ui.state!.merchants.find((m) => m.name === 'Pell Dorran')!;
    (document.querySelector(`[data-stall=${stall.id}]`) as HTMLElement).click();
    type('10 coin for 2 wool');
    expect($('preview').textContent).toBe('Offer: you give 10 coin, you get 2 wool');
    const wool = ui.state!.merchants[0].goods.wool;
    enter();
    await until(() => ui.state!.trades.length > 0);
    const lines = [...document.querySelectorAll('#convo li')].map((l) => l.className);
    expect(lines.at(-2)).toMatch(/me/);
    expect(lines.at(-1)).toMatch(/them/);
    expect($('mygoods').textContent).toContain(`wool${wool + 2}`);
    expect($('talks').textContent).toMatch(/5 of 6/);
    expect($('market').textContent).toMatch(/trade/);
  });

  it('shows a counter on the table and accepts it with the button', async () => {
    const web = await boot();
    $<HTMLInputElement>('seed').value = '5';
    $('start').click();
    const ui = web.getUI();
    const id = ui.state!.merchants.find((m) => m.name === 'Pell Dorran')!.id;
    (document.querySelector(`[data-stall=${id}]`) as HTMLElement).click();
    type('3 coin for 3 wool');
    $('send').click();
    await until(() => !$('table').classList.contains('hidden'));
    expect($('table').textContent).toMatch(/On the table: you give/);
    expect($('table').textContent).toMatch(/By your books/);
    const coin = ui.state!.merchants[0].coin;
    ($('accept') as HTMLButtonElement).click();
    await until(() => ui.state!.trades.length > 0);
    expect(ui.state!.merchants[0].coin).toBeLessThan(coin);
    expect($('table').classList.contains('hidden')).toBe(true);
  });

  it('uses the quick questions and says when it does not understand', async () => {
    const web = await boot();
    $('start').click();
    const chips = [...document.querySelectorAll('#chips .chip')] as HTMLElement[];
    expect(chips.map((c) => c.textContent)).toContain('Any news?');
    chips.find((c) => c.textContent === 'Any news?')!.click();
    await until(() => web.getUI().state!.talksLeft === 5, 1000).catch(() => {
      throw new Error(`talks ${web.getUI().state!.talksLeft}, preview ${$('preview').textContent}, convo ${$('convo').textContent}`);
    });
    type('the gulls are loud');
    enter();
    await until(() => /didn’t follow/.test($('preview').textContent ?? ''));
    expect(web.getUI().state!.talksLeft).toBe(5);
  });

  it('ends days through to the close and shows the standings', async () => {
    const web = await boot();
    ($<HTMLSelectElement>('days')).value = '6';
    $('start').click();
    for (let i = 0; i < 5; i++) $('endday').click();
    expect($('endday').textContent).toBe('Close the market');
    $('endday').click();
    expect($('result').classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('.standings tbody tr')).toHaveLength(4);
    expect($('result').textContent).toMatch(/You finished/);
    $('sameseed').click();
    expect(web.getUI().state!.day).toBe(1);
  });

  it('saves the game so it can be continued', async () => {
    await boot();
    $<HTMLInputElement>('seed').value = 'keep';
    $('start').click();
    $('endday').click();
    vi.resetModules();
    document.documentElement.innerHTML = html.replace(/<!doctype html>/i, '');
    const again = (await import('../src/web/main.js')) as typeof import('../src/web/main.js');
    expect($('continue').classList.contains('hidden')).toBe(false);
    $('continue').click();
    expect(again.getUI().state!.day).toBe(2);
  });

  it('lets you watch the merchants trade alone', async () => {
    await boot();
    $('watch').click();
    expect(document.querySelectorAll('.standings tbody tr')).toHaveLength(4);
    expect($('result').textContent).toMatch(/traded on their own/);
  });

  it('talks through the local server when a model is picked', async () => {
    const server = startServer(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const realFetch = globalThis.fetch;
    try {
      vi.stubGlobal('fetch', (path: string, init?: RequestInit) => realFetch(base + path, init));
      const web = await boot();
      $<HTMLInputElement>('seed').value = '5';
      $('start').click();
      const sel = $<HTMLSelectElement>('voice');
      sel.add(new Option('mock', 'mock'));
      sel.value = 'mock';
      sel.dispatchEvent(new Event('change'));
      const ui = web.getUI();
      const id = ui.state!.merchants.find((m) => m.name === 'Pell Dorran')!.id;
      (document.querySelector(`[data-stall=${id}]`) as HTMLElement).click();
      const wool = ui.state!.merchants[0].goods.wool;
      type('10 coin for 2 wool');
      enter();
      await until(() => web.getUI().state!.trades.length > 0);
      expect(web.getUI().state!.merchants[0].goods.wool).toBe(wool + 2);
      expect([...document.querySelectorAll('#convo li.me')].length).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      server.close();
    }
  });
});

describe('promises the player makes', () => {
  it('can be broken on purpose, and the merchant remembers', async () => {
    const web = await boot();
    $<HTMLInputElement>('seed').value = '5';
    $('start').click();
    const ui = web.getUI();
    const pell = ui.state!.merchants.find((m) => m.name === 'Pell Dorran')!;
    (document.querySelector(`[data-stall=${pell.id}]`) as HTMLElement).click();
    type("give me 1 wool now and I'll pay you 8 coin tomorrow");
    enter();
    await until(() => ui.state!.promises.length > 0 || !$('table').classList.contains('hidden'));
    if (!ui.state!.promises.length) ($('accept') as HTMLButtonElement).click();
    await until(() => ui.state!.promises.length > 0);
    const box = document.querySelector('#promises input[data-promise]') as HTMLInputElement;
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    $('endday').click();
    const p = ui.state!.promises[0];
    expect(p.status).toBe('broken');
    expect(ui.state!.merchants.find((m) => m.id === pell.id)!.trust.you).toBeLessThan(0.3);
    expect($('stalls').textContent).toMatch(/doesn.t trust you/);
  });
});
