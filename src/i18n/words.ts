// Every piece of game text the engine and the built-in merchants write: goods,
// amounts, deals, events, rumours, log lines and replies at the stalls, in
// English and Simplified Chinese. Nothing here touches the game's random
// stream, so a seeded market plays out the same whichever language it is told in.
import { GOODS, type Bundle, type EventKind, type Good, type Offer } from '../engine/types.js';
import type { Lang } from './lang.js';
import { spaceMixed } from './spacing.js';

export const GOOD_ZH: Record<Good, string> = { salt: '盐', amber: '琥珀', dye: '染料', wool: '羊毛', spice: '香料', iron: '铁' };
/** The measure word each good is counted in. */
export const UNIT_ZH: Record<Good, string> = { salt: '袋', amber: '块', dye: '罐', wool: '捆', spice: '包', iron: '锭' };
export const UNIT_EN: Record<Good, [string, string]> = {
  salt: ['sack', 'sacks'],
  amber: ['lump', 'lumps'],
  dye: ['jar', 'jars'],
  wool: ['bale', 'bales'],
  spice: ['pouch', 'pouches'],
  iron: ['bar', 'bars'],
};
/** The Chinese word for coin, after a figure: 15 文. */
export const COIN_ZH = '文';

export function fmtCoin(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** A figure with a true minus sign (U+2212). */
export const num = (n: number): string => (n < 0 ? `−${-n}` : String(n));
/** A figure with its sign always shown. */
export const signed = (n: number): string => (n < 0 ? num(n) : `+${n}`);

export function goodName(g: Good, lang: Lang): string {
  return lang === 'zh' ? GOOD_ZH[g] : g;
}

export function unitName(g: Good, lang: Lang, n = 2): string {
  return lang === 'zh' ? UNIT_ZH[g] : UNIT_EN[g][n === 1 ? 0 : 1];
}

export function coinText(n: number, lang: Lang): string {
  return lang === 'zh' ? `${fmtCoin(n)} ${COIN_ZH}` : `${fmtCoin(n)} coin`;
}

export function qtyText(g: Good, n: number, lang: Lang): string {
  return lang === 'zh' ? `${n} ${UNIT_ZH[g]}${GOOD_ZH[g]}` : `${n} ${g}`;
}

/** "a, b and c" / "a、b和c". */
export function listText(items: string[], lang: Lang, empty?: string): string {
  if (items.length === 0) return empty ?? (lang === 'zh' ? '没什么' : 'nothing');
  if (items.length === 1) return items[0];
  const head = items.slice(0, -1).join(lang === 'zh' ? '、' : ', ');
  return lang === 'zh' ? spaceMixed(`${head}和${items[items.length - 1]}`) : `${head} and ${items[items.length - 1]}`;
}

export function goodsList(goods: Good[], lang: Lang): string {
  return listText(
    goods.map((g) => goodName(g, lang)),
    lang,
  );
}

export function isEmptyBundle(b: Bundle | undefined): boolean {
  return !b || Object.values(b).every((v) => !v);
}

export function bundleText(b: Bundle | undefined, lang: Lang): string {
  const parts: string[] = [];
  if (b) {
    for (const g of GOODS) if (b[g]) parts.push(qtyText(g, b[g]!, lang));
    if (b.coin) parts.push(coinText(b.coin, lang));
  }
  return listText(parts, lang);
}

/** Who is who in a deal, as text: the viewer is "I", the player is "you". */
export type NameOf = (id: string) => string;

/**
 * A deal described by someone watching it (viewer ''), or by one of the two
 * sides (viewer = their id).
 */
export function offerText(o: Offer, lang: Lang, nameOf: NameOf, human: string, viewer = o.from): string {
  const zh = lang === 'zh';
  const who = (id: string) => (id === viewer ? (zh ? '我' : 'I') : id === human ? (zh ? '你' : 'you') : nameOf(id));
  const s = (id: string) => (zh || id === viewer || id === human ? '' : 's');
  const b = (x: Bundle | undefined) => bundleText(x, lang);
  const parts: string[] = [];
  const give = !isEmptyBundle(o.give);
  const get = !isEmptyBundle(o.get);
  if (give || get) {
    if (!get) parts.push(zh ? `${who(o.from)}给出${b(o.give)}` : `${who(o.from)} give${s(o.from)} ${b(o.give)}`);
    else if (!give) parts.push(zh ? `${who(o.to)}给出${b(o.get)}` : `${who(o.to)} give${s(o.to)} ${b(o.get)}`);
    else if (viewer !== o.from && viewer !== o.to)
      parts.push(zh ? `${who(o.from)}给出${b(o.give)}，${who(o.to)}给出${b(o.get)}` : `${who(o.from)} give${s(o.from)} ${b(o.give)} and ${who(o.to)} give${s(o.to)} ${b(o.get)}`);
    else {
      const mine = viewer === o.from ? o.give : o.get;
      const theirs = viewer === o.from ? o.get : o.give;
      parts.push(zh ? `用${b(mine)}换${b(theirs)}` : `${b(mine)} for ${b(theirs)}`);
    }
  }
  if (o.later) {
    const due = o.later.due;
    if (!isEmptyBundle(o.later.give)) parts.push(zh ? `${who(o.from)}在第${due}天交付${b(o.later.give)}` : `${who(o.from)} deliver${s(o.from)} ${b(o.later.give)} on day ${due}`);
    if (!isEmptyBundle(o.later.get)) parts.push(zh ? `${who(o.to)}在第${due}天交付${b(o.later.get)}` : `${who(o.to)} deliver${s(o.to)} ${b(o.later.get)} on day ${due}`);
  }
  if (!parts.length) return zh ? '什么也没有' : 'nothing';
  return zh ? spaceMixed(parts.join('；之后')) : parts.join(', then ');
}

/** How a merchant puts a deal to the person in front of them. */
export function pitchText(o: Offer, lang: Lang): string {
  const zh = lang === 'zh';
  const b = (x: Bundle | undefined) => bundleText(x, lang);
  const parts: string[] = [];
  const give = !isEmptyBundle(o.give);
  const get = !isEmptyBundle(o.get);
  if (give && get) parts.push(zh ? `我出${b(o.give)}，换你的${b(o.get)}` : `I give ${b(o.give)} for your ${b(o.get)}`);
  else if (give) parts.push(zh ? `我给你${b(o.give)}` : `I give you ${b(o.give)}`);
  else if (get) parts.push(zh ? `你给我${b(o.get)}` : `you give me ${b(o.get)}`);
  if (o.later) {
    if (!isEmptyBundle(o.later.give)) parts.push(zh ? `第${o.later.due}天我再交付${b(o.later.give)}` : `I deliver ${b(o.later.give)} on day ${o.later.due}`);
    if (!isEmptyBundle(o.later.get)) parts.push(zh ? `第${o.later.due}天你再交付${b(o.later.get)}` : `you deliver ${b(o.later.get)} on day ${o.later.due}`);
  }
  if (!parts.length) return zh ? '什么也没有' : 'nothing';
  return zh ? spaceMixed(parts.join('，')) : parts.join(', and ');
}

// ---------- events and rumours ----------

const EVENT_EN: Record<EventKind, (g: string) => string> = {
  ship: (g) => `A cargo ship from the south ties up, heavy with ${g}. Prices drop.`,
  storm: (g) => `Storm on the strait. No boats get through, and ${g} climbs.`,
  guild: (g) => `The guild posts a big order for ${g}. Buyers line the quay.`,
  fair: (g) => `Fair day in town. Everyone wants ${g}.`,
  blight: (g) => `Bad news from the farms: ${g} will be short this season.`,
  quiet: () => 'A quiet morning on the quay.',
};

const EVENT_ZH: Record<EventKind, (g: string) => string> = {
  ship: (g) => `一艘南方来的货船靠了岸，满载${g}。价格跌了。`,
  storm: (g) => `海峡起了风暴，船都过不来，${g}涨价了。`,
  guild: (g) => `行会贴出一大笔${g}的订单，买家挤满了码头。`,
  fair: (g) => `城里赶集，人人都想要${g}。`,
  blight: (g) => `农庄传来坏消息：这一季${g}要短缺了。`,
  quiet: () => '码头上一个平静的早晨。',
};

export function eventText(kind: EventKind, goods: Good[], lang: Lang): string {
  return lang === 'zh' ? spaceMixed(EVENT_ZH[kind](goodsList(goods, lang))) : EVENT_EN[kind](goodsList(goods, lang));
}

export function rumorText(kind: EventKind, goods: Good[], day: number, lang: Lang): string {
  const g = goodsList(goods, lang);
  if (lang === 'zh') {
    const when = `第${day}天`;
    const zh: Record<EventKind, string> = {
      ship: `听说${when}有一艘满载${g}的船要到。`,
      storm: `渔民说${when}风暴会封住海峡，${g}会变得稀缺。`,
      guild: `行会打算在${when}大量收购${g}。`,
      fair: `${when}的集市会需要${g}。`,
      blight: `农庄捎来口信：${when}${g}会短缺。`,
      quiet: `${when}预计没什么动静。`,
    };
    return spaceMixed(zh[kind]);
  }
  const when = `on day ${day}`;
  const en: Record<EventKind, string> = {
    ship: `A ship loaded with ${g} is due ${when}.`,
    storm: `Fishermen say a storm will close the strait ${when}, and ${g} will be scarce.`,
    guild: `The guild means to buy up ${g} ${when}.`,
    fair: `The fair ${when} will want ${g}.`,
    blight: `Word from the farms: ${g} will run short ${when}.`,
    quiet: `Nothing much is expected ${when}.`,
  };
  return en[kind];
}

// ---------- the market's log ----------

/** Lines the engine writes into the log, in the language of the moment. */
export interface LogWords {
  dayOf(day: number, days: number): string;
  whisper(rumor: string): string;
  trade(a: string, b: string, deal: string): string;
  kept(debtor: string, youPay: boolean, what: string, creditor: string): string;
  broken(debtor: string, youPay: boolean, what: string, creditor: string, couldPay: boolean): string;
  close(lines: { name: string; profit: number }[]): string;
  says(name: string, text: string): string;
  heardFrom(name: string, rumor: string): string;
  you(words: string): string;
  /** The player's own name as it appears in a line. */
  youName: string;
}

const LOG_EN: LogWords = {
  dayOf: (d, n) => `Day ${d} of ${n}.`,
  whisper: (r) => `A dockhand whispers: ${r}`,
  trade: (a, b, deal) => `${a} and ${b} trade: ${deal}.`,
  kept: (d, you, what, c) => `${d} ${you ? 'deliver' : 'delivers'} ${what} to ${c} as promised.`,
  broken: (d, you, what, c, could) => `${d} ${you ? 'fail' : 'fails'} to deliver ${what} to ${c}${could ? '' : you ? ' (you did not have it)' : ' (they did not have it)'}.`,
  close: (lines) => `The market closes. ${lines.map((l, i) => `${i + 1}. ${l.name} ${signed(l.profit)}`).join(', ')}.`,
  says: (name, text) => `${name}: ${text}`,
  heardFrom: (name, r) => `${name} says: ${r}`,
  you: (w) => `You: ${w}`,
  youName: 'You',
};

const LOG_ZH: LogWords = {
  dayOf: (d, n) => spaceMixed(`第${d}天（共${n}天）。`),
  whisper: (r) => `一个码头工人悄悄告诉你：${r}`,
  trade: (a, b, deal) => spaceMixed(`${a}与${b}成交：${deal}。`),
  kept: (d, _you, what, c) => spaceMixed(`${d}按约把${what}交给了${c}。`),
  broken: (d, you, what, c, could) => spaceMixed(`${d}没能把${what}交给${c}${could ? '' : you ? '（你手上没有）' : '（对方手上没有）'}。`),
  close: (lines) => spaceMixed(`收市了。${lines.map((l, i) => `${i + 1}. ${l.name} ${signed(l.profit)}`).join('，')}。`),
  says: (name, text) => `${name}：${text}`,
  heardFrom: (name, r) => spaceMixed(`${name}说：`) + r,
  you: (w) => `你：${w}`,
  youName: '你',
};

export function logWords(lang: Lang): LogWords {
  return lang === 'zh' ? LOG_ZH : LOG_EN;
}

/** A line the player said, without its "You:" / "你：" lead, or null when it isn't one. */
export function stripYou(text: string): string | null {
  const m = text.match(/^(?:You:\s*|你：\s*)/);
  return m ? text.slice(m[0].length) : null;
}

// ---------- problems with a deal ----------

export interface ProblemWords {
  closed: string;
  unknownMerchant: string;
  self: string;
  unknownGood(k: string): string;
  badAmount(k: string): string;
  whole(k: string): string;
  empty: string;
  youLack(what: string): string;
  theyLack(name: string, what: string): string;
  laterDay: string;
  closesAfter(day: number): string;
  join: string;
}

const anyName = (k: string, lang: Lang) => ((GOODS as readonly string[]).includes(k) ? goodName(k as Good, lang) : k === 'coin' ? (lang === 'zh' ? '钱' : 'coin') : k);

const PROBLEMS_EN: ProblemWords = {
  closed: 'the market has closed',
  unknownMerchant: 'unknown merchant',
  self: 'a merchant cannot trade with themselves',
  unknownGood: (k) => `unknown good "${k}"`,
  badAmount: (k) => `bad amount for ${k}`,
  whole: (k) => `${k} comes in whole units`,
  empty: 'the deal is empty',
  youLack: (w) => `you don't have ${w}`,
  theyLack: (n, w) => `${n} doesn't have ${w}`,
  laterDay: 'a later delivery must be due on a later day',
  closesAfter: (d) => `the market closes after day ${d}`,
  join: '; ',
};

const PROBLEMS_ZH: ProblemWords = {
  closed: '市场已经收了',
  unknownMerchant: '没有这个商人',
  self: '商人不能和自己做买卖',
  unknownGood: (k) => `没有“${k}”这种货`,
  badAmount: (k) => `${anyName(k, 'zh')}的数量不对`,
  whole: (k) => `${anyName(k, 'zh')}只能按整份算`,
  empty: '这笔买卖是空的',
  youLack: (w) => spaceMixed(`你没有${w}`),
  theyLack: (n, w) => spaceMixed(`${n}没有${w}`),
  laterDay: '延后交付必须定在以后的某一天',
  closesAfter: (d) => spaceMixed(`市场在第${d}天之后就收了`),
  join: '；',
};

export function problemWords(lang: Lang): ProblemWords {
  return lang === 'zh' ? PROBLEMS_ZH : PROBLEMS_EN;
}

// ---------- what the merchants say around their stock lines ----------

export interface TalkWords {
  closed: string;
  bell: string;
  self: string;
  wontWork(problems: string): string;
  acceptWhat: string;
  cantGoThrough(problems: string): string;
  onlySpare(n: number): string;
  noneToSell(g: Good): string;
  dontNeed(g: Good): string;
  didntFollow: string;
  pickStall: string;
  needsNone: string;
  /** A stock line followed by a deal: "Here's my price: I give …." */
  withDeal(line: string, deal: string): string;
  /** A stock line followed by more words: "Between us, I heard this: …". */
  then(a: string, b: string): string;
  /** A stock line closed by a list: "Truth is, I need wool and dye." */
  sentence(line: string, rest: string): string;
}

const TALK_EN: TalkWords = {
  closed: 'The market has closed.',
  bell: 'The bell has rung. Trading talk is done for today; end the day to carry on.',
  self: 'Talking to yourself won’t move any goods.',
  wontWork: (p) => `That won’t work: ${p}.`,
  acceptWhat: 'Accept what? I haven’t offered you anything yet.',
  cantGoThrough: (p) => `That deal can’t go through any more: ${p}.`,
  onlySpare: (n) => `I can only spare ${n}. `,
  noneToSell: (g) => `You don’t have any ${g} to sell.`,
  dontNeed: (g) => `I don’t need ${g}.`,
  didntFollow: 'I didn’t follow that. Try "3 salt for 2 amber", "how much for your spice?", "what do you need?" or "any news?".',
  pickStall: 'Pick a stall first, or start with a merchant’s name.',
  needsNone: 'nothing in particular',
  withDeal: (l, d) => `${l} ${d}.`,
  then: (a, b) => (a ? `${a} ${b}` : b),
  sentence: (l, r) => `${l} ${r}.`,
};

const TALK_ZH: TalkWords = {
  closed: '市场已经收了。',
  bell: '收工的钟已经敲过了。今天的买卖话到此为止，结束这一天再接着谈吧。',
  self: '自言自语可换不来货。',
  wontWork: (p) => `这样不行：${p}。`,
  acceptWhat: '接受什么？我还没给你开过价呢。',
  cantGoThrough: (p) => `这笔买卖已经做不成了：${p}。`,
  onlySpare: (n) => spaceMixed(`我只能匀出${n}份。`),
  noneToSell: (g) => `你手上没有${GOOD_ZH[g]}可卖。`,
  dontNeed: (g) => `我不需要${GOOD_ZH[g]}。`,
  didntFollow: '我没听明白。试试“3 罐染料换 2 捆羊毛”“你的香料多少钱？”“你缺什么？”或者“有什么消息？”。',
  pickStall: '先选一个摊位，或者在开头叫出商人的名字。',
  needsNone: '没什么特别要的',
  withDeal: (l, d) => spaceMixed(`${l}${d}。`),
  then: (a, b) => a + b,
  sentence: (l, r) => spaceMixed(`${l}${r}。`),
};

export function talkWords(lang: Lang): TalkWords {
  return lang === 'zh' ? TALK_ZH : TALK_EN;
}

// ---------- people, places and clients ----------

/** Chinese blurbs for the merchants, by their (Latin) name. */
const BLURB_ZH: Record<string, string> = {
  'Marta Vey': '山间农庄来的羊毛和染料。说话算话，也记得谁守过信用。',
  'Oskar Brine': '经营盐田和一座铁匠铺。每一文都要讨价，很少先开口让步。',
  'Ilse Tamm': '夜船上运来的琥珀和香料。讨人喜欢，消息灵通，却不总说实话。',
  'Pell Dorran': '一条装着杂货的河驳船。有耐心，说话直，喜欢爽快的买卖。',
  You: '初来乍到，带着一辆货车、一点钱和一张好订单。',
};

/** Chinese spellings players may use for each merchant's first name. */
export const NAME_ZH: Record<string, string[]> = {
  'Marta Vey': ['玛塔', '玛尔塔', '马塔'],
  'Oskar Brine': ['奥斯卡'],
  'Ilse Tamm': ['伊尔莎', '伊尔丝', '伊丽莎'],
  'Pell Dorran': ['佩尔', '贝尔'],
};

const CLIENT_ZH: Record<string, string> = {
  'the abbey': '修道院',
  'the shipwright': '造船匠',
  'the duke’s steward': '公爵的管家',
  'a glassworks': '一家玻璃坊',
  'the dyers’ guild': '染匠行会',
  'a caravan master': '一位商队首领',
  'the lighthouse keeper': '灯塔看守人',
};

export function blurbText(name: string, blurb: string, lang: Lang): string {
  return lang === 'zh' ? (BLURB_ZH[name] ?? blurb) : blurb;
}

export function clientText(client: string, lang: Lang): string {
  return lang === 'zh' ? (CLIENT_ZH[client] ?? client) : client;
}

export function personalityText(p: string, lang: Lang): string {
  if (lang !== 'zh') return p;
  return ({ fair: '公道', hard: '强硬', sly: '狡黠', human: '' } as Record<string, string>)[p] ?? p;
}
