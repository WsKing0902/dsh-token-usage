import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import { ASSOCIATIONS_PATH, PRICING_PATH } from "../wire.js";
import { modelKey } from "../model-resolution.js";
import { useAsyncResource } from "./async-resource.js";
import { currencyViewOf } from "./format.js";
import { PricingDialog } from "./PricingDialog.js";
import { AssociationRequestError, pricingAssociationsChanged, pricingIssueUrl } from "./pricing-associations.js";
import shared from './PricingDialog.module.css';
import styles from './PricingAssociations.module.css';
const AssociationUiContext = createContext(null);
export function PricingAssociationProvider({ resolutions = [], feedVersion, view, t, children }) {
    const [source, setSource] = useState(undefined);
    const [unpriced, setUnpriced] = useState(null);
    const opener = useRef(null);
    const rememberOpener = () => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; };
    return _jsxs(AssociationUiContext.Provider, { value: { open: name => { rememberOpener(); setSource(name ?? null); },
            showUnpriced: resolution => { rememberOpener(); setUnpriced(resolution); }, resolutions,
            ...(feedVersion !== undefined ? { feedVersion } : {}) }, children: [children, unpriced !== null && _jsx(UnpricedModelDialog, { resolution: unpriced, version: feedVersion, t: t, onClose: () => setUnpriced(null), onAssociate: () => { setUnpriced(null); setSource(unpriced.rawName); } }), source !== undefined && _jsx(PricingAssociationDialog, { initialSource: source, returnFocus: opener.current, view: view, t: t, onClose: () => setSource(undefined) })] });
}
/** Entry remains available even when the usage filter has no rows. */
export function PricingAssociationManagerButton({ t, onOpen }) {
    const ui = useContext(AssociationUiContext);
    const open = onOpen ?? (ui === null ? undefined : () => ui.open());
    return open === undefined ? null : _jsx("button", { type: "button", "data-pricing-association-manager": true, className: styles.button, onClick: open, children: t('association.manage') });
}
export function PricingIssueLink({ resolution, version, t }) {
    return _jsx("a", { className: styles.link, href: pricingIssueUrl(resolution, version), target: "_blank", rel: "noopener noreferrer", children: t('association.issue') });
}
export function UnpricedModelTag({ model, t }) {
    const ui = useContext(AssociationUiContext);
    const resolution = ui?.resolutions.find(row => modelKey(row.rawName) === modelKey(model))
        ?? { rawName: model, status: 'unmatched', strippedPrefix: false, candidates: [] };
    return _jsx("button", { type: "button", className: styles.unpricedTag, "aria-haspopup": "dialog", disabled: ui === null || model === '', onClick: () => ui?.showUnpriced(resolution), children: t('pricing.unpriced') });
}
function UnpricedModelDialog({ resolution, version, t, onClose, onAssociate }) {
    const dialogRef = useRef(null);
    const backdropPress = useRef(false);
    const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    useEffect(() => {
        dialogRef.current?.showModal();
        return () => { if (opener.current?.isConnected)
            opener.current.focus(); };
    }, []);
    const automatic = resolution.automatic ?? resolution;
    return _jsxs("dialog", { ref: dialogRef, className: `${shared.dialog} ${styles.unpricedDialog}`, "aria-label": t('association.unpricedTitle'), onClose: event => { if (event.target === dialogRef.current)
            onClose(); }, onMouseDown: event => { backdropPress.current = event.target === dialogRef.current; }, onClick: event => { if (event.target === dialogRef.current && backdropPress.current)
            dialogRef.current?.close(); }, onKeyDown: event => { if (event.key === 'Escape')
            event.stopPropagation(); }, children: [_jsxs("div", { className: shared.dialogHead, children: [_jsx("h2", { className: shared.dialogTitle, children: t('association.unpricedTitle') }), _jsx("button", { type: "button", className: shared.dialogClose, "aria-label": t('association.close'), onClick: () => dialogRef.current?.close(), children: "\u2715" })] }), _jsx("p", { className: styles.name, children: resolution.rawName }), automatic.status === 'ambiguous' && _jsx("p", { className: styles.note, children: t('pricing.ambiguous', { models: automatic.candidates.join(', ') }) }), _jsxs("div", { className: styles.actions, children: [_jsx("button", { type: "button", className: styles.button, onClick: onAssociate, children: t('association.choose') }), _jsx(PricingIssueLink, { resolution: resolution, version: version, t: t })] })] });
}
/** Show original associated IDs on hover without expanding the statistics row. */
export function ModelAssociationBadge({ model, t }) {
    const ui = useContext(AssociationUiContext);
    if (ui === null || model === '')
        return null;
    const names = ui.resolutions.filter(row => modelKey(row.modelId ?? row.rawName) === modelKey(model));
    const associated = names.filter(row => row.association !== undefined);
    if (associated.length === 0)
        return null;
    const label = t('association.tooltip', { models: associated.map(row => row.rawName).join(', ') });
    return _jsx("span", { className: styles.badgeWrap, children: _jsx(Tooltip, { label: label, side: "top", delayMs: 100, children: _jsx("span", { className: styles.badge, role: "img", "aria-label": label, tabIndex: 0, children: _jsxs("svg", { width: "14", height: "14", viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", children: [_jsx("circle", { cx: "8", cy: "8", r: "6", stroke: "currentColor" }), _jsx("path", { d: "M6.5 6a1.5 1.5 0 0 1 3 0c0 1-1.5 1-1.5 2.5", stroke: "currentColor", strokeLinecap: "round" }), _jsx("circle", { cx: "8", cy: "10.5", r: ".7", fill: "currentColor" })] }) }) }) });
}
function AssociationStatus({ row, t }) {
    return _jsxs("p", { className: styles.note, children: [t(`association.state.${row.state}`), row.state === 'automatic-takeover' && _jsxs(_Fragment, { children: [' ', t('association.automaticTarget', { model: row.automaticModelId ?? '' }), row.targetDiffers && _jsxs(_Fragment, { children: [' ', t('association.targetDiffers', { model: row.targetModelId })] }), ' ', t('association.reactivate')] })] });
}
async function readJson(url, signal) {
    const response = await fetch(url, { signal, cache: 'no-store' });
    if (!response.ok)
        throw new Error(`HTTP ${response.status}`);
    return response.json();
}
function checkAssociations(value) {
    if (value === null || typeof value !== 'object' || typeof value.directoryToken !== 'string'
        || !['ready', 'unavailable'].includes(value.storageState) || !Array.isArray(value.associations)
        || typeof value.pricingAvailable !== 'boolean' || typeof value.writesPaused !== 'boolean'
        || (value.storageState === 'ready' && (!Number.isSafeInteger(value.revision) || value.revision < 0))
        || value.associations.some(row => row === null || typeof row.sourceModel !== 'string' || typeof row.targetModelId !== 'string')) {
        throw new Error('unexpected association response');
    }
    return value;
}
function checkPricing(value) {
    if (value === null || typeof value !== 'object' || !Array.isArray(value.models)
        || value.models.some(row => row === null || typeof row.modelId !== 'string'
            || !Array.isArray(row.aliasPatterns) || !row.aliasPatterns.every((pattern) => typeof pattern === 'string') || row.rules?.base === undefined)) {
        throw new Error('unexpected pricing response');
    }
    return value;
}
function requestMessage(error, t) {
    if (!(error instanceof AssociationRequestError))
        return t('association.writeFailed');
    switch (error.code) {
        case 'revision-conflict':
        case 'directory-conflict': return t('association.conflict');
        case 'migration-in-progress': return t('association.migrating');
        case 'source-automatically-priced': return t('association.automaticOnly');
        case 'target-unavailable': return t('association.targetUnavailable');
        case 'pricing-unavailable': return t('pricing.unavailable');
        case 'association-storage-unavailable': return t('pricing.associationStorageUnavailable');
        default: return t('association.writeFailed');
    }
}
export function PricingAssociationDialog({ initialSource, view, t, onClose, returnFocus }) {
    const dialogRef = useRef(null);
    const searchId = useId();
    const backdropPress = useRef(false);
    const mounted = useRef(true);
    const writing = useRef(false);
    const opener = useRef(returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null));
    const source = initialSource;
    const [query, setQuery] = useState('');
    const [target, setTarget] = useState(null);
    const [detail, setDetail] = useState(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [confirmRevoke, setConfirmRevoke] = useState(null);
    const [override, setOverride] = useState(null);
    const [state, retry] = useAsyncResource(async (signal) => {
        const [associations, pricing] = await Promise.all([
            readJson(ASSOCIATIONS_PATH + (source !== null ? `?sourceModel=${encodeURIComponent(source)}` : ''), signal).then(checkAssociations),
            readJson(PRICING_PATH, signal).then(checkPricing).catch(() => null),
        ]);
        return { associations, pricing, source };
    }, [source], { retryToken: 0 });
    useEffect(() => {
        const dialog = dialogRef.current;
        dialog?.showModal();
        const parent = dialog?.parentElement;
        mounted.current = true;
        return () => {
            mounted.current = false;
            if (opener.current?.isConnected)
                opener.current.focus();
            else
                (parent?.querySelector('[data-pricing-association-manager]')
                    ?? parent?.querySelector('[data-pricing-overview-trigger]')
                    ?? parent?.querySelector('button'))?.focus();
        };
    }, []);
    const ready = state.status === 'ready' && state.value.source === source;
    const snapshot = override ?? (ready ? state.value.associations : null);
    const models = ready ? state.value.pricing?.models ?? [] : [];
    const candidateView = ready && state.value.pricing !== null ? currencyViewOf(state.value.pricing) : view;
    const selected = models.find(model => modelKey(model.modelId) === modelKey(target ?? ''));
    const currentChoice = snapshot?.associations.find(row => modelKey(row.sourceModel) === modelKey(source ?? ''));
    const savedTarget = models.find(model => modelKey(model.modelId) === modelKey(currentChoice?.targetModelId ?? ''));
    const automatic = snapshot?.resolution?.automatic ?? snapshot?.resolution;
    const writable = ready && snapshot?.storageState === 'ready' && !snapshot.writesPaused && !pending;
    const canSave = writable && snapshot?.pricingAvailable && ready && state.value.pricing !== null && state.value.pricing.costState !== 'pricing-unavailable'
        && automatic !== undefined && automatic.status !== 'matched' && selected !== undefined && source !== null;
    const searchModelId = modelKey(query.trim());
    const candidates = searchModelId === '' ? [] : models.filter(model => modelKey(model.modelId).includes(searchModelId));
    const reload = () => { setOverride(null); setError(null); retry(); };
    const mutate = async (operation, name) => {
        if (writing.current || snapshot === null || snapshot.revision === null)
            return;
        writing.current = true;
        setPending(true);
        setError(null);
        setNotice(null);
        try {
            const response = await fetch(ASSOCIATIONS_PATH, { method: operation === 'save' ? 'POST' : 'DELETE', cache: 'no-store',
                headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceModel: name,
                    ...(operation === 'save' ? { targetModelId: selected?.modelId } : {}), revision: snapshot.revision, directoryToken: snapshot.directoryToken }) });
            const result = await response.json();
            if (!response.ok)
                throw new AssociationRequestError(result.error ?? 'write-failed', result.current);
            checkAssociations(result);
            pricingAssociationsChanged();
            if (!mounted.current)
                return;
            if (operation === 'save') {
                dialogRef.current?.close();
                return;
            }
            setOverride(result);
            setConfirmRevoke(null);
            setNotice(t('association.revoked'));
        }
        catch (failure) {
            if (!mounted.current)
                return;
            if (failure instanceof AssociationRequestError && failure.current !== undefined) {
                setOverride(failure.current);
                if (failure.code === 'directory-conflict') {
                    setTarget(null);
                    setDetail(null);
                    setOverride(null);
                    retry();
                    pricingAssociationsChanged();
                }
            }
            setError(requestMessage(failure, t));
        }
        finally {
            writing.current = false;
            if (mounted.current)
                setPending(false);
        }
    };
    const revokeButtons = (name) => _jsx(_Fragment, { children: confirmRevoke === name ? _jsxs("span", { className: `${styles.actions} ${styles.revokeConfirmation}`, children: [_jsx("span", { className: styles.note, children: t('association.revokeImpact') }), _jsx("button", { type: "button", className: styles.button, disabled: !writable, onClick: () => { void mutate('delete', name); }, children: t('association.confirmRevoke') }), _jsx("button", { type: "button", className: styles.button, disabled: pending, onClick: () => setConfirmRevoke(null), children: t('association.cancel') })] }) : _jsx("button", { type: "button", className: styles.button, disabled: !writable, onClick: () => setConfirmRevoke(name), children: t('association.revoke') }) });
    return _jsxs("dialog", { ref: dialogRef, className: `${shared.dialog} ${styles.dialog}`, "aria-label": t('association.title'), onClose: event => { if (event.target === dialogRef.current)
            onClose(); }, onCancel: event => { if (event.target === dialogRef.current && writing.current)
            event.preventDefault(); }, onMouseDown: event => { backdropPress.current = event.target === dialogRef.current; }, onClick: event => { if (event.target === dialogRef.current && backdropPress.current && !writing.current)
            dialogRef.current?.close(); }, onKeyDown: event => { if (event.key === 'Escape')
            event.stopPropagation(); }, children: [_jsxs("div", { className: shared.dialogHead, children: [_jsx("h2", { className: shared.dialogTitle, children: t('association.title') }), _jsx("button", { type: "button", className: shared.dialogClose, "aria-label": t('association.close'), disabled: pending, onClick: () => dialogRef.current?.close(), children: "\u2715" })] }), state.status === 'loading' && _jsx("p", { children: t('loading') }), state.status === 'error' && _jsxs(_Fragment, { children: [_jsx("p", { role: "alert", children: t('association.loadFailed') }), _jsx("button", { type: "button", className: styles.button, onClick: reload, children: t('retry') })] }), source !== null && ready && state.value.pricing === null && _jsxs(_Fragment, { children: [_jsx("p", { role: "alert", children: t('association.candidatesUnavailable') }), _jsx("button", { type: "button", className: styles.button, disabled: pending, onClick: reload, children: t('retry') })] }), error !== null && _jsxs("p", { role: "alert", className: styles.error, children: [error, " ", _jsx("button", { type: "button", className: styles.button, disabled: pending, onClick: reload, children: t('association.refresh') })] }), notice !== null && _jsx("p", { role: "status", children: notice }), snapshot !== null && _jsxs(_Fragment, { children: [snapshot.storageState !== 'ready' && _jsx("p", { role: "alert", children: t('pricing.associationStorageUnavailable') }), snapshot.writesPaused && _jsx("p", { role: "status", children: t('association.migrating') }), !snapshot.pricingAvailable && _jsx("p", { role: "status", children: t('pricing.unavailable') }), source === null ? _jsxs(_Fragment, { children: [_jsx("p", { className: styles.note, children: t('association.allHint') }), snapshot.associations.length === 0 && _jsx("p", { className: styles.note, children: t('association.empty') }), snapshot.associations.map(row => _jsxs("section", { className: `${styles.entry} ${styles.mappingRow}`, children: [_jsxs("div", { className: styles.name, children: [row.sourceModel, " \u2192 ", row.resolvedTargetModelId ?? row.targetModelId] }), revokeButtons(row.sourceModel)] }, modelKey(row.sourceModel)))] }) : _jsxs(_Fragment, { children: [_jsx("p", { className: `${styles.name} ${styles.source}`, children: source }), automatic?.status === 'ambiguous' && _jsx("p", { children: t('pricing.ambiguous', { models: automatic.candidates.join(', ') }) }), currentChoice !== undefined && _jsxs("section", { className: styles.entry, children: [_jsxs("div", { className: styles.name, children: [source, " \u2192 ", currentChoice.resolvedTargetModelId ?? currentChoice.targetModelId] }), _jsx(AssociationStatus, { row: currentChoice, t: t }), savedTarget !== undefined && _jsx("button", { type: "button", className: styles.button, onClick: () => setDetail(savedTarget), children: t('association.preview') }), revokeButtons(source)] }), automatic?.status === 'matched' ? _jsxs("p", { children: [t('association.automaticOnly'), " ", automatic.modelId] }) : _jsxs(_Fragment, { children: [_jsx("label", { className: styles.label, htmlFor: searchId, children: t('association.search') }), _jsx("input", { id: searchId, className: styles.search, type: "search", placeholder: t('association.searchHint'), value: query, disabled: pending, onChange: event => { setQuery(event.target.value); setTarget(null); } }), candidates.length > 0 && _jsx("div", { className: styles.candidates, role: "group", "aria-label": t('association.candidates'), children: candidates.map(model => _jsxs("label", { className: styles.candidate, children: [_jsx("input", { type: "radio", name: searchId + '-target', checked: target !== null && modelKey(target) === modelKey(model.modelId), disabled: !writable || !snapshot.pricingAvailable, onChange: () => { setTarget(model.modelId); setNotice(null); } }), _jsx("span", { children: model.modelId }), _jsx("small", { children: model.family })] }, model.modelId)) }), query.trim() !== '' && candidates.length === 0 && _jsx("p", { className: styles.note, children: t('association.noResults') }), selected !== undefined && _jsxs("div", { className: styles.selection, children: [_jsx("span", { className: styles.name, children: t('association.target', { model: selected.modelId }) }), _jsx("button", { type: "button", className: styles.button, onClick: () => setDetail(selected), children: t('association.preview') })] }), _jsx("p", { className: styles.note, children: t('association.impact') }), _jsx("button", { type: "button", className: `${styles.button} ${styles.save}`, disabled: !canSave, onClick: () => { void mutate('save', source); }, children: t(pending ? 'association.saving' : 'association.save') })] })] })] }), detail !== null && _jsx(PricingDialog, { model: detail.modelId, rules: detail.rules, view: candidateView, t: t, onClose: () => setDetail(null) })] });
}
//# sourceMappingURL=PricingAssociations.js.map