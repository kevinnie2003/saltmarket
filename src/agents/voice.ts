// What the built-in merchants say. Each personality has its own lines.
import type { Personality } from '../engine/types.js';

export type Moment = 'accept' | 'counter' | 'reject' | 'insulted' | 'sulk' | 'noCredit' | 'greet' | 'offer' | 'noNews' | 'news' | 'secret' | 'notForSale' | 'quote' | 'want' | 'cantAfford' | 'bid' | 'bye';

const LINES: Record<Exclude<Personality, 'human'>, Record<Moment, string[]>> = {
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

/** A line for the moment, picked by a number so replays say the same thing. */
export function line(p: Personality, m: Moment, pick: number): string {
  const set = LINES[p === 'human' ? 'fair' : p][m];
  return set[Math.abs(Math.floor(pick)) % set.length];
}
