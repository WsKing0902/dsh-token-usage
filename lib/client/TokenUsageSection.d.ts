/**
 * Token-usage settings page (browser half): fetches the stats summary from
 * the host route and renders the filter bar (inclusive day range, model
 * select, 1d/7d/30d quick ranges where 1d spans today 00:00–23:59), the
 * total-usage strip, the daily-token trend chart, and the per-model detail
 * table with the hit rate last — all following the active filters. A
 * priced model name is the row's price affordance (one click opens
 * PricingDialog.tsx); unpriced rows keep the in-cell tag. The filter
 * row's tail link opens the filter-free pricing-overview dialog
 * (PricingOverviewDialog.tsx). There is no refresh
 * button: entering the page or changing a filter refetches (the route
 * answers no-store); only the error state keeps a retry.
 *
 * @module token-usage/client/TokenUsageSection
 */
import type { ReactNode } from 'react';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { SettingsSectionOwnerProps } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { AuxSummary, CostState } from '../wire.ts';
import type { CurrencyView } from './format.ts';
/** Re-export so existing section tests and consumers keep importing
 * `StatCard` from this module (the file moved to `./StatCard.tsx`). */
export { StatCard } from './StatCard.tsx';
export { totalTokens } from './day.ts';
export { formatTokens, formatHitRate } from './format.ts';
/**
 * The runtime-overhead tab content: the auxiliary (bypass) model requests —
 * Auto review, session-title generation, translation, and the defensive
 * "other" bucket — split by kind. Those calls are provider-billed requests of
 * a concrete model, so their usage is already folded into the totals above
 * and into the by-model table; this content is a read-only breakdown of that
 * share, never an additional total. Each kind row is a collapsed-by-default
 * disclosure: its per-model detail lines appear only while the kind's toggle
 * is activated. A summary without auxiliary requests
 * renders its empty hint inside the tab, so the dimension switch keeps a
 * stable set of tabs. The aux layer is read defensively: a host that predates
 * the field sends no `aux` at all, and that shape renders the same empty hint.
 * @param props - the aux layer of the summary (possibly absent on an older
 * host payload), the cost state, the display currency view, and the locale
 * translator.
 * @returns the tab content: an empty hint, or the per-kind table (kinds
 * collapsed, expanding to their per-model lines) with its total row.
 */
export declare function AuxOverheadSection({ aux, costState, view, t }: {
    aux: AuxSummary | undefined;
    costState: CostState;
    view: CurrencyView;
    t: TranslateNS<'token-usage'>;
}): ReactNode;
/**
 * Render the Token Usage section content column. The `t` seat arrives from
 * the registration's `locale:` declaration and follows the active locale.
 * The session jump seats (`sessionListed` / `openSession`) come from the
 * registration's `inject:` — the session table's Ctrl+click affordance
 * reads the controller's list and opens the target session.
 * @param props - the settings shell's owner share (close rides along to the
 * session jump: the jump closes the panel) plus the injected jump seats and
 * the framework-injected translate seat.
 * @returns the section, one of loading / error / ready.
 */
export declare function TokenUsageSection({ t, close, sessionListed, openSession }: SettingsSectionOwnerProps & {
    t: TranslateNS<'token-usage'>;
    sessionListed?: (id: string) => boolean;
    openSession?: (id: string) => boolean | {
        ok: boolean;
        reason?: string;
    };
}): ReactNode;
//# sourceMappingURL=TokenUsageSection.d.ts.map