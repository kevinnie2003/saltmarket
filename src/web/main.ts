// Browser client. The whole game lives in the page; a local server is only
// used when the player picks a model to play the merchants.
import { HUMAN, describeBundle, flip, fmtCoin, isEmpty, marketValue, merchant, offerProblems, scoreOf, signed, standings } from '../engine/game.js';
import { GOOD_INFO } from '../engine/market.js';
import { GOODS, type GameState, type Good, type LogEntry, type Merchant, type Offer } from '../engine/types.js';
import { endDay, newGame, playOut, rivals } from '../agents/session.js';
import { talk } from '../agents/talk.js';
import { gain } from '../agents/value.js';
import { parseTalk, type Intent } from '../talk/parse.js';

const SAVE_KEY = 'saltmarket.save.v1';

interface UI {
  state: GameState | null;
  stall: string | null;
  voice: string;
  busy: boolean;
  /** Log length when the day started, to show what happened since. */
  seen: number;
  /** What happened at dusk and overnight, shown the next morning. */
  recap: LogEntry[];
}

const ui: UI = { state: null, stall: null, voice: 'local', busy: false, seen: 0, recap: [] };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ---------- setup ----------

export function setupScreen(): void {
  $('setup').classList.remove('hidden');
  $('game').classList.add('hidden');
  $('result').classList.add('hidden');
  $('dayline').textContent = '';
  const saved = loadSaved();
  $('continue').classList.toggle('hidden', !saved || saved.over);
}

export function start(opts: { seed?: string; days?: number; watch?: boolean } = {}): GameState {
  const seed = opts.seed?.trim() ? opts.seed.trim() : String(Math.floor(Math.random() * 1e9));
  const state = newGame({ seed, days: opts.days ?? 8, noHuman: opts.watch, rivals: opts.watch ? 4 : 3 });
  if (opts.watch) {
    playOut(state);
    ui.state = state;
    showResult();
    return state;
  }
  begin(state);
  return state;
}

function begin(state: GameState): void {
  ui.state = state;
  ui.stall = ui.stall && state.merchants.some((m) => m.id === ui.stall) ? ui.stall : rivals(state)[0]?.id ?? null;
  ui.seen = state.log.length;
  ui.recap = [];
  $('setup').classList.add('hidden');
  $('result').classList.add('hidden');
  $('game').classList.remove('hidden');
  render();
}

// ---------- rendering ----------

export function render(): void {
  const s = ui.state;
  if (!s) return;
  save();
  $('dayline').textContent = s.over ? 'The market has closed' : `Day ${s.day} of ${s.days}`;
  renderPrices(s);
  renderToday(s);
  renderMarket(s);
  renderStalls(s);
  renderStall(s);
  renderYou(s);
  updatePreview();
}

function renderPrices(s: GameState): void {
  const rows = GOODS.map((g) => {
    const p = s.prices[g];
    const d = p - s.openingPrices[g];
    const cls = d > 0.4 ? 'up' : d < -0.4 ? 'down' : '';
    const arrow = d > 0.4 ? '▲' : d < -0.4 ? '▼' : '';
    return `<tr><th>${g}</th><td class="num">${fmtCoin(p)}</td><td class="chg ${cls}">${arrow} ${d ? signedNum(d) : ''}</td></tr>`;
  });
  $('prices').innerHTML = `<thead><tr><th>Good</th><th class="num">Price</th><th>Since day 1</th></tr></thead><tbody>${rows.join('')}</tbody>`;
}

function signedNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r > 0 ? `+${r}` : `−${-r}`;
}

function renderToday(s: GameState): void {
  const ev = s.events.find((e) => e.day === s.day);
  $('event').textContent = ev?.text ?? '';
  const recap = ui.recap.filter((l) => !l.private);
  $('recap').innerHTML = recap.length
    ? `<h3>Since yesterday</h3><ul>${recap.map((l) => `<li class="k-${l.kind}">${esc(l.text)}</li>`).join('')}</ul>`
    : '';
  const you = s.merchants.find((m) => m.id === HUMAN);
  const heard = you ? s.rumors.filter((r) => you.heard.includes(r.id) && r.day > s.day) : [];
  const source = new Map<string, string>();
  for (const l of s.log) if (l.kind === 'rumor') for (const r of heard) if (l.text.includes(r.text)) source.set(r.id, l.text.split(':')[0]);
  $('rumors').innerHTML = heard.length
    ? heard.map((r) => `<li><span class="src">${esc(source.get(r.id) ?? 'Heard')}</span> ${esc(r.text)}</li>`).join('')
    : '<li class="muted">Nothing yet. Ask around: <em>any news?</em></li>';
}

function renderMarket(s: GameState): void {
  const items = s.log.filter((l) => !l.private && l.kind !== 'day').slice(-14).reverse();
  $('market').innerHTML = items.map((l) => `<li class="k-${l.kind}"><span class="d">day ${l.day}</span> ${esc(l.text)}</li>`).join('');
}

export function moodOf(m: Merchant): { label: string; tone: string } {
  const mood = m.mood[HUMAN] ?? 0;
  const trust = m.trust[HUMAN] ?? 0.7;
  if (trust < 0.3) return { label: 'doesn’t trust you', tone: 'bad' };
  if (mood <= -0.4) return { label: 'cold with you', tone: 'bad' };
  if (mood >= 0.2 || trust >= 0.85) return { label: 'friendly', tone: 'good' };
  return { label: 'neutral', tone: '' };
}

function renderStalls(s: GameState): void {
  $('stalls').innerHTML = rivals(s)
    .map((m) => {
      const mood = moodOf(m);
      const pend = s.pending[m.id] ? '<span class="dot" title="has an offer for you"></span>' : '';
      return `<button class="stall ${m.id === ui.stall ? 'on' : ''}" data-stall="${m.id}"><b>${esc(m.name)}</b>${pend}<small class="${mood.tone}">${mood.label}</small></button>`;
    })
    .join('');
}

function convoFor(s: GameState, id: string): LogEntry[] {
  return s.log.filter((l) => l.private && l.who?.includes(id));
}

function renderStall(s: GameState): void {
  const id = ui.stall;
  if (!id) return;
  const m = merchant(s, id);
  $('stallhead').innerHTML = `<div><h2>${esc(m.name)}</h2><p class="muted">${esc(m.blurb)}</p></div><div class="theirs">${stock(m)}</div>`;
  const lines = convoFor(s, id);
  $('convo').innerHTML = lines.length
    ? lines
        .map((l) => {
          const mine = l.text.startsWith('You:');
          return `<li class="${mine ? 'me' : 'them'} k-${l.kind}"><span class="d">day ${l.day}</span> ${esc(l.text.replace(/^You:\s*/, ''))}</li>`;
        })
        .join('')
    : `<li class="muted">You haven’t spoken to ${esc(m.name.split(' ')[0])} yet. Say hello, or make an offer.</li>`;
  const c = $('convo');
  c.scrollTop = c.scrollHeight;
  renderTable(s, m);
  renderChips(s, m);
  $('talks').textContent = s.over ? '' : `${s.talksLeft} of ${s.talkPerDay} talks left today`;
}

function stock(m: Merchant): string {
  const goods = GOODS.filter((g) => m.goods[g] > 0)
    .map((g) => `<span class="g g-${g}">${m.goods[g]} ${g}</span>`)
    .join('');
  return `${goods || '<span class="muted">nothing on the stall</span>'}<span class="g coin">${Math.floor(m.coin)} coin</span>`;
}

function renderTable(s: GameState, m: Merchant): void {
  const o = s.pending[m.id];
  const el = $('table');
  if (!o || s.over) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  const you = merchant(s, HUMAN);
  const g = gain(s, you, o);
  const problems = offerProblems(s, o);
  const hint = problems.length ? `<span class="bad">${esc(problems.join('; '))}</span>` : `<span class="${g >= 0 ? 'good' : 'bad'}">By your books: ${g >= 0 ? '+' : '−'}${Math.abs(g).toFixed(1)} coin</span>`;
  el.classList.remove('hidden');
  el.innerHTML = `<div><b>On the table:</b> ${esc(youView(o))}</div><div class="row">${hint}<span class="spacer"></span><button id="accept" class="primary" ${problems.length ? 'disabled' : ''}>Accept</button><button id="decline">Decline</button></div>`;
}

/** A merchant's offer written from the player's side. */
export function youView(o: Offer): string {
  const parts: string[] = [];
  if (!isEmpty(o.get)) parts.push(`you give ${describeBundle(o.get)}`);
  if (!isEmpty(o.give)) parts.push(`you get ${describeBundle(o.give)}`);
  if (o.later) {
    if (!isEmpty(o.later.get)) parts.push(`you deliver ${describeBundle(o.later.get)} on day ${o.later.due}`);
    if (!isEmpty(o.later.give)) parts.push(`they deliver ${describeBundle(o.later.give)} on day ${o.later.due}`);
  }
  return parts.join(', ');
}

function renderChips(s: GameState, m: Merchant): void {
  if (s.over) {
    $('chips').innerHTML = '';
    return;
  }
  const you = merchant(s, HUMAN);
  const chips = ['What do you need?', 'Any news?'];
  const need = GOODS.find((g) => (you.contract.needs[g] ?? 0) > you.goods[g] && m.goods[g] > 0);
  if (need) chips.push(`How much for ${Math.min(m.goods[need], (you.contract.needs[need] ?? 0) - you.goods[need])} ${need}?`);
  const sell = GOODS.find((g) => you.goods[g] > (you.contract.needs[g] ?? 0));
  if (sell) chips.push(`What would you pay for my ${sell}?`);
  $('chips').innerHTML = chips.map((c) => `<button class="chip" data-say="${esc(c)}">${esc(c)}</button>`).join('');
}

function renderYou(s: GameState): void {
  const you = s.merchants.find((m) => m.id === HUMAN);
  if (!you) return;
  $('purse').innerHTML = `<b>${fmtCoin(you.coin)}</b> coin`;
  $('mygoods').innerHTML = GOODS.map((g) => {
    const n = you.goods[g];
    const need = you.contract.needs[g] ?? 0;
    return `<li class="${n ? '' : 'muted'}"><span>${g}</span><span class="num">${n}</span><small>${GOOD_INFO[g].unit}s${need ? `, need ${need}` : ''}</small></li>`;
  }).join('');
  const needs = Object.entries(you.contract.needs) as [Good, number][];
  const rows = needs.map(([g, n]) => {
    const have = Math.min(you.goods[g], n);
    const lack = n - you.goods[g];
    const who = lack > 0 ? rivals(s).filter((m) => m.goods[g] > 0).map((m) => `${m.name.split(' ')[0]} ${m.goods[g]}`) : [];
    const where = lack > 0 ? `<small>${who.length ? `On the quay: ${esc(who.join(', '))}` : 'Nobody has any on their stall'}</small>` : '';
    return `<li><span>${g}</span><span class="bar"><span style="width:${(have / n) * 100}%"></span></span><span class="num">${you.goods[g]}/${n}</span>${where}</li>`;
  });
  const sc = scoreOf(s, you);
  $('contract').innerHTML = `<p>For ${esc(you.contract.client)}. Pays <b>${you.contract.reward}</b> coin at the close if all of it is there.</p><ul class="needs">${rows.join('')}</ul><p class="${sc.contractMet ? 'good' : 'muted'}">${sc.contractMet ? 'Filled. Keep these goods until the close.' : 'Not filled yet.'}</p>`;
  const mine = s.promises.filter((p) => p.from === HUMAN || p.to === HUMAN);
  $('promises').innerHTML = mine.length
    ? mine
        .map((p) => {
          const other = merchant(s, p.from === HUMAN ? p.to : p.from).name;
          const text = p.from === HUMAN ? `You owe ${other} ${describeBundle(p.bundle)}` : `${other} owes you ${describeBundle(p.bundle)}`;
          const choice =
            p.status === 'open' && p.from === HUMAN
              ? `<label class="keep"><input type="checkbox" data-promise="${p.id}" ${(s.breaking ?? []).includes(p.id) ? '' : 'checked'} /> keep it</label>`
              : '';
          return `<li class="p-${p.status}">${esc(text)}, day ${p.due}${p.status === 'open' ? '' : ` (${p.status})`}${choice}</li>`;
        })
        .join('')
    : '<li class="muted">None. A deal can include a delivery on a later day.</li>';
  $('standing').innerHTML = `If the market closed now: <b>${signed(sc.profit)}</b> profit`;
  ($('endday') as HTMLButtonElement).textContent = s.day >= s.days ? 'Close the market' : 'End the day';
  ($('endday') as HTMLButtonElement).disabled = s.over || ui.busy;
}

// ---------- talking ----------

export function describeIntent(s: GameState, i: Intent): string {
  switch (i.kind) {
    case 'offer': {
      const parts = [];
      if (!isEmpty(i.give)) parts.push(`you give ${describeBundle(i.give)}`);
      if (!isEmpty(i.get)) parts.push(`you get ${describeBundle(i.get)}`);
      if (i.later?.give && !isEmpty(i.later.give)) parts.push(`you deliver ${describeBundle(i.later.give)} on day ${i.later.due}`);
      if (i.later?.get && !isEmpty(i.later.get)) parts.push(`they deliver ${describeBundle(i.later.get)} on day ${i.later.due}`);
      return `Offer: ${parts.join(', ')}`;
    }
    case 'accept':
      return s.pending[ui.stall ?? ''] ? 'Accept the deal on the table' : 'Accept (there is nothing on the table)';
    case 'reject':
      return 'Turn it down';
    case 'price':
      return `Ask their price for ${i.qty} ${i.good}`;
    case 'bid':
      return `Ask what they'd pay for ${i.qty} of your ${i.good}`;
    case 'needs':
      return 'Ask what they need';
    case 'news':
      return 'Ask for news';
    case 'hello':
      return 'Say hello';
    default:
      return 'Not sure what that means yet';
  }
}

export function updatePreview(): void {
  $('preview').classList.remove('warn');
  const s = ui.state;
  const text = ($('input') as HTMLTextAreaElement).value;
  if (!s || !text.trim()) {
    $('preview').textContent = '';
    return;
  }
  const p = parseTalk(s, text, ui.stall ?? undefined);
  const who = p.to && p.to !== ui.stall ? ` (to ${merchant(s, p.to).name})` : '';
  $('preview').textContent = `${describeIntent(s, p.intent)}${who}`;
}

export async function say(text: string): Promise<void> {
  const s = ui.state;
  if (!s || ui.busy || !text.trim()) return;
  const words = text.trim().slice(0, 300);
  let problem: string | null = null;
  if (ui.voice !== 'local') {
    ui.busy = true;
    try {
      const res = await fetch('/api/talk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: s, text: words, stall: ui.stall, provider: ui.voice }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      ui.state = body.state as GameState;
      if (body.reply?.to) ui.stall = body.reply.to;
      if (body.reply?.spent) addYouLine(ui.state, words, body.reply.to ?? ui.stall);
      else problem = body.reply?.say ?? null;
    } catch (err) {
      problem = localSay(s, words);
      problem = `Couldn\u2019t reach the model (${(err as Error).message}), so a built-in merchant answered.${problem ? ` ${problem}` : ''}`;
    } finally {
      ui.busy = false;
    }
  } else problem = localSay(s, words);
  // Keep words that didn't land in the box so they can be fixed.
  if (!problem) ($('input') as HTMLTextAreaElement).value = '';
  render();
  if (problem) note(problem);
}

/** Answer locally. Returns a note for the player when the words didn't reach the merchant. */
function localSay(s: GameState, words: string): string | null {
  const p = parseTalk(s, words, ui.stall ?? undefined);
  const to = p.to ?? ui.stall;
  if (!to) return 'Pick a stall first.';
  ui.stall = to;
  const r = talk(s, to, p.intent);
  if (r.spent) addYouLine(s, words, to);
  return r.spent ? null : r.say;
}

/** The player's own line goes into the stall's conversation, just before the merchant's answer. */
function addYouLine(s: GameState, words: string, to: string | null): void {
  if (!to) return;
  const entry: LogEntry = { day: s.day, kind: 'say', text: `You: ${words}`, who: [HUMAN, to], private: true };
  // The merchant's answer was the last private line for this stall; put ours before it.
  let i = s.log.length - 1;
  while (i >= 0 && !(s.log[i].private && s.log[i].who?.includes(to) && s.log[i].kind === 'say')) i--;
  if (i >= 0) s.log.splice(i, 0, entry);
  else s.log.push(entry);
}

function note(text: string): void {
  if (!text) return;
  $('preview').textContent = text;
  $('preview').classList.add('warn');
}

export function acceptPending(): void {
  void say('deal');
}

export function declinePending(): void {
  void say('no thanks');
}

export function finishDay(): void {
  const s = ui.state;
  if (!s || s.over || ui.busy) return;
  const from = s.log.length;
  endDay(s);
  ui.recap = s.log.slice(from).filter((l) => ['trade', 'promise', 'broken'].includes(l.kind));
  ui.seen = s.log.length;
  if (s.over) showResult();
  else render();
}

// ---------- the close ----------

export function showResult(): void {
  const s = ui.state!;
  save();
  $('setup').classList.add('hidden');
  $('game').classList.add('hidden');
  const el = $('result');
  el.classList.remove('hidden');
  $('dayline').textContent = 'The market has closed';
  const lines = standings(s);
  const rows = lines
    .map((l, i) => {
      const m = merchant(s, l.id);
      const needs = Object.entries(m.contract.needs)
        .map(([g, n]) => `${n} ${g}`)
        .join(', ');
      return `<tr class="${l.id === HUMAN ? 'me' : ''}"><td>${i + 1}</td><td><b>${esc(l.name)}</b><small>${m.id === HUMAN ? '' : m.personality}</small></td><td class="num">${signed(l.profit)}</td><td>${l.contractMet ? `filled (${l.reward})` : 'missed'}<small>${esc(needs)}</small></td></tr>`;
    })
    .join('');
  const you = lines.findIndex((l) => l.id === HUMAN);
  const head = you < 0 ? 'The merchants traded on their own.' : you === 0 ? 'You finished first on the quay.' : `You finished ${['first', 'second', 'third', 'fourth', 'fifth'][you]}.`;
  const broken = s.promises.filter((p) => p.status === 'broken');
  const lies = s.rumors.filter((r) => !r.truth && s.merchants.some((m) => m.id === HUMAN && m.heard.includes(r.id)));
  const ledger = you < 0 ? '' : ledgerHtml(s);
  el.innerHTML = `<div class="card"><h2>${head}</h2>
    <table class="standings"><thead><tr><th></th><th>Merchant</th><th class="num">Profit</th><th>Contract</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted">${s.trades.length} trades, ${broken.length} broken promise${broken.length === 1 ? '' : 's'}${you >= 0 ? `, ${lies.length} false rumour${lies.length === 1 ? '' : 's'} reached you` : ''}.</p>
    ${ledger}
    <div class="row"><button id="again" class="primary">Play again</button><button id="sameseed">Same market again</button></div></div>`;
}

/** Your own deals, each valued at the closing prices from your side. */
export function ledgerHtml(s: GameState): string {
  const mine = s.trades
    .filter((t) => t.offer.from === HUMAN || t.offer.to === HUMAN)
    .map((t) => {
      const o = t.offer.from === HUMAN ? t.offer : flip(t.offer);
      const value =
        marketValue(s, o.get) + marketValue(s, o.later?.get) - marketValue(s, o.give) - marketValue(s, o.later?.give);
      const parts = [`gave ${describeBundle(o.give)}`, `got ${describeBundle(o.get)}`];
      if (o.later && !isEmpty(o.later.give)) parts.push(`owed ${describeBundle(o.later.give)} on day ${o.later.due}`);
      if (o.later && !isEmpty(o.later.get)) parts.push(`owed ${describeBundle(o.later.get)} on day ${o.later.due}`);
      return { day: t.day, who: merchant(s, o.to).name, what: parts.filter((x) => !x.endsWith('nothing')).join('; '), value };
    });
  if (!mine.length) return '<p class="muted">You made no deals this market.</p>';
  const best = mine.reduce((a, b) => (b.value > a.value ? b : a));
  const rows = mine
    .map(
      (d) =>
        `<tr class="${d === best && d.value > 0 ? 'best' : ''}"><td>${d.day}</td><td>${esc(d.who)}</td><td>${esc(d.what)}</td><td class="num ${d.value < 0 ? 'loss' : ''}">${signed(Math.round(d.value * 10) / 10)}</td></tr>`,
    )
    .join('');
  return `<h3>Your deals</h3><table class="ledger"><thead><tr><th>Day</th><th>With</th><th>Deal</th><th class="num">At close</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted">Valued at the closing prices. A deal can lose on paper and still be worth it if it filled your contract.</p>`;
}

// ---------- saving ----------

function save(): void {
  try {
    if (ui.state && ui.state.merchants.some((m) => m.id === HUMAN)) localStorage.setItem(SAVE_KEY, JSON.stringify(ui.state));
  } catch {
    /* storage may be unavailable */
  }
}

function loadSaved(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as GameState) : null;
  } catch {
    return null;
  }
}

// ---------- wiring ----------

export function wire(): void {
  $('start').addEventListener('click', () => start({ seed: ($('seed') as HTMLInputElement).value, days: Number(($('days') as HTMLSelectElement).value) }));
  $('watch').addEventListener('click', () => start({ seed: ($('seed') as HTMLInputElement).value, days: Number(($('days') as HTMLSelectElement).value), watch: true }));
  $('continue').addEventListener('click', () => {
    const s = loadSaved();
    if (s) begin(s);
  });
  $('stalls').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-stall]') as HTMLElement | null;
    if (!b) return;
    ui.stall = b.dataset.stall!;
    render();
    ($('input') as HTMLTextAreaElement).focus();
  });
  $('chips').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-say]') as HTMLElement | null;
    if (b) void say(b.dataset.say!);
  });
  $('table').addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).id;
    if (id === 'accept') acceptPending();
    if (id === 'decline') declinePending();
  });
  $('send').addEventListener('click', () => void say(($('input') as HTMLTextAreaElement).value));
  $('input').addEventListener('input', updatePreview);
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void say(($('input') as HTMLTextAreaElement).value);
    }
  });
  $('endday').addEventListener('click', finishDay);
  $('promises').addEventListener('change', (e) => {
    const box = e.target as HTMLInputElement;
    const id = box.dataset.promise;
    const s = ui.state;
    if (!id || !s) return;
    const set = new Set(s.breaking ?? []);
    if (box.checked) set.delete(id);
    else set.add(id);
    s.breaking = [...set];
    save();
  });
  $('voice').addEventListener('change', () => (ui.voice = ($('voice') as HTMLSelectElement).value));
  $('result').addEventListener('click', (e) => {
    const id = (e.target as HTMLElement).id;
    if (id === 'again') start({ days: ui.state?.days });
    if (id === 'sameseed' && ui.state) start({ seed: String(ui.state.seed), days: ui.state.days });
  });
  if (location.protocol.startsWith('http')) {
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((h: { providers?: string[] } | null) => {
        if (!h?.providers) return;
        const opts = [['local', 'built-in merchants'], ...h.providers.filter((p) => p !== 'mock').map((p) => [p, p === 'anthropic' ? 'Claude' : p]), ['mock', 'offline model stand-in']];
        ($('voice') as HTMLSelectElement).innerHTML = opts.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
        $('voicebox').classList.remove('hidden');
      })
      .catch(() => undefined);
  }
}

export function getUI(): UI {
  return ui;
}

if (typeof document !== 'undefined' && document.getElementById('start')) {
  wire();
  setupScreen();
}
