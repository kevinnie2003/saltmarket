// Reads what the player types in Chinese into the same intents as the English
// reader: offers, deliveries promised for later, prices, bids, needs, news,
// yes, no and hello. Chinese numerals (两、十五、二十), full-width digits and
// English good names inside a Chinese line all work.
import { HUMAN } from '../engine/game.js';
import { GOODS, type Bundle, type GameState, type Good } from '../engine/types.js';
import { bumpOffer, onlyCoin, onlyGoods, type Intent } from './parse.js';

type Later = { give?: Bundle; get?: Bundle; due: number };

// ---------- words ----------

/** Good names, longest first so 铁锭 wins over 铁. */
const GOOD_ALIASES: [string, Good][] = (
  [
    ['海盐', 'salt'], ['盐巴', 'salt'], ['食盐', 'salt'], ['盐', 'salt'],
    ['琥珀', 'amber'], ['蜜蜡', 'amber'],
    ['染料', 'dye'], ['颜料', 'dye'], ['染剂', 'dye'],
    ['羊毛', 'wool'], ['毛料', 'wool'], ['羊绒', 'wool'],
    ['香料', 'spice'], ['香辛料', 'spice'], ['胡椒', 'spice'],
    ['铁锭', 'iron'], ['铁条', 'iron'], ['铁块', 'iron'], ['生铁', 'iron'], ['熟铁', 'iron'], ['铁', 'iron'],
    ['salts', 'salt'], ['salt', 'salt'], ['ambers', 'amber'], ['amber', 'amber'], ['dyes', 'dye'], ['dye', 'dye'],
    ['wools', 'wool'], ['wool', 'wool'], ['fleece', 'wool'], ['spices', 'spice'], ['spice', 'spice'], ['pepper', 'spice'],
    ['irons', 'iron'], ['iron', 'iron'],
  ] as [string, Good][]
).sort((a, b) => b[0].length - a[0].length);

/** Words that make a figure coin: 15 枚, 10 个钱, 12 文, 20 块钱. */
const COIN_WORDS = ['钱币', '铜钱', '铜板', '铜币', '银币', '金币', '银子', '银两', '块钱', '钱', '文', '枚', '元', 'coins', 'coin'].sort((a, b) => b.length - a.length);
/** Measure words between a figure and a good. 块 and 两 alone after a figure mean coin. */
const MEASURES = '个份袋块罐捆包条锭根把斤只件盒箱桶串两';
const COINISH_MEASURES = '块两';

const NUMERAL = '零〇一二两俩仨三四五六七八九十百';
const DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 俩: 2, 仨: 3, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 十五 → 15, 二十 → 20, 一百二十 → 120, 两 → 2. Null when it isn't a number. */
export function zhNumber(s: string): number | null {
  if (!s) return null;
  if (/^[零〇一二两俩仨三四五六七八九]$/.test(s)) return DIGIT[s];
  let total = 0;
  let cur = 0;
  let seen = false;
  for (const ch of s) {
    if (ch in DIGIT) {
      cur = DIGIT[ch];
      seen = true;
    } else if (ch === '十') {
      total += (seen ? cur : 1) * 10;
      cur = 0;
      seen = false;
    } else if (ch === '百') {
      total += (seen ? cur : 1) * 100;
      cur = 0;
      seen = false;
    } else return null;
  }
  return total + cur;
}

const goodPattern = GOOD_ALIASES.map(([w]) => w).join('|');
/** What may follow a Chinese numeral for it to be read as a number. */
const AFTER_NUMBER = new RegExp(String.raw`^\s*(?:[${MEASURES}]|${COIN_WORDS.join('|')}|${goodPattern}|[天日号打]|换|买|卖|给|吧|怎么样|如何|行|呢|成|好|可以|的|[,.?!;]|$)`);
/** What may come before one for the same reason. */
const BEFORE_NUMBER = /(?:第|出|付|给|花|用|拿|要|收|卖|买|换|就|改成|算|过|加)\s*$/;

/** Turns Chinese numerals into digits where they stand for an amount or a day, leaving words like 一言为定 alone. */
export function digitsFromNumerals(t: string): string {
  return t
    .replace(/半打/g, '6')
    .replace(new RegExp(`([${NUMERAL}]+)`, 'g'), (run, _m, offset: number, whole: string) => {
      let unit = '';
      let body = run as string;
      // 十两银子: a trailing 两 after another numeral is the silver measure, not "two".
      if (body.length > 1 && body.endsWith('两')) {
        body = body.slice(0, -1);
        unit = '两';
      }
      const n = zhNumber(body);
      if (n === null) return run;
      const after = whole.slice(offset + run.length);
      const before = whole.slice(0, offset);
      // 10两: after a figure, 两 is the measure.
      if (/\d\s*$/.test(before)) return run;
      const fits = AFTER_NUMBER.test(unit ? unit + after : after) || (body !== '一' && BEFORE_NUMBER.test(before));
      return fits ? `${n}${unit}` : run;
    })
    .replace(/(\d+)打/g, (_, n) => String(Number(n) * 12));
}

function normaliseZh(text: string): string {
  return digitsFromNumerals(
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[、，]/g, ',')
      .replace(/[。．]/g, '.')
      .replace(/[“”"‘’「」『』《》()（）]/g, '')
      // A space between two figures keeps them apart; any other space goes.
      .replace(/(\d)\s+(?=\d)/g, '$1,')
      .replace(/\s+/g, ''),
  )
    .replace(/^(?:那个|嗯+|喂|嘿|哎|唉|老板娘?|掌柜的?|大姐|大哥|朋友|这位)[,]*/, '')
    .replace(/[.?!~…]+$/, '')
    .replace(/^[,.:;]+/, '');
}

// ---------- amounts ----------

/** Read "2份羊毛和10文", "15枚", "3罐染料", "琥珀", "15". A bare figure is coin when `bareIsCoin`. */
export function readBundleZh(text: string, bareIsCoin = true): Bundle | null {
  const out: Bundle = {};
  let found = false;
  let pending: number | null = null;
  let measure = '';
  const flush = () => {
    if (pending !== null && (bareIsCoin || (!!measure && COINISH_MEASURES.includes(measure)))) {
      out.coin = (out.coin ?? 0) + pending;
      found = true;
    }
    pending = null;
    measure = '';
  };
  let i = 0;
  outer: while (i < text.length) {
    const rest = text.slice(i);
    const n = rest.match(/^\d+(?:\.\d+)?/);
    if (n) {
      flush();
      pending = Number(n[0]);
      i += n[0].length;
      continue;
    }
    for (const [w, g] of GOOD_ALIASES) {
      if (rest.startsWith(w)) {
        out[g] = (out[g] ?? 0) + (pending ?? 1);
        found = true;
        pending = null;
        measure = '';
        i += w.length;
        continue outer;
      }
    }
    for (const w of COIN_WORDS) {
      if (rest.startsWith(w)) {
        if (pending !== null) {
          out.coin = (out.coin ?? 0) + pending;
          found = true;
        }
        pending = null;
        measure = '';
        i += w.length;
        continue outer;
      }
    }
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (pending !== null && !measure && MEASURES.includes(ch)) {
      measure = ch;
      i++;
      continue;
    }
    // "的" sits between a measure and a good: 2份的羊毛.
    if (ch === '的' && pending !== null) {
      i++;
      continue;
    }
    flush();
    i++;
  }
  flush();
  return found ? out : null;
}

function firstGood(text: string): { good: Good; qty: number } | null {
  const b = readBundleZh(text, false);
  if (!b) return null;
  const g = GOODS.find((x) => (b[x] ?? 0) > 0);
  return g ? { good: g, qty: b[g] ?? 1 } : null;
}

const hasGood = (t: string) => GOOD_ALIASES.some(([w]) => t.includes(w));

// ---------- deliveries promised for later ----------

const WHEN = /第(\d+)[天日]|大后天|后天|明天|明日|(\d+)天(?:以|之)?后|过(\d+)天|(?:收市|闭市|散市)(?:时|前|那天|的时候)?|最后一天/;

function dueFrom(state: GameState, m: RegExpMatchArray): number {
  if (m[1]) return Number(m[1]);
  if (m[2]) return state.day + Number(m[2]);
  if (m[3]) return state.day + Number(m[3]);
  const w = m[0];
  if (w.startsWith('大后天')) return state.day + 3;
  if (w.startsWith('后天')) return state.day + 2;
  if (w.startsWith('明')) return state.day + 1;
  return state.days;
}

/** Splits a clause so a "第4天…" part after the deal of the moment stands on its own. */
function splitAtWhen(clause: string): string[] {
  const m = clause.match(WHEN);
  if (!m || !m.index) return [clause];
  let j = m.index;
  while (j > 0 && '再在于并且就'.includes(clause[j - 1])) j--;
  if (j > 0 && '我你'.includes(clause[j - 1]) && !(j > 1 && '给卖付交还送帮让跟和向'.includes(clause[j - 2]))) j--;
  const head = clause.slice(0, j);
  return head && readBundleZh(head) ? [head, clause.slice(j)] : [clause];
}

/** Which way a later clause runs: "第4天付你15枚" is the player paying, "你第4天给我2份铁" the merchant delivering. */
function laterSide(c: string): 'give' | 'get' {
  if (/(?:付|给|交|还|送|带|补|运)(?:给)?我/.test(c) || /^你/.test(c.replace(WHEN, ''))) return 'get';
  return 'give';
}

// ---------- the reader ----------

const ACCEPT_STRONG = /成交|一言为定|就这么(?:定|办)|我接受|我同意|我要了|我买了|拍板|说定了|^就这样/;
const ACCEPT = /^(?:好的?|好吧|好啊|好呀|好嘞|行|行吧|行啊|可以|可以的|同意|接受|没问题|定了|妥了?|成|那就这样|就这么着|ok|okay|deal|yes)(?:[,.!]|了|吧|啊|呀|的)*/;
const REJECT =
  /^(?:不要|不了|不用|不必|不行|不成|不干|不换|不买|不卖|不划算|不合适|不好|不|算了|算啦|拒绝|没兴趣|免了|免谈|再见|拜拜|告辞|回头见|明天见|下次吧|改天吧|改天|谢谢|多谢|谢了|太贵|太高|太少|太低|太黑|好贵|贵了|no|nope|bye)/;
const NEWS = /消息|新闻|传闻|传言|风声|听说了?(?:什么|啥)|听到(?:了)?(?:什么|啥)|听见(?:什么|啥)|新鲜事|八卦|小道|行情|(?:什么|啥)动静|有啥事/;
const NEEDS = /(?:缺|需要|想要|要|收|找|想买|买|在找|在收|缺少)(?:些|点)?(?:什么|啥|哪些|哪几样)(?![价换])|有什么需要|需要点什么|要点什么|缺点什么/;
const PRICE_WORDS = /多少钱|多少文|多少枚|多少|几个钱|几文|几钱|什么价|啥价|价钱|价格|怎么卖|如何卖|卖多少|卖几|要多少|开个价|报个价|开价|报价|怎么算|贵不贵|值多少|值几/;
const HELLO = /^(?:你好|您好|早上好|早安|上午好|下午好|晚上好|早|嗨|哈喽|哈啰|喂|嘿|幸会|久仰|hi|hello)/;

/** Exchange words and which way the goods go: left is what the player hands over unless said otherwise. */
const CONNECTORS: [RegExp, 'swap' | 'buy' | 'sellTo' | 'buyFrom'][] = [
  [/卖给你|卖你/, 'sellTo'],
  [/卖给我|卖我/, 'buyFrom'],
  [/换取|换回|来换|交换|换|兑/, 'swap'],
  [/买下|来买|购买|买/, 'buy'],
];

const GIVE_ME = /给我|卖给我|卖我|让我|交给我|送我|我要|我买|^买|^来|你先给/;
const I_GIVE = /我给|给你|我付|付你|我出|^出|先付|^付|我用|^用|^拿|我拿/;

export function readIntentZh(state: GameState, raw: string, to?: string): Intent {
  const t = normaliseZh(raw);
  if (!t) return { kind: 'hello' };
  const plain = !/\d/.test(t) && !hasGood(t);
  if (plain && ACCEPT_STRONG.test(t) && !/不成交|不接受|不同意|不要了/.test(t)) return { kind: 'accept' };
  if (plain && REJECT.test(t) && !/^不错/.test(t)) return { kind: 'reject' };
  if (plain && ACCEPT.test(t)) return { kind: 'accept' };
  if (NEWS.test(t)) return { kind: 'news' };
  if (!hasGood(t) && NEEDS.test(t)) return { kind: 'needs' };

  const bid = readBid(t);
  if (bid) return bid;
  if (PRICE_WORDS.test(t) && !/换.*换/.test(t)) {
    const g = firstGood(t);
    if (g) return { kind: 'price', ...g };
  }
  const bump = readBumpZh(state, t, to);
  if (bump) return bump;
  const offer = readOfferZh(state, t, to);
  if (offer) return offer;

  // 我想卖盐, 卖你3袋盐: what would they pay?
  const sell = t.match(/^(?:我(?:想|要|打算|可以)?|想|打算)(?:卖|出售|出手)(?:给你|你)?(.+)$|^(?:卖给你|卖你)(.+)$/);
  if (sell) {
    const g = firstGood(sell[1] ?? sell[2]);
    if (g) return { kind: 'bid', ...g };
  }
  // Everyday asks for goods: 有铁吗, 卖香料吗, 我想买琥珀, 来两份铁, 我要2份铁.
  if (/^(?:你)?(?:这儿|这里)?(?:有|卖|还有)(?:没有)?.+(?:吗|么|没有|没|不)?$/.test(t) || /^(?:我)?(?:想|要|想要|需要|打算)?(?:买|来|要)/.test(t)) {
    const g = firstGood(t);
    if (g) return { kind: 'price', ...g };
  }
  if (HELLO.test(t)) return { kind: 'hello' };
  return { kind: 'unknown', text: raw.trim() };
}

/** "你出多少买我的盐", "我的盐你给多少", "收不收铁", "买我的琥珀吗". */
function readBid(t: string): Intent | null {
  const g = firstGood(t);
  if (!g) return null;
  const mine = /我的/.test(t) && !/你的/.test(t);
  if (mine && (PRICE_WORDS.test(t) || /[吗么]$|收|买|要不要/.test(t))) return { kind: 'bid', ...g };
  if (/(?:出|给|开|付)(?:个)?(?:多少|什么价|啥价|个价|几)/.test(t) && !/换/.test(t)) return { kind: 'bid', ...g };
  if (/(?:收|买|要)不(?:收|买|要)|(?:收|买)(?:点)?我(?:的)?/.test(t)) return { kind: 'bid', ...g };
  if (/^我(?:这儿|这里|手上|手里)?有.+(?:要|收|买)(?:不要|不收|不买|吗|么|不)/.test(t)) return { kind: 'bid', ...g };
  return null;
}

/** "14怎么样", "那就16吧", "改成12", "12文行不行": a new coin figure for the deal on the table. */
function readBumpZh(state: GameState, t: string, to?: string): Intent | null {
  const m = t.match(
    /^(?:好|行|那|那就|那么|就|要不|不如|改成|换成|算|算你|给你|我出|出|我给|我付|最多|顶多|这样吧|这样|,)*(\d+)(?:个|枚|文|块|元|两)?(?:钱|钱币|铜钱|coin|coins)?(?:吧|怎么样|如何|行吗|行不行|可以吗|可以不|好吗|呢|成吗|成不成|行|好了|得了|算了|就成交|成交|吗|,)*$/,
  );
  if (!m || !to) return null;
  return bumpOffer(state, to, Number(m[1]));
}

function readOfferZh(state: GameState, t: string, to?: string): Intent | null {
  // Pull out the parts that happen on a later day.
  const clauses = t.split(/[,;]|然后|之后再/).filter(Boolean).flatMap(splitAtWhen);
  let later: Later | undefined;
  const now: string[] = [];
  for (const c of clauses) {
    const w = c.match(WHEN);
    if (w) {
      const b = readBundleZh(c.replace(WHEN, ''));
      if (b) {
        const due = dueFrom(state, w);
        later = laterSide(c) === 'get' ? { get: b, due } : { give: b, due };
        continue;
      }
    }
    now.push(c.replace(WHEN, ''));
  }
  const text = now.join(',');

  // One exchange word with an amount on each side.
  for (const [re, kind] of CONNECTORS) {
    const m = text.match(re);
    if (!m || m.index === undefined) continue;
    const left = text.slice(0, m.index);
    const right = text.slice(m.index + m[0].length);
    let a = readBundleZh(left);
    let b = readBundleZh(right);
    let after = false;
    if (!a && b && /,/.test(right)) {
      // 卖你2捆羊毛,10文 / 买2份羊毛,10文: both amounts come after the word.
      const [x, ...y] = right.split(',');
      a = readBundleZh(x);
      b = readBundleZh(y.join(','));
      after = true;
    }
    if (!a || !b) continue;
    if (after && kind === 'swap') continue;
    let give: Bundle;
    let get: Bundle;
    if (kind === 'buyFrom' || (kind === 'buy' && after)) [give, get] = [b, a];
    else [give, get] = [a, b];
    // "你的琥珀换我的3袋盐" reads the other way round.
    if (kind === 'swap' && ((/你的/.test(left) && !/我的/.test(left)) || (/我的/.test(right) && !/你的/.test(right)))) [give, get] = [get, give];
    if (kind === 'swap') [give, get] = purchaseOrder(state, to, give, get);
    return { kind: 'offer', give, get, later };
  }

  // Two clauses, one for each side: "你给我2份铁,我给你15枚".
  const parts = now.map((c) => ({ c, b: readBundleZh(c) })).filter((p): p is { c: string; b: Bundle } => !!p.b);
  if (parts.length === 2) {
    const side = (c: string) => (GIVE_ME.test(c) ? 'get' : I_GIVE.test(c) ? 'give' : null);
    let [s0, s1] = [side(parts[0].c), side(parts[1].c)];
    if (s0 && !s1) s1 = s0 === 'get' ? 'give' : 'get';
    if (s1 && !s0) s0 = s1 === 'get' ? 'give' : 'get';
    if (s0 && s1 && s0 !== s1) {
      const give = s0 === 'give' ? parts[0].b : parts[1].b;
      const get = s0 === 'get' ? parts[0].b : parts[1].b;
      return { kind: 'offer', give, get, later };
    }
    return null;
  }
  if (parts.length === 1) {
    const { c, b } = parts[0];
    // One amount holding goods and coin: "卖我2份铁15文", "我想买2份羊毛10文".
    const goods: Bundle = {};
    for (const g of GOODS) if (b[g]) goods[g] = b[g];
    if (b.coin && onlyGoods(goods) && !later) {
      if (/卖给你|卖你|我卖/.test(c)) return { kind: 'offer', give: goods, get: { coin: b.coin } };
      if (/买|卖给我|卖我|给我|我要|卖不卖|卖吗/.test(c)) return { kind: 'offer', give: { coin: b.coin }, get: goods };
      // "2份铁15文怎么样": a purchase from a stall that has them, a sale from a player who has them.
      const [give, get] = purchaseOrder(state, to, goods, { coin: b.coin });
      return give === goods && !playerHas(state, goods) ? null : { kind: 'offer', give, get };
    }
    if (later) {
      // "先给我2份铁,第4天付你15枚"
      if (GIVE_ME.test(c) || (later.give && !I_GIVE.test(c))) return { kind: 'offer', give: {}, get: b, later };
      if (I_GIVE.test(c) || later.get) return { kind: 'offer', give: b, get: {}, later };
    }
  }
  return null;
}

/** "琥珀换15文" said to someone who has amber, by a player who has none, is a purchase. */
function purchaseOrder(state: GameState, to: string | undefined, give: Bundle, get: Bundle): [Bundle, Bundle] {
  if (!to || !onlyGoods(give) || !onlyCoin(get)) return [give, get];
  const you = state.merchants.find((m) => m.id === HUMAN);
  const them = state.merchants.find((m) => m.id === to);
  const g = GOODS.find((x) => (give[x] ?? 0) > 0)!;
  if (you && them && you.goods[g] < (give[g] ?? 0) && them.goods[g] >= (give[g] ?? 0)) return [get, give];
  return [give, get];
}

function playerHas(state: GameState, b: Bundle): boolean {
  const you = state.merchants.find((m) => m.id === HUMAN);
  return !!you && GOODS.every((g) => (b[g] ?? 0) <= you.goods[g]);
}
