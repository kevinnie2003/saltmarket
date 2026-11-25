import { makeProvider, type ProviderKind } from '../llm/factory.js';
import { LLMMerchant } from '../llm/merchant.js';
import { asLang } from '../i18n/lang.js';
import type { BotKind } from './bot.js';
import { formatReport, playGame, simulate } from './simulate.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  if (flag('help')) {
    console.log(`npm run sim -- [--games N] [--seed N] [--player none|idle|taker|trader|all] [--days N] [--voice mock|anthropic|openai] [--noise 0.2] [--log] [--lang en|zh] [--json file]`);
    return;
  }
  const games = Number(arg('games') ?? 100);
  const seed = Number(arg('seed') ?? 1);
  const days = arg('days') ? Number(arg('days')) : undefined;
  const who = arg('player') ?? 'all';
  const bots: (BotKind | 'none')[] = who === 'all' ? ['none', 'idle', 'taker', 'trader'] : [who as BotKind | 'none'];
  const v = arg('voice') as ProviderKind | undefined;
  const voice = v ? new LLMMerchant(await makeProvider(v, { noise: Number(arg('noise') ?? 0), seed })) : undefined;

  if (flag('log')) {
    const lang = asLang(arg('lang'));
    const g = await playGame(seed, { games: 1, seed, bot: bots.at(-1)!, days, voice, lang });
    for (const l of g.log) console.log(`[${lang === 'zh' ? `第 ${l.day} 天` : `day ${l.day}`}] ${l.text}`);
    return;
  }
  const reports = [];
  for (const bot of bots) {
    const r = await simulate({ games, seed, bot, days, voice });
    reports.push(r);
    console.log(`${formatReport(r)}\n`);
  }
  const out = arg('json');
  if (out) {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(reports, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
