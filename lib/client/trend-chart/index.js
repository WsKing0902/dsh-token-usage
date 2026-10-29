/**
 * Public re-exports of the trend-chart helpers, so the test suite and
 * any future module can import them from a single barrel.
 */
export { MAX_BUCKETS, bucketSeries, bucketWidth, scaleToSpan } from "./bucket.js";
export { niceStep, tickValues } from "./axis.js";
export { buildChartPoints, cumulateSeries } from "./points.js";
export { dotRadius, labelIndices, scaleSeries } from "./scale.js";
export { areaPath, gapAfter, gapPatchedPoints, monotoneSplinePath, seriesPath, smoothSeriesPath } from "./path.js";
//# sourceMappingURL=index.js.map