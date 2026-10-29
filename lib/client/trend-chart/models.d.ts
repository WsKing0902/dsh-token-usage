/**
 * Per-model daily series of the trend chart (browser half): folds the
 * already-filtered `rateRows` (day × model × rate) into one token series
 * per model, ranked by range total, so the chart can draw every model in
 * its own color at the same time — the ZCode-style daily model trend.
 *
 * Pure functions, no React: the renderer only shapes and draws.
 *
 * @module token-usage/client/trend-chart/models
 */
import type { UsageRateRow } from '../../wire.ts';
/** Fixed palette: enough hues to keep six models apart in both light and
 * dark themes; index order is the ranking order (biggest model first). */
export declare const MODEL_CHART_COLORS: readonly ["#5B8FF9", "#5AD8A6", "#F6BD16", "#E8684A", "#9270CA", "#6DC8EC", "#FF9D4D", "#269A99"];
/** Synthetic series key of the folded tail beyond the display limit. */
export declare const OTHER_MODEL_KEY = "__other__";
/** Neutrals keep the folded tail visible without claiming a palette hue. */
export declare const OTHER_MODEL_COLOR = "#9CA3AF";
/** How many models get their own color; the rest fold into "other". */
export declare const MODEL_SERIES_LIMIT = 6;
/** One plotted model: values aligned index-for-index with the day points. */
export interface ModelDaySeries {
    /** Model id, or {@link OTHER_MODEL_KEY} for the folded tail. */
    key: string;
    /** Display label (the model id; the caller supplies the "other" label). */
    label: string;
    color: string;
    /** Daily token totals, aligned with the chart's day points. */
    values: number[];
    /** Range total across every day (legend figure). */
    total: number;
}
/**
 * Fold `rateRows` into ranked per-model daily token series.
 *
 * Rows sharing a day and model across different rate identities (and the
 * same model met under two spellings) sum into one cell, so a model line is
 * its whole billed input + output + cache traffic. Failure rows (`model ===
 * ''`) and zero-token cells stay out: they carry no line to draw.
 *
 * @param input - the filtered rate rows, the chart's day keys in plot order,
 * the display limit, and the localised label for the folded tail.
 * @returns up to `limit` ranked series plus an optional folded "other" series
 * (omitted when the tail is empty); `[]` when nothing has tokens.
 */
export declare function buildModelDaySeries(input: {
    rateRows: readonly UsageRateRow[];
    dayKeys: readonly string[];
    otherLabel: string;
    limit?: number;
}): ModelDaySeries[];
//# sourceMappingURL=models.d.ts.map