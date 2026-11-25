import { describe, expect, it } from 'vitest';
import { HUMAN } from '../src/engine/game.js';
import { newGame } from '../src/agents/session.js';
import { parseTalk } from '../src/talk/parse.js';
import { digitsFromNumerals, readBundleZh, zhNumber } from '../src/talk/zh.js';

// Seed 5: the player has dye, iron, salt and spice; Pell Dorran (m1) has wool
// and iron; Marta Vey is m2 and Ilse Tamm m3.
const game = () => newGame({ seed: 5, talkPerDay: 20 });
const read = (text: string, stall = 'm1') => parseTalk(game(), text, stall).intent;

describe('Chinese numbers and amounts', () => {
  it('reads Chinese numerals', () => {
    expect(zhNumber('两')).toBe(2);
    expect(zhNumber('十')).toBe(10);
    expect(zhNumber('十五')).toBe(15);
    expect(zhNumber('二十')).toBe(20);
    expect(zhNumber('二十五')).toBe(25);
    expect(zhNumber('一百二十')).toBe(120);
    expect(zhNumber('鱼')).toBeNull();
  });

  it('turns numerals into figures only where they are amounts or days', () => {
    expect(digitsFromNumerals('两份铁')).toBe('2份铁');
    expect(digitsFromNumerals('出十五换三袋盐')).toBe('出15换3袋盐');
    expect(digitsFromNumerals('第四天')).toBe('第4天');
    expect(digitsFromNumerals('一言为定')).toBe('一言为定');
    expect(digitsFromNumerals('等一下')).toBe('等一下');
    expect(digitsFromNumerals('十两银子')).toBe('10两银子');
    expect(digitsFromNumerals('半打羊毛')).toBe('6羊毛');
  });

  it('reads bundles with measure words, coin words and plain figures', () => {
    expect(readBundleZh('2份羊毛和10文')).toEqual({ wool: 2, coin: 10 });
    expect(readBundleZh('10个钱')).toEqual({ coin: 10 });
    expect(readBundleZh('15枚')).toEqual({ coin: 15 });
    expect(readBundleZh('20块钱')).toEqual({ coin: 20 });
    expect(readBundleZh('3块琥珀')).toEqual({ amber: 3 });
    expect(readBundleZh('琥珀')).toEqual({ amber: 1 });
    expect(readBundleZh('2份的铁锭')).toEqual({ iron: 2 });
    expect(readBundleZh('12')).toEqual({ coin: 12 });
    expect(readBundleZh('12', false)).toBeNull();
    expect(readBundleZh('3 wool和5 coin')).toEqual({ wool: 3, coin: 5 });
  });
});

describe('reading Chinese at the stalls', () => {
  it('knows who is addressed, by Latin name or Chinese spelling', () => {
    const g = game();
    expect(parseTalk(g, '玛塔，你缺什么？', 'm1')).toMatchObject({ to: 'm2', intent: { kind: 'needs' } });
    expect(parseTalk(g, 'Marta，你要什么？', 'm1')).toMatchObject({ to: 'm2', intent: { kind: 'needs' } });
    expect(parseTalk(g, 'Marta Vey：有什么消息', 'm1')).toMatchObject({ to: 'm2', intent: { kind: 'news' } });
    expect(parseTalk(g, '你好，伊尔莎', 'm1')).toMatchObject({ to: 'm3', intent: { kind: 'hello' } });
    expect(parseTalk(g, '嘿，伊尔莎，琥珀怎么卖？', 'm1')).toMatchObject({ to: 'm3', intent: { kind: 'price', good: 'amber', qty: 1 } });
    expect(parseTalk(g, 'Ilse, 你好', 'm1')).toMatchObject({ to: 'm3', intent: { kind: 'hello' } });
  });

  it('reads offers paid in coin or goods', () => {
    expect(read('10 个钱买 2 份羊毛')).toMatchObject({ kind: 'offer', give: { coin: 10 }, get: { wool: 2 } });
    expect(read('我出 15 枚换 2 份铁')).toMatchObject({ kind: 'offer', give: { coin: 15 }, get: { iron: 2 } });
    expect(read('我出十五枚换两份铁')).toMatchObject({ kind: 'offer', give: { coin: 15 }, get: { iron: 2 } });
    expect(read('三罐染料换两捆羊毛')).toMatchObject({ kind: 'offer', give: { dye: 3 }, get: { wool: 2 } });
    expect(read('３罐染料换２捆羊毛')).toMatchObject({ kind: 'offer', give: { dye: 3 }, get: { wool: 2 } });
    expect(read('我用两罐染料和 5 文换 3 捆羊毛')).toMatchObject({ kind: 'offer', give: { dye: 2, coin: 5 }, get: { wool: 3 } });
    expect(read('2 捆羊毛卖你 10 文')).toMatchObject({ kind: 'offer', give: { wool: 2 }, get: { coin: 10 } });
    expect(read('卖给我 2 份铁，15 文')).toMatchObject({ kind: 'offer', give: { coin: 15 }, get: { iron: 2 } });
    expect(read('买 2 份羊毛，10 文')).toMatchObject({ kind: 'offer', give: { coin: 10 }, get: { wool: 2 } });
    expect(read('卖我两份铁十五文')).toMatchObject({ kind: 'offer', give: { coin: 15 }, get: { iron: 2 } });
    expect(read('你给我 2 份铁，我给你 15 枚')).toMatchObject({ kind: 'offer', give: { coin: 15 }, get: { iron: 2 } });
    expect(read('十两银子换一份铁')).toMatchObject({ kind: 'offer', give: { coin: 10 }, get: { iron: 1 } });
  });

  it('reads "yours for mine" the right way round', () => {
    expect(read('你的琥珀换我的 3 袋盐')).toMatchObject({ kind: 'offer', give: { salt: 3 }, get: { amber: 1 } });
    // The player has no wool and Pell does: "2 份羊毛 10 文怎么样" is a purchase, "3 罐染料 20 文怎么样" a sale.
    expect(read('2 份羊毛 10 文怎么样')).toMatchObject({ kind: 'offer', give: { coin: 10 }, get: { wool: 2 } });
    expect(read('3 罐染料 20 文怎么样')).toMatchObject({ kind: 'offer', give: { dye: 3 }, get: { coin: 20 } });
  });

  it('reads deliveries promised for a later day', () => {
    expect(read('先给我 2 份铁，第 4 天付你 15 枚')).toEqual({ kind: 'offer', give: {}, get: { iron: 2 }, later: { give: { coin: 15 }, due: 4 } });
    expect(read('给我两份铁第四天付你十五枚')).toMatchObject({ get: { iron: 2 }, later: { give: { coin: 15 }, due: 4 } });
    expect(read('第三天我付你二十文，先给我两份铁')).toMatchObject({ get: { iron: 2 }, later: { give: { coin: 20 }, due: 3 } });
    expect(read('3 罐染料换 2 捆羊毛，你明天给我 10 文')).toMatchObject({ give: { dye: 3 }, get: { wool: 2 }, later: { get: { coin: 10 }, due: 2 } });
    expect(read('我现在给你 10 文，你后天给我 2 份铁')).toMatchObject({ give: { coin: 10 }, later: { get: { iron: 2 }, due: 3 } });
    expect(read('先给我 1 捆羊毛，收市时付你 8 文')).toMatchObject({ get: { wool: 1 }, later: { give: { coin: 8 }, due: 8 } });
    expect(read('先给我 1 捆羊毛，两天后付你 8 文')).toMatchObject({ later: { due: 3 } });
  });

  it('reads yes, no, news, needs and hello', () => {
    for (const yes of ['成交', '好', '好的', '行', '可以', '一言为定', '好的，就这么定了', '没问题']) expect(read(yes).kind, yes).toBe('accept');
    for (const no of ['不要', '不了', '算了', '太贵了', '不成交', '谢谢', '再见', '明天见']) expect(read(no).kind, no).toBe('reject');
    for (const news of ['有什么消息？', '有啥新鲜事', '听说什么了吗', '最近有什么风声']) expect(read(news).kind, news).toBe('news');
    for (const needs of ['你缺什么？', '你要什么', '你缺点啥', '你在收什么']) expect(read(needs).kind, needs).toBe('needs');
    for (const hi of ['你好', '早上好', '嗨']) expect(read(hi).kind, hi).toBe('hello');
    expect(read('海鸥真吵').kind).toBe('unknown');
  });

  it('asks prices and bids', () => {
    expect(read('你的琥珀多少钱')).toMatchObject({ kind: 'price', good: 'amber', qty: 1 });
    expect(read('3 罐染料怎么卖')).toMatchObject({ kind: 'price', good: 'dye', qty: 3 });
    expect(read('有铁吗')).toMatchObject({ kind: 'price', good: 'iron' });
    expect(read('卖香料吗')).toMatchObject({ kind: 'price', good: 'spice' });
    expect(read('我想买琥珀')).toMatchObject({ kind: 'price', good: 'amber' });
    expect(read('来两份铁')).toMatchObject({ kind: 'price', good: 'iron', qty: 2 });
    expect(read('两打羊毛多少钱')).toMatchObject({ kind: 'price', good: 'wool', qty: 24 });
    expect(read('你出多少买我的盐')).toMatchObject({ kind: 'bid', good: 'salt', qty: 1 });
    expect(read('我的 2 锭铁你给多少')).toMatchObject({ kind: 'bid', good: 'iron', qty: 2 });
    expect(read('收不收铁')).toMatchObject({ kind: 'bid', good: 'iron' });
    expect(read('我想卖盐')).toMatchObject({ kind: 'bid', good: 'salt' });
    expect(read('卖你 3 袋盐')).toMatchObject({ kind: 'bid', good: 'salt', qty: 3 });
    expect(read('我有盐，你要不要')).toMatchObject({ kind: 'bid', good: 'salt' });
  });

  it('reads a new coin figure as a counter to the deal on the table', () => {
    const g = game();
    g.pending.m1 = { from: 'm1', to: HUMAN, give: { wool: 2 }, get: { coin: 12 } };
    for (const [text, n] of [['14 怎么样', 14], ['那就 16 吧', 16], ['改成十二', 12], ['12 文行不行', 12], ['好，10 文', 10], ['我出 11', 11]] as const)
      expect(parseTalk(g, text, 'm1').intent, text).toEqual({ kind: 'offer', give: { coin: n }, get: { wool: 2 }, later: undefined });
    delete g.pending.m1;
    expect(parseTalk(g, '14 怎么样', 'm1').intent.kind).toBe('unknown');
  });

  it('reads by what is written, not by the language of the game', () => {
    const en = newGame({ seed: 5, lang: 'en' });
    const zh = newGame({ seed: 5, lang: 'zh' });
    for (const [a, b] of [
      ['10 coin for 2 wool', '10 个钱买 2 份羊毛'],
      ['what do you need?', '你缺什么？'],
      ['any news?', '有什么消息？'],
      ['deal', '成交'],
      ['no thanks', '不要'],
      ['how much for 3 dye', '3 罐染料怎么卖'],
      ["give me 2 iron now, I'll pay you 15 coin on day 4", '先给我 2 份铁，第 4 天付你 15 枚'],
    ]) {
      expect(parseTalk(zh, a, 'm1'), a).toEqual(parseTalk(en, a, 'm1'));
      expect(parseTalk(en, b, 'm1'), b).toEqual(parseTalk(zh, b, 'm1'));
      expect(parseTalk(en, b, 'm1').intent, b).toEqual(parseTalk(en, a, 'm1').intent);
    }
  });
});
