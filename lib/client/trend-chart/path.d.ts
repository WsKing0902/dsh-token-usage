/**
 * Trend-chart SVG path geometry: a polyline, optionally patched across
 * temporal gaps. Pure functions, no React.
 *
 * @module token-usage/client/trend-chart/path
 */
/** How consecutive points are joined. */
export type PathStyle = 'polyline' | 'gap';
/**
 * Per-segment gap flags: `flags[i]` is true when the next bucket starts
 * after this bucket's exclusive `end`. Adjacent uniform buckets have
 * `next.time === prev.end` and are not gaps.
 */
export declare function gapAfter(points: readonly {
    time: number;
    end: number;
}[]): boolean[];
/**
 * SVG `d` for already-scaled coordinates. Empty → `''`; one point → `M`.
 *
 * `gap` is the original polyline plus a patch: adjacent buckets stay a
 * straight `L`; a gap holds `hold` (`zero` = axis, `previous` = last y)
 * from the previous bucket's end until one bucket-width before the next
 * start, then slants in — so idle is not interpolated and dense hours
 * keep the polyline.
 */
export declare function seriesPath(input: {
    xs: readonly number[];
    ys: readonly number[];
    yZero: number;
    style: PathStyle;
    hold?: 'zero' | 'previous';
    gaps?: readonly boolean[];
    xEnds?: readonly number[];
}): string;
/**
 * Generate a smooth cubic Bezier path using Fritsch-Carlson monotone cubic
 * Hermite interpolation. Preserves monotonicity so zero-filled plateaus stay
 * strictly flat at baseline without undershooting, and peaks round smoothly.
 *
 * @param xs - scaled x coordinates (monotonic ascending).
 * @param ys - scaled y coordinates.
 * @returns SVG `d` string containing M, L, and C commands.
 */
export declare function monotoneSplinePath(xs: readonly number[], ys: readonly number[]): string;
/**
 * Close a line/curve path down to the baseline (`yZero`) to form an area polygon.
 * Returns an empty string when the input path is empty or has fewer than 2 points.
 *
 * @param linePath - the line or curve `d` string.
 * @param xs - the plotted x coordinates.
 * @param yZero - the baseline y coordinate.
 * @returns SVG `d` string closed with Z for fill.
 */
export declare function areaPath(linePath: string, xs: readonly number[], yZero: number): string;
/**
 * Return coordinates with gap hold points inserted so temporal series can be
 * smoothly interpolated with monotonic cubic splines without smearing idle spans.
 */
export declare function gapPatchedPoints(input: {
    xs: readonly number[];
    ys: readonly number[];
    yZero: number;
    hold?: 'zero' | 'previous' | undefined;
    gaps?: readonly boolean[] | undefined;
    xEnds?: readonly number[] | undefined;
}): {
    xs: number[];
    ys: number[];
};
/**
 * Generate a smooth spline path for either equidistant or gap-patched temporal series.
 */
export declare function smoothSeriesPath(input: {
    xs: readonly number[];
    ys: readonly number[];
    yZero: number;
    gaps?: readonly boolean[] | undefined;
    xEnds?: readonly number[] | undefined;
    hold?: 'zero' | 'previous' | undefined;
}): string;
//# sourceMappingURL=path.d.ts.map