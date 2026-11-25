# Saltmarket

An original harbour trading game. You arrive at the market with a cart, a little coin and one good order to fill, and you haggle in plain words with the merchants on the quay:

> Marta, what do you need?
> 10 coin for 2 wool.
> Give me 2 iron now and I'll pay you 15 coin on day 4.

Every merchant keeps their own books. Each has a private contract that pays well only if it is filled in full, their own resale rates at the close, and the rumours they happened to hear. They value every deal by those books, haggle toward what they want, and remember how you treated them. Lowball offers sour their mood. Broken promises cost you trust with the merchant you cheated, and the word gets around the quay.

## 中文简介

《盐市》是一款原创的港口交易游戏。你推着一车货、带着一点钱和一张订单来到码头，用自己的话跟摊主讨价还价：

> 玛塔，你缺什么？
> 10 文买 2 捆羊毛。
> 先给我 2 锭铁，第 4 天付你 15 文。

每位摊主都有自己的账本：一张只有凑齐才值钱的私人订单、收市时各自的转卖价，以及碰巧听到的传闻。他们按自己的账本给每笔买卖估价，记得你怎么待他们；压价太狠会坏了交情，失信的事也会在码头上传开。

页面右上角的 **EN / 中文** 按钮可以随时切换语言，也可以在地址后加 `?lang=zh` 直接用中文打开。中文界面下可以直接用中文说话，数字写成“三罐”“两捆”“十五文”或阿拉伯数字都行，商人的名字保留拉丁字母，钱的单位是“文”。构建后的单页游戏也放在 `docs/index.html`，无需服务器，直接用浏览器打开即可。

There are three kinds of merchant:

- **Fair** merchants trade at small margins, give ground quickly when you haggle, tell you what they need, share what they hear, and always keep their word.
- **Hard** merchants want a bigger cut, give ground slowly, admit to one need at most, and keep news to themselves unless they trust you.
- **Sly** merchants are charming. They like to pay later and promise handsomely, then break some of those promises when it's worth it, more often near the close. They mention a decoy need alongside a real one, and sometimes they invent a rumour that talks up a good they want to sell you.

## Play

```
npm install
npm run build
```

Open `dist/saltmarket.html` in a browser. It is one self-contained file with no server and no network calls. Your game is saved in the browser as you play. A copy of the latest build is kept at `docs/index.html`, so the repository's `docs/` folder can be served as a static site.

- Pick a stall and type what you'd say. The line under the box shows how your words were read before you send them.
- When a merchant puts a deal on the table, the card shows it from your side and how it changes your worth by your own books. Accept it, decline it, or make your own counter.
- You get six talks a day. **End the day** lets the merchants trade among themselves at dusk, and the next morning brings an event (a cargo ship, a storm, a guild order, a fair, a bad harvest) and new rumours.
- A promise you made shows in **Promises** with a **keep it** box. Untick it and you won't deliver on the day.
- Each morning starts with what happened since yesterday: dusk trades, kept and broken promises. Your contract card shows which merchants on the quay hold each good you still need.
- You score your profit over what your stall was worth on the first morning: coin, plus the contract reward if it is filled, plus leftover goods at the closing price. The final screen lists your deals, each valued at the closing prices.

**Watch the merchants trade alone** plays a full market with four AI merchants and shows the standings.

### What you can say

| You say | It means |
| --- | --- |
| `3 dye for 2 wool`, `I'll give you 10 coin for 2 wool`, `sell me 2 wool for 8 coin`, `your amber for my 3 salt` | An offer |
| `give me 2 iron now, I'll pay you 15 coin on day 4`, `... you deliver 10 coin tomorrow` | An offer with a delivery promised for later |
| `deal`, `yes`, `I'll take it` / `no thanks`, `too much` | Accept or turn down the deal on the table |
| `how much for your amber?`, `how much for 3 dye` | Ask their price |
| `what would you pay for my salt?` | Ask what they'd pay |
| `what do you need?`, `any news?`, `hello` | Ask about their needs, ask for rumours, say hello (they may offer you something) |

Start a line with a merchant's name (`Marta, ...`) to talk to them without switching stalls. Numbers can be words (`two jars of dye`, `half a dozen bales of wool`), and a bare number after `for` is coin.

The same things can be said in Chinese:

| 你说 | 意思 |
| --- | --- |
| `3 罐染料换 2 捆羊毛`, `10 文买 2 捆羊毛`, `我出十五枚换两份铁`, `你的琥珀换我的 3 袋盐` | An offer |
| `先给我 2 份铁，第 4 天付你 15 枚`, `3 罐染料换 2 捆羊毛，你明天给我 10 文` | An offer with a delivery promised for later |
| `成交`, `好`, `一言为定` / `不要`, `太贵了` | Accept or turn down the deal on the table |
| `3 罐染料怎么卖`, `你的琥珀多少钱` | Ask their price |
| `你出多少买我的盐`, `收不收铁` | Ask what they'd pay |
| `你缺什么？`, `有什么消息？`, `你好` | Ask about their needs, ask for rumours, say hello |
| `14 怎么样`, `那就 16 吧` | Counter with a new figure for the deal on the table |

A merchant can be addressed by name in either script: `玛塔，你缺什么？` and `Marta，你要什么？` both go to Marta Vey.

### With a real model

```
ANTHROPIC_API_KEY=... SALTMARKET_ANTHROPIC_MODEL=<model id> npm start
```

This serves the game on http://127.0.0.1:8788 with a small local server that keeps the key on your machine. A **Merchants played by** menu appears under the chat. Pick a model and it does two jobs on each line: it reads what you said into an intent, and it plays the merchant you're talking to, in character. Any OpenAI-compatible endpoint works too, through `OPENAI_BASE_URL`, `OPENAI_API_KEY` and `OPENAI_MODEL`. The server holds no game state; the browser sends it with each line and gets the new state back.

## Languages

The page speaks English and Simplified Chinese. The **EN / 中文** switch sits at the top right. The page opens in the language given by `?lang=en` or `?lang=zh` in the address, then the one you last picked (kept in the browser), then the browser's own language (any `zh` variant opens in Chinese), and otherwise English.

**Text is written in the language it was said in.** The language is part of the saved game. What merchants say, the quay log and the morning recap are written in the language that was active when each line was made, so switching keeps the earlier lines as they were and writes new ones in the new language. Everything that is drawn from the game's numbers rather than from what was said (prices, stock, your purse and goods, the contract slip, promises, today's event and rumours, the deal on the table, the final standings) is redrawn at once in the new language. Saves from before languages existed open in English. Goods have Chinese names (盐、琥珀、染料、羊毛、香料、铁) with their own measure words, merchant names stay in Latin letters, and coin is 文 in Chinese.

**The Chinese parser** (`src/talk/zh.ts`) reads a line by what is in it, not by the page's language: a line with Chinese characters goes to the Chinese reader and any other line to the English one, so either can be typed at any time. It understands Chinese and Arabic numerals (including 两, 半打 and full-width digits), measure words, coin words such as 文、枚、钱, swaps with 换, buying and selling with 买 and 卖, yours-for-mine phrasing, later deliveries (`明天`, `后天`, `第 4 天`, `3 天后`, `收市前`), counters with a new figure, accept and reject words, and questions about price, needs and news.

**Seeded games play the same in both languages.** Merchants' lines come from voice packs of the same size in each language and are picked the same way, so a seed gives the same events, offers, trades and scores whichever language is on, and the tests check that move for move.

With a model, the prompts tell the model which language to answer in and how Chinese input looks; the request carries the language, and the offline stand-in answers in it too. The simulator can print a market in Chinese:

```
npm run sim -- --log --seed 7 --lang zh
```

`npm run build` writes `dist/saltmarket.html`. To update the static copy, copy it to `docs/index.html` and commit it.

## How the AI works

**Valuation** (`src/agents/value.ts`). A merchant's worth is its coin, plus its contract reward scaled by how much of the contract it holds (on a curve that steepens toward the close, since the contract pays all or nothing), plus spare goods at the price it expects at the close times its own resale rate. Expected prices follow the rumours it heard, believed by half. A deal is worth taking when it raises that worth by enough: a flat amount plus a share of the deal's size, which shrinks with each round of haggling, as the close nears, and when the merchant likes you. Goods promised to it later are discounted by how much it trusts the other side. Honest merchants won't take a deal that leaves them unable to pay what they already owe.

**Haggling** (`src/agents/mind.ts`). An offer that falls short gets a counter: give less, ask for coin to close the gap, or ask for one or two more of what you were already giving. Proposals go after the goods its contract still lacks, paying in coin, spare goods, or (when short of coin, or sly) part now and the rest later.

**LLM merchant** (`src/llm/merchant.ts`). The model gets the merchant's books, its persona, what you said, how the deal on the table changes its worth, and what the built-in merchant would do. It replies with what it says and a decision: accept, counter, reject or just talk. Guardrails check every decision. It can't accept or offer a deal that leaves it worse off by its own books, every deal is checked against the rules, and for questions (prices, needs, news) the facts still come from the built-in merchant, so the model can't invent stock or rumours. A bad reply gets one repair round with the exact problem; after that, or if the provider fails, the built-in merchant answers.

**LLM interpreter** (`src/llm/interpreter.ts`). The model turns your words into the same intent the rule parser produces, with names mapped to merchants and every bundle checked. Invalid output gets one repair round, then the rule parser takes over.

**Offline model stand-in** (`src/llm/mock.ts`). It speaks the same JSON protocols, so the whole model path (prompts, parsing, validation, repair, fallback) runs and is tested without a key. With `--noise`, it sends broken or rule-breaking replies some of the time.

## Simulator

```
npm run sim -- --games 300                        # all stand-in players
npm run sim -- --player trader --voice mock --noise 0.2
npm run sim -- --log --seed 7                     # one market, day by day
```

Stand-in players talk to the stalls through the same path as a person. `idle` never trades, `taker` accepts any morning offer that helps it, and `trader` also chases its contract and haggles. 300 markets from seed 1:

| Player | Profit | Contract filled | Finished first |
| --- | --- | --- | --- |
| idle | +23 | 1% | 10% |
| taker | +30 | 5% | 9% |
| trader | +45 | 71% | 21% |
| the AI merchants in that market | +37 to +50 | 43% to 60% | 15% to 33% |

So doing nothing loses to everyone, accepting offers is not enough, and chasing your contract puts you level with the merchants. Beating them takes reading the market: rumours, who to trust with a promise, and when to hold out. In the trader games there are about 1.3 promises per market and 29% of them are broken.

## Tests

```
npm test
```

70 tests in seven files:

- `test/engine.test.ts`: deals, promises, events, the close
- `test/talk.test.ts`: the English parser and the merchants' answers
- `test/zh.test.ts`: the Chinese parser: numerals, bundles, names, offers, later deliveries, questions and counters
- `test/i18n.test.ts`: the same seeded games in English and Chinese, Chinese game text, switching language mid-game, old saves, the model path answering in Chinese
- `test/llm.test.ts`: the model path with a scripted provider and the noisy stand-in
- `test/server.test.ts`: the local server
- `test/web.test.ts`: the browser client in jsdom, including the start language, the switch and a game played in Chinese

## Layout

```
src/engine   market rules: goods, merchants, events, rumours, deals, promises, scoring
src/agents   built-in merchants: valuation, haggling, voice, the day's rhythm
src/talk     plain-language parsers, English and Chinese
src/llm      model providers, interpreter, LLM merchant, offline stand-in
src/sim      stand-in players and the simulator
src/server   local server for model-played merchants
src/web      browser client and its strings in both languages
src/i18n     languages, game words in English and Chinese, mixed-script spacing
docs         the built page, for static hosting
```
