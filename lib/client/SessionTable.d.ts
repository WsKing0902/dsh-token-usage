/**
 * The settings page's per-session detail table (browser half): the "by
 * session" mode of the detail-table block. Rows arrive FINAL from the host
 * route — folded over subagent subtrees (a subagent's only visibility here
 * is the row's child-count badge; the conversation view's subagent table
 * owns the per-child drill-down), cost-sorted, top-N truncated, with the
 * metadata index's titles and directories attached — so this component only
 * re-organizes presentation: the optional directory grouping (default on,
 * session-local, no request; grouped rows indent under their directory
 * head) and the identity fallback for titleless sessions (short id + time
 * span; the plugin never fabricates a title). Rows carry no click behavior,
 * matching the per-model table.
 *
 * @module token-usage/client/SessionTable
 */
import type { ReactNode } from 'react';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { CostState, SessionUsageRow } from '../wire.ts';
import type { CurrencyView } from './format.ts';
/**
 * Render the session table: the grouping switch above the table, optional
 * directory groups (rows indent under their group head), one row per
 * served session. The token / cost / last-active headers sort the rows
 * client-side within the served set (groups keep their directory order;
 * rows reorder inside each group). Holding Ctrl over a session title draws
 * a dashed underline and a click jumps to that session (the parent closes
 * the settings panel; the conversation view lands on the session's last
 * used tab) — rows the session controller does not list never invite it.
 * @param props - the served rows, the currency view, the session jump
 * seats (absent on tests / hosts without the controller), locale.
 */
export declare function SessionTable({ rows, view, t, sessionListed, openSession, costState }: {
    costState?: CostState;
    rows: readonly SessionUsageRow[];
    view: CurrencyView;
    t: TranslateNS<'token-usage'>;
    sessionListed?: (id: string) => boolean;
    openSession?: (id: string) => void;
}): ReactNode;
//# sourceMappingURL=SessionTable.d.ts.map