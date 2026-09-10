/**
 * Attribution (SPEC §5.3): split what filled each request's context among the tool results,
 * prompts, hook output and harness attachments that produced it, plus the two parts of the
 * context nobody hands over explicitly — the assistant's own re-sent replies and the baseline
 * floor of the window (docs/METHODOLOGY.md §3 "Re-sent history and baseline context").
 *
 * Everything here is price-independent — the output is a set of token counts plus the request
 * range over which each item was carried. Money is applied later in price-at-read.ts so that
 * re-pricing (or a what-if simulation) never requires re-indexing.
 */
import type {
  AttributedItem,
  ContextItemKind,
  EstMethod,
  OutputShare,
  ParsedRequest,
  ParsedTranscript,
  PricingConfig,
  TranscriptAttribution,
} from '../types.js';
import { FALLBACK_CHARS_PER_TOKEN, IMAGE_TOKENS } from '../pricing/defaults.js';
import { charsPerTokenFor } from '../pricing/resolve.js';

/** Δ/H must land in this band for the delta estimate to be trusted. */
export const DELTA_RATIO_MIN = 0.4;
export const DELTA_RATIO_MAX = 2.5;

interface GapItem {
  kind: AttributedItem['kind'];
  ref: string | number;
  seq: number;
  chars: number;
  imageTokens: number;
  turnIndex: number;
}

function outputShareOf(req: ParsedRequest): OutputShare {
  const share: OutputShare = { thinkingTokens: 0, textTokens: 0, toolUseTokens: new Map() };
  const output = req.usage.output;
  if (output <= 0) return share;
  const thinking = Math.min(req.usage.thinking, output);
  share.thinkingTokens = thinking;
  const remainder = output - thinking;
  if (remainder <= 0) return share;

  let totalChars = 0;
  for (const block of req.blocks) {
    if (block.type === 'text' || block.type === 'tool_use') totalChars += block.chars;
  }
  if (totalChars <= 0) {
    share.textTokens = remainder;
    return share;
  }
  for (const block of req.blocks) {
    if (block.type === 'text') {
      share.textTokens += (remainder * block.chars) / totalChars;
    } else if (block.type === 'tool_use' && block.toolUseId) {
      const previous = share.toolUseTokens.get(block.toolUseId) ?? 0;
      share.toolUseTokens.set(block.toolUseId, previous + (remainder * block.chars) / totalChars);
    }
  }
  return share;
}

function collectGapItems(t: ParsedTranscript): GapItem[] {
  const items: GapItem[] = [];
  for (const call of t.toolCalls) {
    if (call.resultSeq === undefined) continue;
    items.push({
      kind: 'tool_result',
      ref: call.toolUseId,
      seq: call.resultSeq,
      chars: call.resultChars,
      imageTokens: call.resultImages * IMAGE_TOKENS,
      turnIndex: call.turnIndex,
    });
  }
  for (const injection of t.injections) {
    items.push({
      kind: injection.kind,
      ref: injection.seq,
      seq: injection.seq,
      chars: injection.chars,
      imageTokens: 0,
      turnIndex: injection.turnIndex,
    });
  }
  items.sort((a, b) => a.seq - b.seq);
  return items;
}

/** Index of the first element of `sorted` that is > value, via binary search. */
function upperBound(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] ?? 0) <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * @param t transcript to attribute (main, subagent or workflow agent)
 * @param pricing used only for `charsPerToken` of the ingesting request's model
 */
export function attributeTranscript(t: ParsedTranscript, pricing: PricingConfig): TranscriptAttribution {
  const requests = t.requests.filter((r) => !r.isSynthetic).sort((a, b) => a.seq - b.seq);
  const outputShares = new Map<number, OutputShare>();
  for (const req of requests) outputShares.set(req.seq, outputShareOf(req));

  const reqSeqs = requests.map((r) => r.seq);
  const compactionSeqs = t.compactions.map((c) => c.seq).sort((a, b) => a - b);
  const items = collectGapItems(t);

  // Gap g holds every item that appears before request g; the trailing gap (g === requests.length)
  // holds items that no request ever sent.
  const buckets: GapItem[][] = Array.from({ length: requests.length + 1 }, () => []);
  for (const item of items) {
    buckets[upperBound(reqSeqs, item.seq)]?.push(item);
  }

  const out: AttributedItem[] = [];
  /** Σ estimated tokens of the gap items ingested by requests[g]; the baseline math needs it. */
  const gapTokens = new Float64Array(buckets.length);
  for (let g = 0; g < buckets.length; g += 1) {
    const bucket = buckets[g];
    if (!bucket || bucket.length === 0) continue;
    const ingest = requests[g];
    const previous = g > 0 ? requests[g - 1] : undefined;
    const cpt = ingest ? charsPerTokenFor(ingest.model, pricing) : FALLBACK_CHARS_PER_TOKEN;

    const lowerSeq = previous ? previous.seq : -1;
    const upperSeq = ingest ? ingest.seq : Number.MAX_SAFE_INTEGER;
    const compactionInGap = compactionSeqs.some((s) => s > lowerSeq && s < upperSeq);

    let ratio = 1;
    let method: EstMethod = 'heuristic';
    if (ingest && previous && !compactionInGap) {
      const heuristicTokens = bucket.reduce((sum, item) => sum + item.chars / cpt, 0);
      const delta = ingest.contextTokens - previous.contextTokens - previous.usage.output;
      if (heuristicTokens > 0 && delta > 0) {
        const candidate = delta / heuristicTokens;
        if (candidate >= DELTA_RATIO_MIN && candidate <= DELTA_RATIO_MAX) {
          ratio = candidate;
          method = 'delta';
        }
      }
    }

    const ingestRequestSeq = ingest ? ingest.seq : null;
    const lastCarrySeq = ingest ? carryEndFor(ingest.seq, reqSeqs, compactionSeqs) : null;

    for (const item of bucket) {
      const textTokens = (item.chars / cpt) * ratio;
      const tokens = textTokens + item.imageTokens;
      gapTokens[g] = (gapTokens[g] ?? 0) + tokens;
      let estMethod: EstMethod = method;
      if (item.imageTokens > 0) estMethod = 'image';
      else if (tokens === 0) estMethod = 'none';
      out.push({
        kind: item.kind,
        ref: item.ref,
        seq: item.seq,
        chars: item.chars,
        tokens,
        estMethod,
        ingestRequestSeq,
        lastCarrySeq,
        turnIndex: item.turnIndex,
      });
    }
  }
  out.sort((a, b) => a.seq - b.seq);
  // Context items are appended after the gap items rather than merged into the seq order: they
  // describe whole ranges, not single lines, and callers index the gap items positionally.
  out.push(...contextItems(requests, reqSeqs, compactionSeqs, gapTokens, out));
  return { outputShares, items: out };
}

/** Σ tokens of the items that are part of the context of the request at `seq`. */
function liveTokensAt(items: readonly AttributedItem[], seq: number): number {
  let sum = 0;
  for (const item of items) {
    const ingest = item.ingestRequestSeq;
    if (ingest === null || ingest > seq) continue;
    if (ingest === seq || (item.lastCarrySeq ?? -1) >= seq) sum += item.tokens;
  }
  return sum;
}

/** Seq of the last request at or after `from` that still belongs to `turnIndex`. */
function lastSeqOfTurn(requests: readonly ParsedRequest[], from: number, turnIndex: number): number {
  let last = requests[from]?.seq ?? -1;
  for (let i = from; i < requests.length; i += 1) {
    const req = requests[i];
    if (!req || req.turnIndex !== turnIndex) break;
    last = req.seq;
  }
  return last;
}

function contextItem(
  kind: ContextItemKind,
  seq: number,
  turnIndex: number,
  tokens: number,
  estMethod: AttributedItem['estMethod'],
  ingestRequestSeq: number,
  lastCarrySeq: number | null,
): AttributedItem {
  return {
    kind,
    ref: `${kind}:${seq}`,
    seq,
    chars: 0,
    tokens,
    estMethod,
    ingestRequestSeq,
    lastCarrySeq,
    turnIndex,
  };
}

/**
 * The two parts of every request's context that no gap item owns.
 *
 * (a) `assistant_history` — one item per request: the reply that request produced is re-sent as
 *     history by the *next* request and carried from there like anything else. Its tokens are the
 *     reported `output` minus `thinking`, an approximation: thinking blocks are dropped from the
 *     context once the turn that produced them is over, but they do survive inside a turn, so this
 *     slightly under-counts tool-heavy turns. Its generation cost stays with the request / the tool
 *     call that emitted it — this item carries ingest + carry only, so nothing is double counted.
 *     A reply that a compaction swallows before the next request is skipped: the compact summary
 *     already stands in for it.
 *
 * (b) `baseline` — what the first request already paid for before any gap item existed: system
 *     prompt, tool definitions, CLAUDE.md and memory, skill listings. It is `context(R_0)` minus
 *     the (heuristic) estimates of the gap items that preceded R_0, and it is carried over the
 *     whole transcript because a compaction never drops it. `post_compaction_floor` is the same
 *     idea for what a compaction leaves behind on top of the baseline and the summary: the first
 *     request after the boundary, minus that gap's items, minus the baseline that is already
 *     being carried; it is carried to the next boundary or to the end.
 */
function contextItems(
  requests: readonly ParsedRequest[],
  reqSeqs: readonly number[],
  compactionSeqs: readonly number[],
  gapTokens: Float64Array,
  gapItems: readonly AttributedItem[],
): AttributedItem[] {
  const out: AttributedItem[] = [];
  const first = requests[0];
  const last = requests[requests.length - 1];
  if (!first || !last) return out;

  for (let i = 0; i + 1 < requests.length; i += 1) {
    const req = requests[i];
    const next = requests[i + 1];
    if (!req || !next) continue;
    if (compactionSeqs.some((s) => s > req.seq && s < next.seq)) continue;
    const carryEnd = carryEndFor(next.seq, reqSeqs, compactionSeqs);
    const thinking = Math.min(Math.max(0, req.usage.thinking), Math.max(0, req.usage.output));
    const text = Math.max(0, req.usage.output - thinking);
    if (text > 0) {
      out.push(
        contextItem('assistant_history', req.seq, req.turnIndex, text, 'exact-output', next.seq, carryEnd),
      );
    }
    // Thinking blocks are re-sent for the rest of the turn that produced them (the API needs them
    // back with each tool result) and dropped once the next user turn starts, so they get their
    // own item with a carry range that ends with the turn.
    if (thinking > 0 && next.turnIndex === req.turnIndex) {
      const turnEnd = lastSeqOfTurn(requests, i + 1, req.turnIndex);
      const stop = carryEnd === null ? turnEnd : Math.min(turnEnd, carryEnd);
      out.push({
        ...contextItem('assistant_history', req.seq, req.turnIndex, thinking, 'exact-output', next.seq, stop),
        ref: `assistant_history:${req.seq}:thinking`,
      });
    }
  }

  // Skip leading requests whose context is too small to be holding the items we already charged to
  // them: a resumed or forked session often opens with a tiny background call (title generation)
  // that never carried the conversation, and anchoring the floor there would measure nothing.
  let anchorAt = 0;
  while (anchorAt < requests.length) {
    const candidate = requests[anchorAt];
    if (candidate && candidate.contextTokens >= (gapTokens[anchorAt] ?? 0)) break;
    anchorAt += 1;
  }
  const anchor = requests[anchorAt];
  const baselineTokens = anchor
    ? Math.max(0, anchor.contextTokens - liveTokensAt([...gapItems, ...out], anchor.seq))
    : 0;
  if (anchor && baselineTokens > 0) {
    out.push(
      contextItem(
        'baseline',
        anchor.seq,
        anchor.turnIndex,
        baselineTokens,
        'heuristic',
        anchor.seq,
        last.seq > anchor.seq ? last.seq : null,
      ),
    );
  }

  for (const boundary of compactionSeqs) {
    const at = upperBound(reqSeqs, boundary);
    const after = requests[at];
    if (!after || (anchor && after.seq <= anchor.seq)) continue;
    const live = liveTokensAt([...gapItems, ...out], after.seq);
    const floor = Math.max(0, after.contextTokens - live);
    if (floor <= 0) continue;
    out.push(
      contextItem(
        'post_compaction_floor',
        after.seq,
        after.turnIndex,
        floor,
        'heuristic',
        after.seq,
        carryEndFor(after.seq, reqSeqs, compactionSeqs),
      ),
    );
  }
  return out;
}

/**
 * Last request that still re-sends content ingested at `ingestSeq`: the newest request before the
 * next compaction boundary. `null` when nothing carries it (compaction or end of transcript).
 */
function carryEndFor(
  ingestSeq: number,
  reqSeqs: readonly number[],
  compactionSeqs: readonly number[],
): number | null {
  let stopSeq = Number.MAX_SAFE_INTEGER;
  for (const seq of compactionSeqs) {
    if (seq > ingestSeq) {
      stopSeq = seq;
      break;
    }
  }
  let last: number | null = null;
  for (let i = upperBound(reqSeqs, ingestSeq); i < reqSeqs.length; i += 1) {
    const seq = reqSeqs[i];
    if (seq === undefined || seq >= stopSeq) break;
    last = seq;
  }
  return last;
}

/** Attributed items keyed by `ref` (tool_use id for results, seq for injections). */
export function attributionByRef(attribution: TranscriptAttribution): Map<string | number, AttributedItem> {
  const map = new Map<string | number, AttributedItem>();
  for (const item of attribution.items) map.set(item.ref, item);
  return map;
}
