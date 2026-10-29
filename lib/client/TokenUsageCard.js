import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * The token-usage card on the Plugins configuration tab: a collapsible row
 * whose header names the plugin over a one-line description of what its
 * settings govern, disclosing the data-directory control and the mirror
 * region pick (`domestic` gitee / `overseas` github) when open. The card owns
 * everything inside it — chrome, controls, and copy — per the keyed-slot
 * contract; the tab only dispatches it under the `token-usage` namespace key.
 *
 * Renders nothing while the namespace is unavailable: a deployment that did
 * not compose the host half shows no trace of the card. A region change takes
 * effect live (the host re-syncs the pricing mirror); a directory change the
 * guard refuses while conversations run shows the wait-for-them notice on the
 * failure line, and one that lands migrates the data across under a live
 * progress bar that locks the controls until it settles.
 *
 * @module token-usage/client/TokenUsageCard
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconChevronDownOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives';
import { FULL_SYNC_PATH, PRICING_SYNC_PATH } from "../wire.js";
import { pricingTableChanged } from "./pricing-associations.js";
import css from './TokenUsageCard.module.css';
/**
 * Render the token-usage settings card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card, or nothing when the namespace is unavailable.
 */
export function TokenUsageCard(props) {
    const [open, setOpen] = useState(props.view === 'page');
    const [picking, setPicking] = useState(false);
    const { t } = props;
    const state = props.useTokenUsageCard(snapshot => snapshot);
    // Discard unstaged changes when navigating away from the page.
    const discardRef = useRef(props.discard);
    discardRef.current = props.discard;
    useEffect(() => () => { discardRef.current(); }, []);
    if (!state.available)
        return null;
    if (props.view === 'summary') {
        return _jsx("span", { className: css.description, children: t('card.description') });
    }
    const migrating = state.migration !== undefined;
    const lockInput = !state.writable || migrating;
    const lockActions = !state.dirty || state.saving || migrating;
    /**
     * Open the shell's native folder dialog and stage the chosen path — the
     * same picker the workspace flows use, driven through the injected
     * workspace service. A dismissal leaves the staged draft exactly as it
     * was; the text input stays the fallback either way.
     */
    const browse = async () => {
        if (picking || lockInput)
            return;
        setPicking(true);
        try {
            const picked = await props.pickDirectory();
            if (picked !== null && picked !== '')
                props.editField('path', picked);
        }
        catch (_pickFailure) {
            // Leave the draft untouched; typing the path remains available.
        }
        finally {
            setPicking(false);
        }
    };
    // Manual full-sync state, polled from the host route while a scan runs.
    // The default `idle` matches the host's default; a card opening with a
    // terminal `done` / `failed` keeps it on screen until the next click.
    const [fullSync, setFullSync] = useState({ status: 'idle' });
    const fullSyncRunning = fullSync.status === 'running';
    /**
     * Fetch the current full-sync status from the host. A transport failure
     * keeps the previous view (a transient miss never blanks the bar).
     */
    const fetchFullSync = useCallback(async () => {
        try {
            const response = await fetch(FULL_SYNC_PATH, { headers: { accept: 'application/json' } });
            if (!response.ok)
                return null;
            const body = (await response.json());
            // Trust nothing that does not match the typed shape — a host running an
            // older build may answer a different status set.
            if (body.status === 'idle')
                return { status: 'idle' };
            if (body.status === 'running' || body.status === 'done') {
                if (typeof body.processed === 'number' && typeof body.total === 'number'
                    && typeof body.added === 'number' && typeof body.skipped === 'number') {
                    return {
                        status: body.status,
                        processed: body.processed,
                        total: body.total,
                        added: body.added,
                        skipped: body.skipped,
                        removed: typeof body.removed === 'number' ? body.removed : 0,
                        failedSessions: typeof body.failedSessions === 'number' ? body.failedSessions : 0,
                    };
                }
                return null;
            }
            if (body.status === 'failed' && typeof body.error === 'string') {
                return { status: 'failed', error: body.error };
            }
            return null;
        }
        catch (_pollFailure) {
            return null;
        }
    }, []);
    // Poll while a scan is in flight; the route answers 200 + status, and the
    // poll tears itself down the moment the status leaves `running`.
    useEffect(() => {
        if (!fullSyncRunning)
            return;
        let cancelled = false;
        const tick = async () => {
            const next = await fetchFullSync();
            if (cancelled || next === null)
                return;
            setFullSync(next);
        };
        void tick();
        const timer = setInterval(() => { void tick(); }, 300);
        return () => { cancelled = true; clearInterval(timer); };
    }, [fullSyncRunning, fetchFullSync]);
    /**
     * Kick off one full scan. The button shows the request as soon as the
     * POST returns 202; the polling effect above then drives the bar until
     * the host settles into `done` or `failed`. A 409 (already running) is
     * a no-op — the polling will already see the running state.
     */
    const startFullSync = useCallback(async () => {
        try {
            const response = await fetch(FULL_SYNC_PATH, { method: 'POST' });
            if (response.status === 202) {
                setFullSync({ status: 'running', processed: 0, total: 0, added: 0, skipped: 0, removed: 0, failedSessions: 0 });
                return;
            }
            if (response.status === 409) {
                // A scan is already running on the host; the next poll will pick it
                // up. The button is disabled while running, so this branch only
                // fires on a race the host already accepted.
                const next = await fetchFullSync();
                if (next !== null)
                    setFullSync(next);
            }
        }
        catch (_triggerFailure) {
            // The next open of the section re-tries; a transient POST failure
            // does not need its own error line.
        }
    }, [fetchFullSync]);
    return (_jsxs("li", { className: open ? `${css.card} ${css.cardOpen}` : css.card, children: [_jsxs("button", { type: "button", className: css.header, "aria-expanded": open, "aria-label": `${t(open ? 'card.collapse' : 'card.expand')}: ${t('card.title')}`, onClick: () => { setOpen(!open); }, children: [_jsxs("span", { className: css.headText, children: [_jsx("span", { className: css.name, children: t('card.title') }), _jsx("span", { className: css.description, children: t('card.description') })] }), state.dirty ? _jsx("span", { className: css.pending, children: t('card.unsaved') }) : null, _jsx(IconChevronDownOutlineMedium, { className: open ? `${css.chevron} ${css.chevronOpen}` : css.chevron })] }), open
                ? (_jsxs("div", { className: css.body, children: [!state.writable ? _jsx("p", { className: css.note, role: "status", children: t('card.readOnly') }) : null, _jsxs("label", { className: css.field, htmlFor: "token-usage-card-path", children: [_jsx("span", { className: css.fieldLabel, children: t('card.pathLabel') }), _jsxs("span", { className: css.inputRow, children: [_jsx("input", { id: "token-usage-card-path", className: css.input, type: "text", spellCheck: false, value: state.fields.path, disabled: lockInput, onChange: event => { props.editField('path', event.target.value); } }), _jsx("button", { type: "button", className: css.browse, disabled: lockInput || picking, onClick: () => { void browse(); }, children: t(picking ? 'card.picking' : 'card.browse') })] })] }), _jsx("p", { className: css.hint, children: t('card.pathHint') }), _jsxs("div", { className: css.field, children: [_jsx("label", { className: css.fieldLabel, htmlFor: "token-usage-card-region", children: t('card.regionLabel') }), _jsxs("div", { className: css.regionRow, children: [_jsxs("select", { id: "token-usage-card-region", className: css.input, value: state.fields.pricingRegion, disabled: lockInput, onChange: event => { props.editField('pricingRegion', event.target.value); }, children: [_jsx("option", { value: "", children: t('card.regionDefault') }), _jsx("option", { value: "domestic", children: t('card.region.domestic') }), _jsx("option", { value: "overseas", children: t('card.region.overseas') })] }), _jsx(PricingSyncButton, { disabled: lockInput || state.saving, dirty: state.dirty, t: t })] })] }), _jsxs("p", { className: css.hint, children: [t('card.hint'), state.overridden.pricingRegion ? ` ${t('card.overridden')}` : ''] }), state.migration !== undefined
                            ? (_jsxs("div", { className: css.migration, role: "status", children: [_jsx("span", { className: css.migrationLabel, children: t(state.migration.phase === 'copying' ? 'card.migratingCopy' : 'card.migratingClean')
                                            .replace('{done}', String(state.migration.done))
                                            .replace('{total}', String(state.migration.total)) }), _jsx("span", { className: css.migrationBar, children: _jsx("span", { className: css.migrationFill, style: { width: `${String(Math.round((state.migration.done / Math.max(state.migration.total, 1)) * 100))}%` } }) })] }))
                            : null, _jsxs("div", { className: css.fullSync, children: [_jsxs("div", { className: css.fullSyncHeader, children: [_jsx("span", { className: css.fullSyncTitle, children: t('card.fullSync.title') }), _jsx("span", { className: css.fullSyncHint, children: t('card.fullSync.hint') })] }), _jsx("button", { type: "button", className: css.fullSyncButton, disabled: fullSyncRunning, onClick: () => { void startFullSync(); }, children: t(fullSyncRunning ? 'card.fullSync.running' : 'card.fullSync.button') }), fullSync.status === 'running'
                                    ? (_jsxs("div", { className: css.fullSyncProgress, role: "status", children: [_jsxs("span", { className: css.fullSyncProgressLabel, children: [t('card.fullSync.progress', {
                                                        processed: String(fullSync.processed),
                                                        total: String(fullSync.total),
                                                        added: String(fullSync.added),
                                                        skipped: String(fullSync.skipped),
                                                        removed: String(fullSync.removed),
                                                    }), fullSync.failedSessions > 0
                                                        ? t('card.fullSync.failuresNote', { count: String(fullSync.failedSessions) })
                                                        : ''] }), _jsx("span", { className: css.fullSyncBar, children: _jsx("span", { className: css.fullSyncFill, style: { width: `${String(Math.round((fullSync.processed / Math.max(fullSync.total, 1)) * 100))}%` } }) })] }))
                                    : null, fullSync.status === 'done'
                                    ? (_jsxs("p", { className: css.fullSyncResult, role: "status", children: [t('card.fullSync.done', {
                                                added: String(fullSync.added),
                                                skipped: String(fullSync.skipped),
                                                removed: String(fullSync.removed),
                                            }), fullSync.failedSessions > 0
                                                ? t('card.fullSync.failuresNote', { count: String(fullSync.failedSessions) })
                                                : ''] }))
                                    : null, fullSync.status === 'failed'
                                    ? (_jsx("p", { className: css.fullSyncError, role: "status", children: t('card.fullSync.failed', { error: fullSync.error }) }))
                                    : null] }), _jsxs("div", { className: css.footer, children: [state.failed
                                    ? (_jsx("p", { className: css.failed, role: "status", children: state.refusal !== undefined
                                            ? t('card.saveBlockedSessions').replace('{count}', String(state.refusal.interactingSessions))
                                            : t('card.saveFailed') }))
                                    : null, _jsx("button", { type: "button", className: css.discard, disabled: lockActions, onClick: props.discard, children: t('card.discard') }), _jsx("button", { type: "button", className: css.save, disabled: lockActions, onClick: props.save, children: t(state.saving ? 'card.saving' : 'card.save') })] })] }))
                : null] }));
}
function PricingSyncButton({ disabled, dirty, t }) {
    const [status, setStatus] = useState('idle');
    const [result, setResult] = useState(null);
    const running = useRef(false);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const sync = async () => {
        if (running.current || disabled || dirty)
            return;
        running.current = true;
        setStatus('running');
        setResult(null);
        try {
            const response = await fetch(PRICING_SYNC_PATH, { method: 'POST', cache: 'no-store' });
            if (!response.ok) {
                const body = await response.json();
                if (mounted.current)
                    setStatus(body.error === 'migration-in-progress' ? 'migrating'
                        : body.error === 'directory-conflict' || body.error === 'pricing-source-changed' ? 'changed' : 'failed');
                return;
            }
            const body = await response.json();
            if (body === null || typeof body !== 'object'
                || ![body.version, body.updatedAt, body.models, body.aliasPatterns, body.usdExchangeRate].every(value => typeof value === 'number' && Number.isFinite(value))) {
                throw new Error('unexpected pricing sync response');
            }
            pricingTableChanged();
            if (mounted.current) {
                setResult(body);
                setStatus('done');
            }
        }
        catch {
            if (mounted.current)
                setStatus('failed');
        }
        finally {
            running.current = false;
        }
    };
    return _jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: css.browse, disabled: disabled || dirty || status === 'running', onClick: () => { void sync(); }, children: t(status === 'running' ? 'card.pricingSync.running' : 'card.pricingSync.button') }), dirty ? _jsx("p", { className: `${css.hint} ${css.syncFeedback}`, children: t('card.pricingSync.unsaved') })
                : status === 'done' && result !== null ? _jsx("p", { className: `${css.note} ${css.syncFeedback}`, role: "status", children: t('card.pricingSync.done', { version: String(result.version), models: String(result.models) }) })
                    : status === 'failed' || status === 'changed' || status === 'migrating' ? _jsx("p", { className: `${css.failed} ${css.syncFeedback}`, role: "alert", children: t(`card.pricingSync.${status}`) }) : null] });
}
//# sourceMappingURL=TokenUsageCard.js.map