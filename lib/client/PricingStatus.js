import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
export function costsAvailable(state) {
    return state === undefined || state === 'ready';
}
/** Shared failure reasons; matching and prices remain entirely on the host. */
export function PricingStatus({ costState, pricingUnavailableReason, associationStorageError, t }) {
    const storageWarning = associationStorageError !== undefined
        ? _jsx("p", { role: "status", children: t('pricing.associationStorageUnavailable') }) : null;
    const costWarning = !costsAvailable(costState)
        ? _jsxs("p", { role: "status", children: [t(costState === 'history-incomplete' ? 'pricing.historyIncomplete' : 'pricing.unavailable'), costState === 'pricing-unavailable' && pricingUnavailableReason !== undefined ? ` ${t(`pricing.reason.${pricingUnavailableReason}`)}` : ''] }) : null;
    return _jsxs(_Fragment, { children: [storageWarning, costWarning] });
}
//# sourceMappingURL=PricingStatus.js.map