/**
 * Shared SVG canvas metrics of the token trend charts (single-series and
 * the per-model multi-series view). One module keeps both renderers on the
 * same viewBox, margins, and hit-target floor — a second copy would drift
 * and the two charts would stop lining up under the same section width.
 *
 * @module token-usage/client/trend-chart/layout
 */
/** SVG canvas width in viewBox units; the element scales to its container. */
export declare const CHART_WIDTH = 800;
/** SVG canvas height in viewBox units. */
export declare const CHART_HEIGHT = 190;
/** Top plot margin (room for the floating tooltip label). */
export declare const CHART_TOP = 12;
/** Bottom plot margin (the y-axis baseline). */
export declare const CHART_BOTTOM = 16;
/** Left plot margin (room for the y-axis tick labels). */
export declare const CHART_LEFT = 44;
/** Right plot margin. */
export declare const CHART_RIGHT = 16;
/** Height reserved under the plot for the x-axis labels. */
export declare const CHART_X_LABELS = 22;
/** Minimum half-width of one point's invisible hover target. */
export declare const HIT_TARGET_FLOOR = 6;
//# sourceMappingURL=layout.d.ts.map