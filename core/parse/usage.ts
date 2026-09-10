/**
 * Normalizes `message.usage` (SPEC §3.3) into `TokenUsage` plus the three billing modifiers.
 *
 * The cache-write TTL split is reported, never guessed away: when `cache_creation` is missing (or
 * is present but contradicts `cache_creation_input_tokens`) the whole write lands in `cache5m` and
 * `assumedTtl` is set, so the pricing layer can re-bucket it per
 * `PricingConfig.assumeCacheWriteTtlWhenUnknown`.
 */
import type { BilledIteration, InferenceGeo, ServiceTier, Speed, TokenUsage } from '../types.js';
import { asRecord, count, list, rec, str } from './raw.js';

export function normalizeUsage(usage: Record<string, unknown> | undefined): TokenUsage {
  const creation = rec(usage, 'cache_creation');
  const declared = count(usage?.['cache_creation_input_tokens']);
  let cache5m = count(creation?.['ephemeral_5m_input_tokens']);
  let cache1h = count(creation?.['ephemeral_1h_input_tokens']);
  let assumedTtl = false;
  if (!creation || (cache5m + cache1h === 0 && declared > 0)) {
    cache5m = declared;
    cache1h = 0;
    assumedTtl = declared > 0;
  }
  const details = rec(usage, 'output_tokens_details');
  const serverTools = rec(usage, 'server_tool_use');
  const out: TokenUsage = {
    input: count(usage?.['input_tokens']),
    output: count(usage?.['output_tokens']),
    cacheRead: count(usage?.['cache_read_input_tokens']),
    cache5m,
    cache1h,
    thinking: count(details?.['thinking_tokens']),
    webSearchRequests: count(serverTools?.['web_search_requests']),
    webFetchRequests: count(serverTools?.['web_fetch_requests']),
  };
  if (assumedTtl) out.assumedTtl = true;
  return out;
}

export function contextTokensOf(u: TokenUsage): number {
  return u.input + u.cacheRead + u.cache5m + u.cache1h;
}

export function speedOf(usage: Record<string, unknown> | undefined): Speed {
  return str(usage, 'speed') === 'fast' ? 'fast' : 'standard';
}

export function serviceTierOf(usage: Record<string, unknown> | undefined): ServiceTier {
  const tier = str(usage, 'service_tier');
  return tier === 'batch' || tier === 'priority' ? tier : 'standard';
}

export function inferenceGeoOf(usage: Record<string, unknown> | undefined): InferenceGeo {
  return str(usage, 'inference_geo') === 'us' ? 'us' : 'global';
}

/**
 * Billed iterations, populated only when the API reported more than one (a model fallback).
 * With a single iteration the top-level usage is authoritative and this returns `undefined`.
 */
export function iterationsOf(
  usage: Record<string, unknown> | undefined,
  fallbackModel: string,
): BilledIteration[] | undefined {
  const raw = list(usage, 'iterations');
  if (raw.length <= 1) return undefined;
  const out: BilledIteration[] = [];
  for (const item of raw) {
    const it = asRecord(item);
    if (!it) continue;
    out.push({
      model: str(it, 'model') ?? fallbackModel,
      usage: normalizeUsage(it),
      type: str(it, 'type') ?? 'message',
    });
  }
  return out.length > 1 ? out : undefined;
}
