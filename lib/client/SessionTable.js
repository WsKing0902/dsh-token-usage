import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
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
import { useEffect, useMemo, useState } from 'react';
import { costsAvailable } from "./PricingStatus.js";
import { dayKeyOf, totalTokens } from "./day.js";
import { formatCost, formatTokens } from "./format.js";
import { RequestsCell, RequestsSplitHead } from "./StatCard.js";
import styles from './SessionTable.module.css';
/** The last path segment of a directory, on either separator. */
function dirTailOf(cwd) {
    const parts = cwd.split(/[\\/]/u).filter(part => part !== '');
    return parts[parts.length - 1] ?? cwd;
}
/** A short session-id fallback: the leading chunk is usually enough to
 * tell sessions apart when no title ever landed. */
function shortIdOf(sessionId) {
    return sessionId.length > 8 ? `${sessionId.slice(0, 8)}…` : sessionId;
}
/** Browser-level grouping preference: localStorage, not per-component state —
 * a filter change unmounts this table (the section flips to its loading
 * branch), and the choice must survive that remount as well as reloads. */
const SESSION_GROUPED_KEY = 'dsh.token-usage.sessionGrouped';
function readGroupedPreference() {
    if (typeof localStorage === 'undefined')
        return true;
    try {
        // Absent or unparseable reads as the default (grouped); only an
        // explicit '0' (the flat-list pick) turns grouping off.
        return localStorage.getItem(SESSION_GROUPED_KEY) !== '0';
    }
    catch {
        return true;
    }
}
function writeGroupedPreference(grouped) {
    try {
        if (grouped)
            localStorage.removeItem(SESSION_GROUPED_KEY);
        else
            localStorage.setItem(SESSION_GROUPED_KEY, '0');
    }
    catch {
        // Storage may refuse (private mode); the choice just stays session-local.
    }
}
function sortValueOf(row, key) {
    if (key === 'tokens')
        return totalTokens(row.totals);
    if (key === 'cost')
        return row.cost;
    return row.lastTime;
}
function nextSort(current, key) {
    if (current?.key !== key)
        return { key, dir: 'desc' };
    if (current.dir === 'desc')
        return { key, dir: 'asc' };
    return null;
}
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
export function SessionTable({ rows, view, t, sessionListed, openSession, costState }) {
    // Directory grouping: presentation-only (rows already carry their cwd),
    // default on, persisted at browser level so a filter change (which
    // unmounts this table) and a reload keep the user's pick.
    const [grouped, setGrouped] = useState(readGroupedPreference);
    const toggleGrouped = (next) => {
        setGrouped(next);
        writeGroupedPreference(next);
    };
    const [sort, setSort] = useState(null);
    // Whether Ctrl is held: the jump affordance (dashed title, click) exists
    // only while it is, so plain clicks keep the rows inert. `blur` resets —
    // a focus loss can swallow the keyup and strand the state on.
    const [ctrlHeld, setCtrlHeld] = useState(false);
    useEffect(() => {
        const down = (event) => { if (event.key === 'Control' || event.key === 'Meta')
            setCtrlHeld(true); };
        const up = (event) => { if (event.key === 'Control' || event.key === 'Meta')
            setCtrlHeld(false); };
        const move = (event) => {
            const active = event.ctrlKey || event.metaKey;
            setCtrlHeld(previous => (previous === active ? previous : active));
        };
        const blur = () => setCtrlHeld(false);
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('mousemove', move);
        window.addEventListener('blur', blur);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
            window.removeEventListener('mousemove', move);
            window.removeEventListener('blur', blur);
        };
    }, []);
    // A row is jumpable when the controller knows the session; the click
    // re-checks through openSession (the list may have moved between hover
    // and click), which reports whether it actually opened.
    const jumpable = (id) => ctrlHeld && sessionListed !== undefined && openSession !== undefined && sessionListed(id);
    const sorted = useMemo(() => {
        if (sort === null)
            return rows;
        const factor = sort.dir === 'desc' ? -1 : 1;
        return [...rows].sort((left, right) => factor * (sortValueOf(left, sort.key) - sortValueOf(right, sort.key))
            || (left.sessionId < right.sessionId ? -1 : 1));
    }, [rows, sort]);
    const groups = useMemo(() => {
        if (!grouped)
            return null;
        const map = new Map();
        for (const row of sorted) {
            const key = row.cwd ?? '';
            const bucket = map.get(key) ?? [];
            bucket.push(row);
            map.set(key, bucket);
        }
        // Directories by name; the no-directory group sinks to the end.
        return [...map.entries()].sort((left, right) => {
            if (left[0] === '')
                return 1;
            if (right[0] === '')
                return -1;
            return left[0].localeCompare(right[0]);
        });
    }, [sorted, grouped]);
    /** One sortable header cell: the column name as the toggle, the current
     * direction marked and announced via aria-sort. */
    const sortHead = (key, label) => {
        const active = sort?.key === key;
        return (_jsx("th", { ...active ? { 'aria-sort': sort.dir === 'desc' ? 'descending' : 'ascending' } : {}, children: _jsxs("button", { type: "button", className: styles['sortBtn'], onClick: () => setSort(previous => nextSort(previous, key)), children: [label, active ? _jsx("span", { className: styles['sortMark'], children: sort.dir === 'desc' ? '▼' : '▲' }) : null] }) }));
    };
    return (_jsxs(_Fragment, { children: [_jsx("div", { className: styles['head'], children: _jsxs("div", { className: styles['segmented'], role: "group", "aria-label": t('session.group.label'), children: [_jsx("button", { type: "button", className: grouped ? `${styles['segBtn']} ${styles['segActive']}` : styles['segBtn'], "aria-pressed": grouped, onClick: () => toggleGrouped(true), children: t('session.group.on') }), _jsx("button", { type: "button", className: !grouped ? `${styles['segBtn']} ${styles['segActive']}` : styles['segBtn'], "aria-pressed": !grouped, onClick: () => toggleGrouped(false), children: t('session.group.off') })] }) }), _jsx("div", { className: styles['tableWrap'], children: _jsxs("table", { className: styles['table'], "aria-label": t('bySession.title'), children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: styles['sessionHead'], children: t('session.titleCol') }), _jsx("th", { "aria-label": t('stat.successFail'), children: _jsx(RequestsSplitHead, { t: t }) }), sortHead('tokens', t('stat.totalTokens')), sortHead('cost', t('stat.cost')), sortHead('lastTime', t('session.lastActive'))] }) }), _jsx("tbody", { children: groups === null
                                ? sorted.map(row => renderRow(row, false))
                                : groups.map(([cwd, groupRows]) => (_jsx(FragmentGroup, { cwd: cwd, count: groupRows.length, t: t, children: groupRows.map(row => renderRow(row, true)) }, cwd === '' ? '\u0000' : cwd))) })] }) })] }));
    function renderRow(row, indented) {
        // Identity: the log-backed title when one landed; otherwise the short
        // session id plus the time span (the span substitutes for the missing
        // title, it never pretends to be one). The directory tail rides along
        // as the secondary identity only in the ungrouped list — grouped, it
        // lives in the group head. While Ctrl is held over a listed session,
        // the identity becomes a jump affordance: dashed underline, click
        // opens the session (the parent closes the settings panel).
        const jump = jumpable(row.sessionId);
        return (_jsxs("tr", { children: [_jsxs("td", { className: indented ? `${styles['sessionCol']} ${styles['sessionIndent']}` : styles['sessionCol'], children: [_jsxs("span", { className: styles['sessionCell'], children: [_jsx("button", { type: "button", className: jump ? `${styles['sessionName']} ${styles['jumpable']}` : styles['sessionName'], title: jump ? t('session.openHint') : undefined, onClick: jump || ctrlHeld
                                        ? event => {
                                            event.preventDefault();
                                            openSession?.(row.sessionId);
                                        }
                                        : undefined, children: row.title !== undefined
                                        ? row.title
                                        : `${shortIdOf(row.sessionId)} · ${dayKeyOf(new Date(row.firstTime))} – ${dayKeyOf(new Date(row.lastTime))}` }), row.childCount !== undefined && row.childCount > 0
                                    ? (_jsx("span", { className: styles['badge'], "aria-label": t('view.subagents.nested', { count: String(row.childCount) }), children: t('view.subagents.nested', { count: String(row.childCount) }) }))
                                    : null] }), !indented && row.cwd !== undefined
                            ? _jsx("span", { className: styles['dirTail'], children: dirTailOf(row.cwd) })
                            : null] }), _jsx("td", { children: _jsx(RequestsCell, { requests: row.totals.requests, failures: row.totals.failures ?? 0, failuresByCode: row.totals.failuresByCode, t: t }) }), _jsx("td", { children: formatTokens(totalTokens(row.totals)) }), _jsx("td", { className: styles['costCol'], children: costsAvailable(costState) ? formatCost(row.cost, view) : '—' }), _jsx("td", { children: dayKeyOf(new Date(row.lastTime)) })] }, row.sessionId));
    }
}
/** One directory group: a full-width head row with the directory tail, then
 * the group's rows (a keyed fragment keeps `<tr>`s table-legal). */
function FragmentGroup({ cwd, count, t, children }) {
    return (_jsxs(_Fragment, { children: [_jsx("tr", { className: styles['groupRow'], children: _jsxs("td", { colSpan: 5, className: styles['groupHead'], children: [cwd === '' ? t('session.untitledDir') : dirTailOf(cwd), _jsx("span", { className: styles['groupCount'], children: String(count) })] }) }), children] }));
}
//# sourceMappingURL=SessionTable.js.map