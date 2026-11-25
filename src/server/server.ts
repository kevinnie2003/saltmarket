import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOODS, type GameState } from '../engine/types.js';
import { asLang } from '../i18n/lang.js';
import { availableProviders, makeProvider, type ProviderKind } from '../llm/factory.js';
import { LLMInterpreter } from '../llm/interpreter.js';
import { LLMMerchant } from '../llm/merchant.js';
import { UsageMeter } from '../llm/provider.js';
import { stallTalk } from '../llm/stall.js';

/**
 * A small local server that lets the browser talk to merchants played by a real
 * model, with API keys kept on the server. It is stateless: the browser owns
 * the game, sends its state with each line, and gets the new state back.
 */
const here = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = process.env.SALTMARKET_WEB_ROOT ?? join(here, 'web');
const PORT = Number(process.env.PORT ?? 8788);
const HOST = process.env.HOST ?? '127.0.0.1';

const meter = new UsageMeter();

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit = 1_000_000): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  const v = text ? JSON.parse(text) : {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('body must be a JSON object');
  return v as Record<string, unknown>;
}

/** Check the browser's game state has the right shape before using it. */
export function stateFrom(raw: unknown): GameState {
  const s = raw as GameState;
  if (!s || s.version !== 1) throw new Error('bad state');
  if (!Number.isInteger(s.day) || !Number.isInteger(s.days) || s.day < 1 || s.days > 20 || s.day > s.days) throw new Error('bad day');
  if (!Array.isArray(s.merchants) || s.merchants.length < 2 || s.merchants.length > 6) throw new Error('bad merchants');
  for (const m of s.merchants) {
    if (typeof m.id !== 'string' || typeof m.coin !== 'number' || !m.goods || !m.contract || !m.taste) throw new Error('bad merchant');
    for (const g of GOODS) if (!Number.isInteger(m.goods[g]) || m.goods[g] < 0) throw new Error('bad goods');
  }
  if (!s.prices || GOODS.some((g) => typeof s.prices[g] !== 'number')) throw new Error('bad prices');
  if (!Array.isArray(s.promises) || !Array.isArray(s.rumors) || !Array.isArray(s.events) || !Array.isArray(s.log)) throw new Error('bad lists');
  if (s.lang !== undefined && s.lang !== 'en' && s.lang !== 'zh') throw new Error('bad lang');
  return structuredClone(s);
}

function provider(body: Record<string, unknown>): ProviderKind {
  const kind = String(body.provider ?? 'mock') as ProviderKind;
  if (!availableProviders().includes(kind)) throw new Error(`provider ${kind} is not available on this server`);
  return kind;
}

const usage = () => ({ calls: meter.calls, inputTokens: meter.inputTokens, outputTokens: meter.outputTokens });

export async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, providers: availableProviders() });
  if (req.method !== 'POST' || url.pathname !== '/api/talk') return json(res, 404, { error: 'not found' });
  let body: Record<string, unknown>;
  let state: GameState;
  let kind: ProviderKind;
  try {
    body = await readBody(req);
    state = stateFrom(body.state);
    kind = provider(body);
  } catch (err) {
    return json(res, 400, { error: (err as Error).message });
  }
  const text = String(body.text ?? '').slice(0, 1000);
  if (!text.trim()) return json(res, 400, { error: 'missing text' });
  // The language the player is reading in; new lines are written in it.
  if (body.lang !== undefined) state.lang = asLang(body.lang);
  const stall = typeof body.stall === 'string' && state.merchants.some((m) => m.id === body.stall) ? body.stall : undefined;
  const llm = await makeProvider(kind, { seed: state.day * 100 + state.talksLeft });
  const reply = await stallTalk(state, text, stall, { interpreter: new LLMInterpreter(llm, meter), merchant: new LLMMerchant(llm, meter) });
  return json(res, 200, { state, reply, provider: llm.name, usage: usage() });
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
};

async function serveStatic(res: ServerResponse, path: string): Promise<void> {
  const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
  const file = join(WEB_ROOT, rel);
  if (!file.startsWith(WEB_ROOT)) return json(res, 403, { error: 'forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    json(res, 404, { error: 'not found' });
  }
}

export function startServer(port = PORT, host = HOST): Server {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const work = url.pathname.startsWith('/api/') ? handleApi(req, res, url) : serveStatic(res, url.pathname);
    work.catch((err) => {
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
    });
  });
  server.listen(port, host, () => console.log(`Saltmarket on http://${host}:${port}  (models: ${availableProviders().join(', ')})`));
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) startServer();
