import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Daily / hourly / request-bucketed token trend chart (browser half):
 * a dependency-free SVG line chart over the already-filtered summary.
 * The renderer is pure presentation; the bucketing, scaling, and
 * point-shape decisions live in `./trend-chart/*` so each piece can be
 * tested in isolation.
 *
 * Two granularities share one renderer — per-day rows (x axis spans
 * every calendar day of the active range, days without records plot as
 * zero) and per-hour rows (a single-day window plots every whole hour of
 * that day, 00:00–23:00, future hours of today reading zero). The
 * third mode — request buckets — folds the request series into uniformly
 * sized time buckets spanning the session's actual first-to-last window
 * and scales each bucket at its real temporal proportion of the span.
 *
 * Hovering (or keyboard-focusing) a point highlights it and floats a
 * label with that point's date/time and total tokens.
 *
 * @module token-usage/client/TrendChart
 */
import { useId, useState } from 'react';
import { formatTokens } from "./format.js";
import { MultiModelTrendChart } from "./MultiModelTrendChart.js";
import { buildModelDaySeries } from "./trend-chart/models.js";
import { tickValues } from "./trend-chart/axis.js";
import { areaPath, gapAfter, smoothSeriesPath } from "./trend-chart/path.js";
import { buildChartPoints, cumulateSeries } from "./trend-chart/points.js";
import { dotRadius, labelIndices, scaleSeries } from "./trend-chart/scale.js";
import { CHART_BOTTOM, CHART_HEIGHT, CHART_LEFT, CHART_RIGHT, CHART_TOP, CHART_WIDTH, CHART_X_LABELS, HIT_TARGET_FLOOR, } from "./trend-chart/layout.js";
import { useIsLightMode } from "./use-color-scheme.js";
import styles from './TrendChart.module.css';
/** Re-export the chart's pure helpers for the test suite. */
export { MAX_BUCKETS, areaPath, bucketSeries, bucketWidth, buildChartPoints, cumulateSeries, dotRadius, gapAfter, gapPatchedPoints, labelIndices, monotoneSplinePath, niceStep, scaleSeries, scaleToSpan, seriesPath, smoothSeriesPath, tickValues, } from "./trend-chart/index.js";
/** SVG canvas metrics; shared with the per-model renderer so both charts
 * line up under the same section width and margins. */
const WIDTH = CHART_WIDTH;
const HEIGHT = CHART_HEIGHT;
const TOP = CHART_TOP;
const BOTTOM = CHART_BOTTOM;
const LEFT = CHART_LEFT;
const RIGHT = CHART_RIGHT;
const X_LABELS = CHART_X_LABELS;
/**
 * Apply the `t`-based localisation to a point's `full` tooltip. The pre-shape
 * labels live in points.ts; the chart's aria-label and the floating tooltip
 * both use this single source so the two stay consistent. Cumulative mode
 * swaps in its own phrasing so "total" never reads ambiguous next to a
 * running sum.
 * @param t - the locale seat.
 * @param point - the pre-shaped point.
 * @param mode - the active y-axis mode.
 * @returns the tooltip / aria-label text.
 */
function tipOf(t, point, mode) {
    if (point.time !== undefined) {
        const params = { window: point.full, count: String(point.count ?? 0), tokens: formatTokens(point.tokens) };
        return mode === 'cumulative' ? t('chart.cumulativeBucket', params) : t('chart.bucket', params);
    }
    const params = { day: point.full, tokens: formatTokens(point.tokens) };
    return mode === 'cumulative' ? t('chart.cumulativePoint', params) : t('chart.pointLabel', params);
}
/**
 * Render the daily / hourly / request-bucketed token line chart. Pure
 * presentation: every data-driven decision (bucketing, axis scaling,
 * point ordering) lives in `./trend-chart/*`; this component picks the
 * right `chartAria` string for screen readers and forwards hover /
 * focus state to the dot + label.
 *
 * Empty ranges (no data on any branch) render a placeholder instead of an
 * axis so the layout does not collapse to an empty SVG.
 *
 * @param props - the filtered per-day rows plus the optional per-hour rows
 * (when present the chart plots hours instead of days), the optional
 * per-request series (session-scoped reads), the active range bounds
 * (absent when unfiltered; the chart then spans first to last row), the
 * optional y-axis mode (interval totals, or their running cumulative sum),
 * and
 * the `t` seat for the empty hint and chart aria-label.
 * @returns the SVG chart, or a placeholder for an empty range.
 */
export function TrendChart({ rows, hours, requests, from, to, mode = 'interval', rateRows, t }) {
    const isLight = useIsLightMode();
    const gradientId = useId();
    const [active, setActive] = useState(null);
    const base = buildChartPoints({ rows, hours, requests, from, to });
    if (base === null) {
        return _jsx("p", { className: styles.empty, children: t('chart.empty') });
    }
    // Cumulative mode is a pure y-axis transform on the built points (a
    // prefix sum); the x axis, bucketing, and point count are untouched.
    const series = mode === 'cumulative' ? cumulateSeries(base) : base;
    // Per-model daily trend: the settings page supplies its rate rows, so the
    // day chart can split the total into one colored line per model (the
    // ZCode-style model breakdown). Hour / request / cumulative modes keep the
    // single total line — their per-model granules are not part of this view.
    if (rateRows !== undefined && mode === 'interval' && hours === undefined && series.mode === 'equidistant') {
        const modelSeries = buildModelDaySeries({
            rateRows,
            dayKeys: series.points.map(point => point.key),
            otherLabel: t('chart.modelOther'),
        });
        if (modelSeries.length >= 2) {
            return _jsx(MultiModelTrendChart, { points: series.points, series: modelSeries, t: t });
        }
    }
    // Materialise the points (and apply t() through `tipOf` at render time).
    const points = series.points.map(point => ({
        key: point.key,
        label: point.label,
        full: point.full,
        tokens: point.tokens,
        time: 'time' in point ? point.time : undefined,
        count: 'count' in point ? point.count : undefined,
    }));
    const { top, ticks } = tickValues(Math.max(...points.map(p => p.tokens)));
    const innerHeight = HEIGHT - TOP - BOTTOM - X_LABELS;
    // scaleSeries returns absolute viewBox coordinates already offset by LEFT,
    // so the dots / path / x-axis labels can plug xs[i] straight into the
    // SVG `cx`/`x` attributes without re-adding the y-axis margin.
    const { xs, xEnds, innerWidth } = scaleSeries(series, LEFT, WIDTH - RIGHT);
    const radius = dotRadius(points.length);
    const activePoint = active === null ? null : points[active] ?? null;
    const y = (tokens) => TOP + innerHeight - (tokens / top) * innerHeight;
    const ys = points.map(point => y(point.tokens));
    const yZero = y(0);
    // Generate a smooth monotonic cubic spline across either equidistant
    // days/hours or gap-patched temporal buckets (so request idle stays idle).
    const path = smoothSeriesPath({
        xs,
        ys,
        yZero,
        gaps: series.mode === 'temporal' ? gapAfter(series.points) : undefined,
        xEnds: series.mode === 'temporal' ? (xEnds ?? xs) : undefined,
        hold: mode === 'cumulative' ? 'previous' : 'zero',
    });
    const area = areaPath(path, xs, yZero);
    // Cumulative reads one aria regardless of granularity: the per-mode
    // phrasing ("daily" / "hourly" / "request-bucketed") describes interval
    // totals and would mislabel a running sum; the tooltip carries the detail.
    const chartAria = mode === 'cumulative'
        ? t('chart.ariaCumulative')
        : series.mode === 'temporal'
            ? t('chart.ariaRequests')
            : hours !== undefined ? t('chart.ariaHour') : t('chart.aria');
    // The hit target around each point spans to the midpoint of each
    // neighbour (the full width for a single point), with a floor so
    // bunched-up request-mode points stay individually reachable — no
    // fixed grid width survives a temporal scale.
    const hitExtent = (index) => {
        if (points.length === 1)
            return { start: LEFT, width: innerWidth };
        const center = xs[index];
        const before = index === 0 ? undefined : xs[index - 1];
        const after = index === points.length - 1 ? undefined : xs[index + 1];
        const toPrev = before === undefined ? innerWidth : (center - before) / 2;
        const toNext = after === undefined ? innerWidth : (after - center) / 2;
        const half = Math.max(Math.min(toPrev, toNext), HIT_TARGET_FLOOR);
        return { start: center - half, width: half * 2 };
    };
    const handleMouseMove = (event) => {
        if (points.length <= 1)
            return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width <= 0)
            return;
        const svgX = ((event.clientX - rect.left) / rect.width) * WIDTH;
        let closest = 0;
        let minDiff = Math.abs(xs[0] - svgX);
        for (let i = 1; i < xs.length; i += 1) {
            const diff = Math.abs(xs[i] - svgX);
            if (diff < minDiff) {
                minDiff = diff;
                closest = i;
            }
        }
        setActive(closest);
    };
    return (_jsxs("svg", { role: "img", "aria-label": chartAria, viewBox: `0 0 ${WIDTH} ${HEIGHT}`, className: `${styles.chart} ${isLight ? styles.chartLight : ''}`.trim(), "data-theme": isLight ? 'light' : 'dark', onMouseMove: handleMouseMove, onMouseLeave: () => setActive(null), children: [isLight ? (_jsx("defs", { children: _jsxs("linearGradient", { id: gradientId, x1: "0", y1: "0", x2: "0", y2: "1", children: [_jsx("stop", { offset: "0%", stopColor: "var(--dsw-alias-label-primary)", stopOpacity: "0.045" }), _jsx("stop", { offset: "55%", stopColor: "var(--dsw-alias-label-primary)", stopOpacity: "0.012" }), _jsx("stop", { offset: "100%", stopColor: "var(--dsw-alias-label-primary)", stopOpacity: "0.0" })] }) })) : null, ticks.map(tick => (_jsxs("g", { children: [_jsx("line", { x1: LEFT, y1: y(tick), x2: WIDTH - RIGHT, y2: y(tick), className: styles.grid }), _jsx("text", { x: LEFT - 6, y: y(tick) + 3, textAnchor: "end", className: styles.tick, children: formatTokens(tick) })] }, tick))), _jsx("line", { x1: LEFT, y1: y(0), x2: WIDTH - RIGHT, y2: y(0), className: styles.axis }), isLight && area !== '' ? _jsx("path", { d: area, fill: `url(#${gradientId})`, className: styles.area }) : null, _jsx("path", { d: path, className: styles.line }), activePoint !== null && active !== null ? (_jsxs("g", { pointerEvents: "none", children: [_jsx("circle", { cx: xs[active], cy: y(activePoint.tokens), r: radius + 3.5, className: styles.dotHalo }), _jsx("circle", { cx: xs[active], cy: y(activePoint.tokens), r: radius, className: styles.dotActive })] })) : points.length === 1 ? (_jsx("circle", { cx: xs[0], cy: y(points[0].tokens), r: radius, className: styles.dot })) : null, activePoint !== null
                ? (
                // The guide line drops from the active point to the x axis.
                _jsx("line", { x1: xs[active], y1: y(activePoint.tokens), x2: xs[active], y2: y(0), className: styles.guide }))
                : null, points.map((point, index) => {
                const hit = hitExtent(index);
                return (_jsx("rect", { x: hit.start, y: TOP, width: hit.width, height: innerHeight, fill: "transparent", "aria-label": tipOf(t, point, mode), role: "button", tabIndex: 0, className: styles.hit, onMouseEnter: () => setActive(index), onFocus: () => setActive(index), onBlur: () => setActive(current => current === index ? null : current) }, point.key));
            }), activePoint !== null
                ? (() => {
                    // Floating label: kept inside the canvas horizontally (near
                    // the edges it flips toward the center), above the point with
                    // a ceiling at the canvas top.
                    const label = tipOf(t, activePoint, mode);
                    const charWidth = 6.2;
                    const labelWidth = label.length * charWidth + 14;
                    const center = xs[active];
                    const left = Math.min(Math.max(center - labelWidth / 2, LEFT), WIDTH - RIGHT - labelWidth);
                    const labelY = Math.max(y(activePoint.tokens) - 12, TOP + 8);
                    return (_jsxs("g", { className: styles.pointLabel, pointerEvents: "none", children: [_jsx("rect", { x: left, y: labelY - 14, width: labelWidth, height: 22, rx: 6 }), _jsx("text", { x: left + labelWidth / 2, y: labelY + 1, textAnchor: "middle", children: label })] }));
                })()
                : null, labelIndices(points.length).map(index => (_jsx("text", { x: xs[index], y: HEIGHT - 6, textAnchor: index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle', className: styles.tick, children: points[index].label }, index)))] }));
}
//# sourceMappingURL=TrendChart.js.map