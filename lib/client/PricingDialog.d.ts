/**
 * The pricing dialog of one model: a native `<dialog>` (Esc closes, focus
 * is trapped, the backdrop dims, and the top layer renders it above the
 * table's scroll shell) holding that model's full price table — billing
 * conditions (default / context tiers / peak slots / time rules) × the four
 * per-million rates, converted for a USD view. Shared by the settings
 * page's per-model “定价” affordance and the pricing-overview dialog's
 * drill-in rows; a native showModal naturally stacks a second instance
 * above the overview.
 *
 * @module token-usage/client/PricingDialog
 */
import type { ReactNode } from 'react';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { ModelPricing, ModelRates, RateWindow } from '../wire.ts';
import type { CurrencyView } from './format.ts';
/** The four base rates of one model as display text (symbol included,
 * converted for a USD view); a missing cache rate bills at the input rate. */
export declare function billedRates(rates: ModelPricing, view: CurrencyView): {
    input: string;
    output: string;
    cacheRead: string;
    cacheWrite: string;
};
/** `HH:MM-HH:MM` of one peak window (half-open, local minutes). */
export declare function windowText(window: RateWindow): string;
/**
 * One model's price table: rows are billing conditions — grouped into the
 * model root (“常规”, omitted when it is the only group) and one group per
 * time rule with its date window — so tier, peak, and time-rule pricing
 * each show when they apply and what they bill. The structure mirrors
 * {@link resolveRate}'s node chain.
 */
export declare function ModelPriceTable({ rules, view, t }: {
    rules: ModelRates;
    view: CurrencyView;
    t: TranslateNS<'token-usage'>;
}): ReactNode;
/**
 * The pricing dialog of one model. Mounts only while a model is selected;
 * every close path funnels through the dialog's `close` event, which clears
 * the selection and unmounts it.
 */
export declare function PricingDialog({ model, rules, view, onClose, t }: {
    model: string;
    rules: ModelRates;
    view: CurrencyView;
    onClose: () => void;
    t: TranslateNS<'token-usage'>;
}): ReactNode;
//# sourceMappingURL=PricingDialog.d.ts.map