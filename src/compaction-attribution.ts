/**
 * Compaction attribution (shared window): the attribution model behind the
 * 「压缩后」 request-pool badge. Each session keeps a window of the
 * compaction events that landed since its last PLAIN request — when a plain
 * request row is projected and the window is non-empty, the row carries the
 * window as its attribution and the window resets.
 *
 * Why attribution, not a cache verdict: the host's compaction rewrites the
 * context prefix (tool-result pruning shadows messages, an LLM summary
 * replaces history), so the prefix cache of the FIRST request after the
 * rewrite may miss through no fault of the provider. The miss severity is a
 * function of the earliest rewritten position, so「affected」 never implies
 *「cache lost」 — the badge annotates, `assessRequestCache` stays untouched.
 *
 * Clustering: prune events land as a tight run at one step boundary (same
 * millisecond, verified live), so consecutive prunes with no other event in
 * between fold into ONE cluster item (count = run length, tokens = the
 * shadowed sum). Any other event seals the cluster — a later prune opens a
 * new one even inside the same window. A summary is always its own item, so
 * a mixed window (prune cluster + summary) lists both for the tooltip.
 *
 * The window is pure in-memory state over the session event stream, so the
 * live recorder and the history rescan drive the SAME implementation — the
 * badge can never diverge between the two paths.
 *
 * @module token-usage/compaction-attribution
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: pulls the declaration-merged `compaction/*` event payloads into
// this program, so `SessionEvent<'compaction/prune'>` below is nameable.
import type {} from '@deepseek-ai/dsh-compaction/types'

/** Which host compaction operation rewrote the prefix. */
export type CompactionSourceKind = 'prune' | 'summary'

/** One attribution entry a request row may carry: the source kind plus the
 * magnitude facts the tooltip needs. */
export interface CompactionAttributionItem {
  /** `prune` — a run of `compaction/prune` events folded into one cluster;
   * `summary` — one `compaction/summary` (its summarize call bills as its
   * own compaction row; this entry only explains the prefix rewrite). */
  kind: CompactionSourceKind
  /** Prune cluster: the number of folded prune events. Summary: always 1. */
  count: number
  /** Shadow tokens: the cluster's summed / the summary's own
   * `shadowedTokenCount` — the heuristic price of the shadowed content,
   * NOT a claim about the exact context-size reduction. */
  shadowedTokenCount: number
}

/** Defensive read of one shadowed figure: a non-finite or negative value
 * reads as 0 (the event count is still a fact; its magnitude is not). */
function shadowTokensOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/**
 * The per-session attribution window: compaction events since the last plain
 * request. Feed every session event through {@link observe} in stream order;
 * call {@link consumeForRequest} when a plain-request row is projected — a
 * non-empty window is returned (and reset) as that row's attribution.
 */
export class CompactionAttributionWindow {
  private items: CompactionAttributionItem[] = []
  /** Whether the trailing prune cluster is sealed (any non-prune event
   * seals it; the next prune opens a fresh cluster). */
  private sealed = false

  /** Fold one session event into the window. Only `compaction/prune` and
   * `compaction/summary` contribute items; every other event type merely
   * seals the trailing prune cluster. */
  observe(event: SessionEvent): void {
    if (event.type === 'compaction/prune') {
      const last = this.items[this.items.length - 1]
      const tokens = shadowTokensOf(event.data.shadowedTokenCount)
      if (last !== undefined && last.kind === 'prune' && !this.sealed) {
        last.count += 1
        last.shadowedTokenCount += tokens
      } else {
        this.items.push({ kind: 'prune', count: 1, shadowedTokenCount: tokens })
        this.sealed = false
      }
      return
    }
    if (event.type === 'compaction/summary') {
      this.items.push({ kind: 'summary', count: 1, shadowedTokenCount: shadowTokensOf(event.data.shadowedTokenCount) })
      this.sealed = true
      return
    }
    this.sealed = true
  }

  /** Take the window for a plain-request row: the accumulated attribution
   * when any, and the window resets either way (the request consumed it).
   * Only plain request rows consume — a compaction row is the rewrite's own
   * billing row, and a failure row has no cache figures to explain; the
   * window then survives until the next plain request, whose prefix the
   * rewrite still precedes. */
  consumeForRequest(): CompactionAttributionItem[] | undefined {
    if (this.items.length === 0) return undefined
    const out = this.items
    this.items = []
    this.sealed = true
    return out
  }
}
