/**
 * Shared "stat card" primitive: label on top, value underneath. Used by the
 * settings section (primary cards + four token-bucket cards) and the Usage
 * view tab (six cards: requests-with-failure-pill / cost / total tokens /
 * hit rate / TTFT / token speed). Centralising the markup + styling means
 * the two surfaces read as one family without each one carrying its own
 * copy of the label-on-top / value-below rule.
 *
 * {@link FailurePill} is the compact failed-count chip the requests card
 * uses. Per-model tables use {@link RequestsCell} (`A/B`, B in the error
 * color) instead — a pill is too much chrome for a numeric column.
 *
 * @module token-usage/client/StatCard
 */
import type { ReactNode } from 'react';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
/** One labelled figure inside a card. */
export interface StatCardProps {
    /** The small secondary line ("token cost", "hit rate", "总 token"). */
    label: string;
    /** The bold tabular-numeric value (`1.5M`, `¥12.34`, `0.5s`). A
     * node is accepted so the hit-rate card can wrap {@link HitRateText}
     * and inherit the four-bucket colour without a second card variant. */
    value: ReactNode;
}
/**
 * Render one stat card. The value uses the standard label-primary color.
 * The label clamps to one line and ellipsizes if the column is squeezed.
 */
export declare function StatCard({ label, value }: StatCardProps): ReactNode;
/** Props for the shared failure-count pill. */
export interface FailurePillProps {
    /** Failed provider attempts; 0 renders nothing. */
    failures: number;
    /** Per-code breakdown driving the tooltip. */
    failuresByCode: Record<string, number> | undefined;
    /** Locale function (`stat.failuresPill` / `fail.*`). */
    t: TranslateNS<'token-usage'>;
}
/**
 * Compact "失败 n" chip for the requests **card** only. Hovering or focusing
 * it lists `限流 ×count` per class. Zero failures render nothing. Per-model
 * tables do not use this — they print `A/B` via {@link RequestsCell}.
 */
export declare function FailurePill({ failures, failuresByCode, t, }: FailurePillProps): ReactNode;
/** Props for the shared successful-requests card with a failure pill. */
export interface RequestsStatCardProps {
    /** Successful (billed) request count. */
    requests: number;
    /** Failed provider attempts. */
    failures: number;
    /** Per-code breakdown driving the pill tooltip. */
    failuresByCode: Record<string, number> | undefined;
    /** Locale function (zh/en `stat.requests` / `stat.failuresPill`). */
    t: TranslateNS<'token-usage'>;
}
/**
 * The requests tile both dashboards share: hero figure is the successful
 * count; a compact pill to its right carries the failure count.
 */
export declare function RequestsStatCard({ requests, failures, failuresByCode, t, }: RequestsStatCardProps): ReactNode;
/** Props for the per-model requests cell: `success/fail` as `A/B`.
 * Tables pass the row's own totals so a session-scoped or date-filtered
 * summary cannot leak another row's failures into this cell. */
export interface RequestsCellProps {
    requests: number;
    failures: number;
    failuresByCode: Record<string, number> | undefined;
    t: TranslateNS<'token-usage'>;
}
/** Column header for the per-model success/fail split: same 3-track
 * grid as {@link RequestsCell} so the slash sits on the column midline. */
export declare function RequestsSplitHead({ t }: {
    t: TranslateNS<'token-usage'>;
}): ReactNode;
/** One table cell: successful count, and when failures > 0 a slash on
 * the column midline plus the failure count in the error color.
 * Zero failures print only A (same left track, so the figure still
 * lines up with rows that have a B). Hovering B lists the per-code
 * breakdown. */
export declare function RequestsCell({ requests, failures, failuresByCode, t, }: RequestsCellProps): ReactNode;
//# sourceMappingURL=StatCard.d.ts.map