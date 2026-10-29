/**
 * The pricing-overview dialog of the settings page: the full cloud-mirror
 * model list served by the filter-free `/token-usage/pricing` route — one
 * flat row per model, sorted by the feed's upstream `family` field (zero
 * client-side mapping) then by modelId, each row's four base rates in the
 * page's display currency. Families drive order and search only — there is
 * no grouping UI, every row is directly visible. Rows the page's filters
 * have used carry a “已用” tag; clicking a row opens that model's full
 * price table as a second native dialog stacked above.
 *
 * Above the table, four token-bucket inputs drive a simulated-cost column:
 * what the buckets would bill at each model's base rates. Each bucket is
 * an amount under a picked K/M/B unit — switching converts the amount, the
 * token count stands still. Preset case buttons (「案例1」, hover-titled
 * with the workload picture) refill the buckets compact in one click; the
 * first case is prefilled on open, and the pressed highlight tracks exact
 * token matches, so a manual edit un-presses. The column sorts by a
 * three-state header cycle (family order → cost desc → cost asc → family);
 * the header's glyph never disappears: a dim ⇅ in the default family
 * order, then ▾ desc and ▴ asc.
 *
 * Aliases never render — they stay a search dimension only (a hit on an
 * alias surfaces the model, whose id then reads as the result).
 *
 * @module token-usage/client/PricingOverviewDialog
 */
import type { ReactNode } from 'react';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { ContextTier, DailySlot, ModelPricing, ModelRates } from '../wire.ts';
import type { CurrencyView } from './format.ts';
export { matchesPricingSearch, sortPricingModels } from './pricing-search.ts';
/**
 * The effective world of one model at `nowMs`: the time rule whose date
 * window contains the current date (rules are mutually exclusive — at most
 * one matches; bounds are Unix seconds, `startTime` 0 reads as "since
 * forever"), else the model root. The world's default rates are the main
 * row (the root's prices are NOT shown while a rule owns the present);
 * its slots and tiers are the expandable special rows — never the root's.
 */
export interface EffectiveNode {
    /** The world's default rates: the main row's four prices and cost. */
    baseRates: ModelPricing;
    /** Slot rows of this world: shown whenever defined, regardless of the
     * current minute (peaks recur daily — hiding them at off-peak hours
     * would hide the information). */
    slots: DailySlot[];
    /** The one tier this world's input side clears (largest threshold at or
     * below the context), if any. */
    tier: ContextTier | undefined;
}
export declare function hitNodeOf(rules: ModelRates, ctxTokens: number, nowMs: number): EffectiveNode;
/**
 * The pricing-overview dialog. `usedModels` is the open-time snapshot of
 * the page's filtered model selection (the modal's backdrop covers the
 * filter row, so it cannot change while the dialog is open); `view` is the
 * page's display currency. Mounts only while open; every close path
 * funnels through the dialog's `close` event, which unmounts it.
 */
export declare function PricingOverviewDialog({ usedModels, view, onClose, t }: {
    usedModels: ReadonlySet<string>;
    view: CurrencyView;
    onClose: () => void;
    t: TranslateNS<'token-usage'>;
}): ReactNode;
//# sourceMappingURL=PricingOverviewDialog.d.ts.map