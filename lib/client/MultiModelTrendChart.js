import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { useState } from 'react';
import { formatTokens } from "./format.js";
import { tickValues } from "./trend-chart/axis.js";
import { CHART_BOTTOM, CHART_HEIGHT, CHART_LEFT, CHART_RIGHT, CHART_TOP, CHART_WIDTH, CHART_X_LABELS, HIT_TARGET_FLOOR, } from "./trend-chart/layout.js";
import { smoothSeriesPath } from "./trend-chart/path.js";
import { labelIndices, scaleSeries } from "./trend-chart/scale.js";
import styles from './TrendChart.module.css';
/** Approximate glyph width used to size the floating hover card. */
const TOOLTIP_CHAR_WIDTH = 6.2;
/** Vertical pitch of one tooltip row. */
const TOOLTIP_ROW_HEIGHT = 15;
/** Truncate a long model id so one hover row cannot blow up the card. */
function shortLabel(label) {
    return label.length > 26 ? `${label.slice(0, 25)}…` : label;
}
/**
 * Render the per-model daily token trend.
 *
 * @param props - the day points in plot order, the ranked model series
 * (aligned with those points), and the locale seat.
 * @returns the legend plus the SVG chart.
 */
export function MultiModelTrendChart({ points, series, t }) {
    const [active, setActive] = useState(null);
    const equidistant = { mode: 'equidistant', points: [...points] };
    const innerHeight = CHART_HEIGHT - CHART_TOP - CHART_BOTTOM - CHART_X_LABELS;
    const maxValue = Math.max(1, ...series.flatMap(item => item.values));
    const { top, ticks } = tickValues(maxValue);
    const { xs, innerWidth } = scaleSeries(equidistant, CHART_LEFT, CHART_WIDTH - CHART_RIGHT);
    const y = (tokens) => CHART_TOP + innerHeight - (tokens / top) * innerHeight;
    const yZero = y(0);
    const paths = series.map(item => smoothSeriesPath({
        xs,
        ys: item.values.map(value => y(value)),
        yZero,
        hold: 'zero',
    }));
    const handleMouseMove = (event) => {
        if (points.length <= 1)
            return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (rect.width <= 0)
            return;
        const svgX = ((event.clientX - rect.left) / rect.width) * CHART_WIDTH;
        let closest = 0;
        let minDiff = Math.abs(xs[0] - svgX);
        for (let index = 1; index < xs.length; index += 1) {
            const diff = Math.abs(xs[index] - svgX);
            if (diff < minDiff) {
                minDiff = diff;
                closest = index;
            }
        }
        setActive(closest);
    };
    /** Invisible column around one point, spanning to its neighbours' midpoints. */
    const hitExtent = (index) => {
        if (points.length === 1)
            return { start: CHART_LEFT, width: innerWidth };
        const center = xs[index];
        const before = index === 0 ? undefined : xs[index - 1];
        const after = index === points.length - 1 ? undefined : xs[index + 1];
        const toPrev = before === undefined ? innerWidth : (center - before) / 2;
        const toNext = after === undefined ? innerWidth : (after - center) / 2;
        const half = Math.max(Math.min(toPrev, toNext), HIT_TARGET_FLOOR);
        return { start: center - half, width: half * 2 };
    };
    const activePoint = active === null ? null : points[active] ?? null;
    const activeRows = active === null
        ? []
        : series
            .map(item => ({ key: item.key, label: item.label, color: item.color, value: item.values[active] ?? 0 }))
            .filter(row => row.value > 0)
            .sort((left, right) => right.value - left.value);
    const tipTitle = activePoint === null
        ? ''
        : t('chart.pointLabel', { day: activePoint.full, tokens: formatTokens(activePoint.tokens) });
    const tipWidth = Math.min(CHART_WIDTH - CHART_LEFT - CHART_RIGHT, Math.max(tipTitle.length, ...activeRows.map(row => shortLabel(row.label).length + formatTokens(row.value).length + 4), 12) * TOOLTIP_CHAR_WIDTH + 30);
    const tipHeight = 22 + activeRows.length * TOOLTIP_ROW_HEIGHT + 8;
    const tipLeft = activePoint === null
        ? CHART_LEFT
        : Math.min(Math.max(xs[active] - tipWidth / 2, CHART_LEFT), CHART_WIDTH - CHART_RIGHT - tipWidth);
    const tipTop = CHART_TOP + 4;
    return (_jsxs("div", { className: styles.multiWrap, children: [_jsx("div", { className: styles.legend, role: "list", children: series.map(item => (_jsxs("span", { className: styles.legendItem, role: "listitem", children: [_jsx("span", { className: styles.swatch, style: { backgroundColor: item.color } }), _jsx("span", { className: styles.legendName, title: item.label, children: item.label }), _jsx("span", { className: styles.legendValue, children: formatTokens(item.total) })] }, item.key))) }), _jsxs("svg", { role: "img", "aria-label": t('chart.ariaModels'), viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`, className: styles.chart, onMouseMove: handleMouseMove, onMouseLeave: () => setActive(null), children: [ticks.map(tick => (_jsxs("g", { children: [_jsx("line", { x1: CHART_LEFT, y1: y(tick), x2: CHART_WIDTH - CHART_RIGHT, y2: y(tick), className: styles.grid }), _jsx("text", { x: CHART_LEFT - 6, y: y(tick) + 3, textAnchor: "end", className: styles.tick, children: formatTokens(tick) })] }, tick))), _jsx("line", { x1: CHART_LEFT, y1: y(0), x2: CHART_WIDTH - CHART_RIGHT, y2: y(0), className: styles.axis }), series.map((item, index) => (_jsx("path", { d: paths[index], className: styles.modelLine, style: { stroke: item.color } }, item.key))), active !== null ? (_jsxs("g", { pointerEvents: "none", children: [_jsx("line", { x1: xs[active], y1: CHART_TOP, x2: xs[active], y2: yZero, className: styles.guide }), series.map(item => (_jsx("circle", { cx: xs[active], cy: y(item.values[active] ?? 0), r: 3.5, className: styles.modelDot, style: { fill: item.color } }, item.key)))] })) : null, points.map((point, index) => {
                        const hit = hitExtent(index);
                        return (_jsx("rect", { x: hit.start, y: CHART_TOP, width: hit.width, height: innerHeight, fill: "transparent", "aria-label": t('chart.pointLabel', { day: point.full, tokens: formatTokens(point.tokens) }), role: "button", tabIndex: 0, className: styles.hit, onMouseEnter: () => setActive(index), onFocus: () => setActive(index), onBlur: () => setActive(current => (current === index ? null : current)) }, point.key));
                    }), activePoint !== null ? (_jsxs("g", { className: styles.pointLabel, pointerEvents: "none", children: [_jsx("rect", { x: tipLeft, y: tipTop, width: tipWidth, height: tipHeight, rx: 6 }), _jsx("text", { x: tipLeft + 12, y: tipTop + 15, className: styles.tooltipTitle, children: tipTitle }), activeRows.map((row, index) => {
                                const rowY = tipTop + 30 + index * TOOLTIP_ROW_HEIGHT;
                                return (_jsxs("g", { children: [_jsx("rect", { x: tipLeft + 12, y: rowY - 6, width: 8, height: 8, rx: 2, style: { fill: row.color } }), _jsx("text", { x: tipLeft + 26, y: rowY + 1, className: styles.tooltipText, children: shortLabel(row.label) }), _jsx("text", { x: tipLeft + tipWidth - 10, y: rowY + 1, textAnchor: "end", className: styles.tooltipValue, children: formatTokens(row.value) })] }, row.key));
                            })] })) : null, labelIndices(points.length).map(index => (_jsx("text", { x: xs[index], y: CHART_HEIGHT - 6, textAnchor: index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle', className: styles.tick, children: points[index].label }, index)))] })] }));
}
//# sourceMappingURL=MultiModelTrendChart.js.map