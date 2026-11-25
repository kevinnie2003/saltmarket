import { MockLLMProvider } from './mock.js';
import type { LLMProvider } from './provider.js';

export type ProviderKind = 'mock' | 'anthropic' | 'openai';

/** Build a provider by name. Real providers are imported only when asked for. */
export async function makeProvider(kind: ProviderKind, opts: { noise?: number; seed?: number } = {}): Promise<LLMProvider> {
  if (kind === 'mock') return new MockLLMProvider(opts.noise ?? 0, opts.seed ?? 1);
  if (kind === 'anthropic') {
    const { AnthropicProvider } = await import('./anthropic.js');
    return new AnthropicProvider();
  }
  const { OpenAICompatibleProvider } = await import('./openai.js');
  return new OpenAICompatibleProvider();
}

/** Which real providers this process could use, from the environment. */
export function availableProviders(env: Record<string, string | undefined> = process.env): ProviderKind[] {
  const out: ProviderKind[] = ['mock'];
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) out.push('anthropic');
  if (env.OPENAI_MODEL) out.push('openai');
  return out;
}
