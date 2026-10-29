/**
 * Per-model daily token trend chart (browser half): one line per model in
 * its own color, a legend carrying each model's range total, and a hover
 * card breaking the active day down by model. Follows the ZCode usage
 * page's daily model trend: the top models get fixed palette hues, the
 * tail folds into a neutral "other" line, and the y axis shrinks to the
 * largest *visible* series value — a total-scaled axis would press every
 * model line onto the baseline.
 *
 * Pure presentation: folding lives in `./trend-chart/models.ts`, and the
 * canvas metrics are shared with the single-series renderer through
 * `./trend-chart/layout.ts`.
 *
 * @module token-usage/client/MultiModelTrendChart
 */
import type { ReactNode } from 'react';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { ModelDaySeries } from './trend-chart/models.ts';
/** One plotted day, pre-shaped by `buildChartPoints` (equidistant mode). */
export interface ModelChartPoint {
    key: string;
    label: string;
    full: string;
    tokens: number;
}
/**
 * Render the per-model daily token trend.
 *
 * @param props - the day points in plot order, the ranked model series
 * (aligned with those points), and the locale seat.
 * @returns the legend plus the SVG chart.
 */
export declare function MultiModelTrendChart({ points, series, t }: {
    points: readonly ModelChartPoint[];
    series: readonly ModelDaySeries[];
    t: TranslateNS<'token-usage'>;
}): ReactNode;
//# sourceMappingURL=MultiModelTrendChart.d.ts.map