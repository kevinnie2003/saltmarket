# Saltmarket

An original harbour trading game. You arrive at the market with a cart, a little coin and one good order to fill, and you haggle in plain words with the merchants on the quay:

> Marta, what do you need?
> 10 coin for 2 wool.
> Give me 2 iron now and I'll pay you 15 coin on day 4.

Every merchant keeps their own books. Each has a private contract that pays well only if it is filled in full, their own resale rates at the close, and the rumours they happened to hear. They value every deal by those books, haggle toward what they want, and remember how you treated them. Lowball offers sour their mood. Broken promises cost you trust with the merchant you cheated, and the word gets around the quay.

There are three kinds of merchant:

- **Fair** merchants trade at small margins, give ground quickly when you haggle, tell you what they need, share what they hear, and always keep their word.
- **Hard** merchants want a bigger cut, give ground slowly, admit to one need at most, and keep news to themselves unless they trust you.
- **Sly** merchants are charming. They like to pay later and promise handsomely, then break some of those promises when it's worth it, more often near the close. They mention a decoy need alongside a real one, and sometimes they invent a rumour that talks up a good they want to sell you.

## Play

```
npm install
npm run build
```

Open `dist/saltmarket.html` in a browser. It is one self-contained file with no server and no network calls. Your game is saved in the browser as you play.

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

### With a real model

```
ANTHROPIC_API_KEY=... SALTMARKET_ANTHROPIC_MODEL=<model id> npm start
```

This serves the game on http://127.0.0.1:8788 with a small local server that keeps the key on your machine. A **Merchants played by** menu appears under the chat. Pick a model and it does two jobs on each line: it reads what you said into an intent, and it plays the merchant you're talking to, in character. Any OpenAI-compatible endpoint works too, through `OPENAI_BASE_URL`, `OPENAI_API_KEY` and `OPENAI_MODEL`. The server holds no game state; the browser sends it with each line and gets the new state back.

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

The tests cover the engine (deals, promises, events, the close), the parser, the merchants' answers, the model path with a scripted provider and the noisy stand-in, the local server, and the browser client in jsdom.

## Layout

```
src/engine   market rules: goods, merchants, events, rumours, deals, promises, scoring
src/agents   built-in merchants: valuation, haggling, voice, the day's rhythm
src/talk     plain-language parser
src/llm      model providers, interpreter, LLM merchant, offline stand-in
src/sim      stand-in players and the simulator
src/server   local server for model-played merchants
src/web      browser client
```
