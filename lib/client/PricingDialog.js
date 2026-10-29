import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { useEffect, useRef } from 'react';
import { dayKeyOf } from "./day.js";
import { formatRate, formatRateWithSymbol, formatTokens } from "./format.js";
import styles from './PricingDialog.module.css';
/** The four base rates of one model as display text (symbol included,
 * converted for a USD view); a missing cache rate bills at the input rate. */
export function billedRates(rates, view) {
    return {
        input: formatRateWithSymbol(rates.inputPerMillion, view),
        output: formatRateWithSymbol(rates.outputPerMillion, view),
        cacheRead: formatRateWithSymbol(rates.cacheReadPerMillion ?? rates.inputPerMillion, view),
        cacheWrite: formatRateWithSymbol(rates.cacheWritePerMillion ?? rates.inputPerMillion, view),
    };
}
/** `HH:MM-HH:MM` of one peak window (half-open, local minutes). */
export function windowText(window) {
    const clock = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    return `${clock(window.startMinute)}-${clock(window.endMinute)}`;
}
/** The when-it-applies text of one peak slot: its label plus its windows. */
function slotCondition(slot, t) {
    return `${slot.label ?? t('pricing.peak')} ${slot.windows.map(windowText).join(t('pricing.windowSep'))}`;
}
/**
 * The price rows of one rate node (a time rule's or the model root's): the
 * node's own base rates, then its peak slots, then its context tiers
 * (ascending), each tier followed by the peak slots hanging on that tier —
 * mirroring {@link resolveRate}'s node chain, where a matching tier's slots
 * replace the node's and peak rates replace the node's rates wholesale.
 */
function nodePriceRows(node, t) {
    const rows = [{ condition: t('pricing.default'), rates: node.rates }];
    const tiers = [...node.tiers ?? []].sort((a, b) => a.threshold - b.threshold);
    for (const tier of tiers) {
        const tierCondition = t('pricing.tier', { threshold: formatTokens(tier.threshold) });
        rows.push({ condition: tierCondition, rates: tier.rates });
        for (const slot of tier.dailySlots ?? []) {
            rows.push({ condition: `${tierCondition} · ${slotCondition(slot, t)}`, rates: slot.rates });
        }
    }
    for (const slot of node.slots ?? []) {
        rows.push({ condition: slotCondition(slot, t), rates: slot.rates });
    }
    return rows;
}
/**
 * One model's price table: rows are billing conditions — grouped into the
 * model root (“常规”, omitted when it is the only group) and one group per
 * time rule with its date window — so tier, peak, and time-rule pricing
 * each show when they apply and what they bill. The structure mirrors
 * {@link resolveRate}'s node chain.
 */
export function ModelPriceTable({ rules, view, t }) {
    // Groups follow resolveRate's chain: the model root (the current era)
    // first, then each time rule as an isolated price world, newest era
    // first (descending rule end), regardless of the feed's listing order.
    const groups = [
        {
            title: rules.timeRules.length > 0 ? t('pricing.regular') : null,
            rows: nodePriceRows({ rates: rules.base, tiers: rules.contextTiers, slots: rules.dailySlots }, t),
        },
        ...[...rules.timeRules]
            .sort((a, b) => b.endTime - a.endTime)
            .map(rule => ({
            // A zero start (the “since forever” rules some feeds carry) drops
            // the bogus 1970 date and reads as “through <end>”.
            title: `${rule.label !== undefined ? `${rule.label} ` : ''}${rule.startTime > 0 ? `${dayKeyOf(new Date(rule.startTime * 1000))} ~ ` : '~ '}${dayKeyOf(new Date(rule.endTime * 1000))}`,
            rows: nodePriceRows({ rates: rule.rates, tiers: rule.contextTiers, slots: rule.dailySlots }, t),
        })),
    ];
    return (_jsxs("div", { className: styles['tableWrap'], children: [_jsxs("table", { className: styles['table'], "aria-label": t('pricing.title'), children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: styles['conditionHead'], children: t('pricing.condition') }), _jsxs("th", { children: [t('pricing.input'), t('pricing.perMillion')] }), _jsxs("th", { children: [t('pricing.output'), t('pricing.perMillion')] }), _jsxs("th", { children: [t('pricing.cacheRead'), t('pricing.perMillion')] }), _jsxs("th", { children: [t('pricing.cacheWrite'), t('pricing.perMillion')] })] }) }), _jsx("tbody", { children: groups.flatMap(group => [
                            ...(group.title !== null
                                ? [
                                    _jsx("tr", { className: styles['groupRow'], children: _jsx("td", { colSpan: 5, children: group.title }) }, group.title),
                                ]
                                : []),
                            ...group.rows.map((row, index) => {
                                const billed = billedRates(row.rates, view);
                                return (_jsxs("tr", { children: [_jsx("td", { className: styles['conditionCell'], children: row.condition }), _jsx("td", { children: billed.input }), _jsx("td", { children: billed.output }), _jsx("td", { children: billed.cacheRead }), _jsx("td", { children: billed.cacheWrite })] }, `${group.title ?? ''}-${index}-${row.condition}`));
                            }),
                        ]) })] }), view.symbol === '$'
                ? _jsx("p", { className: styles['rateNote'], children: t('pricing.exchangeRateNote', { rate: formatRate(view.rate) }) })
                : null] }));
}
/**
 * The pricing dialog of one model. Mounts only while a model is selected;
 * every close path funnels through the dialog's `close` event, which clears
 * the selection and unmounts it.
 */
export function PricingDialog({ model, rules, view, onClose, t }) {
    const dialogRef = useRef(null);
    // The backdrop-close press guard: a text-selection drag released outside
    // the dialog lands its click on the dialog element (the click fires on
    // the press/release targets' common ancestor, and outside a top-layer
    // dialog every point resolves to the dialog) — the same target a real
    // backdrop click produces. Only a press that began on the backdrop may
    // close; see the overview dialog's backdropPress for the full story.
    const backdropPress = useRef(false);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog !== null && !dialog.open)
            dialog.showModal();
    }, []);
    return (_jsxs("dialog", { ref: dialogRef, className: styles['dialog'], "aria-label": t('pricing.title'), onClose: onClose, 
        // A click that landed on the dialog element itself hit the backdrop
        // (the content sits in child elements), which closes like Esc does —
        // but only when the press started there too: a selection drag
        // released outside produces the same click target.
        onMouseDown: event => { backdropPress.current = event.target === dialogRef.current; }, onClick: event => {
            if (event.target === dialogRef.current && backdropPress.current)
                dialogRef.current?.close();
        }, children: [_jsxs("div", { className: styles['dialogHead'], children: [_jsx("span", { className: styles['dialogTitle'], children: model }), _jsx("button", { type: "button", className: styles['dialogClose'], "aria-label": t('pricing.close'), onClick: () => dialogRef.current?.close(), children: "\u2715" })] }), _jsx(ModelPriceTable, { rules: rules, view: view, t: t })] }));
}
//# sourceMappingURL=PricingDialog.js.map