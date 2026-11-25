// What the built-in merchants say. Each personality has its own lines, in
// English and in Simplified Chinese.
//
// Both language packs hold the same number of lines for every moment, and a
// line is picked by a number that comes from the seed, never from the text, so
// a seeded market plays out identically whichever language it is spoken in.
import type { Lang } from '../i18n/lang.js';
import type { Personality } from '../engine/types.js';

export type Moment = 'accept' | 'counter' | 'reject' | 'insulted' | 'sulk' | 'noCredit' | 'greet' | 'offer' | 'noNews' | 'news' | 'secret' | 'notForSale' | 'quote' | 'want' | 'cantAfford' | 'bid' | 'bye';

export type Pack = Record<Exclude<Personality, 'human'>, Record<Moment, string[]>>;

const EN: Pack = {
  fair: {
    accept: ['Done. Fair trade.', 'Shake on it, then.', 'That works for me.'],
    counter: ['Not quite. How about this:', 'Close. Meet me here:', 'I can do it like this:'],
    reject: ['That doesn’t work for me, sorry.', 'I’ll pass on that one.'],
    insulted: ['Come now, that’s not a serious offer.', 'You know that’s worth more than that.'],
    sulk: ['I’d rather not deal with you today.', 'After last time? Not today.'],
    noCredit: ['I’ll want that paid now, not promised.'],
    greet: ['Morning! What do you need?', 'Good to see you. Looking for anything?'],
    offer: ['I have a proposal for you:', 'Here’s a deal that might suit us both:'],
    noNews: ['I haven’t heard anything worth passing on.'],
    news: ['Between us, I heard this:', 'Here’s what the boatmen told me:'],
    secret: ['I keep what I hear to myself, I’m afraid.'],
    notForSale: ['That one’s promised elsewhere, I need all of it.'],
    quote: ['I could let some go:', 'For you:'],
    want: ['I’m after a few things:', 'Truth is, I need'],
    cantAfford: ['I don’t have the coin for that.'],
    bid: ['I could use some. I’d pay:', 'I’ll buy:'],
    bye: ['Safe roads.'],
  },
  hard: {
    accept: ['Fine. Done.', 'Agreed. Don’t make me regret it.', 'Hm. Deal.'],
    counter: ['No. This, and not a coin less:', 'Try again. I’ll take this:', 'Here’s my price:'],
    reject: ['No.', 'Not at that price.', 'I’ve heard better from gulls.'],
    insulted: ['Don’t waste my morning.', 'Is that a joke?'],
    sulk: ['We’re done talking for today.', 'Find someone else.'],
    noCredit: ['Coin on the table. I don’t do promises.'],
    greet: ['What.', 'Make it quick.'],
    offer: ['Here’s what I’ll do, once:', 'One offer:'],
    noNews: ['Nothing.'],
    news: ['Fine. I heard:'],
    secret: ['News costs more than you’ve got.'],
    notForSale: ['Not selling that.'],
    quote: ['My price:', 'It’ll cost you:'],
    want: ['Maybe I’d take'],
    cantAfford: ['I don’t have it, and I wouldn’t pay that anyway.'],
    bid: ['I’ll pay this and no more:', 'Here’s my bid:'],
    bye: ['Hm.'],
  },
  sly: {
    accept: ['Lovely. A pleasure, as always.', 'Done, darling.', 'You drive a sweet bargain.'],
    counter: ['Oh, almost. Make it this and we’re friends:', 'Let’s sweeten it a little:', 'For you, I’d do this:'],
    reject: ['Oh, I couldn’t possibly.', 'Not today, I think.'],
    insulted: ['You wound me.', 'I’ll pretend I didn’t hear that.'],
    sulk: ['I’m terribly busy today.', 'Another time, perhaps.'],
    noCredit: ['Promises are pretty things, but I’d like it now.'],
    greet: ['There you are. I was hoping you’d come by.', 'Ah, my favourite newcomer.'],
    offer: ['I’ve been saving this for you:', 'Here’s a little something:'],
    noNews: ['The quay’s been dull, sadly.'],
    news: ['Don’t tell a soul, but:', 'Since you asked so nicely:'],
    secret: ['A lady never tells.'],
    notForSale: ['Oh, that’s spoken for.'],
    quote: ['Only because it’s you:', 'A special price:'],
    want: ['I might be tempted by'],
    cantAfford: ['My purse is lighter than it looks.'],
    bid: ['I might take some off your hands:', 'For you, I\u2019d pay:'],
    bye: ['Until tomorrow.'],
  },
};

const ZH: Pack = {
  fair: {
    accept: ['成交。公平买卖。', '那就握个手吧。', '这样我可以。'],
    counter: ['还差一点。这样如何：', '很接近了。咱们各让一步：', '我可以这样做：'],
    reject: ['这样对我不合适，抱歉。', '这笔我就不做了。'],
    insulted: ['得了吧，这可不是正经出价。', '你知道这东西不止这个价。'],
    sulk: ['今天我不想跟你打交道。', '上回那样？今天免谈。'],
    noCredit: ['这笔我要现钱，不要空口许诺。'],
    greet: ['早！需要点什么？', '见到你真好。想找点什么吗？'],
    offer: ['我有个提议：', '这笔买卖也许对咱俩都合适：'],
    noNews: ['我没听到什么值得说的。'],
    news: ['咱俩私下说，我听说：', '船夫们是这么跟我说的：'],
    secret: ['我听到的事都烂在肚子里，抱歉。'],
    notForSale: ['那个已经许给别人了，我全都要用。'],
    quote: ['我可以让出一些：', '给你的价：'],
    want: ['我在找这几样：', '说实话，我需要'],
    cantAfford: ['我没那么多钱。'],
    bid: ['我用得上。我出：', '我收：'],
    bye: ['一路平安。'],
  },
  hard: {
    accept: ['行。成交。', '同意。别让我后悔。', '哼。成交。'],
    counter: ['不行。就这个，一文都不能少：', '再来。我要这个：', '我的价：'],
    reject: ['不。', '这个价不行。', '海鸥都比你出得高。'],
    insulted: ['别浪费我的早上。', '开玩笑吧？'],
    sulk: ['今天到此为止。', '找别人去。'],
    noCredit: ['钱放桌上。我不赊账。'],
    greet: ['什么事。', '快说。'],
    offer: ['我就开这一次价：', '就一个价：'],
    noNews: ['没有。'],
    news: ['行吧。我听说：'],
    secret: ['消息可比你兜里的钱贵。'],
    notForSale: ['那个不卖。'],
    quote: ['我的价：', '得花你：'],
    want: ['也许我会收点'],
    cantAfford: ['我没那么多，而且也不会出这个价。'],
    bid: ['我出这个，多一文都没有：', '我的出价：'],
    bye: ['哼。'],
  },
  sly: {
    accept: ['太好了。一如既往，很愉快。', '成交，亲爱的。', '你可真会讨价还价。'],
    counter: ['哎呀，就差一点。改成这样，咱们就是朋友了：', '咱们再添点甜头：', '为了你，我愿意这样：'],
    reject: ['哦，这我可不能答应。', '今天恐怕不行。'],
    insulted: ['你真伤我的心。', '我就当没听见。'],
    sulk: ['我今天忙得很。', '改天吧。'],
    noCredit: ['许诺是好看，可我想现在就拿到。'],
    greet: ['你来啦。我正盼着你过来呢。', '啊，我最喜欢的新来的。'],
    offer: ['这是我特意给你留的：', '有件小东西给你：'],
    noNews: ['码头上冷清得很，可惜。'],
    news: ['别告诉别人，不过：', '既然你问得这么客气：'],
    secret: ['淑女从不多嘴。'],
    notForSale: ['哦，那个已经有主了。'],
    quote: ['只因为是你：', '特价：'],
    want: ['要是有，我也许想要'],
    cantAfford: ['我的钱袋比看上去轻。'],
    bid: ['我也许能帮你脱手一些：', '为了你，我出：'],
    bye: ['明天见。'],
  },
};

export const PACKS: Record<Lang, Pack> = { en: EN, zh: ZH };

/**
 * A line for the moment, picked by a number so replays say the same thing.
 * The pick depends only on the number, so English and Chinese choose the same
 * line in the same place.
 */
export function line(p: Personality, m: Moment, pick: number, lang: Lang = 'en'): string {
  const set = PACKS[lang][p === 'human' ? 'fair' : p][m];
  return set[Math.abs(Math.floor(pick)) % set.length];
}
