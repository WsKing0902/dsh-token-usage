/**
 * Composer-dock usage pill (browser half): a cost trigger registered into
 * the `conversation.composer.dock` slot (`order: 10`, after the official
 * stats pills at `order: 0`), rendered as one capsule in the official
 * StatsPills skin. The figure is the WITH-SUBAGENTS fold — the one number
 * no official surface carries — suffixed with a quiet "with subagents"
 * badge only when the scope actually spans a subtree; a solo session's
 * cost renders bare, same scope as the official pills beside it.
 *
 * Clicking opens a detail panel (harness menu chrome, upward of the dock)
 * that explains the total: the folded token figure and cache-hit rate next
 * to it (official pills carry only the single-session token count, so the
 * subtree share has no home but here), the session / subagents split, and
 * a per-model breakdown with the unpriced-models footnote. Panel data is
 * LAZY: the trigger polls `fields=chip` (totals only, subtree scope); the
 * two richer reads (`fields=session` for byModel, a solo-session `chip`
 * read for the split) fire when the panel first opens and again whenever
 * request churn debounces through.
 *
 * The pill refreshes at REQUEST granularity (the header chip's former
 * cadence, inherited whole): `sessionStats` projection churn plus mirror
 * `updatedAt` is debounced 250 ms into one fetch, a failed FIRST fetch
 * retries itself on a 3 s cadence, and later failures keep the prior
 * figures. When cost rises on a new request the figure plays `costPop`
 * and a +Δ label FALLS below the pill (the dock sits under the composer;
 * the header chip's upward rise would climb into the message scrollport).
 * Reduced-motion users get silent figure updates.
 *
 * Visibility contract: a session with no recorded requests renders
 * nothing; a transient fetch miss keeps the previous render.
 *
 * @module token-usage/client/CostPill
 */
import type { ReactNode } from 'react';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { UsageSummary } from '../wire.ts';
/** Self-heal cadence after a failed first fetch: refresh failures after the
 * first land keep the prior figures (silent mode) and self-heal on the next
 * request churn, so they never reach the error state. */
export declare const FETCH_FAILURE_RETRY_MS = 3000;
/** Props the pill binds for the composer-dock slot: the framework's session
 * kit (`sessionId` + the global `useSessions` mirror used to walk the
 * subagent tree) plus the locale seat from the registration's `locale:`
 * declaration. The dock slot declares no owner share. */
export type CostPillProps = PropsRuntime<'conversation.composer.dock'> & PropsLocale<'token-usage'>;
/**
 * The session / subagents split of one folded summary. Subagent figures are
 * derived by subtraction (folded minus solo) and clamped at zero — a stale
 * solo read against a fresher fold must never paint a negative share.
 */
export interface UsageSplit {
    selfCost: number;
    subsCost: number;
    selfTokens: number;
    subsTokens: number;
}
/**
 * Subtract a solo-session summary from its subtree fold.
 * @param tree - the subtree-scoped folded summary.
 * @param self - the solo-session summary (same session, no children).
 * @returns the two shares; costs and tokens are additive so subtraction is
 * exact, and the hit rate is NEVER split (a ratio is not subtractable — the
 * panel recomputes the folded rate from the tree totals instead).
 */
export declare function splitUsage(tree: UsageSummary, self: UsageSummary): UsageSplit;
/**
 * Render the composer-dock usage pill for the active session. Renders
 * nothing when the session has no recorded usage or while the first fetch
 * is in flight — the "data has no value, the block does not render" rule.
 * @param props - framework session id, the session-list mirror, and the locale seat.
 * @returns the pill (plus its open detail panel), or null when empty/unavailable.
 */
export declare function CostPill({ sessionId, useSessions, useProjection, t }: CostPillProps): ReactNode | null;
//# sourceMappingURL=CostPill.d.ts.map