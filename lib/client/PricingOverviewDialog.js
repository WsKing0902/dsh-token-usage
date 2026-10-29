import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { PRICING_PATH } from "../wire.js";
import { useAsyncResource } from "./async-resource.js";
import { usePricingAssociationRefresh } from "./pricing-associations.js";
import { PricingAssociationDialog, PricingAssociationManagerButton } from "./PricingAssociations.js";
import { PricingStatus, costsAvailable } from "./PricingStatus.js";
import { formatCost, formatRate, formatTokens } from "./format.js";
import { billedRates, PricingDialog, windowText } from "./PricingDialog.js";
import shared from './PricingDialog.module.css';
import styles from './PricingOverviewDialog.module.css';
import { matchesPricingSearch, sortPricingModels } from "./pricing-search.js";
export { matchesPricingSearch, sortPricingModels } from "./pricing-search.js";
/** The preset cases the buttons fill the inputs with (maintainer-curated
 * classic workloads). The first prefills the inputs on open. */
const SIM_SCENARIOS = [
    // 「输入 100M（缓存 98%）输出 457K」: an input side of 100M tokens, 98%
    // of it served from cache, 457K generated.
    { inputTokens: 2_000_000, cacheReadTokens: 98_000_000, outputTokens: 457_000, cacheWriteTokens: 0 },
    // 「输入 100M（缓存 95%）输出 600K」: the same 100M input side at a 95%
    // cache hit, 600K generated.
    { inputTokens: 5_000_000, cacheReadTokens: 95_000_000, outputTokens: 600_000, cacheWriteTokens: 0 },
    // 「输入 100M（缓存 0%）输出 100M」: translation at corpus scale — fresh
    // text both ways, no cache in play, the output roughly as long as the
    // input.
    { inputTokens: 100_000_000, cacheReadTokens: 0, outputTokens: 100_000_000, cacheWriteTokens: 0 },
];
/** The units a bucket's amount can carry. */
const BUCKET_UNITS = ['K', 'M', 'B'];
const UNIT_MULT = { K: 1e3, M: 1e6, B: 1e9 };
/** The whole-token count a bucket stands for: amount × unit, float fuzz
 * rounded off; empty, negative, or non-numeric amounts read as zero. */
function tokensOf(bucket) {
    const parsed = Number(bucket.amount);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return 0;
    return Math.round(parsed * UNIT_MULT[bucket.unit]);
}
/** The amount string for the same tokens under a new unit — converting so
 * the token count stands still (98M reads 98000K). Trims float fuzz to
 * six decimals so 0.457M ↔ 457K round-trips cleanly. */
function convertBucketAmount(bucket, unit) {
    const parsed = Number(bucket.amount);
    if (!Number.isFinite(parsed))
        return '';
    const converted = parsed * UNIT_MULT[bucket.unit] / UNIT_MULT[unit];
    return String(Math.round(converted * 1e6) / 1e6);
}
/** The compact refill shape of one token count: a short amount under the
 * fitting unit (98M, 457K), K as the floor for the sub-1K tail. */
function compactBucket(tokens) {
    if (tokens >= UNIT_MULT.B)
        return { amount: String(tokens / UNIT_MULT.B), unit: 'B' };
    if (tokens >= UNIT_MULT.M)
        return { amount: String(tokens / UNIT_MULT.M), unit: 'M' };
    return { amount: String(tokens / UNIT_MULT.K), unit: 'K' };
}
/** The refill shape of a whole case: every bucket compact. */
function bucketsOfCase(scenario) {
    return {
        inputTokens: compactBucket(scenario.inputTokens),
        cacheReadTokens: compactBucket(scenario.cacheReadTokens),
        outputTokens: compactBucket(scenario.outputTokens),
        cacheWriteTokens: compactBucket(scenario.cacheWriteTokens),
    };
}
/**
 * The simulated cost (¥) of one scenario under a model's base rates —
 * the same arithmetic as the host half's `costOf` (a missing cache rate
 * bills at the input rate), re-implemented here because pricing.ts lives
 * on the node side of the bundle boundary.
 */
function simCostOf(scenario, rates) {
    const M = 1_000_000;
    const cacheRead = rates.cacheReadPerMillion ?? rates.inputPerMillion;
    const cacheWrite = rates.cacheWritePerMillion ?? rates.inputPerMillion;
    return (scenario.inputTokens * rates.inputPerMillion
        + scenario.outputTokens * rates.outputPerMillion
        + scenario.cacheReadTokens * cacheRead
        + scenario.cacheWriteTokens * cacheWrite) / M;
}
/** The largest tier whose threshold the context clears. */
function hitTier(tiers, ctxTokens) {
    let hit;
    for (const tier of tiers) {
        if (ctxTokens >= tier.threshold && (hit === undefined || tier.threshold > hit.threshold))
            hit = tier;
    }
    return hit;
}
export function hitNodeOf(rules, ctxTokens, nowMs) {
    const nowSec = Math.floor(nowMs / 1000);
    const rule = rules.timeRules.find(candidate => candidate.startTime <= nowSec && nowSec <= candidate.endTime);
    if (rule !== undefined) {
        return { baseRates: rule.rates, slots: rule.dailySlots ?? [], tier: hitTier(rule.contextTiers ?? [], ctxTokens) };
    }
    return { baseRates: rules.base, slots: rules.dailySlots, tier: hitTier(rules.contextTiers, ctxTokens) };
}
/** The workload picture of one case — the input line (input-side total
 * with its cache-hit share) and the output line — joined into the case
 * button's hover title. */
function scenarioLabel(scenario, t) {
    const total = scenario.inputTokens + scenario.cacheReadTokens;
    const pct = Math.round((scenario.cacheReadTokens / total) * 100);
    return {
        inputLine: `${t('pricing.simInput', { tokens: formatTokens(total) })}${t('pricing.simCache', { pct: String(pct) })}`,
        outputLine: t('pricing.simOutput', { tokens: formatTokens(scenario.outputTokens) }),
    };
}
/** One bucket's K/M/B unit segment. Switching converts the amount so the
 * token count stands still. */
function UnitPicker({ t, bucket, unit, onPick }) {
    return (_jsx("div", { className: styles['unitGroup'], children: BUCKET_UNITS.map(candidate => (_jsx("button", { type: "button", className: styles['unit'], "aria-pressed": candidate === unit, "aria-label": t('pricing.simUnitOf', { bucket, unit: candidate }), onClick: () => { if (candidate !== unit)
                onPick(candidate); }, children: candidate }, candidate))) }));
}
/**
 * Fetch the pricing overview from the local route — deliberately without
 * any query parameters: the overview is not a filtered view, so changing
 * the page's filters never changes what this dialog shows. An empty model
 * list (a first startup whose sync has not landed a mirror yet) reads as
 * the same failure the fetch error does: nothing to show, retry offered.
 */
function fetchPricingOverview(signal) {
    return fetch(PRICING_PATH, { signal })
        .then(response => {
        if (!response.ok)
            throw new Error(`HTTP ${String(response.status)}`);
        return response.json();
    })
        .then(value => {
        if (typeof value !== 'object' || value === null || !Array.isArray(value.models)) {
            throw new Error('unexpected pricing response');
        }
        if (value.costState === 'pricing-unavailable')
            return value;
        if (value.models.length === 0)
            throw new Error('pricing mirror is empty');
        return value;
    });
}
/**
 * The pricing-overview dialog. `usedModels` is the open-time snapshot of
 * the page's filtered model selection (the modal's backdrop covers the
 * filter row, so it cannot change while the dialog is open); `view` is the
 * page's display currency. Mounts only while open; every close path
 * funnels through the dialog's `close` event, which unmounts it.
 */
export function PricingOverviewDialog({ usedModels, view, onClose, t }) {
    const dialogRef = useRef(null);
    // Whether the press that precedes a dialog-targeting click started on
    // the backdrop itself. A text-selection drag that starts inside the
    // content and releases outside lands its click on the dialog element
    // (the click fires on the press/release targets' common ancestor, and
    // outside a top-layer dialog every point resolves to the dialog) — the
    // same target a real backdrop click produces. Only a press that began
    // on the backdrop may close.
    const backdropPress = useRef(false);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog !== null && !dialog.open)
            dialog.showModal();
    }, []);
    // One fetch per dialog session: no filter deps, and the hook's own
    // retry() is the failure state's retry button (a fresh local fetch).
    const [state, retry] = useAsyncResource(fetchPricingOverview, [], { retryToken: 0 });
    usePricingAssociationRefresh(retry);
    const [search, setSearch] = useState('');
    // The token buckets driving the simulated-cost column, as typed: an
    // amount under a picked K/M/B unit each. The first preset case prefills
    // them on open; case buttons refill them compact, any edit just retypes.
    const [buckets, setBuckets] = useState(() => bucketsOfCase(SIM_SCENARIOS[0]));
    // The simulated-cost column's sort: default family order, then a
    // three-state cycle (desc → asc → back to family) on header clicks.
    const [sortMode, setSortMode] = useState('family');
    // The drilled-in model whose full price table is open above the overview.
    const [detail, setDetail] = useState(null);
    const [associationsOpen, setAssociationsOpen] = useState(false);
    // The wall clock the effective-world hits are judged at: taken once on
    // mount so a dialog left open never reshuffles itself at a rule boundary.
    const [nowMs] = useState(() => Date.now());
    // The one model whose special-rate rows are expanded under its main row.
    const [expandedId, setExpandedId] = useState(null);
    const sorted = useMemo(() => sortPricingModels(state.status === 'ready' ? state.value.models : []), [state]);
    // The whole-token counts the buckets stand for — what the cost column
    // bills and the case match compares.
    const scenario = useMemo(() => ({
        inputTokens: tokensOf(buckets.inputTokens),
        cacheReadTokens: tokensOf(buckets.cacheReadTokens),
        outputTokens: tokensOf(buckets.outputTokens),
        cacheWriteTokens: tokensOf(buckets.cacheWriteTokens),
    }), [buckets]);
    // The context a tier is hit against: the whole input side (fresh + cache
    // reads) reads as the request's context length.
    const ctxTokens = scenario.inputTokens + scenario.cacheReadTokens;
    // A case button reads pressed while the inputs exactly match it — the
    // highlight follows the data, not the last click.
    const pressedCase = SIM_SCENARIOS.find(candidate => candidate.inputTokens === scenario.inputTokens
        && candidate.cacheReadTokens === scenario.cacheReadTokens
        && candidate.outputTokens === scenario.outputTokens
        && candidate.cacheWriteTokens === scenario.cacheWriteTokens);
    // Search filters rows and keeps the family sort order; the cost sort
    // (a stable sort) reorders afterwards, so equal-cost rows keep the
    // family order and the search never fights the sort. Cost = the main
    // row's (the effective world's default rates).
    const query = search.trim();
    const rows = useMemo(() => {
        const withCost = sorted.map(model => {
            const node = hitNodeOf(model.rules, ctxTokens, nowMs);
            return {
                model,
                node,
                cost: simCostOf(scenario, node.baseRates),
                specials: [
                    ...(node.tier !== undefined
                        ? [{ kind: 'tier', tier: node.tier, slot: undefined, cost: simCostOf(scenario, node.tier.rates) }]
                        : []),
                    ...node.slots.map(slot => ({ kind: 'slot', tier: undefined, slot, cost: simCostOf(scenario, slot.rates) })),
                ],
            };
        })
            .filter(({ model }) => query === '' || matchesPricingSearch(model, query));
        if (sortMode === 'family')
            return withCost;
        return [...withCost].sort((a, b) => (sortMode === 'cost-desc' ? b.cost - a.cost : a.cost - b.cost));
    }, [sorted, scenario, query, sortMode, ctxTokens, nowMs]);
    return (_jsxs("dialog", { ref: dialogRef, className: `${shared['dialog']} ${styles['overview']}`, "aria-label": t('pricing.table'), 
        // The stacked detail dialog is a DOM child of this one, and React
        // simulates the close event's propagation up the tree — so a close
        // that targeted the detail reaches this handler too. Only a close of
        // this dialog itself ends the overview.
        onClose: event => { if (event.target === dialogRef.current)
            onClose(); }, 
        // A click that landed on the dialog element itself hit the backdrop
        // (the content sits in child elements), which closes like Esc does —
        // but only when the press started there too (see backdropPress): a
        // selection drag released outside produces the same click target.
        // With the detail dialog stacked above, its own backdrop click
        // never reaches this handler.
        onMouseDown: event => { backdropPress.current = event.target === dialogRef.current; }, onClick: event => {
            if (event.target === dialogRef.current && backdropPress.current)
                dialogRef.current?.close();
        }, children: [_jsxs("div", { className: shared['dialogHead'], children: [_jsxs("div", { className: styles.titleActions, children: [_jsx("span", { className: shared['dialogTitle'], children: t('pricing.table') }), _jsx(PricingAssociationManagerButton, { t: t, onOpen: () => setAssociationsOpen(true) })] }), _jsx("button", { type: "button", className: shared['dialogClose'], "aria-label": t('pricing.close'), onClick: () => dialogRef.current?.close(), children: "\u2715" })] }), associationsOpen && _jsx(PricingAssociationDialog, { initialSource: null, view: view, t: t, onClose: () => setAssociationsOpen(false) }), state.status === 'loading'
                ? _jsx("p", { className: styles['note'], children: t('loading') })
                : null, state.status === 'error'
                ? (_jsxs("div", { className: styles['failRow'], children: [_jsx("p", { className: styles['note'], children: t('pricing.overviewFailed') }), _jsx("button", { type: "button", className: styles['retryButton'], onClick: retry, children: t('retry') })] }))
                : null, state.status === 'ready' && !costsAvailable(state.value.costState)
                ? _jsxs("div", { className: styles['failRow'], children: [_jsx(PricingStatus, { costState: state.value.costState, ...state.value.pricingUnavailableReason !== undefined ? { pricingUnavailableReason: state.value.pricingUnavailableReason } : {}, t: t }), _jsx("button", { type: "button", className: styles['retryButton'], onClick: retry, children: t('retry') })] }) : null, state.status === 'ready' && costsAvailable(state.value.costState)
                ? (_jsxs(_Fragment, { children: [_jsx("input", { type: "search", className: styles['search'], placeholder: t('pricing.search'), "aria-label": t('pricing.search'), value: search, onChange: event => setSearch(event.target.value) }), _jsxs("div", { className: styles['buckets'], children: [_jsxs("div", { className: styles['bucket'], children: [_jsx("span", { className: styles['bucketLabel'], children: t('pricing.simBucketInput') }), _jsx("input", { type: "number", min: 0, step: "any", className: styles['bucketInput'], "aria-label": t('pricing.simBucketInput'), value: buckets.inputTokens.amount, onChange: event => setBuckets(previous => ({
                                                ...previous,
                                                inputTokens: { ...previous.inputTokens, amount: event.target.value },
                                            })) }), _jsx(UnitPicker, { t: t, bucket: t('pricing.simBucketInput'), unit: buckets.inputTokens.unit, onPick: unit => setBuckets(previous => ({
                                                ...previous,
                                                inputTokens: { amount: convertBucketAmount(previous.inputTokens, unit), unit },
                                            })) })] }), _jsxs("div", { className: styles['bucket'], children: [_jsx("span", { className: styles['bucketLabel'], children: t('pricing.simBucketCacheRead') }), _jsx("input", { type: "number", min: 0, step: "any", className: styles['bucketInput'], "aria-label": t('pricing.simBucketCacheRead'), value: buckets.cacheReadTokens.amount, onChange: event => setBuckets(previous => ({
                                                ...previous,
                                                cacheReadTokens: { ...previous.cacheReadTokens, amount: event.target.value },
                                            })) }), _jsx(UnitPicker, { t: t, bucket: t('pricing.simBucketCacheRead'), unit: buckets.cacheReadTokens.unit, onPick: unit => setBuckets(previous => ({
                                                ...previous,
                                                cacheReadTokens: { amount: convertBucketAmount(previous.cacheReadTokens, unit), unit },
                                            })) })] }), _jsxs("div", { className: styles['bucket'], children: [_jsx("span", { className: styles['bucketLabel'], children: t('pricing.simBucketOutput') }), _jsx("input", { type: "number", min: 0, step: "any", className: styles['bucketInput'], "aria-label": t('pricing.simBucketOutput'), value: buckets.outputTokens.amount, onChange: event => setBuckets(previous => ({
                                                ...previous,
                                                outputTokens: { ...previous.outputTokens, amount: event.target.value },
                                            })) }), _jsx(UnitPicker, { t: t, bucket: t('pricing.simBucketOutput'), unit: buckets.outputTokens.unit, onPick: unit => setBuckets(previous => ({
                                                ...previous,
                                                outputTokens: { amount: convertBucketAmount(previous.outputTokens, unit), unit },
                                            })) })] }), _jsxs("div", { className: styles['bucket'], children: [_jsx("span", { className: styles['bucketLabel'], children: t('pricing.simBucketCacheWrite') }), _jsx("input", { type: "number", min: 0, step: "any", className: styles['bucketInput'], "aria-label": t('pricing.simBucketCacheWrite'), value: buckets.cacheWriteTokens.amount, onChange: event => setBuckets(previous => ({
                                                ...previous,
                                                cacheWriteTokens: { ...previous.cacheWriteTokens, amount: event.target.value },
                                            })) }), _jsx(UnitPicker, { t: t, bucket: t('pricing.simBucketCacheWrite'), unit: buckets.cacheWriteTokens.unit, onPick: unit => setBuckets(previous => ({
                                                ...previous,
                                                cacheWriteTokens: { amount: convertBucketAmount(previous.cacheWriteTokens, unit), unit },
                                            })) })] })] }), _jsx("div", { className: styles['scenarios'], children: SIM_SCENARIOS.map((candidate, index) => {
                                const label = scenarioLabel(candidate, t);
                                return (_jsx("button", { type: "button", className: styles['scenario'], "aria-pressed": pressedCase === candidate, title: `${label.inputLine} ${label.outputLine}`, onClick: () => { setBuckets(bucketsOfCase(candidate)); }, children: t('pricing.simCase', { index: String(index + 1) }) }, index));
                            }) }), _jsxs("div", { className: styles['tableWrap'], children: [_jsxs("table", { className: styles['table'], "aria-label": t('pricing.table'), children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: styles['modelHead'], children: t('filter.model') }), _jsxs("th", { children: [t('pricing.input'), t('pricing.perMillion')] }), _jsxs("th", { children: [t('pricing.output'), t('pricing.perMillion')] }), _jsxs("th", { children: [t('pricing.cacheRead'), t('pricing.perMillion')] }), _jsxs("th", { children: [t('pricing.cacheWrite'), t('pricing.perMillion')] }), _jsx("th", { children: _jsxs("button", { type: "button", className: styles['sortHead'], onClick: () => {
                                                                setSortMode(previous => previous === 'family' ? 'cost-desc' : previous === 'cost-desc' ? 'cost-asc' : 'family');
                                                            }, children: [t('pricing.simCost'), _jsx("span", { className: sortMode === 'family' ? `${styles['sortArrow']} ${styles['sortArrowIdle']}` : styles['sortArrow'], "aria-hidden": true, children: sortMode === 'family' ? ' ⇅' : sortMode === 'cost-desc' ? ' ▾' : ' ▴' })] }) })] }) }), _jsx("tbody", { children: rows.map(({ model, node, cost, specials }) => {
                                                const billed = billedRates(node.baseRates, view);
                                                const expanded = expandedId === model.modelId;
                                                return (_jsxs(Fragment, { children: [_jsxs("tr", { className: styles['modelRow'], role: "button", tabIndex: 0, "aria-label": t('pricing.view', { model: model.modelId }), onClick: () => setDetail(model), onKeyDown: event => {
                                                                if (event.key === 'Enter' || event.key === ' ') {
                                                                    event.preventDefault();
                                                                    setDetail(model);
                                                                }
                                                            }, children: [_jsx("td", { className: styles['modelCell'], children: _jsxs("span", { className: styles['cellInner'], children: [specials.length > 0
                                                                                ? (_jsx("button", { type: "button", className: styles['expandArrow'], "aria-expanded": expanded, "aria-label": t('pricing.expand'), onClick: event => {
                                                                                        event.stopPropagation();
                                                                                        setExpandedId(previous => (previous === model.modelId ? null : model.modelId));
                                                                                    }, children: expanded ? '▾' : '▸' }))
                                                                                : _jsx("span", { className: styles['arrowGap'], "aria-hidden": true }), _jsx("span", { className: styles['modelName'], children: model.modelId }), usedModels.has(model.modelId)
                                                                                ? _jsx("span", { className: styles['usedTag'], children: t('pricing.used') })
                                                                                : null] }) }), _jsx("td", { children: billed.input }), _jsx("td", { children: billed.output }), _jsx("td", { children: billed.cacheRead }), _jsx("td", { children: billed.cacheWrite }), _jsx("td", { children: formatCost(cost, view) })] }), expanded
                                                            ? (_jsx("tr", { className: styles['expansionRow'], children: _jsx("td", { colSpan: 6, children: _jsx("div", { className: styles['specialRows'], children: specials.map((special, index) => {
                                                                            const specialBilled = billedRates(special.tier?.rates ?? special.slot.rates, view);
                                                                            const label = special.kind === 'tier'
                                                                                ? t('pricing.tier', { threshold: formatTokens(special.tier.threshold) })
                                                                                : `${special.slot.label ?? t('pricing.peak')} ${special.slot.windows.map(windowText).join(t('pricing.windowSep'))}`;
                                                                            return (_jsxs("div", { className: styles['specialRow'], children: [_jsx("span", { className: styles['specialLabel'], children: label }), _jsx("span", { className: styles['specialRate'], children: specialBilled.input }), _jsx("span", { className: styles['specialRate'], children: specialBilled.output }), _jsx("span", { className: styles['specialRate'], children: specialBilled.cacheRead }), _jsx("span", { className: styles['specialRate'], children: specialBilled.cacheWrite }), _jsx("span", { className: styles['specialRate'], children: formatCost(special.cost, view) })] }, index));
                                                                        }) }) }) }))
                                                            : null] }, model.modelId));
                                            }) })] }), view.symbol === '$'
                                    ? _jsx("p", { className: shared['rateNote'], children: t('pricing.exchangeRateNote', { rate: formatRate(view.rate) }) })
                                    : null] })] }))
                : null, detail !== null
                ? (_jsx(PricingDialog, { model: detail.modelId, rules: detail.rules, view: view, onClose: () => setDetail(null), t: t }))
                : null] }));
}
//# sourceMappingURL=PricingOverviewDialog.js.map