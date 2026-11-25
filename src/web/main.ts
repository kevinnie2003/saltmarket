// Browser client. The whole game lives in the page; a local server is only
// used when the player picks a model to play the merchants.
//
// The page speaks English or Chinese. Ledgers, cards and the board are worded
// afresh in the current language whenever they are drawn; lines in the daybook
// (the conversation and the quay log) stay in the language they were written in.
import { HUMAN, flip, isEmpty, marketValue, merchant, nameIn, offerProblems, scoreOf, standings } from '../engine/game.js';
import { eventGoods } from '../engine/market.js';
import { GOODS, type Bundle, type GameState, type Good, type LogEntry, type Merchant, type Offer } from '../engine/types.js';
import { endDay, newGame, playOut, rivals } from '../agents/session.js';
import { talk } from '../agents/talk.js';
import { gain } from '../agents/value.js';
import { asLang, hasCjk, langOf, type Lang } from '../i18n/lang.js';
import {
  blurbText,
  bundleText,
  clientText,
  coinText,
  eventText,
  fmtCoin,
  goodName,
  logWords,
  personalityText,
  qtyText,
  rumorText,
  stripYou,
  unitName,
} from '../i18n/words.js';
import { parseTalk, type Intent } from '../talk/parse.js';
import { S, num, setUiLang, signed, uiLang } from './strings.js';

const SAVE_KEY = 'saltmarket.save.v1';
const LANG_KEY = 'saltmarket.lang';

type Screen = 'setup' | 'game' | 'result';

interface UI {
  state: GameState | null;
  screen: Screen;
  stall: string | null;
  voice: string;
  busy: boolean;
  /** Log length when the day started, to show what happened since. */
  seen: number;
  /** What happened at dusk and overnight, shown the next morning. */
  recap: LogEntry[];
  /** Model providers the local server offers, if any. */
  providers: string[];
  /** Lines drawn in the open conversation, to tell when a new one arrives. */
  drawn: { stall: string | null; lines: number };
}

const ui: UI = { state: null, screen: 'setup', stall: null, voice: 'local', busy: false, seen: 0, recap: [], providers: [], drawn: { stall: null, lines: 0 } };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const L = (): Lang => uiLang();
const htmlLang = (lang: Lang) => (lang === 'zh' ? 'zh-CN' : 'en');
/** A line from the daybook, marked with the language it was written in. */
const written = (text: string) => `<span lang="${hasCjk(text) ? 'zh-CN' : 'en'}">${esc(text)}</span>`;
const first = (name: string) => name.split(' ')[0];

// ---------- language ----------

export function initialLang(): Lang {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (fromUrl === 'en' || fromUrl === 'zh') return fromUrl;
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    // Storage can be blocked; fall back to the browser's language.
  }
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** Fills every fixed piece of text on the page in the current language. */
export function applyStrings(): void {
  const s = S() as unknown as Record<string, unknown>;
  const lang = L();
  document.documentElement.lang = htmlLang(lang);
  document.body.dataset.lang = lang;
  document.title = S().docTitle;
  for (const el of document.querySelectorAll<HTMLElement>('[data-t]')) el.textContent = String(s[el.dataset.t!] ?? '');
  for (const el of document.querySelectorAll<HTMLElement>('[data-t-ph]')) el.setAttribute('placeholder', String(s[el.dataset.tPh!] ?? ''));
  for (const el of document.querySelectorAll<HTMLElement>('[data-t-aria]')) el.setAttribute('aria-label', String(s[el.dataset.tAria!] ?? ''));
  for (const b of document.querySelectorAll<HTMLButtonElement>('.lang button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  $('rules').innerHTML = S().rules.map((r) => `<li>${esc(r)}</li>`).join('');
  $('examples').innerHTML = S().examples.map((x) => `<li><code>${esc(x)}</code></li>`).join('');
  renderVoices();
}

/**
 * Switching language re-words the page at once. A game in progress writes its
 * next lines in the new language; the lines already written stay as they are.
 */
export function switchLang(lang: Lang): void {
  if (lang === uiLang()) return;
  setUiLang(lang);
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* storage may be unavailable */
  }
  if (ui.state) ui.state.lang = lang;
  applyStrings();
  if (ui.screen === 'game') render();
  else if (ui.screen === 'result') showResult();
  else setupScreen();
}

// ---------- setup ----------

function show(screen: Screen): void {
  ui.screen = screen;
  $('setup').classList.toggle('hidden', screen !== 'setup');
  $('game').classList.toggle('hidden', screen !== 'game');
  $('result').classList.toggle('hidden', screen !== 'result');
  $('gauge').classList.toggle('hidden', screen === 'setup');
}

export function setupScreen(): void {
  show('setup');
  $('dayline').textContent = '';
  const saved = loadSaved();
  $('continue').classList.toggle('hidden', !saved || saved.over);
}

export function start(opts: { seed?: string; days?: number; watch?: boolean } = {}): GameState {
  const seed = opts.seed?.trim() ? opts.seed.trim() : String(Math.floor(Math.random() * 1e9));
  const state = newGame({ seed, days: opts.days ?? 8, noHuman: opts.watch, rivals: opts.watch ? 4 : 3, lang: L() });
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
  // New lines are written in the language the player is reading now.
  state.lang = L();
  ui.stall = ui.stall && state.merchants.some((m) => m.id === ui.stall) ? ui.stall : rivals(state)[0]?.id ?? null;
  ui.seen = state.log.length;
  ui.recap = [];
  ui.drawn = { stall: null, lines: 0 };
  show('game');
  render();
}

// ---------- rendering ----------

export function render(): void {
  const s = ui.state;
  if (!s) return;
  save();
  renderGauge(s);
  renderPrices(s);
  renderToday(s);
  renderMarket(s);
  renderStalls(s);
  renderStall(s);
  renderYou(s);
  updatePreview();
}

function renderGauge(s: GameState): void {
  const t = S();
  $('dayline').textContent = s.over ? t.closed : t.dayOf(s.day, s.days);
  const cells = [];
  for (let d = 1; d <= s.days; d++) {
    const cls = s.over || d < s.day ? 'past' : d === s.day ? 'now' : '';
    cells.push(`<li class="${cls}" title="${esc(t.dayCell(d))}"><span>${d}</span></li>`);
  }
  $('daygauge').innerHTML = cells.join('');
  const left = s.over ? 0 : s.talksLeft;
  $('pips').innerHTML = Array.from({ length: s.talkPerDay }, (_, i) => `<i class="${i < left ? 'on' : ''}"></i>`).join('');
  $('talkfig').textContent = s.over ? '' : `${left}/${s.talkPerDay}`;
}

/** A price change with a true minus, to one decimal. */
function change(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r > 0 ? `+${r}` : r < 0 ? num(r) : '';
}

function renderPrices(s: GameState): void {
  const t = S();
  const rows = GOODS.map((g) => {
    const d = s.prices[g] - s.openingPrices[g];
    const cls = d > 0.4 ? 'up' : d < -0.4 ? 'down' : '';
    return `<tr><th scope="row">${esc(goodName(g, L()))}</th><td class="num">${fmtCoin(s.prices[g])}</td><td class="num chg ${cls}">${change(d)}</td></tr>`;
  });
  $('prices').innerHTML = `<thead><tr><th scope="col">${esc(t.boardGood)}</th><th scope="col" class="num">${esc(t.boardPrice)}</th><th scope="col" class="num">${esc(t.boardSince)}</th></tr></thead><tbody>${rows.join('')}</tbody>`;
}

function renderToday(s: GameState): void {
  const t = S();
  const ev = s.events.find((e) => e.day === s.day);
  $('event').textContent = ev ? eventText(ev.kind, eventGoods(ev), L()) : '';
  const recap = ui.recap.filter((l) => !l.private);
  $('recap').innerHTML = recap.length ? `<h3 class="label">${esc(t.recapHead)}</h3><ul>${recap.map((l) => `<li class="k-${l.kind}">${written(l.text)}</li>`).join('')}</ul>` : '';
  const you = s.merchants.find((m) => m.id === HUMAN);
  const heard = you ? s.rumors.filter((r) => you.heard.includes(r.id) && r.day > s.day) : [];
  $('rumors').innerHTML = heard.length
    ? heard.map((r) => `<li><span class="src label">${esc(rumorSource(s, r.id, r.text))}</span> ${esc(rumorText(r.kind, r.goods, r.day, L()))}</li>`).join('')
    : `<li class="muted">${esc(t.heardNone)}</li>`;
}

/** Who passed a rumour on: a merchant, or a dockhand's whisper. */
function rumorSource(s: GameState, id: string, text: string): string {
  const t = S();
  const line = s.log.find((l) => l.kind === 'rumor' && (l.rumor === id || (!l.rumor && l.text.includes(text))));
  if (!line) return t.heardFrom;
  const from = line.who?.find((w) => w !== HUMAN);
  return from && s.merchants.some((m) => m.id === from) ? merchant(s, from).name : t.heardDockhand;
}

function renderMarket(s: GameState): void {
  const t = S();
  const items = s.log.filter((l) => !l.private && l.kind !== 'day').slice(-14);
  $('market').innerHTML = items.length
    ? items.map((l) => `<li class="k-${l.kind}"><span class="d">${esc(t.logDay(l.day))}</span> ${written(l.text)}</li>`).join('')
    : `<li class="muted">${esc(t.quayNone)}</li>`;
}

export function moodOf(m: Merchant): { label: string; tone: string } {
  const t = S().mood;
  const mood = m.mood[HUMAN] ?? 0;
  const trust = m.trust[HUMAN] ?? 0.7;
  if (trust < 0.3) return { label: t.bad, tone: 'bad' };
  if (mood <= -0.4) return { label: t.cold, tone: 'bad' };
  if (mood >= 0.2 || trust >= 0.85) return { label: t.good, tone: 'good' };
  return { label: t.neutral, tone: '' };
}

function renderStalls(s: GameState): void {
  const t = S();
  $('stalls').innerHTML = rivals(s)
    .map((m) => {
      const mood = moodOf(m);
      const on = m.id === ui.stall;
      const pend = s.pending[m.id] ? `<span class="seal" title="${esc(t.hasOffer)}" aria-hidden="true"></span><span class="sr-only">${esc(t.hasOffer)}</span>` : '';
      return `<button type="button" class="stall${on ? ' on' : ''}" data-stall="${m.id}" aria-pressed="${on}"><b class="who">${esc(m.name)}</b>${pend}<small class="${mood.tone}">${esc(mood.label)}</small></button>`;
    })
    .join('');
}

function convoFor(s: GameState, id: string): LogEntry[] {
  return s.log.filter((l) => l.private && l.who?.includes(id));
}

/** True for a line the player said, in either language and in old saves. */
function isMine(l: LogEntry): boolean {
  return (l.kind === 'say' && l.who?.[0] === HUMAN && l.who.length > 1) || stripYou(l.text) !== null;
}

function renderStall(s: GameState): void {
  const id = ui.stall;
  if (!id) return;
  const t = S();
  const m = merchant(s, id);
  $('stallhead').innerHTML = `<div class="who-block"><h2>${esc(m.name)}</h2><p class="blurb">${esc(blurbText(m.name, m.blurb, L()))}</p></div><div class="theirs"><span class="label">${esc(t.stockHead)}</span>${stock(m)}</div>`;
  const lines = convoFor(s, id);
  const c = $('convo');
  c.setAttribute('aria-label', t.convoLabel(m.name));
  c.innerHTML = lines.length
    ? lines
        .map((l) => {
          const mine = isMine(l);
          const text = mine ? stripYou(l.text) ?? l.text : l.text;
          return `<li class="${mine ? 'me' : 'them'} k-${l.kind}"><span class="d">${esc(t.logDay(l.day))}</span><span class="line">${written(text)}</span></li>`;
        })
        .join('')
    : `<li class="muted">${esc(t.notYet(first(m.name)))}</li>`;
  pin(c, id, lines.length);
  renderTable(s, m);
  renderChips(s, m);
  $('talks').textContent = s.over ? '' : t.talksLeft(s.talksLeft, s.talkPerDay);
}

/** Keeps the conversation on its newest line: inside its own pane on wide screens, in the page on narrow ones. */
function pin(c: HTMLElement, stall: string, count: number): void {
  const grew = ui.drawn.stall === stall && count > ui.drawn.lines;
  ui.drawn = { stall, lines: count };
  if (c.scrollHeight > c.clientHeight + 1) c.scrollTop = c.scrollHeight;
  else if (grew) {
    const last = c.lastElementChild as HTMLElement | null;
    if (last && typeof last.scrollIntoView === 'function') last.scrollIntoView({ block: 'nearest' });
  }
}

function stock(m: Merchant): string {
  const t = S();
  const rows = GOODS.filter((g) => m.goods[g] > 0).map((g) => `<tr><th scope="row">${esc(goodName(g, L()))}</th><td class="num">${m.goods[g]}</td></tr>`);
  const goods = rows.length ? rows.join('') : `<tr><td colspan="2" class="muted">${esc(t.stockNone)}</td></tr>`;
  return `<table class="ledger stock"><tbody>${goods}<tr class="coin"><th scope="row">${esc(t.coinWord)}</th><td class="num">${Math.floor(m.coin)}</td></tr></tbody></table>`;
}

/** The rows of one side of a bill: a figure and what it counts. */
function billRows(b: Bundle | undefined): string {
  const t = S();
  const rows: string[] = [];
  if (b) {
    for (const g of GOODS) if (b[g]) rows.push(`<tr><td class="num">${b[g]}</td><td>${esc(L() === 'zh' ? `${unitName(g, 'zh')}${goodName(g, 'zh')}` : goodName(g, 'en'))}</td></tr>`);
    if (b.coin) rows.push(`<tr><td class="num">${fmtCoin(b.coin)}</td><td>${esc(t.billCoin)}</td></tr>`);
  }
  return rows.join('');
}

function billSide(head: string, now: Bundle | undefined, later: Bundle | undefined, due: number | undefined): string {
  const t = S();
  const nowRows = billRows(now);
  const laterRows = due !== undefined ? billRows(later) : '';
  const body = (nowRows || (laterRows ? '' : `<tr><td class="num">—</td><td class="muted">${esc(t.billNothing)}</td></tr>`)) + (laterRows ? `<tr class="later"><th colspan="2" scope="rowgroup">${esc(t.billLater(due!))}</th></tr>${laterRows}` : '');
  return `<div class="bill-side"><h3 class="label">${esc(head)}</h3><table class="ledger"><tbody>${body}</tbody></table></div>`;
}

function renderTable(s: GameState, m: Merchant): void {
  const o = s.pending[m.id];
  const el = $('table');
  if (!o || s.over) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  const t = S();
  const you = merchant(s, HUMAN);
  const g = gain(s, you, o);
  const problems = offerProblems(s, o, L());
  const worth = problems.length
    ? `<p class="bill-problem bad">${esc(problems.join(L() === 'zh' ? '；' : '; '))}</p>`
    : `<p class="bill-worth"><span>${esc(t.billWorth)}</span><span class="num figure ${g < 0 ? 'bad' : ''}">${g < 0 ? '−' : '+'}${Math.abs(g).toFixed(1)} ${esc(t.billCoin)}</span></p>`;
  el.classList.remove('hidden');
  el.setAttribute('aria-label', `${t.billHead}: ${youView(o)}`);
  // The merchant's `get` is what the player hands over; `give` what the player receives.
  el.innerHTML = `<div class="bill-head"><span class="label">${esc(t.billHead)}</span><span class="bill-from">${esc(t.billFrom(m.name))}</span></div>
    <div class="bill-cols">${billSide(t.billGive, o.get, o.later?.get, o.later?.due)}${billSide(t.billGet, o.give, o.later?.give, o.later?.due)}</div>
    ${worth}
    <div class="bill-actions"><button type="button" id="accept" class="primary" ${problems.length ? 'disabled' : ''}>${esc(t.accept)}</button><button type="button" id="decline">${esc(t.decline)}</button><span class="hint">${esc(t.counterHint)}</span></div>`;
}

/** A merchant's offer written from the player's side. */
export function youView(o: Offer): string {
  const t = S();
  const b = (x: Bundle | undefined) => bundleText(x, L());
  const parts: string[] = [];
  if (!isEmpty(o.get)) parts.push(t.youGive(b(o.get)));
  if (!isEmpty(o.give)) parts.push(t.youGet(b(o.give)));
  if (o.later) {
    if (!isEmpty(o.later.get)) parts.push(t.youDeliver(b(o.later.get), o.later.due));
    if (!isEmpty(o.later.give)) parts.push(t.theyDeliver(b(o.later.give), o.later.due));
  }
  return parts.join(t.partsJoin);
}

function renderChips(s: GameState, m: Merchant): void {
  if (s.over) {
    $('chips').innerHTML = '';
    return;
  }
  const t = S();
  const you = merchant(s, HUMAN);
  const chips = [t.chipNeeds, t.chipNews];
  const need = GOODS.find((g) => (you.contract.needs[g] ?? 0) > you.goods[g] && m.goods[g] > 0);
  if (need) chips.push(t.chipPrice(qtyText(need, Math.min(m.goods[need], (you.contract.needs[need] ?? 0) - you.goods[need]), L())));
  const sell = GOODS.find((g) => you.goods[g] > (you.contract.needs[g] ?? 0));
  if (sell) chips.push(t.chipBid(goodName(sell, L())));
  $('chips').innerHTML = chips.map((c) => `<button type="button" class="chip" data-say="${esc(c)}">${esc(c)}</button>`).join('');
}

function renderYou(s: GameState): void {
  const you = s.merchants.find((m) => m.id === HUMAN);
  if (!you) return;
  const t = S();
  const lang = L();
  $('purse').innerHTML = `<span class="label">${esc(t.purse)}</span><span class="figure">${fmtCoin(you.coin)}</span><span class="unit">${esc(t.coinWord)}</span>`;
  $('mygoods').innerHTML =
    `<thead><tr><th scope="col">${esc(t.goodsGood)}</th><th scope="col" class="num">${esc(t.goodsHave)}</th><th scope="col"><span class="sr-only">${esc(t.goodsGood)}</span></th><th scope="col" class="num">${esc(t.goodsNeed)}</th></tr></thead><tbody>` +
    GOODS.map((g) => {
      const n = you.goods[g];
      const need = you.contract.needs[g] ?? 0;
      return `<tr class="${n ? '' : 'nil'}${need ? ' wanted' : ''}"><th scope="row">${esc(goodName(g, lang))}</th><td class="num">${n}</td><td class="unit">${esc(unitName(g, lang, n))}</td><td class="num">${need || ''}</td></tr>`;
    }).join('') +
    '</tbody>';

  const needs = Object.entries(you.contract.needs) as [Good, number][];
  const rows = needs.map(([g, n]) => {
    const have = Math.min(you.goods[g], n);
    const lack = n - you.goods[g];
    const who = lack > 0 ? rivals(s).filter((m) => m.goods[g] > 0).map((m) => `${first(m.name)} ${m.goods[g]}`) : [];
    const where = lack > 0 ? `<tr class="where"><td colspan="3">${esc(who.length ? t.onQuay(who.join(lang === 'zh' ? '，' : ', ')) : t.nobodyHas)}</td></tr>` : '';
    return `<tr><th scope="row">${esc(goodName(g, lang))}</th><td class="num">${you.goods[g]}/${n}</td><td class="meter"><span class="bar"><span style="width:${(have / n) * 100}%"></span></span></td></tr>${where}`;
  });
  const sc = scoreOf(s, you);
  $('contract').innerHTML = `<div class="slip-head"><span class="label">${esc(t.orderNo((s.seed % 900) + 100))}</span><span class="stamp${sc.contractMet ? '' : ' open'}">${esc(sc.contractMet ? t.stampFilled : t.stampOpen)}</span></div>
    <p class="slip-for">${esc(t.orderFor(clientText(you.contract.client, lang)))}</p>
    <p class="slip-pays">${esc(t.orderPays(you.contract.reward))}</p>
    <table class="ledger needs"><tbody>${rows.join('')}</tbody></table>
    <p class="${sc.contractMet ? 'done' : 'muted'}">${esc(sc.contractMet ? t.filled : t.notFilled)}</p>`;

  const mine = s.promises.filter((p) => p.from === HUMAN || p.to === HUMAN);
  $('promises').innerHTML = mine.length
    ? mine
        .map((p) => {
          const other = merchant(s, p.from === HUMAN ? p.to : p.from).name;
          const what = bundleText(p.bundle, lang);
          const text = p.from === HUMAN ? t.youOwe(other, what) : t.owesYou(other, what);
          const choice =
            p.status === 'open' && p.from === HUMAN
              ? `<label class="keep"><input type="checkbox" data-promise="${p.id}" ${(s.breaking ?? []).includes(p.id) ? '' : 'checked'} /> ${esc(t.keepIt)}</label>`
              : '';
          return `<li class="p-${p.status}"><span class="what">${esc(text)}</span><span class="due">${esc(t.promiseDue(p.due))}${p.status === 'open' ? '' : ` · ${esc(t.promiseStatus[p.status])}`}</span>${choice}</li>`;
        })
        .join('')
    : `<li class="muted">${esc(t.promisesNone)}</li>`;
  $('standing').innerHTML = `<span class="label">${esc(t.standing)}</span><span class="figure${sc.profit < 0 ? ' bad' : ''}">${signed(sc.profit)}</span><span class="unit">${esc(t.profitWord)}</span>`;
  const end = $('endday') as HTMLButtonElement;
  end.textContent = s.day >= s.days ? t.closeMarket : t.endDay;
  end.disabled = s.over || ui.busy;
}

// ---------- talking ----------

export function describeIntent(s: GameState, i: Intent): string {
  const t = S();
  const lang = L();
  const b = (x: Bundle | undefined) => bundleText(x, lang);
  switch (i.kind) {
    case 'offer': {
      const parts = [];
      if (!isEmpty(i.give)) parts.push(t.youGive(b(i.give)));
      if (!isEmpty(i.get)) parts.push(t.youGet(b(i.get)));
      if (i.later?.give && !isEmpty(i.later.give)) parts.push(t.youDeliver(b(i.later.give), i.later.due));
      if (i.later?.get && !isEmpty(i.later.get)) parts.push(t.theyDeliver(b(i.later.get), i.later.due));
      return t.intent.offer(parts.join(t.partsJoin));
    }
    case 'accept':
      return s.pending[ui.stall ?? ''] ? t.intent.acceptOn : t.intent.acceptNone;
    case 'reject':
      return s.pending[ui.stall ?? ''] ? t.intent.rejectOn : t.intent.rejectNone;
    case 'price':
      return t.intent.price(qtyText(i.good, i.qty, lang));
    case 'bid':
      return t.intent.bid(i.qty, goodName(i.good, lang), qtyText(i.good, i.qty, lang));
    case 'needs':
      return t.intent.needs;
    case 'news':
      return t.intent.news;
    case 'hello':
      return t.intent.hello;
    default:
      return t.intent.unknown;
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
  const who = p.to && p.to !== ui.stall ? S().previewTo(merchant(s, p.to).name) : '';
  $('preview').textContent = `${describeIntent(s, p.intent)}${who}`;
}

export async function say(text: string): Promise<void> {
  const s = ui.state;
  if (!s || ui.busy || !text.trim()) return;
  const words = text.trim().slice(0, 300);
  s.lang = L();
  let problem: string | null = null;
  if (ui.voice !== 'local') {
    ui.busy = true;
    try {
      const res = await fetch('/api/talk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: s, text: words, stall: ui.stall, provider: ui.voice, lang: L() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      ui.state = body.state as GameState;
      if (body.reply?.to) ui.stall = body.reply.to;
      if (body.reply?.spent) addYouLine(ui.state, words, body.reply.to ?? ui.stall);
      else problem = body.reply?.say ?? null;
    } catch (err) {
      problem = localSay(s, words);
      problem = `${S().unreachable((err as Error).message)}${problem ? ` ${problem}` : ''}`;
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
  if (!to) return S().pickStall;
  ui.stall = to;
  const r = talk(s, to, p.intent);
  if (r.spent) addYouLine(s, words, to);
  return r.spent ? null : r.say;
}

/** The player's own line goes into the stall's conversation, just before the merchant's answer. */
function addYouLine(s: GameState, words: string, to: string | null): void {
  if (!to) return;
  const entry: LogEntry = { day: s.day, kind: 'say', text: logWords(langOf(s)).you(words), who: [HUMAN, to], private: true };
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
  void say(L() === 'zh' ? '成交' : 'deal');
}

export function declinePending(): void {
  void say(L() === 'zh' ? '不要' : 'no thanks');
}

export function finishDay(): void {
  const s = ui.state;
  if (!s || s.over || ui.busy) return;
  s.lang = L();
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
  show('result');
  const t = S();
  const lang = L();
  renderGauge(s);
  const el = $('result');
  const lines = standings(s);
  const rows = lines
    .map((l, i) => {
      const m = merchant(s, l.id);
      const needs = (Object.entries(m.contract.needs) as [Good, number][]).map(([g, n]) => qtyText(g, n, lang)).join(lang === 'zh' ? '、' : ', ');
      return `<tr class="${l.id === HUMAN ? 'me' : ''}"><td class="num">${i + 1}</td><th scope="row"><b>${esc(nameIn(s, l.id, lang))}</b><small>${esc(m.id === HUMAN ? '' : personalityText(m.personality, lang))}</small></th><td class="num${l.profit < 0 ? ' bad' : ''}">${signed(l.profit)}</td><td>${esc(l.contractMet ? t.contractFilled(l.reward) : t.contractMissed)}<small>${esc(needs)}</small></td></tr>`;
    })
    .join('');
  const you = lines.findIndex((l) => l.id === HUMAN);
  const head = you < 0 ? t.headWatch : you === 0 ? t.headFirst : t.headPlace(you);
  const broken = s.promises.filter((p) => p.status === 'broken');
  const lies = s.rumors.filter((r) => !r.truth && s.merchants.some((m) => m.id === HUMAN && m.heard.includes(r.id)));
  const ledger = you < 0 ? '' : ledgerHtml(s);
  el.innerHTML = `<div class="sheet final">
    <p class="label">${esc(t.resultLabel)}</p>
    <h2 class="title">${esc(head)}</h2>
    <table class="ledger standings"><thead><tr><th scope="col" class="num">${esc(t.colRank)}</th><th scope="col">${esc(t.colMerchant)}</th><th scope="col" class="num">${esc(t.colProfit)}</th><th scope="col">${esc(t.colContract)}</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted">${esc(t.summary(s.trades.length, broken.length, you >= 0 ? lies.length : null))}</p>
    ${ledger}
    <div class="actions"><button type="button" id="again" class="primary">${esc(t.again)}</button><button type="button" id="sameseed">${esc(t.sameSeed)}</button></div></div>`;
}

/** Your own deals, each valued at the closing prices from your side. */
export function ledgerHtml(s: GameState): string {
  const t = S();
  const lang = L();
  const b = (x: Bundle | undefined) => bundleText(x, lang);
  const mine = s.trades
    .filter((d) => d.offer.from === HUMAN || d.offer.to === HUMAN)
    .map((d) => {
      const o = d.offer.from === HUMAN ? d.offer : flip(d.offer);
      const value = marketValue(s, o.get) + marketValue(s, o.later?.get) - marketValue(s, o.give) - marketValue(s, o.later?.give);
      const parts: string[] = [];
      if (!isEmpty(o.give)) parts.push(t.gave(b(o.give)));
      if (!isEmpty(o.get)) parts.push(t.got(b(o.get)));
      if (o.later && !isEmpty(o.later.give)) parts.push(t.owed(b(o.later.give), o.later.due));
      if (o.later && !isEmpty(o.later.get)) parts.push(t.owed(b(o.later.get), o.later.due));
      return { day: d.day, who: merchant(s, o.to).name, what: parts.join(t.dealJoin), value };
    });
  if (!mine.length) return `<p class="muted">${esc(t.noDeals)}</p>`;
  const best = mine.reduce((a, x) => (x.value > a.value ? x : a));
  const rows = mine
    .map(
      (d) =>
        `<tr class="${d === best && d.value > 0 ? 'best' : ''}"><td class="num">${d.day}</td><td>${esc(d.who)}</td><td>${esc(d.what)}</td><td class="num ${d.value < 0 ? 'loss' : ''}">${signed(Math.round(d.value * 10) / 10)}</td></tr>`,
    )
    .join('');
  return `<h3 class="label">${esc(t.dealsHead)}</h3><table class="ledger deals"><thead><tr><th scope="col" class="num">${esc(t.colDay)}</th><th scope="col">${esc(t.colWith)}</th><th scope="col">${esc(t.colDeal)}</th><th scope="col" class="num">${esc(t.colAtClose)}</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted">${esc(t.dealsNote)}</p>`;
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

function renderVoices(): void {
  if (!ui.providers.length) return;
  const t = S();
  const sel = $('voice') as HTMLSelectElement;
  const opts = [['local', t.voiceLocal], ...ui.providers.filter((p) => p !== 'mock').map((p) => [p, p === 'anthropic' ? 'Anthropic' : p === 'openai' ? 'OpenAI-compatible' : p]), ['mock', t.voiceMock]];
  sel.innerHTML = opts.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
  sel.value = ui.voice;
}

export function wire(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.lang button')) b.addEventListener('click', () => switchLang(asLang(b.dataset.lang)));
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
    // Enter sends; Shift+Enter makes a new line, and Enter while composing Chinese picks a character.
    if (e.key === 'Enter' && !e.shiftKey && !(e as KeyboardEvent).isComposing) {
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
        ui.providers = h.providers;
        renderVoices();
        $('voicebox').classList.remove('hidden');
      })
      .catch(() => undefined);
  }
}

export function getUI(): UI {
  return ui;
}

if (typeof document !== 'undefined' && document.getElementById('start')) {
  setUiLang(initialLang());
  applyStrings();
  wire();
  setupScreen();
}
