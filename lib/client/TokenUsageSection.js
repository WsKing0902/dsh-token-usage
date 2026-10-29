import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { IconWarningOutlineRegular, Toast } from '@deepseek-ai/dsh-client-ui-primitives';
import { STATS_PATH } from "../wire.js";
import { useAsyncResource } from "./async-resource.js";
import { DateRangePicker } from "./DateRangePicker.js";
import { shiftedDayKey, totalTokens } from "./day.js";
import { currencyViewOf, formatCost, formatTokens } from "./format.js";
import { HitRateText } from "./HitRateText.js";
import { MenuSelect } from "./MenuSelect.js";
import { PricingDialog } from "./PricingDialog.js";
import { PricingOverviewDialog } from "./PricingOverviewDialog.js";
import { RequestsCell, RequestsSplitHead, RequestsStatCard, StatCard } from "./StatCard.js";
import { SessionTable } from "./SessionTable.js";
import { PricingStatus, costsAvailable } from "./PricingStatus.js";
import { ModelAssociationBadge, PricingAssociationProvider, UnpricedModelTag } from "./PricingAssociations.js";
import { usePricingAssociationRefresh } from "./pricing-associations.js";
import { TrendChart } from "./TrendChart.js";
import { useColorSchemeMirror } from "./use-color-scheme.js";
import styles from './TokenUsageSection.module.css';
/** Re-export so existing section tests and consumers keep importing
 * `StatCard` from this module (the file moved to `./StatCard.tsx`). */
export { StatCard } from "./StatCard.js";
// Re-exported for tests and sibling consumers; the implementations live in
// the leaf modules (day / format) so the chart can share them without a cycle.
export { totalTokens } from "./day.js";
export { formatTokens, formatHitRate } from "./format.js";
/** Fetch the summary for one query string; the caller owns the failure
 * presentation. The AbortSignal wires into the request so a filter change
 * cancels the in-flight fetch instead of letting its response overwrite
 * the next filter's data. */
function fetchSummary(query, signal) {
    return fetch(STATS_PATH + query, { signal })
        .then(response => {
        if (!response.ok)
            throw new Error(`HTTP ${String(response.status)}`);
        return response.json();
    })
        .then(value => {
        if (typeof value !== 'object' || value === null || typeof value.total !== 'object') {
            throw new Error('unexpected stats response');
        }
        return value;
    });
}
/**
 * The query string of one filter selection ('' when unconstrained), or null
 * while the range is mid-edit (`from > to`): editing the two date inputs
 * one at a time passes through inverted ranges, and fetching those would
 * only flash an HTTP 400 — the request waits until the range settles.
 */
function filterQuery(filters) {
    if (filters.from !== '' && filters.to !== '' && filters.from > filters.to)
        return null;
    const params = new URLSearchParams();
    if (filters.from !== '')
        params.set('from', filters.from);
    if (filters.to !== '')
        params.set('to', filters.to);
    if (filters.model !== '')
        params.set('model', filters.model);
    return Array.from(params).length > 0 ? `?${params.toString()}` : '';
}
/** The day keys of one quick range: today minus (days - 1) through today. */
function quickRange(days) {
    return { from: shiftedDayKey(-(days - 1)), to: shiftedDayKey(0) };
}
/** Whether the filters exactly hold one quick range. */
function isQuickActive(days, filters) {
    const range = quickRange(days);
    return filters.from === range.from && filters.to === range.to;
}
/** Quick-range menu entries (labels are locale-free day counts). */
const QUICK_OPTIONS = [
    { value: '1', label: '1d' },
    { value: '7', label: '7d' },
    { value: '30', label: '30d' },
];
/** The filter bar: quick range menu, day-range picker popover, model
 * menu — one row, one popover language. The row's tail link is an action,
 * not a selector: it opens the filter-free pricing overview. */
function FilterBar({ filters, models, onChange, onPricingTable, t }) {
    // 'all' when the range is unconstrained, 'custom' when it no longer
    // holds one of the quick ranges.
    const quickValue = QUICK_OPTIONS.find(option => isQuickActive(Number(option.value), filters))?.value
        ?? (filters.from === '' && filters.to === '' ? 'all' : 'custom');
    return (_jsxs("div", { className: styles['filters'], children: [_jsx(MenuSelect, { ariaLabel: t('filter.quickRange'), value: quickValue, options: [
                    ...QUICK_OPTIONS,
                    { value: 'all', label: t('filter.allDates') },
                    { value: 'custom', label: t('filter.custom') },
                ], onChange: value => {
                    // 'all' releases the range back to unconstrained; the 'custom'
                    // entry is informational: it mirrors the day range and never
                    // rewrites it.
                    if (value === 'all')
                        onChange({ ...filters, from: '', to: '' });
                    const days = Number(value);
                    if (days > 0)
                        onChange({ ...filters, ...quickRange(days) });
                } }), _jsx(DateRangePicker, { from: filters.from, to: filters.to, onChange: next => onChange({ ...filters, ...next }), t: t }), _jsx(MenuSelect, { ariaLabel: t('filter.model'), grow: true, value: filters.model, options: [{ value: '', label: t('filter.allModels') }, ...models.map(model => ({ value: model, label: model }))], onChange: model => onChange({ ...filters, model }) }), _jsx("button", { type: "button", "data-pricing-overview-trigger": true, className: styles['pricingLink'], onClick: onPricingTable, children: t('pricing.table') })] }));
}
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
export function AuxOverheadSection({ aux, costState, view, t }) {
    // Which kinds are expanded. Collapsed by default — the kind row itself
    // carries the aggregate; the per-model lines are the drill-in. Each kind
    // toggles independently; switching tabs unmounts the section, which is
    // the natural reset.
    const [expandedKinds, setExpandedKinds] = useState(() => new Set());
    const toggleKind = useCallback((auxKind) => {
        setExpandedKinds(previous => {
            const next = new Set(previous);
            if (next.has(auxKind))
                next.delete(auxKind);
            else
                next.add(auxKind);
            return next;
        });
    }, []);
    if (aux === undefined || aux.total.requests === 0) {
        return _jsx("p", { className: styles['muted'], children: t('aux.empty') });
    }
    // The numeric cells are shared by the per-kind rows and the total row so
    // both keep the same column set; zero buckets dim exactly like the
    // per-model table's cells.
    const numericCells = (totals, cost) => (_jsxs(_Fragment, { children: [_jsx("td", { children: totals.requests.toLocaleString() }), _jsx("td", { className: styles['costCol'], children: costsAvailable(costState) ? formatCost(cost, view) : '—' }), _jsx("td", { children: formatTokens(totalTokens(totals)) }), _jsx("td", { className: totals.inputTokens === 0 ? styles['zeroDim'] : undefined, children: formatTokens(totals.inputTokens) }), _jsx("td", { className: totals.outputTokens === 0 ? styles['zeroDim'] : undefined, children: formatTokens(totals.outputTokens) }), _jsx("td", { className: totals.cacheReadTokens === 0 ? styles['zeroDim'] : undefined, children: formatTokens(totals.cacheReadTokens) }), _jsx("td", { className: totals.cacheWriteTokens === 0 ? styles['zeroDim'] : undefined, children: formatTokens(totals.cacheWriteTokens) })] }));
    return (_jsx(_Fragment, { children: _jsx("div", { className: styles['tableWrap'], children: _jsxs("table", { className: styles['table'], "aria-label": t('aux.tab'), children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: styles['modelHead'], children: t('aux.kind') }), _jsx("th", { children: t('aux.requests') }), _jsx("th", { children: t('stat.cost') }), _jsx("th", { children: t('stat.totalTokens') }), _jsx("th", { children: t('stat.input') }), _jsx("th", { children: t('stat.output') }), _jsx("th", { children: t('stat.cacheRead') }), _jsx("th", { children: t('stat.cacheWrite') })] }) }), _jsxs("tbody", { children: [(aux.byKind ?? []).map(kindRow => {
                                const expanded = expandedKinds.has(kindRow.auxKind);
                                return (_jsxs(Fragment, { children: [_jsxs("tr", { children: [_jsx("td", { className: styles['modelCol'], children: _jsxs("button", { type: "button", className: styles['auxKindToggle'], "aria-expanded": expanded, onClick: () => toggleKind(kindRow.auxKind), children: [_jsx("span", { className: styles['auxChevron'], "aria-hidden": "true", children: "\u25B8" }), t(`aux.kind.${kindRow.auxKind}`)] }) }), numericCells(kindRow.totals, kindRow.cost)] }), expanded && (kindRow.byModel ?? []).map(modelRow => (_jsxs("tr", { children: [_jsx("td", { className: `${styles['modelCol']} ${styles['auxModelCell']}`, children: _jsx("span", { className: styles['modelCell'], children: _jsx("span", { className: styles['modelName'], children: modelRow.model }) }) }), numericCells(modelRow.totals, modelRow.cost)] }, `${kindRow.auxKind}:${modelRow.model}`)))] }, kindRow.auxKind));
                            }), _jsxs("tr", { children: [_jsx("td", { className: styles['modelCol'], children: t('aux.total') }), numericCells(aux.total, aux.cost)] })] })] }) }) }));
}
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
export function TokenUsageSection({ t, close, sessionListed, openSession }) {
    const rootRef = useRef(null);
    useColorSchemeMirror(rootRef);
    const [toastText, setToastText] = useState(null);
    const [toastSeq, setToastSeq] = useState(0);
    const showToast = useCallback((text) => {
        setToastSeq(previous => previous + 1);
        setToastText(text);
    }, []);
    const dismissToast = useCallback(() => {
        setToastText(null);
    }, []);
    const handleOpenSession = useCallback((id) => {
        if (!openSession)
            return;
        const result = openSession(id);
        if (result && typeof result === 'object' && 'ok' in result) {
            if (result.ok) {
                close();
            }
            else if (result.reason === 'workspaceDeleted') {
                showToast(t('session.workspaceDeleted'));
            }
            return;
        }
        if (result === true) {
            close();
        }
    }, [openSession, close, showToast, t]);
    // Entering the page starts on today's window (the 1d quick range).
    const [filters, setFilters] = useState(() => ({ model: '', ...quickRange(1) }));
    // The detail-table block's mode: by model (default, the historical table,
    // byte-identical behavior), by session, or the runtime-overhead breakdown of
    // the auxiliary (bypass) model requests. Pure presentation state — every row
    // set arrives on the SAME summary response, so switching never refetches
    // (session-local, not persisted, the usage tab's scope-switch tradeoff).
    const [detailMode, setDetailMode] = useState('model');
    const [models, setModels] = useState([]);
    // The model whose pricing dialog is open (null = none). Refetched
    // summaries keep the dialog's rules in sync with the latest pricing.
    const [detailModel, setDetailModel] = useState(null);
    // The pricing-overview dialog (opened by the filter row's tail link).
    // `usedSnapshot` is taken at open time: the modal's backdrop covers the
    // filter row, so the filters cannot change while it is open and the
    // snapshot stays stable for the whole dialog session. The link renders
    // only in the ready branch, so the summary is always at hand here.
    const [pricingTableOpen, setPricingTableOpen] = useState(false);
    const [usedSnapshot, setUsedSnapshot] = useState(() => new Set());
    const [retryToken, setRetryToken] = useState(0);
    const lastSummary = useRef(null);
    const retry = useCallback(() => { setRetryToken(previous => previous + 1); }, []);
    usePricingAssociationRefresh(retry);
    const query = filterQuery(filters);
    // A mid-edit inverted range (`query === null`) is fed to the hook as the
    // last valid query — the ref remembers the most recent non-null string
    // and stays stable while the user types a bad range, so the hook does
    // neither fire a fetch nor flash its loading state. The test pins this
    // contract: bad ranges must not produce a network round-trip.
    const lastValidQueryRef = useRef(query ?? '');
    if (query !== null)
        lastValidQueryRef.current = query;
    const fetchQuery = query ?? lastValidQueryRef.current;
    const [state] = useAsyncResource(signal => fetchSummary(fetchQuery, signal), [fetchQuery, retryToken], { silentAfterFirst: false, retryToken });
    // While every model is shown, keep the option list from collapsing to
    // the filtered selection. The side effect runs when the ready-state
    // summary lands, not on every render.
    useEffect(() => {
        if (state.status !== 'ready')
            return;
        if (filters.model !== '')
            return;
        const next = state.value.byModel.map(row => row.model);
        if (next.length === models.length && next.every((m, i) => m === models[i]))
            return;
        setModels(next);
    }, [state, filters.model, models]);
    if (state.status === 'ready')
        lastSummary.current = state.value;
    const retainedView = lastSummary.current !== null ? currencyViewOf(lastSummary.current) : { symbol: '￥', rate: 1 };
    const pricingOverview = pricingTableOpen ? _jsx(PricingOverviewDialog, { usedModels: usedSnapshot, view: retainedView, onClose: () => setPricingTableOpen(false), t: t }) : null;
    if (state.status === 'loading') {
        return (_jsx("div", { ref: rootRef, className: styles['section'], children: _jsxs(PricingAssociationProvider, { resolutions: lastSummary.current?.modelResolutions, feedVersion: lastSummary.current?.feedVersion, view: retainedView, t: t, children: [pricingOverview, _jsx("h2", { className: styles['title'], children: t('nav.label') }), _jsx("p", { className: styles['muted'], children: t('loading') })] }) }));
    }
    if (state.status === 'error') {
        return (_jsx("div", { ref: rootRef, className: styles['section'], children: _jsxs(PricingAssociationProvider, { resolutions: lastSummary.current?.modelResolutions, feedVersion: lastSummary.current?.feedVersion, view: retainedView, t: t, children: [pricingOverview, _jsxs("div", { className: styles['head'], children: [_jsx("h2", { className: styles['title'], children: t('nav.label') }), _jsx("button", { type: "button", className: styles['button'], onClick: retry, children: t('retry') })] }), _jsx("p", { className: styles['error'], children: t('loadFailed', { message: state.message }) })] }) }));
    }
    const { total } = state.value;
    const view = currencyViewOf(state.value);
    // The auxiliary (bypass) request count: the runtime-overhead tab is part of
    // the detail switch whenever any dimension has rows, and the tab content
    // renders its own empty hint when this stays 0 (or an older host payload
    // carries no auxiliary layer at all).
    const auxRequests = state.value.aux?.total.requests ?? 0;
    return (_jsx("div", { ref: rootRef, className: styles['section'], children: _jsxs(PricingAssociationProvider, { resolutions: state.value.modelResolutions, feedVersion: state.value.feedVersion, view: view, t: t, children: [pricingOverview, _jsx("h2", { className: styles['title'], children: t('nav.label') }), _jsx("p", { className: styles['muted'], children: t('dataDir', { path: state.value.dataDir }) }), _jsx(FilterBar, { filters: filters, models: models, onChange: setFilters, onPricingTable: () => {
                        setUsedSnapshot(new Set(state.value.byModel.map(row => row.model)));
                        setPricingTableOpen(true);
                    }, t: t }), total.requests === 0 && (total.failures ?? 0) === 0
                    ? (
                    // One hint covers both an empty log and an empty filtered window:
                    // the page opens on today (1d), so the two are indistinguishable
                    // from the filtered response alone. The pricing block follows the
                    // filter selection, so an empty selection renders none of it.
                    _jsx("p", { className: styles['empty'], children: t('empty') }))
                    : (_jsxs(_Fragment, { children: [_jsxs("div", { className: styles['cards'], children: [_jsx(RequestsStatCard, { requests: total.requests, failures: total.failures ?? 0, failuresByCode: total.failuresByCode, t: t }), _jsx(StatCard, { label: t('stat.cost'), value: costsAvailable(state.value.costState) ? formatCost(state.value.totalCost, view) : '—' }), _jsx(StatCard, { label: t('stat.totalTokens'), value: formatTokens(totalTokens(total)) }), _jsx(StatCard, { label: t('stat.hitRate'), value: _jsx(HitRateText, { totals: total }) })] }), _jsxs("div", { className: styles['cards'], children: [_jsx(StatCard, { label: t('stat.input'), value: formatTokens(total.inputTokens) }), _jsx(StatCard, { label: t('stat.output'), value: formatTokens(total.outputTokens) }), _jsx(StatCard, { label: t('stat.cacheRead'), value: formatTokens(total.cacheReadTokens) }), _jsx(StatCard, { label: t('stat.cacheWrite'), value: formatTokens(total.cacheWriteTokens) })] }), _jsx(PricingStatus, { costState: state.value.costState, pricingUnavailableReason: state.value.pricingUnavailableReason, associationStorageError: state.value.associationStorageError, t: t }), _jsx(TrendChart, { rows: state.value.byDay, rateRows: state.value.rateRows, t: t, ...filters.from !== '' ? { from: filters.from } : {}, ...filters.to !== '' ? { to: filters.to } : {}, ...filters.from !== '' && filters.from === filters.to ? { hours: state.value.byHour } : {} }), state.value.byModel.length > 0 || (state.value.sessionRows?.length ?? 0) > 0 || auxRequests > 0
                                ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: styles['segmented'], role: "group", "aria-label": t('detail.switch.label'), children: [_jsx("button", { type: "button", className: detailMode === 'model' ? `${styles['segBtn']} ${styles['segActive']}` : styles['segBtn'], "aria-pressed": detailMode === 'model', onClick: () => setDetailMode('model'), children: t('byModel.title') }), _jsx("button", { type: "button", className: detailMode === 'session' ? `${styles['segBtn']} ${styles['segActive']}` : styles['segBtn'], "aria-pressed": detailMode === 'session', onClick: () => setDetailMode('session'), children: t('bySession.title') }), _jsx("button", { type: "button", className: detailMode === 'aux' ? `${styles['segBtn']} ${styles['segActive']}` : styles['segBtn'], "aria-pressed": detailMode === 'aux', onClick: () => setDetailMode('aux'), children: t('aux.tab') })] }), detailMode === 'model'
                                            ? (_jsx("div", { className: styles['tableWrap'], children: _jsxs("table", { className: styles['table'], "aria-label": t('byModel.title'), children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: styles['modelHead'], children: t('filter.model') }), _jsx("th", { "aria-label": t('stat.successFail'), children: _jsx(RequestsSplitHead, { t: t }) }), _jsx("th", { children: t('stat.cost') }), _jsx("th", { children: t('stat.totalTokens') }), _jsx("th", { children: t('stat.input') }), _jsx("th", { children: t('stat.output') }), _jsx("th", { children: t('stat.cacheRead') }), _jsx("th", { children: t('stat.cacheWrite') }), _jsx("th", { children: t('stat.hitRate') })] }) }), _jsx("tbody", { children: state.value.byModel.map(row => {
                                                                const rules = state.value.pricing[row.model];
                                                                return (_jsxs("tr", { children: [_jsx("td", { className: styles['modelCol'], children: _jsxs("span", { className: styles['modelCell'], children: [rules !== undefined
                                                                                        ? (
                                                                                        // The model name is the price
                                                                                        // affordance: one click opens the
                                                                                        // detail-price dialog. No extra
                                                                                        // chip — the column is 150px and
                                                                                        // a trailing badge would truncate
                                                                                        // the id and refuse to line up.
                                                                                        _jsx("button", { type: "button", className: styles['modelName'], "aria-label": t('pricing.view', { model: row.model }), onClick: () => setDetailModel(row.model), children: row.model }))
                                                                                        : (_jsxs(_Fragment, { children: [_jsx("span", { className: styles['modelName'], children: row.model }), _jsx(UnpricedModelTag, { model: row.model, t: t })] })), _jsx(ModelAssociationBadge, { model: row.model, t: t })] }) }), _jsx("td", { children: _jsx(RequestsCell, { requests: row.totals.requests, failures: row.totals.failures ?? 0, failuresByCode: row.totals.failuresByCode, t: t }) }), _jsx("td", { className: styles['costCol'], children: costsAvailable(state.value.costState) && rules !== undefined ? formatCost(row.cost, view) : '—' }), _jsx("td", { children: formatTokens(totalTokens(row.totals)) }), _jsx("td", { className: row.totals.inputTokens === 0 ? styles['zeroDim'] : undefined, children: formatTokens(row.totals.inputTokens) }), _jsx("td", { className: row.totals.outputTokens === 0 ? styles['zeroDim'] : undefined, children: formatTokens(row.totals.outputTokens) }), _jsx("td", { className: row.totals.cacheReadTokens === 0 ? styles['zeroDim'] : undefined, children: formatTokens(row.totals.cacheReadTokens) }), _jsx("td", { className: row.totals.cacheWriteTokens === 0 ? styles['zeroDim'] : undefined, children: formatTokens(row.totals.cacheWriteTokens) }), _jsx("td", { children: _jsx(HitRateText, { totals: row.totals }) })] }, row.model));
                                                            }) })] }) }))
                                            : detailMode === 'session'
                                                ? ((state.value.sessionRows?.length ?? 0) > 0
                                                    ? (_jsx(SessionTable, { rows: state.value.sessionRows ?? [], costState: state.value.costState, view: view, t: t, ...sessionListed !== undefined && openSession !== undefined
                                                            ? { sessionListed, openSession: handleOpenSession }
                                                            : {} }))
                                                    : _jsx("p", { className: styles['muted'], children: t('chart.empty') }))
                                                : _jsx(AuxOverheadSection, { aux: state.value.aux, costState: state.value.costState, view: view, t: t })] }))
                                : null, detailModel !== null && state.value.pricing[detailModel] !== undefined
                                ? (_jsx(PricingDialog, { model: detailModel, rules: state.value.pricing[detailModel], view: view, onClose: () => setDetailModel(null), t: t }))
                                : null] })), toastText !== null && (_jsx(Toast, { text: toastText, icon: _jsx(IconWarningOutlineRegular, {}), onDone: dismissToast }, toastSeq))] }) }));
}
//# sourceMappingURL=TokenUsageSection.js.map