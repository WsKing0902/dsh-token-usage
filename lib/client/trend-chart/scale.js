/**
 * Trend-chart x scaling: pick the right scale for a series mode and
 * return the per-point offsets in one pass. Pure functions, no React.
 *
 * @module token-usage/client/trend-chart/scale
 */
import { scaleToSpan } from "./bucket.js";
function clampX(value, leftEdge, rightEdge) {
    return Math.min(Math.max(value, leftEdge), rightEdge);
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
export function scaleSeries(series, leftEdge, rightEdge) {
    const innerWidth = rightEdge - leftEdge;
    const { points } = series;
    if (series.mode === 'equidistant') {
        const xs = [];
        if (points.length === 1) {
            xs.push((leftEdge + rightEdge) / 2);
        }
        else {
            const stride = innerWidth / (points.length - 1);
            for (let i = 0; i < points.length; i += 1)
                xs.push(leftEdge + i * stride);
        }
        return { xs, innerWidth };
    }
    // Temporal: wall time into the first-start to last-start span. `end`
    // uses the same domain; an end past the last start clamps to the right edge.
    const temporal = series.points;
    const first = temporal[0].time;
    const lastStart = temporal[temporal.length - 1].time;
    if (temporal.length === 1 || first === lastStart) {
        const mid = (leftEdge + rightEdge) / 2;
        const xs = temporal.map(() => mid);
        return { xs, xEnds: [...xs], innerWidth };
    }
    const xs = [];
    const xEnds = [];
    for (const point of temporal) {
        const x = clampX(leftEdge + scaleToSpan(first, lastStart, point.time, innerWidth), leftEdge, rightEdge);
        const xEnd = clampX(leftEdge + scaleToSpan(first, lastStart, point.end, innerWidth), leftEdge, rightEdge);
        xs.push(x);
        xEnds.push(Math.max(x, xEnd));
    }
    return { xs, xEnds, innerWidth };
}
/**
 * The x-axis label positions: first, middle, and last point for long
 * ranges. Short ranges (≤3 points) label every point so a 1- or 2- day
 * window does not skip the only "middle" data.
 */
export function labelIndices(length) {
    if (length <= 3)
        return Array.from({ length }, (_, index) => index);
    const middle = Math.floor((length - 1) / 2);
    return [...new Set([0, middle, length - 1])];
}
/** Choose a dot radius that survives dense point clouds without
 * overlapping but stays visible for sparse ones. Three tiers, picked by
 * point count. */
export function dotRadius(pointCount) {
    if (pointCount > 90)
        return 1.5;
    if (pointCount > 30)
        return 2;
    return 3;
}
//# sourceMappingURL=scale.js.map