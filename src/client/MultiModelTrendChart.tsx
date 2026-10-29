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

import { useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { formatTokens } from './format.ts'
import { tickValues } from './trend-chart/axis.ts'
import {
  CHART_BOTTOM,
  CHART_HEIGHT,
  CHART_LEFT,
  CHART_RIGHT,
  CHART_TOP,
  CHART_WIDTH,
  CHART_X_LABELS,
  HIT_TARGET_FLOOR,
} from './trend-chart/layout.ts'
import type { ModelDaySeries } from './trend-chart/models.ts'
import { smoothSeriesPath } from './trend-chart/path.ts'
import { labelIndices, scaleSeries } from './trend-chart/scale.ts'
import styles from './TrendChart.module.css'

/** One plotted day, pre-shaped by `buildChartPoints` (equidistant mode). */
export interface ModelChartPoint {
  key: string
  label: string
  full: string
  tokens: number
}

/** Approximate glyph width used to size the floating hover card. */
const TOOLTIP_CHAR_WIDTH = 6.2
/** Vertical pitch of one tooltip row. */
const TOOLTIP_ROW_HEIGHT = 15

/** Truncate a long model id so one hover row cannot blow up the card. */
function shortLabel(label: string): string {
  return label.length > 26 ? `${label.slice(0, 25)}…` : label
}

/**
 * Render the per-model daily token trend.
 *
 * @param props - the day points in plot order, the ranked model series
 * (aligned with those points), and the locale seat.
 * @returns the legend plus the SVG chart.
 */
export function MultiModelTrendChart({ points, series, t }: {
  points: readonly ModelChartPoint[]
  series: readonly ModelDaySeries[]
  t: TranslateNS<'token-usage'>
}): ReactNode {
  const [active, setActive] = useState<number | null>(null)

  const equidistant = { mode: 'equidistant' as const, points: [...points] }
  const innerHeight = CHART_HEIGHT - CHART_TOP - CHART_BOTTOM - CHART_X_LABELS
  const maxValue = Math.max(1, ...series.flatMap(item => item.values))
  const { top, ticks } = tickValues(maxValue)
  const { xs, innerWidth } = scaleSeries(equidistant, CHART_LEFT, CHART_WIDTH - CHART_RIGHT)
  const y = (tokens: number): number => CHART_TOP + innerHeight - (tokens / top) * innerHeight
  const yZero = y(0)
  const paths = series.map(item => smoothSeriesPath({
    xs,
    ys: item.values.map(value => y(value)),
    yZero,
    hold: 'zero',
  }))

  const handleMouseMove = (event: MouseEvent<SVGSVGElement>): void => {
    if (points.length <= 1) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const svgX = ((event.clientX - rect.left) / rect.width) * CHART_WIDTH
    let closest = 0
    let minDiff = Math.abs(xs[0]! - svgX)
    for (let index = 1; index < xs.length; index += 1) {
      const diff = Math.abs(xs[index]! - svgX)
      if (diff < minDiff) {
        minDiff = diff
        closest = index
      }
    }
    setActive(closest)
  }

  /** Invisible column around one point, spanning to its neighbours' midpoints. */
  const hitExtent = (index: number): { start: number; width: number } => {
    if (points.length === 1) return { start: CHART_LEFT, width: innerWidth }
    const center = xs[index]!
    const before = index === 0 ? undefined : xs[index - 1]!
    const after = index === points.length - 1 ? undefined : xs[index + 1]!
    const toPrev = before === undefined ? innerWidth : (center - before) / 2
    const toNext = after === undefined ? innerWidth : (after - center) / 2
    const half = Math.max(Math.min(toPrev, toNext), HIT_TARGET_FLOOR)
    return { start: center - half, width: half * 2 }
  }

  const activePoint = active === null ? null : points[active] ?? null
  const activeRows = active === null
    ? []
    : series
        .map(item => ({ key: item.key, label: item.label, color: item.color, value: item.values[active] ?? 0 }))
        .filter(row => row.value > 0)
        .sort((left, right) => right.value - left.value)
  const tipTitle = activePoint === null
    ? ''
    : t('chart.pointLabel', { day: activePoint.full, tokens: formatTokens(activePoint.tokens) })
  const tipWidth = Math.min(
    CHART_WIDTH - CHART_LEFT - CHART_RIGHT,
    Math.max(
      tipTitle.length,
      ...activeRows.map(row => shortLabel(row.label).length + formatTokens(row.value).length + 4),
      12,
    ) * TOOLTIP_CHAR_WIDTH + 30,
  )
  const tipHeight = 22 + activeRows.length * TOOLTIP_ROW_HEIGHT + 8
  const tipLeft = activePoint === null
    ? CHART_LEFT
    : Math.min(Math.max(xs[active!]! - tipWidth / 2, CHART_LEFT), CHART_WIDTH - CHART_RIGHT - tipWidth)
  const tipTop = CHART_TOP + 4

  return (
    <div className={styles.multiWrap}>
      <div className={styles.legend} role="list">
        {series.map(item => (
          <span key={item.key} className={styles.legendItem} role="listitem">
            <span className={styles.swatch} style={{ backgroundColor: item.color }} />
            <span className={styles.legendName} title={item.label}>{item.label}</span>
            <span className={styles.legendValue}>{formatTokens(item.total)}</span>
          </span>
        ))}
      </div>
      <svg
        role="img"
        aria-label={t('chart.ariaModels')}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className={styles.chart}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setActive(null)}
      >
        {ticks.map(tick => (
          <g key={tick}>
            <line x1={CHART_LEFT} y1={y(tick)} x2={CHART_WIDTH - CHART_RIGHT} y2={y(tick)} className={styles.grid} />
            <text x={CHART_LEFT - 6} y={y(tick) + 3} textAnchor="end" className={styles.tick}>
              {formatTokens(tick)}
            </text>
          </g>
        ))}
        <line x1={CHART_LEFT} y1={y(0)} x2={CHART_WIDTH - CHART_RIGHT} y2={y(0)} className={styles.axis} />
        {series.map((item, index) => (
          <path
            key={item.key}
            d={paths[index]!}
            className={styles.modelLine}
            style={{ stroke: item.color }}
          />
        ))}
        {active !== null ? (
          <g pointerEvents="none">
            <line
              x1={xs[active]!}
              y1={CHART_TOP}
              x2={xs[active]!}
              y2={yZero}
              className={styles.guide}
            />
            {series.map(item => (
              <circle
                key={item.key}
                cx={xs[active]!}
                cy={y(item.values[active] ?? 0)}
                r={3.5}
                className={styles.modelDot}
                style={{ fill: item.color }}
              />
            ))}
          </g>
        ) : null}
        {points.map((point, index) => {
          const hit = hitExtent(index)
          return (
            <rect
              key={point.key}
              x={hit.start}
              y={CHART_TOP}
              width={hit.width}
              height={innerHeight}
              fill="transparent"
              aria-label={t('chart.pointLabel', { day: point.full, tokens: formatTokens(point.tokens) })}
              role="button"
              tabIndex={0}
              className={styles.hit}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(current => (current === index ? null : current))}
            />
          )
        })}
        {activePoint !== null ? (
          <g className={styles.pointLabel} pointerEvents="none">
            <rect x={tipLeft} y={tipTop} width={tipWidth} height={tipHeight} rx={6} />
            <text x={tipLeft + 12} y={tipTop + 15} className={styles.tooltipTitle}>{tipTitle}</text>
            {activeRows.map((row, index) => {
              const rowY = tipTop + 30 + index * TOOLTIP_ROW_HEIGHT
              return (
                <g key={row.key}>
                  <rect x={tipLeft + 12} y={rowY - 6} width={8} height={8} rx={2} style={{ fill: row.color }} />
                  <text x={tipLeft + 26} y={rowY + 1} className={styles.tooltipText}>{shortLabel(row.label)}</text>
                  <text x={tipLeft + tipWidth - 10} y={rowY + 1} textAnchor="end" className={styles.tooltipValue}>
                    {formatTokens(row.value)}
                  </text>
                </g>
              )
            })}
          </g>
        ) : null}
        {labelIndices(points.length).map(index => (
          <text
            key={index}
            x={xs[index]}
            y={CHART_HEIGHT - 6}
            textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
            className={styles.tick}
          >
            {points[index]!.label}
          </text>
        ))}
      </svg>
    </div>
  )
}
