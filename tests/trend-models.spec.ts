import { describe, expect, it } from 'vitest'
import { buildModelDaySeries, MODEL_CHART_COLORS, OTHER_MODEL_COLOR, OTHER_MODEL_KEY } from '../src/client/trend-chart/models.ts'
import type { UsageRateRow } from '../src/wire.ts'

function row(day: string, model: string, tokens: number, rate = 'r1'): UsageRateRow {
  return {
    day,
    model,
    rate,
    totals: {
      inputTokens: tokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      requests: 1,
      failures: 0,
    },
  } as UsageRateRow
}

const days = ['2026-10-01', '2026-10-02']

describe('buildModelDaySeries', () => {
  it('ranks models by range total and aligns values with the day keys', () => {
    const series = buildModelDaySeries({
      rateRows: [
        row('2026-10-01', 'big', 100),
        row('2026-10-02', 'big', 50),
        row('2026-10-01', 'small', 10),
      ],
      dayKeys: days,
      otherLabel: 'other',
    })
    expect(series.map(item => item.key)).toEqual(['big', 'small'])
    expect(series[0]!.values).toEqual([100, 50])
    expect(series[1]!.values).toEqual([10, 0])
    expect(series[0]!.total).toBe(150)
    expect(series[0]!.color).toBe(MODEL_CHART_COLORS[0])
  })

  it('sums rows that share a day and model across rate identities', () => {
    const series = buildModelDaySeries({
      rateRows: [row('2026-10-01', 'm', 3, 'r1'), row('2026-10-01', 'm', 4, 'r2')],
      dayKeys: days,
      otherLabel: 'other',
    })
    expect(series).toHaveLength(1)
    expect(series[0]!.values).toEqual([7, 0])
  })

  it('folds the tail past the limit into one neutral "other" series', () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      row('2026-10-01', `model-${index}`, 100 - index))
    const series = buildModelDaySeries({ rateRows: rows, dayKeys: days, otherLabel: 'other' })
    expect(series).toHaveLength(7)
    const other = series.at(-1)!
    expect(other.key).toBe(OTHER_MODEL_KEY)
    expect(other.label).toBe('other')
    expect(other.color).toBe(OTHER_MODEL_COLOR)
    // model-6 (94) + model-7 (93)
    expect(other.values[0]).toBe(187)
    expect(other.total).toBe(187)
  })

  it('drops failure rows and zero-token cells', () => {
    const series = buildModelDaySeries({
      rateRows: [row('2026-10-01', '', 999), row('2026-10-01', 'empty', 0)],
      dayKeys: days,
      otherLabel: 'other',
    })
    expect(series).toEqual([])
  })
})
