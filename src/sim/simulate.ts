import { HUMAN, standings } from '../engine/game.js';
import type { GameState } from '../engine/types.js';
import { endDay, newGame } from '../agents/session.js';
import type { LLMMerchant } from '../llm/merchant.js';
import { playDay, type BotKind } from './bot.js';

export interface SimOptions {
  games: number;
  seed: number;
  bot: BotKind | 'none';
  rivals?: number;
  days?: number;
  voice?: LLMMerchant;
}

export interface SeatStats {
  seat: string;
  games: number;
  profit: number;
  contracts: number;
  wins: number;
}

export interface SimReport {
  options: Omit<SimOptions, 'voice'> & { voice?: string };
  seats: SeatStats[];
  tradesPerGame: number;
  promisesPerGame: number;
  brokenShare: number;
  modelCalls?: number;
  fallbacks?: number;
}

export async function playGame(seed: number, o: SimOptions): Promise<GameState> {
  const state = newGame({ seed, noHuman: o.bot === 'none', rivals: o.rivals ?? (o.bot === 'none' ? 4 : 3), days: o.days, talkPerDay: 6 });
  while (!state.over) {
    if (o.bot !== 'none') await playDay(state, o.bot, o.voice);
    endDay(state);
  }
  return state;
}

export async function simulate(o: SimOptions): Promise<SimReport> {
  const seats = new Map<string, SeatStats>();
  let trades = 0;
  let promises = 0;
  let broken = 0;
  for (let i = 0; i < o.games; i++) {
    const g = await playGame(o.seed + i, o);
    trades += g.trades.length;
    promises += g.promises.length;
    broken += g.promises.filter((p) => p.status === 'broken').length;
    const lines = standings(g);
    lines.forEach((l, rank) => {
      const m = g.merchants.find((x) => x.id === l.id)!;
      const key = m.id === HUMAN ? `player (${o.bot})` : `${m.name} (${m.personality})`;
      const s = seats.get(key) ?? { seat: key, games: 0, profit: 0, contracts: 0, wins: 0 };
      s.games++;
      s.profit += l.profit;
      s.contracts += l.contractMet ? 1 : 0;
      s.wins += rank === 0 ? 1 : 0;
      seats.set(key, s);
    });
  }
  const { voice, ...rest } = o;
  return {
    options: { ...rest, voice: voice?.provider.name },
    seats: [...seats.values()].sort((a, b) => b.profit / b.games - a.profit / a.games),
    tradesPerGame: trades / o.games,
    promisesPerGame: promises / o.games,
    brokenShare: promises ? broken / promises : 0,
    modelCalls: voice?.meter.calls,
    fallbacks: voice?.meter.failures,
  };
}

export function formatReport(r: SimReport): string {
  const head = `${r.options.games} games from seed ${r.options.seed}, player: ${r.options.bot}${r.options.voice ? `, merchants voiced by ${r.options.voice}` : ''}`;
  const rows = r.seats.map(
    (s) => `  ${s.seat.padEnd(26)} profit ${(s.profit / s.games).toFixed(1).padStart(6)}   contract ${pct(s.contracts / s.games)}   first ${pct(s.wins / s.games)}`,
  );
  const tail = `  ${r.tradesPerGame.toFixed(1)} trades a game, ${r.promisesPerGame.toFixed(2)} promises a game, ${pct(r.brokenShare)} of promises broken${r.modelCalls !== undefined ? `, ${r.modelCalls} model calls` : ''}`;
  return [head, ...rows, tail].join('\n');
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`.padStart(4);
}
