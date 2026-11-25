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
    expect($('table').getAttribute('aria-label')).toMatch(/On the table: you give/);
    expect($('table').textContent).toMatch(/You give/);
    expect($('table').textContent).toMatch(/You receive/);
    expect($('table').textContent).toMatch(/by your books/);
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
    expect($('result').textContent).toMatch(/no deals this market/);
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

describe('morning view', () => {
  it('shows what happened at dusk and where to find what you need', async () => {
    await boot();
    $<HTMLInputElement>('seed').value = '11';
    $('start').click();
    expect($('contract').textContent).toMatch(/On the quay: |Nobody has any/);
    let tries = 0;
    while (!$('recap').textContent && tries++ < 6) $('endday').click();
    expect($('recap').textContent).toMatch(/Since yesterday/);
  });

  it('values your own deals at closing prices', async () => {
    const web = await boot();
    $('start').click();
    const st = web.getUI().state!;
    const rival = st.merchants.find((m) => m.id !== 'you')!;
    st.prices.salt = 5;
    st.trades.push({ day: 2, offer: { from: rival.id, to: 'you', give: { salt: 4 }, get: { coin: 12 } } });
    st.trades.push({ day: 3, offer: { from: 'you', to: rival.id, give: { coin: 30 }, get: { salt: 2 } } });
    const html = web.ledgerHtml(st);
    const box = document.createElement('div');
    box.innerHTML = html;
    const rows = [...box.querySelectorAll('.ledger tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('+8');
    expect(rows[0].classList.contains('best')).toBe(true);
    expect(rows[1].textContent).toContain('−20');
    expect(rows[1].textContent).toContain(rival.name);
  });
});

describe('two languages', () => {
  const zhOn = () => (document.querySelector('.lang button[data-lang="zh"]') as HTMLButtonElement).click();
  const enOn = () => (document.querySelector('.lang button[data-lang="en"]') as HTMLButtonElement).click();

  it('starts in the language of the address, then storage, then the browser', async () => {
    history.replaceState(null, '', '?lang=zh');
    await boot();
    expect(document.documentElement.lang).toBe('zh-CN');
    expect($('start').textContent).toBe('摆开你的摊位');
    expect($('seed').getAttribute('placeholder')).toBe('随机');
    history.replaceState(null, '', '/');
    localStorage.setItem('saltmarket.lang', 'zh');
    vi.resetModules();
    document.documentElement.innerHTML = html.replace(/<!doctype html>/i, '');
    await import('../src/web/main.js');
    expect($('start').textContent).toBe('摆开你的摊位');
    localStorage.clear();
    const lang = vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-TW');
    vi.resetModules();
    document.documentElement.innerHTML = html.replace(/<!doctype html>/i, '');
    await import('../src/web/main.js');
    expect($('start').textContent).toBe('摆开你的摊位');
    lang.mockRestore();
    await boot();
    expect($('start').textContent).toBe('Open your stall');
  });

  it('switches every live part at once and keeps written lines as they were', async () => {
    const web = await boot();
    $<HTMLInputElement>('seed').value = '5';
    $('start').click();
    const ui = web.getUI();
    const pell = ui.state!.merchants.find((m) => m.name === 'Pell Dorran')!;
    (document.querySelector(`[data-stall=${pell.id}]`) as HTMLElement).click();
    type('3 coin for 3 wool');
    enter();
    await until(() => !$('table').classList.contains('hidden'));
    const lines = () => [...document.querySelectorAll('#convo .line')].map((l) => l.textContent);
    const before = lines();
    zhOn();
    expect(localStorage.getItem('saltmarket.lang')).toBe('zh');
    expect(ui.state!.lang).toBe('zh');
    expect(document.querySelector('.lang button[data-lang="zh"]')!.getAttribute('aria-pressed')).toBe('true');
    expect($('dayline').textContent).toBe('第 1 天（共 8 天）');
    expect($('table').textContent).toMatch(/你付出/);
    expect($('table').textContent).toMatch(/接受/);
    expect($('prices').textContent).toMatch(/羊毛/);
    expect($('contract').textContent).toMatch(/收市时货齐/);
    expect($('stallhead').textContent).toMatch(/河驳船/);
    expect($('talks').textContent).toMatch(/今天还能谈/);
    expect($('endday').textContent).toBe('结束这一天');
    expect(lines()).toEqual(before);
    type('不要');
    expect($('preview').textContent).toBe('拒绝桌上的买卖');
    enter();
    await until(() => $('table').classList.contains('hidden'));
    expect($('convo').textContent).toMatch(/不要/);
    expect([...document.querySelectorAll('#convo li.them')].at(-1)!.textContent).toMatch(/[一-鿿]/);
    enOn();
    expect($('dayline').textContent).toBe('Day 1 of 8');
    expect([...document.querySelectorAll('#convo li.them')].at(-1)!.textContent).toMatch(/[一-鿿]/);
  });

  it('plays a deal typed in Chinese, with Chinese chips and preview', async () => {
    history.replaceState(null, '', '?lang=zh');
    const web = await boot();
    history.replaceState(null, '', '/');
    $<HTMLInputElement>('seed').value = '5';
    $('start').click();
    const ui = web.getUI();
    expect(ui.state!.lang).toBe('zh');
    expect(ui.state!.log[0].text).toBe('第 1 天（共 8 天）。');
    const chips = [...document.querySelectorAll('#chips .chip')].map((c) => c.textContent);
    expect(chips).toContain('有什么消息？');
    const pell = ui.state!.merchants.find((m) => m.name === 'Pell Dorran')!;
    (document.querySelector(`[data-stall=${pell.id}]`) as HTMLElement).click();
    type('10 个钱买 2 份羊毛');
    expect($('preview').textContent).toBe('出价：你付出 10 文，你得到 2 捆羊毛');
    const wool = ui.state!.merchants[0].goods.wool;
    enter();
    await until(() => ui.state!.trades.length > 0);
    expect(ui.state!.merchants[0].goods.wool).toBe(wool + 2);
    expect($('market').textContent).toMatch(/成交/);
    type('海鸥真吵');
    enter();
    await until(() => /没听明白/.test($('preview').textContent ?? ''));
    for (let i = 0; i < 7; i++) $('endday').click();
    $('endday').click();
    expect($('result').textContent).toMatch(/你排在|你在码头上拔得头筹/);
    expect($('result').textContent).toMatch(/你的买卖/);
  });
});
