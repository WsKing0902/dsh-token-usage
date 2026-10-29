import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import { failuresTooltip } from "./format.js";
import styles from './StatCard.module.css';
/**
 * Render one stat card. The value uses the standard label-primary color.
 * The label clamps to one line and ellipsizes if the column is squeezed.
 */
export function StatCard({ label, value }) {
    return (_jsxs("div", { className: styles['card'], children: [_jsx("span", { className: styles['cardLabel'], children: label }), _jsx("span", { className: styles['cardValue'], children: value })] }));
}
/**
 * Compact "失败 n" chip for the requests **card** only. Hovering or focusing
 * it lists `限流 ×count` per class. Zero failures render nothing. Per-model
 * tables do not use this — they print `A/B` via {@link RequestsCell}.
 */
export function FailurePill({ failures, failuresByCode, t, }) {
    if (failures === 0)
        return null;
    return (_jsx("span", { className: styles['pillWrap'], children: _jsx(Tooltip, { label: failuresTooltip(failuresByCode, t), side: "bottom", delayMs: 200, children: _jsx("span", { className: styles['pill'], tabIndex: 0, children: t('stat.failuresPill', { count: failures.toLocaleString() }) }) }) }));
}
/**
 * The requests tile both dashboards share: hero figure is the successful
 * count; a compact pill to its right carries the failure count.
 */
export function RequestsStatCard({ requests, failures, failuresByCode, t, }) {
    return (_jsx(StatCard, { label: t('stat.requests'), value: (_jsxs(_Fragment, { children: [_jsx("span", { className: styles['cardValueMain'], children: requests.toLocaleString() }), _jsx(FailurePill, { failures: failures, failuresByCode: failuresByCode, t: t })] })) }));
}
/** Column header for the per-model success/fail split: same 3-track
 * grid as {@link RequestsCell} so the slash sits on the column midline. */
export function RequestsSplitHead({ t }) {
    return (_jsxs("span", { className: styles['split'], children: [_jsx("span", { className: styles['splitOk'], children: t('stat.ok') }), _jsx("span", { className: styles['splitSep'], "aria-hidden": true, children: "/" }), _jsx("span", { className: styles['splitFailHead'], children: t('stat.fail') })] }));
}
/** One table cell: successful count, and when failures > 0 a slash on
 * the column midline plus the failure count in the error color.
 * Zero failures print only A (same left track, so the figure still
 * lines up with rows that have a B). Hovering B lists the per-code
 * breakdown. */
export function RequestsCell({ requests, failures, failuresByCode, t, }) {
    const ok = requests.toLocaleString();
    const okFigure = _jsx("span", { className: styles['splitOk'], children: ok });
    if (failures === 0) {
        return _jsx("span", { className: styles['split'], children: okFigure });
    }
    const fail = failures.toLocaleString();
    return (_jsxs("span", { className: styles['split'], children: [okFigure, _jsx("span", { className: styles['splitSep'], "aria-hidden": true, children: "/" }), _jsx("span", { className: styles['pillWrap'], children: _jsx(Tooltip, { label: failuresTooltip(failuresByCode, t), side: "bottom", delayMs: 200, children: _jsx("span", { className: styles['splitFail'], tabIndex: 0, "aria-label": t('stat.failuresPill', { count: fail }), children: fail }) }) })] }));
}
//# sourceMappingURL=StatCard.js.map