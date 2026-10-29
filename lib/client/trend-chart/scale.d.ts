/**
 * Trend-chart x scaling: pick the right scale for a series mode and
 * return the per-point offsets in one pass. Pure functions, no React.
 *
 * @module token-usage/client/trend-chart/scale
 */
import type { ChartSeries } from './points.ts';
/** A scale decision plus the per-point x offsets, expressed as **absolute
 * SVG viewBox coordinates** (already offset by `leftEdge`). Returning
 * absolute coords prevents the "renderer forgot to add `LEFT`" bug that
 * shows up as a line hugging the very-left edge of the chart area. */
export interface ScaleResult {
    /** The x offset of every point in SVG viewBox coordinates (range
     * `[leftEdge, rightEdge]`). */
    xs: number[];
    /** Temporal only: each bucket's exclusive `end` on the same scale as
     * `xs`, clamped to `[leftEdge, rightEdge]`. Gap paths use
     * `xEnds[i] − xs[i]` as the bucket width so the hold ends one bucket
     * before the next cluster. */
    xEnds?: number[];
    /** The plottable width (rightEdge − leftEdge); the renderer can use it
     * for hit-target extents and label clamps. */
    innerWidth: number;
}
/**
 * Pick the right x scale for a {@link ChartSeries} and produce the
 * per-point offsets in absolute viewBox coordinates. Equidistant modes
 * lay points one stride apart across the `[leftEdge, rightEdge]` span;
 * temporal mode uses each point's wall time against the series' own
 * first-start to last-start span and adds `leftEdge` to the result.
 * A zero span (one point, or every start equal) pins to the centerline.
 * Temporal results include `xEnds` for the gap-path bucket width.
 *
 * @param series - the discriminated-union series from {@link buildChartPoints}.
 * @param leftEdge - the absolute SVG x of the chart's left edge (the
 * y-axis line in the renderer).
 * @param rightEdge - the absolute SVG x of the chart's right edge
 * (typically `viewBox.width − RIGHT.margin`).
 * @returns the per-point x offsets plus `innerWidth = rightEdge − leftEdge`.
 */
export declare function scaleSeries(series: ChartSeries, leftEdge: number, rightEdge: number): ScaleResult;
/**
 * The x-axis label positions: first, middle, and last point for long
 * ranges. Short ranges (≤3 points) label every point so a 1- or 2- day
 * window does not skip the only "middle" data.
 */
export declare function labelIndices(length: number): number[];
/** Choose a dot radius that survives dense point clouds without
 * overlapping but stays visible for sparse ones. Three tiers, picked by
 * point count. */
export declare function dotRadius(pointCount: number): number;
//# sourceMappingURL=scale.d.ts.map