import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The conversation view tab "Usage" (browser half): one entry of the
 * `conversation.view` slot ring (beside Chat / Trajectory), rendering the
 * per-session token & cost dashboard for the ACTIVE conversation. The tab
 * shows the focused session's totals (successful requests with a failure
 * pill, 4 token buckets, cost, hit rate, TTFT average, decode throughput) with a
 * scope switch between the session alone and its whole subagent subtree, a
 * per-hour trend chart and the per-model table from the host stats route
 * (`sessionId`-scoped), and a subagent table below — each row drill-in
 * switches the focus to that child.
 *
 * Data sources: token/cost figures come from the host route (the pricing
 * rule chain's authority); TTFT and throughput come from the framework's
 * retained `sessionStats` projection values (`useProjection` for the current
 * session, `byId[].projectionValues` for every other session), which cover
 * the whole log including history written before this plugin was installed.
 * A footnote states the two scopes so the difference is not a surprise.
 *
 * The root declares `data-conversation-composer-overlay` — the same host
 * opt-in Trajectory uses. ConversationRoot hides the chat-column width
 * handles when that attribute is present, and the view owns its own
 * scroller instead of sharing the transcript's constrained column.
 *
 * @module token-usage/client/UsageView
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { encodeStatsQuery, STATS_PATH } from "../wire.js";
import { useAsyncResource, useDebouncedValue } from "./async-resource.js";
import { totalTokens } from "./day.js";
import { currencyViewOf, formatCost, formatSpeed, formatTokens, formatTtft } from "./format.js";
import { PricingStatus, costsAvailable } from "./PricingStatus.js";
import { ModelAssociationBadge, PricingAssociationProvider, UnpricedModelTag } from "./PricingAssociations.js";
import { usePricingAssociationRefresh } from "./pricing-associations.js";
import { HitRateText } from "./HitRateText.js";
import { aggregateProjections, buildChildIndex, directSubagentIds, subagentParentOf, subtreeIds, buildStatsFreshnessKey } from "./session-stats.js";
import { RequestsCell, RequestsSplitHead, RequestsStatCard, StatCard } from "./StatCard.js";
import { TrendChart } from "./TrendChart.js";
import { useColorSchemeMirror } from "./use-color-scheme.js";
import styles from './UsageView.module.css';
/** Refresh debounce: bursts of session-mirror updates (one request's events)
 * collapse into a single fetch, so the dashboard refreshes at REQUEST
 * granularity instead of per event or per turn. */
const REFRESH_DEBOUNCE_MS = 250;
/** Host contract (ui-conversation ConversationRoot): views that own a
 * full-bleed scroller set this so the chat-column width handles hide and
 * the composer seat overlays instead of stealing clicks over the dashboard. */
const COMPOSER_OVERLAY = { 'data-conversation-composer-overlay': '' };
/** One fetch of the session-scoped summary from the host stats route,
 * including the direct-child breakdown for the subagent table. */
function fetchSessionSummary(sessionIds, childGroups, signal) {
    return fetch(STATS_PATH + encodeStatsQuery({ sessionIds, childGroups, fields: 'session' }), { signal })
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
 * Render the Usage view tab for the active conversation.
 * @param props - the framework session kit, the session mirror, and the
 * locale seat (from the registration's `locale:` declaration).
 * @returns the dashboard: header (title, scope switch, back), stat cards
 * and the 4-token strip, the chart/model columns, and the subagent table.
 */
export function UsageView({ useSessions, useProjection, sessionId, t }) {
    const rootRef = useRef(null);
    useColorSchemeMirror(rootRef);
    const [scope, setScope] = useState('session');
    // The trend chart's y-axis reading: per-interval totals or their running
    // cumulative sum. Session-local like the scope switch (no persistence).
    const [chartMode, setChartMode] = useState('interval');
    // The dashboard focus: the active conversation until a subagent row is
    // drilled into. Reset when the conversation itself changes — the pane
    // may reuse this instance across session switches.
    const [focusId, setFocusId] = useState(sessionId);
    useEffect(() => { setFocusId(sessionId); }, [sessionId]);
    const [retryToken, setRetryToken] = useState(0);
    const retry = () => { setRetryToken(token => token + 1); };
    usePricingAssociationRefresh(retry);
    const byId = useSessions(state => state.byId);
    // Build the child index once per mirror churn and share it across the
    // three tree helpers — directSubagentIds / subtreeIds / per-row nested
    // counts — so a heavy subagent subtree doesn't pay O(n) per call.
    const childIndex = useMemo(() => buildChildIndex(byId), [byId]);
    // The scoped session ids: the focus alone, or the focus plus its subtree.
    const scopeIds = useMemo(() => scope === 'tree' ? subtreeIds(byId, focusId, childIndex) : [focusId], [byId, scope, focusId, childIndex]);
    const children = useMemo(() => directSubagentIds(byId, focusId, childIndex), [byId, focusId, childIndex]);
    // Tree scope folds each direct child with its own descendants so the
    // subagent-table numbers add back up to the header total.
    const childGroups = useMemo(() => children.map(id => (scope === 'tree' ? subtreeIds(byId, id, childIndex) : [id])), [children, scope, byId, childIndex]);
    const backParent = subagentParentOf(byId, focusId);
    // Live sessionStats updates every request step; mirror updatedAt alone
    // does not — fold both into the debounce key (same cadence as TTFT).
    const liveStats = useProjection('sessionStats');
    const freshnessKey = buildStatsFreshnessKey([...new Set([...scopeIds, ...children])], { activeSessionId: sessionId, rows: byId, liveSessionStats: liveStats });
    const requestKey = `${scopeIds.join('\n')}\n\t${childGroups.map(group => group.join(',')).join(';')}\n\t${freshnessKey}`;
    const debouncedKey = useDebouncedValue(requestKey, REFRESH_DEBOUNCE_MS);
    const [summaryState] = useAsyncResource(signal => {
        const [idsPart, groupsPart] = debouncedKey.split('\n\t');
        const sessionIds = (idsPart ?? '').split('\n').filter(id => id !== '');
        const childGroups = (groupsPart ?? '').split(';').filter(group => group !== '').map(group => group.split(','));
        return fetchSessionSummary(sessionIds, childGroups, signal);
    }, [debouncedKey, retryToken], { silentAfterFirst: true, retryToken });
    const stats = useMemo(() => {
        const values = scopeIds.map((id) => {
            if (id === sessionId)
                return liveStats;
            return byId[id]?.projectionValues?.sessionStats;
        });
        return aggregateProjections(values);
    }, [scopeIds, sessionId, liveStats, byId]);
    const ttftText = stats !== undefined && stats.ttftSteps > 0
        ? formatTtft(stats.ttftMs / stats.ttftSteps)
        : '—';
    const speedText = stats !== undefined && stats.decodeMs > 0
        ? formatSpeed(stats.decodeTokens / (stats.decodeMs / 1_000))
        : '—';
    const header = (_jsx("header", { className: styles['head'], children: _jsx("div", { className: styles['headRight'], children: _jsxs("div", { className: styles['segmented'], role: "group", "aria-label": t('view.scope.label'), children: [_jsx("button", { type: "button", className: scope === 'session' ? `${styles['segBtn']} ${styles['segActive']}` : styles['segBtn'], "aria-pressed": scope === 'session', onClick: () => setScope('session'), children: t('view.scope.session') }), _jsx("button", { type: "button", className: scope === 'tree' ? `${styles['segBtn']} ${styles['segActive']}` : styles['segBtn'], "aria-pressed": scope === 'tree', onClick: () => setScope('tree'), children: t('view.scope.tree') })] }) }) }));
    if (summaryState.status === 'loading') {
        return (_jsx("div", { ref: rootRef, className: styles['root'], ...COMPOSER_OVERLAY, children: _jsxs(PricingAssociationProvider, { view: { symbol: '￥', rate: 1 }, t: t, children: [header, _jsx("p", { className: styles['muted'], children: t('loading') })] }) }));
    }
    if (summaryState.status === 'error') {
        return (_jsx("div", { ref: rootRef, className: styles['root'], ...COMPOSER_OVERLAY, children: _jsxs(PricingAssociationProvider, { view: { symbol: '￥', rate: 1 }, t: t, children: [header, _jsx("p", { className: styles['error'], children: t('loadFailed', { message: summaryState.message }) }), _jsx("button", { type: "button", className: styles['button'], onClick: retry, children: t('retry') })] }) }));
    }
    const summary = summaryState.value;
    const view = currencyViewOf(summary);
    const { total } = summary;
    return (_jsx("div", { ref: rootRef, className: styles['root'], ...COMPOSER_OVERLAY, children: _jsxs(PricingAssociationProvider, { resolutions: summary.modelResolutions, feedVersion: summary.feedVersion, view: view, t: t, children: [header, total.requests === 0 && (total.failures ?? 0) === 0
                    // The session has no recorded requests (successful or failed); the
                    // stat band is skipped but the subagent table below still renders
                    // (children may hold usage even when this session's scoped summary
                    // is empty).
                    ? _jsx("p", { className: styles['empty'], children: t('view.empty') })
                    : (_jsxs(_Fragment, { children: [_jsxs("div", { className: styles['cards'], children: [_jsx(RequestsStatCard, { requests: total.requests, failures: total.failures ?? 0, failuresByCode: total.failuresByCode, t: t }), _jsx(StatCard, { label: t('stat.cost'), value: costsAvailable(summary.costState) ? formatCost(summary.totalCost, view) : '—' }), _jsx(StatCard, { label: t('stat.totalTokens'), value: formatTokens(totalTokens(total)) }), _jsx(StatCard, { label: t('stat.hitRate'), value: _jsx(HitRateText, { totals: total }) }), _jsx(StatCard, { label: t('view.ttft'), value: ttftText }), _jsx(StatCard, { label: t('view.speed'), value: `${speedText} tok/s` })] }), _jsxs("div", { className: styles['tokenStrip'], children: [_jsxs("span", { children: [t('stat.input'), " ", _jsx("b", { children: formatTokens(total.inputTokens) })] }), _jsxs("span", { children: [t('stat.output'), " ", _jsx("b", { children: formatTokens(total.outputTokens) })] }), _jsxs("span", { children: [t('stat.cacheRead'), " ", _jsx("b", { children: formatTokens(total.cacheReadTokens) })] }), _jsxs("span", { children: [t('stat.cacheWrite'), " ", _jsx("b", { children: formatTokens(total.cacheWriteTokens) })] })] }), _jsx(PricingStatus, { costState: summary.costState, pricingUnavailableReason: summary.pricingUnavailableReason, associationStorageError: summary.associationStorageError, t: t }), costsAvailable(summary.costState) && summary.unpricedModels.length > 0
                                ? (_jsx("p", { className: styles['warning'], role: "status", children: t('unpriced.warning', {
                                        count: String(summary.unpricedModels.length),
                                        models: summary.unpricedModels.join(', '),
                                        zero: formatCost(0, view),
                                    }) }))
                                : null, _jsxs("div", { className: styles['mid'], children: [_jsxs("section", { className: styles['chartCol'], children: [_jsxs("div", { className: styles['chartHead'], children: [_jsx("h3", { className: styles['subtitle'], children: t('view.chart.title') }), _jsxs("div", { className: styles['segmented'], role: "group", "aria-label": t('chart.mode.label'), children: [_jsx("button", { type: "button", className: chartMode === 'interval' ? `${styles['segBtn']} ${styles['segActive']}` : styles['segBtn'], "aria-pressed": chartMode === 'interval', onClick: () => setChartMode('interval'), children: t('chart.mode.interval') }), _jsx("button", { type: "button", className: chartMode === 'cumulative' ? `${styles['segBtn']} ${styles['segActive']}` : styles['segBtn'], "aria-pressed": chartMode === 'cumulative', onClick: () => setChartMode('cumulative'), children: t('chart.mode.cumulative') })] })] }), _jsx(TrendChart, { rows: summary.byDay, mode: chartMode, t: t, ...summary.requestSeries !== undefined ? { requests: summary.requestSeries } : {}, ...summary.byDay.length === 1 ? { hours: summary.byHour } : {} })] }), _jsxs("section", { className: styles['modelCol'], children: [_jsx("h3", { className: styles['subtitle'], children: t('byModel.title') }), summary.byModel.length > 0
                                                ? (_jsx("div", { className: styles['tableWrap'], children: _jsxs("table", { className: styles['table'], "aria-label": t('byModel.title'), children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: styles['modelHead'], children: t('filter.model') }), _jsx("th", { "aria-label": t('stat.successFail'), children: _jsx(RequestsSplitHead, { t: t }) }), _jsx("th", { children: t('stat.input') }), _jsx("th", { children: t('stat.output') }), _jsx("th", { children: t('stat.cacheRead') }), _jsx("th", { children: t('stat.cacheWrite') }), _jsx("th", { children: t('stat.hitRate') }), _jsx("th", { children: t('stat.cost') })] }) }), _jsx("tbody", { children: summary.byModel.map(row => (_jsxs("tr", { children: [_jsx("td", { className: styles['modelCell'], children: _jsxs("span", { className: styles.modelIdentity, children: [_jsx("span", { className: styles.modelName, children: row.model }), summary.unpricedModels.includes(row.model) && _jsx(UnpricedModelTag, { model: row.model, t: t }), _jsx(ModelAssociationBadge, { model: row.model, t: t })] }) }), _jsx("td", { children: _jsx(RequestsCell, { requests: row.totals.requests, failures: row.totals.failures ?? 0, failuresByCode: row.totals.failuresByCode, t: t }) }), _jsx("td", { className: row.totals.inputTokens === 0 ? styles['zeroDim'] : undefined, children: formatTokens(row.totals.inputTokens) }), _jsx("td", { className: row.totals.outputTokens === 0 ? styles['zeroDim'] : undefined, children: formatTokens(row.totals.outputTokens) }), _jsx("td", { className: row.totals.cacheReadTokens === 0 ? styles['zeroDim'] : undefined, children: formatTokens(row.totals.cacheReadTokens) }), _jsx("td", { className: row.totals.cacheWriteTokens === 0 ? styles['zeroDim'] : undefined, children: formatTokens(row.totals.cacheWriteTokens) }), _jsx("td", { children: _jsx(HitRateText, { totals: row.totals }) }), _jsx("td", { className: styles['costCol'], children: costsAvailable(summary.costState) && !summary.unpricedModels.includes(row.model) ? formatCost(row.cost, view) : '—' })] }, row.model))) })] }) }))
                                                : _jsx("p", { className: styles['muted'], children: t('chart.empty') })] })] })] })), _jsxs("section", { className: styles['subagents'], children: [_jsxs("div", { className: styles['subagentsHead'], children: [_jsx("h3", { className: styles['subtitle'], children: t('view.subagents.title', { count: String(children.length) }) }), (() => {
                                    // The up-navigation control sits with the subagent section it
                                    // returns from: the drill-in entry point is the row below.
                                    if (backParent === undefined)
                                        return null;
                                    const parentSummary = byId[backParent];
                                    if (parentSummary === undefined)
                                        return null;
                                    const parentId = backParent;
                                    return (_jsx("button", { type: "button", className: styles['back'], onClick: () => setFocusId(parentId), children: t('view.back', { title: parentSummary.displayTitle ?? parentId }) }));
                                })()] }), children.length === 0
                            ? _jsx("p", { className: styles['muted'], children: t('view.subagents.none') })
                            : (_jsx("div", { className: styles['tableWrap'], children: _jsxs("table", { className: styles['table'], "aria-label": t('view.subagents.title', { count: String(children.length) }), children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: styles['modelHead'], children: t('view.subagents.titleCol') }), _jsx("th", { children: t('stat.requests') }), _jsx("th", { children: t('stat.totalTokens') }), _jsx("th", { children: t('stat.cost') }), _jsx("th", { children: t('stat.hitRate') }), _jsx("th", { children: t('view.ttft') }), _jsx("th", { children: t('view.speed') })] }) }), _jsx("tbody", { children: children.map(id => {
                                                const child = byId[id];
                                                const row = summary.children?.[id];
                                                const childStats = aggregateProjections([
                                                    byId[id]?.projectionValues?.sessionStats,
                                                ]);
                                                // A nested-subagent marker: the count of THIS child's own
                                                // direct subagents, so the table signals before the
                                                // drill-in that the row has a subtree of its own.
                                                const nestedCount = directSubagentIds(byId, id, childIndex).length;
                                                return (_jsxs("tr", { children: [_jsxs("td", { className: styles['modelCell'], children: [_jsx("button", { type: "button", className: styles['childLink'], onClick: () => setFocusId(id), children: child?.displayTitle ?? id }), nestedCount > 0
                                                                    ? (_jsxs("span", { className: styles['nestedBadge'], "aria-label": t('view.subagents.nested', { count: String(nestedCount) }), children: ["(", nestedCount, ")"] }))
                                                                    : null] }), _jsx("td", { children: row?.total.requests.toLocaleString() ?? '—' }), _jsx("td", { children: row !== undefined ? formatTokens(totalTokens(row.total)) : '—' }), _jsx("td", { className: styles['costCol'], children: row !== undefined && costsAvailable(summary.costState) && costsAvailable(row.costState) ? formatCost(row.totalCost, view) : '—' }), _jsx("td", { children: row !== undefined ? _jsx(HitRateText, { totals: row.total }) : '—' }), _jsx("td", { children: childStats !== undefined && childStats.ttftSteps > 0 ? formatTtft(childStats.ttftMs / childStats.ttftSteps) : '—' }), _jsx("td", { children: childStats !== undefined && childStats.decodeMs > 0 ? `${formatSpeed(childStats.decodeTokens / (childStats.decodeMs / 1_000))} tok/s` : '—' })] }, id));
                                            }) })] }) }))] }), (total.requests > 0 || (total.failures ?? 0) > 0) && _jsx("p", { className: styles['note'], children: t('view.note') })] }) }));
}
//# sourceMappingURL=UsageView.js.map