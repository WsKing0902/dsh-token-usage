/**
 * Stats computation of the token-usage plugin: read the day files and fold
 * the records into totals, per-day rows, per-model rows, and a bounded recent
 * window — keeping one row per (day, model, rate identity) so every record
 * is billed at the rate its own timestamp resolved through (see
 * pricing.resolveRate). Frozen (pre-today) day files are served from the
 * on-disk rollup (see rollup.ts); only today's file is read on every call.
 * Pure aggregation lives apart from the file walk so the web route and tests
 * share one implementation.
 *
 * @module token-usage/stats
 */
import { canonicalName, costOf, ratesForKey } from "./pricing.js";
import { modelKey } from "./model-resolution.js";
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileDay, listDayFiles, readDayFile, readDayFileChecked } from "./record-cache.js";
import { consoleLogger } from "./log.js";
import { AUX_KINDS } from "./usage-record.js";
import { readRollup, writeRollup, ROLLUP_FILE_NAME, ROLLUP_TMP_FILE_NAME } from "./rollup.js";
import { UNPRICED_KEY } from "./wire.js";
/** Bounded recent window length: only the newest records cross the wire. */
export const RECENT_LIMIT = 20;
/** Empty rollup used as the merge base when no rollup exists on disk yet. */
function emptyRollup() {
    return { upto: '', total: emptyTotals(), byDay: [], byHour: [], byModel: [], rateRows: [], auxRows: [], bySession: [], recent: [] };
}
/** Zeroed totals; requests counts rows, the token buckets sum reported usage. */
export function emptyTotals() {
    return {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        compactions: 0,
        failures: 0,
    };
}
/**
 * Add one totals row into another, field by field. `compactions` and
 * `failures` merge with a `?? 0` fallback so a legacy rollup (no key) folds
 * into new aggregates without NaN; `failuresByCode` merges key-wise with
 * the same absent-reads-as-empty rule.
 */
function addTotals(target, source) {
    target.requests += source.requests;
    target.inputTokens += source.inputTokens;
    target.outputTokens += source.outputTokens;
    target.cacheReadTokens += source.cacheReadTokens;
    target.cacheWriteTokens += source.cacheWriteTokens;
    target.compactions = (target.compactions ?? 0) + (source.compactions ?? 0);
    target.failures = (target.failures ?? 0) + (source.failures ?? 0);
    const codes = source.failuresByCode;
    if (codes !== undefined) {
        const merged = target.failuresByCode ?? {};
        for (const [code, count] of Object.entries(codes)) {
            merged[code] = (merged[code] ?? 0) + count;
        }
        target.failuresByCode = merged;
    }
}
/** Sort a day row map ascending by day, matching {@link summarizeRecords}. */
function dayRows(days) {
    return [...days.entries()]
        .map(([day, totals]) => ({ day, totals }))
        .sort((left, right) => left.day < right.day ? -1 : 1);
}
/** Sort a model row map by requests descending then model name, matching {@link summarizeRecords}. */
function modelRows(models) {
    return [...models.entries()]
        .map(([model, totals]) => ({ model, totals }))
        .sort((left, right) => right.totals.requests - left.totals.requests || left.model.localeCompare(right.model));
}
/** Deterministic rate-identity order: rule window, tier, slot. */
function compareKeys(left, right) {
    return left.ruleStart - right.ruleStart || left.ruleEnd - right.ruleEnd
        || left.tier - right.tier || left.slot - right.slot;
}
/** Sort rate rows day ascending, then model name, then rate identity. */
function rateRowsSorted(rows) {
    return [...rows].sort((left, right) => left.day < right.day ? -1 : left.day > right.day ? 1
        : left.model < right.model ? -1 : left.model > right.model ? 1
            : compareKeys(left.rate, right.rate));
}
/** Map key of one (day, model, rate) cell. */
function rateRowKey(day, model, rate) {
    return `${day}\n${model}\n${rate.ruleStart}-${rate.ruleEnd}-${rate.tier}-${rate.slot}`;
}
/** Deterministic session-cell order: session id, day, model, rate identity. */
function sessionRowsSorted(rows) {
    return [...rows].sort((left, right) => left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1
        : left.day < right.day ? -1 : left.day > right.day ? 1
            : left.model < right.model ? -1 : left.model > right.model ? 1
                : compareKeys(left.rate, right.rate));
}
/** Map key of one (sessionId, day, model, rate) cell. */
function sessionRowKey(row) {
    return `${row.sessionId}\n${row.day}\n${row.model}\n${row.rate.ruleStart}-${row.rate.ruleEnd}-${row.rate.tier}-${row.rate.slot}`;
}
/** Fixed display order of the auxiliary kinds (the recorder vocabulary). */
const AUX_ORDER = new Map(AUX_KINDS.map((kind, index) => [kind, index]));
/** Deterministic auxiliary-cell order: kind, day, model, rate identity. */
function auxRowsSorted(rows) {
    return [...rows].sort((left, right) => (AUX_ORDER.get(left.auxKind) ?? 0) - (AUX_ORDER.get(right.auxKind) ?? 0)
        || (left.day < right.day ? -1 : left.day > right.day ? 1
            : left.model < right.model ? -1 : left.model > right.model ? 1
                : compareKeys(left.rate, right.rate)));
}
/** Map key of one (kind, day, model, rate) auxiliary cell. */
function auxRowKey(auxKind, day, model, rate) {
    return `${auxKind}\n${day}\n${model}\n${rate.ruleStart}-${rate.ruleEnd}-${rate.tier}-${rate.slot}`;
}
/** The auxiliary kind of one record; a hand-built aux row may omit it. */
function auxKindOfRecord(record) {
    return record.auxKind ?? 'other';
}
/**
 * Fold one record into totals; a record without provider usage still counts a
 * request, and a compaction record additionally counts the `compactions`
 * dimension (absent kind reads as a plain request). A failure record counts
 * only the `failures` dimension — it bills no tokens and never joins
 * `requests`, so the requests figure stays "successful requests" — and its
 * `failureCode` folds into the per-code breakdown the failure pill's
 * tooltip renders.
 */
function addUsage(totals, record) {
    if (record.kind === 'failure') {
        totals.failures = (totals.failures ?? 0) + 1;
        const code = record.failureCode ?? 'UNKNOWN';
        const byCode = totals.failuresByCode ?? {};
        byCode[code] = (byCode[code] ?? 0) + 1;
        totals.failuresByCode = byCode;
        return;
    }
    totals.requests += 1;
    if (record.kind === 'compaction') {
        totals.compactions = (totals.compactions ?? 0) + 1;
    }
    const usage = record.usage;
    if (usage === undefined)
        return;
    totals.inputTokens += usage.inputTokens;
    totals.outputTokens += usage.outputTokens;
    if (usage.cacheReadTokens !== undefined)
        totals.cacheReadTokens += usage.cacheReadTokens;
    if (usage.cacheWriteTokens !== undefined)
        totals.cacheWriteTokens += usage.cacheWriteTokens;
}
/** Local date key of a record time, matching the day-file naming convention. */
function dayKey(time) {
    const date = new Date(time);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}
/** Local `YYYY-MM-DDTHH` key of a record time, the byHour row key. */
function hourKey(time) {
    const date = new Date(time);
    const hour = String(date.getHours()).padStart(2, '0');
    return `${dayKey(time)}T${hour}`;
}
/** Map key of one (hour, model) cell. */
function hourRowKey(hour, model) {
    return `${hour}\n${model}`;
}
/** Sort an hour row map by hour ascending then model name, matching {@link summarizeRecords}. */
function hourRows(hours) {
    return [...hours.entries()]
        .map(([key, totals]) => {
        const separator = key.indexOf('\n');
        return { hour: key.slice(0, separator), model: key.slice(separator + 1), totals };
    })
        .sort((left, right) => left.hour < right.hour ? -1 : left.hour > right.hour ? 1
        : left.model < right.model ? -1 : left.model > right.model ? 1
            : 0);
}
/**
 * Fold records into the token summary shape, one rate row per (day, model,
 * rate identity) the resolver assigns. The recent window keeps the last
 * {@link RECENT_LIMIT} records in input order (day files are chronological)
 * and then sorts them by time descending.
 * @param records - parsed records in day-file order.
 * @param resolve - the rate resolver; defaults to leaving every record unpriced.
 * @returns totals, day rows, model rows, rate rows, and the recent window.
 */
export function summarizeRecords(records, resolve = () => UNPRICED_KEY) {
    const total = emptyTotals();
    const days = new Map();
    const hours = new Map();
    const models = new Map();
    const rated = new Map();
    const aux = new Map();
    const sessions = new Map();
    const recent = [];
    for (const record of records) {
        addUsage(total, record);
        const day = dayKey(record.time);
        const dayTotals = days.get(day) ?? emptyTotals();
        addUsage(dayTotals, record);
        days.set(day, dayTotals);
        // An unattributed failure (`model === ''`) still folds into totals,
        // byDay, and rateRows (so a day-range filter keeps the count). It
        // stays out of byModel / byHour — a blank table row would pretend
        // we know the route. The session dimension keeps it too: request
        // counts must reconcile per session, and a failure belongs to its
        // session even when no model was ever observed.
        if (record.model !== '') {
            const hour = hourKey(record.time);
            const hourTotals = hours.get(hourRowKey(hour, record.model)) ?? emptyTotals();
            addUsage(hourTotals, record);
            hours.set(hourRowKey(hour, record.model), hourTotals);
            const modelTotals = models.get(record.model) ?? emptyTotals();
            addUsage(modelTotals, record);
            models.set(record.model, modelTotals);
        }
        const rate = resolve(record);
        const rowKey = rateRowKey(day, record.model, rate);
        const cell = rated.get(rowKey)
            ?? { day, model: record.model, rate, totals: emptyTotals() };
        addUsage(cell.totals, record);
        rated.set(rowKey, cell);
        // An auxiliary (bypass) request has no owning conversation: it folds
        // into every model-scoped dimension above (it bills a real model) but
        // never into the per-session cells or the session table. Its own
        // (kind, day, model, rate) dimension backs the runtime-overhead block.
        if (record.kind === 'aux') {
            const auxKind = auxKindOfRecord(record);
            const key = auxRowKey(auxKind, day, record.model, rate);
            const auxCell = aux.get(key)
                ?? { auxKind, day, model: record.model, rate, totals: emptyTotals() };
            addUsage(auxCell.totals, record);
            aux.set(key, auxCell);
        }
        else {
            const sessionCell = {
                sessionId: record.sessionId,
                day,
                model: record.model,
                rate,
                lastTime: record.time,
                totals: emptyTotals(),
            };
            const sessionKey = sessionRowKey(sessionCell);
            const folded = sessions.get(sessionKey) ?? sessionCell;
            addUsage(folded.totals, record);
            sessions.set(sessionKey, folded);
            if (record.time > folded.lastTime)
                folded.lastTime = record.time;
        }
        if (recent.length === RECENT_LIMIT)
            recent.shift();
        recent.push(record);
    }
    const byDay = dayRows(days);
    const byHour = hourRows(hours);
    const byModel = modelRows(models);
    recent.sort((left, right) => right.time - left.time);
    return {
        total,
        byDay,
        byHour,
        byModel,
        rateRows: rateRowsSorted(rated.values()),
        auxRows: auxRowsSorted(aux.values()),
        bySession: sessionRowsSorted(sessions.values()),
        recent,
    };
}
/**
 * Keep only the records owned by one of the listed sessions. The rollup
 * carries no session dimension (its rows are (day, model, rate) cells), so a
 * session-scoped read cannot reuse it and must fold the filtered raw records
 * instead — cheap in practice (the JSONL day files are a few hundred KB) and
 * only triggered by per-session fetches (view switches), never the settings
 * page's whole-log read.
 * @param records - parsed records in day-file order.
 * @param sessionIds - the sessions whose requests stay; [] yields no records.
 * @returns the records owned by those sessions, in the original order.
 */
export function filterRecordsBySessions(records, sessionIds) {
    const wanted = new Set(sessionIds);
    return records.filter(record => wanted.has(record.sessionId));
}
/**
 * Whether `name` belongs to the selected model under an optional canonical
 * map: priced aliases of the same feed row match each other and the
 * modelId; an unpriced name matches only itself.
 */
function matchesModel(name, selected, canonical) {
    return selected === undefined || modelKey(canonicalName(name, canonical)) === modelKey(canonicalName(selected, canonical));
}
/**
 * Derive the half-open day-range bounds from optional `YYYY-MM-DD` keys. A
 * missing key leaves that side unbounded; the upper bound inherits the day's
 * full millisecond span (the day-key convention used everywhere else).
 * @param from - first day key (`YYYY-MM-DD`), inclusive; '' ignores both ends.
 * @param to - last day key (`YYYY-MM-DD`), inclusive.
 * @param model - selected model id (or alias); undefined matches any model.
 * @param canonical - alias → modelId map so a priced family matches as one.
 * @returns the bounds (every field may be undefined).
 */
export function dayRangeFilter(from, to, model, canonical) {
    const filter = {};
    if (from !== undefined && from !== '')
        filter.start = dayStart(from);
    if (to !== undefined && to !== '')
        filter.end = dayStart(to) + 86_399_999;
    if (model !== undefined && model !== '')
        filter.model = model;
    if (canonical !== undefined)
        filter.canonical = canonical;
    return filter;
}
/**
 * Combine a day-range filter with a session-id filter. The session ids are
 * applied first (cheap, preroll), the day-range second (per-record); the
 * model id, if any, is per-record too. Returns the records passing both.
 * @param records - parsed records in chronological order.
 * @param sessions - the session ids whose records stay; undefined skips that
 * dimension.
 * @param range - the day-range + model filter; undefined skips every dimension.
 */
export function filterRecordsByRange(records, sessions, range = {}) {
    const wanted = sessions !== undefined ? new Set(sessions) : undefined;
    const { start, end, model, canonical } = range;
    return records.filter(record => (wanted === undefined || wanted.has(record.sessionId))
        && (start === undefined || record.time >= start)
        && (end === undefined || record.time <= end)
        && matchesModel(record.model, model, canonical));
}
/**
 * The per-request token series of a record set, in time order — one point
 * per request, so a 55-request session plots 55 points. Failed requests are
 * excluded: they carry no token figure, and a zero-token point per failure
 * would only sawtooth the curve. The conversation view tab draws this at
 * request granularity; the settings page's hourly aggregation is unchanged
 * (this field is session-scope only).
 * @param records - the scoped records (day-file order is chronological).
 * @param from - optional inclusive day key; the series keeps those requests.
 * @param to - optional inclusive day key.
 * @param model - optional selected model id (or a priced alias of it).
 * @param canonical - alias → modelId map so a priced family matches as one.
 * @returns one point per kept request, in the original time order.
 */
export function requestSeriesOf(records, from, to, model, canonical) {
    return filterRecordsByRange(records, undefined, dayRangeFilter(from, to, model, canonical))
        .filter(record => record.kind !== 'failure')
        .map(record => ({
        time: record.time,
        tokens: record.usage === undefined ? 0
            : record.usage.inputTokens + record.usage.outputTokens
                + (record.usage.cacheReadTokens ?? 0) + (record.usage.cacheWriteTokens ?? 0),
    }));
}
/**
 * Merge two summaries into one: totals and model rows add up, day rows fold
 * by day key (a same-day record set landing in a later file must join the
 * earlier bucket, never replace it), rate rows fold by their (day, model,
 * rate) key, and the recent window keeps the newest {@link RECENT_LIMIT}
 * records across both sides. Order-independent and associative: merging
 * partial summaries equals summarizing the concatenated records.
 * @param left - one partial summary.
 * @param right - the other partial summary.
 * @returns the folded summary.
 */
export function mergeSummaries(left, right) {
    const total = emptyTotals();
    addTotals(total, left.total);
    addTotals(total, right.total);
    const days = new Map();
    const hours = new Map();
    const models = new Map();
    const rated = new Map();
    const aux = new Map();
    const sessions = new Map();
    for (const row of [...left.byDay, ...right.byDay]) {
        const day = days.get(row.day) ?? emptyTotals();
        addTotals(day, row.totals);
        days.set(row.day, day);
    }
    for (const row of [...left.byHour, ...right.byHour]) {
        const key = hourRowKey(row.hour, row.model);
        const cell = hours.get(key) ?? emptyTotals();
        addTotals(cell, row.totals);
        hours.set(key, cell);
    }
    for (const row of [...left.byModel, ...right.byModel]) {
        const model = models.get(row.model) ?? emptyTotals();
        addTotals(model, row.totals);
        models.set(row.model, model);
    }
    for (const row of [...left.rateRows, ...right.rateRows]) {
        const key = rateRowKey(row.day, row.model, row.rate);
        const cell = rated.get(key)
            ?? { day: row.day, model: row.model, rate: row.rate, totals: emptyTotals() };
        addTotals(cell.totals, row.totals);
        rated.set(key, cell);
    }
    // `?? []`: a hand-built or legacy-shaped summary without the auxiliary
    // dimension folds as if it had none (on-disk rollups are normalized when
    // read, so only in-memory shapes need the leniency).
    for (const row of [...(left.auxRows ?? []), ...(right.auxRows ?? [])]) {
        const key = auxRowKey(row.auxKind, row.day, row.model, row.rate);
        const cell = aux.get(key)
            ?? { auxKind: row.auxKind, day: row.day, model: row.model, rate: row.rate, totals: emptyTotals() };
        addTotals(cell.totals, row.totals);
        aux.set(key, cell);
    }
    // `?? []`: a hand-built or legacy-shaped summary without the session
    // dimension folds as if it had none — on-disk rollups fail validation
    // instead (isRollupFile), so this leniency only serves in-memory shapes.
    for (const row of [...(left.bySession ?? []), ...(right.bySession ?? [])]) {
        const key = sessionRowKey(row);
        const cell = sessions.get(key)
            ?? { ...row, totals: emptyTotals() };
        addTotals(cell.totals, row.totals);
        if (row.lastTime > cell.lastTime)
            cell.lastTime = row.lastTime;
        sessions.set(key, cell);
    }
    const recent = [...left.recent, ...right.recent]
        .sort((a, b) => b.time - a.time)
        .slice(0, RECENT_LIMIT);
    return {
        total,
        byDay: dayRows(days),
        byHour: hourRows(hours),
        byModel: modelRows(models),
        rateRows: rateRowsSorted(rated.values()),
        auxRows: auxRowsSorted(aux.values()),
        bySession: sessionRowsSorted(sessions.values()),
        recent,
    };
}
/** Local-midnight epoch of a day key, matching the day-file convention. */
function dayStart(day) {
    const [year, month, date] = day.split('-').map(Number);
    return new Date(year, month - 1, date).getTime();
}
/**
 * Re-aggregate a summary under an optional inclusive day range and model
 * filter, drawing every dimension from the rate rows so no file is reread.
 * The recent window filters on its record timestamps
 * ([from 00:00, to 23:59:59.999] local). No filters returns the input as-is.
 * With a canonical map, `model` matches the priced family (the modelId and
 * every identified name of the same feed row); unpriced full names ignore case.
 * byModel rows stay keyed by the raw name — {@link attachCosts} folds them.
 * @param summary - the unfiltered summary.
 * @param from - first day key (`YYYY-MM-DD`), inclusive.
 * @param to - last day key (`YYYY-MM-DD`), inclusive.
 * @param model - selected model id (or a priced alias of it).
 * @param canonical - alias → modelId map so a priced family matches as one.
 * @returns the filtered summary.
 */
export function filterSummary(summary, from, to, model, canonical) {
    if (from === undefined && to === undefined && model === undefined)
        return summary;
    const rows = summary.rateRows.filter(row => (from === undefined || row.day >= from)
        && (to === undefined || row.day <= to)
        && matchesModel(row.model, model, canonical));
    // Hour rows filter on their day prefix (the `YYYY-MM-DD` part of the key).
    const byHour = summary.byHour.filter(row => (from === undefined || row.hour.slice(0, 10) >= from)
        && (to === undefined || row.hour.slice(0, 10) <= to)
        && matchesModel(row.model, model, canonical));
    // Session cells keep the same granule the rate rows carry (day × model ×
    // rate per session), so the filtered fold stays the exact source the cost
    // layer bills from — same pattern as `rows`, one dimension wider.
    const bySession = summary.bySession.filter(row => (from === undefined || row.day >= from)
        && (to === undefined || row.day <= to)
        && matchesModel(row.model, model, canonical));
    // The auxiliary cells follow the same date/model filter as the rate rows:
    // a model filter selects the bypass calls that ran on that model too, so
    // the runtime-overhead block reconciles with the filtered totals.
    const auxRows = summary.auxRows.filter(row => (from === undefined || row.day >= from)
        && (to === undefined || row.day <= to)
        && matchesModel(row.model, model, canonical));
    const total = emptyTotals();
    const days = new Map();
    const models = new Map();
    for (const row of rows) {
        addTotals(total, row.totals);
        const day = days.get(row.day) ?? emptyTotals();
        addTotals(day, row.totals);
        days.set(row.day, day);
        if (row.model !== '') {
            const perModel = models.get(row.model) ?? emptyTotals();
            addTotals(perModel, row.totals);
            models.set(row.model, perModel);
        }
    }
    const recent = filterRecordsByRange(summary.recent, undefined, dayRangeFilter(from, to, model, canonical));
    return { dataDir: summary.dataDir, total, byDay: dayRows(days), byHour, byModel: modelRows(models), rateRows: rateRowsSorted(rows), auxRows: auxRowsSorted(auxRows), bySession, recent };
}
/** Available cached session cells retain usage even if raw history is lost.
 * Hourly/request timestamps cannot be recovered from these cells. */
export function summaryForSessions(summary, sessionIds) {
    const wanted = new Set(sessionIds);
    const bySession = summary.bySession.filter(row => wanted.has(row.sessionId));
    const total = emptyTotals();
    const days = new Map();
    const models = new Map();
    const rated = new Map();
    for (const row of bySession) {
        addTotals(total, row.totals);
        const day = days.get(row.day) ?? emptyTotals();
        addTotals(day, row.totals);
        days.set(row.day, day);
        if (row.model !== '') {
            const model = models.get(row.model) ?? emptyTotals();
            addTotals(model, row.totals);
            models.set(row.model, model);
        }
        const key = rateRowKey(row.day, row.model, row.rate);
        const cell = rated.get(key) ?? { day: row.day, model: row.model, rate: row.rate, totals: emptyTotals() };
        addTotals(cell.totals, row.totals);
        rated.set(key, cell);
    }
    return { total, byDay: dayRows(days), byHour: [], byModel: modelRows(models), rateRows: rateRowsSorted(rated.values()), auxRows: [], bySession,
        recent: summary.recent.filter(row => wanted.has(row.sessionId)) };
}
/**
 * Attach the cost layer to a token-only summary: each rate row is priced at
 * the prices its rate identity resolves to under the current table, folded
 * into per-model costs, the total, the unpriced model list, and the table
 * itself. Purely additive — totals, day rows, and the recent window are
 * returned untouched, so the token aggregation (and the rollup format)
 * never carries currency. Stored identities must match the current context.
 *
 * With a canonical map, byModel rows that hit the same feed model (the
 * modelId or any of its aliases) fold onto that modelId; unpriced names
 * group by their complete case-insensitive name, retaining display spelling. rateRows / byHour / bySession
 * keep the raw name so a later pricing update can regroup without rebuild.
 * @param summary - the aggregated summary (build or filtered).
 * @param pricing - the active pricing table.
 * @param canonical - alias → modelId map; empty / omitted leaves raw names.
 * @returns the same summary plus the cost fields.
 */
export function attachCosts(summary, pricing, canonical = new Map(), context) {
    const costState = summary.costState
        ?? (context?.available === false ? 'pricing-unavailable' : 'ready');
    const rulesOf = (name) => costState !== 'ready' ? undefined
        : context !== undefined ? context.ratesForModel(name) : pricing[name];
    const costs = new Map();
    let totalCost = 0;
    for (const row of summary.rateRows) {
        const rules = rulesOf(row.model);
        if (rules === undefined)
            continue;
        const cost = costOf(row.totals, ratesForKey(rules, row.rate));
        costs.set(row.model, (costs.get(row.model) ?? 0) + cost);
        totalCost += cost;
    }
    // Session cells bill from their own rate identity — the same units the
    // per-model cost folds from, so the session table's cost column and the
    // summary card reconcile without any extra plumbing. An unpriced model's
    // cells stay 0 and surface through unpricedModels as before.
    const bySession = summary.bySession.map(row => {
        const rules = rulesOf(row.model);
        return {
            ...row,
            cost: rules === undefined ? 0 : costOf(row.totals, ratesForKey(rules, row.rate)),
        };
    });
    // The auxiliary layer: the same rate identity pricing as the model rows,
    // folded per kind for the settings page's runtime-overhead tab, and per
    // model inside each kind (the tab renders one detail line per model). Its
    // token totals are already inside the rate rows (so totalCost/cost-per-model
    // include it); this split must never be added to `totalCost` again.
    const auxTotals = emptyTotals();
    let auxTotalCost = 0;
    const auxByKind = new Map();
    for (const row of summary.auxRows ?? []) {
        addTotals(auxTotals, row.totals);
        const rules = rulesOf(row.model);
        const cost = rules === undefined ? 0 : costOf(row.totals, ratesForKey(rules, row.rate));
        auxTotalCost += cost;
        const kindCell = auxByKind.get(row.auxKind)
            ?? { totals: emptyTotals(), cost: 0, byModel: new Map() };
        addTotals(kindCell.totals, row.totals);
        kindCell.cost += cost;
        const modelCell = kindCell.byModel.get(row.model) ?? { totals: emptyTotals(), cost: 0 };
        addTotals(modelCell.totals, row.totals);
        modelCell.cost += cost;
        kindCell.byModel.set(row.model, modelCell);
        auxByKind.set(row.auxKind, kindCell);
    }
    const aux = {
        total: auxTotals,
        cost: auxTotalCost,
        byKind: AUX_KINDS
            .filter(kind => auxByKind.has(kind))
            .map(kind => {
            const cell = auxByKind.get(kind);
            const byModel = [...cell.byModel.entries()]
                .map(([model, value]) => ({ model, totals: value.totals, cost: value.cost }))
                .sort((left, right) => right.totals.requests - left.totals.requests || left.model.localeCompare(right.model));
            return { auxKind: kind, totals: cell.totals, cost: cell.cost, byModel };
        }),
    };
    const folded = new Map();
    for (const row of summary.byModel) {
        const name = canonicalName(row.model, canonical);
        const key = modelKey(name);
        const existing = folded.get(key);
        if (existing === undefined) {
            const totals = emptyTotals();
            addTotals(totals, row.totals);
            folded.set(key, { model: name, totals, cost: costs.get(row.model) ?? 0 });
        }
        else {
            addTotals(existing.totals, row.totals);
            existing.cost += costs.get(row.model) ?? 0;
        }
    }
    const byModel = [...folded.values()]
        .sort((left, right) => right.totals.requests - left.totals.requests || left.model.localeCompare(right.model));
    const unpricedModels = byModel
        .filter(row => context !== undefined ? context.resolveModel(row.model).status !== 'matched' : pricing[row.model] === undefined)
        .map(row => row.model);
    return {
        dataDir: summary.dataDir,
        total: summary.total,
        totalCost,
        costState,
        ...(context?.feedVersion !== undefined ? { feedVersion: context.feedVersion } : {}),
        ...(context?.associations.state === 'unavailable' ? { associationStorageError: context.associations.error } : {}),
        ...(context?.unavailableReason !== undefined ? { pricingUnavailableReason: context.unavailableReason } : {}),
        modelResolutions: context === undefined ? [] : summary.byModel.map(row => context.resolveModel(row.model)),
        unpricedModels,
        pricing,
        byDay: summary.byDay,
        byHour: summary.byHour,
        byModel,
        bySession,
        rateRows: summary.rateRows,
        auxRows: summary.auxRows,
        aux,
        recent: summary.recent,
    };
}
/** How many session rows the route sends, counted after the fold — the
 * truncation that makes folding a server-side concern in the first place. */
export const SESSION_ROW_LIMIT = 1000;
/**
 * Fold the costed per-session cells into the final rows the settings page's
 * session table renders: one row per top-level session with its whole
 * subtree merged in, priced, sorted by cost descending, and truncated to
 * `limit` — the fold changes ranking (a parent row ranks by its subtree's
 * cost), so the cut must see the folded order or it would drop the wrong
 * rows. Subagents never surface as rows of their own; the row's
 * `childCount` badge is their only visibility here (the conversation view's
 * subagent table owns the per-child drill-down).
 *
 * Fold rules all converge on "the sum never changes": a session without a
 * `parentSession` is a root, a parent missing from the cells (or from the
 * index) leaves the child a top-level row, nested subagents walk to the
 * topmost root, and a defensive cut on a parent cycle keeps every row as
 * its own root rather than dropping one. Identity fields (title, cwd) come
 * from the metadata index — the server attaches them so the wire carries
 * final rows and the client never reassembles anything.
 * @param summary - the (already filtered) costed summary.
 * @param meta - the session-metadata index (id → identity fields).
 * @param limit - maximum rows returned.
 * @returns the truncated, cost-descending session rows.
 */
export function buildSessionRows(summary, meta, limit) {
    const cells = new Map();
    for (const cell of summary.bySession) {
        const bucket = cells.get(cell.sessionId) ?? {
            totals: emptyTotals(),
            cost: 0,
            firstTime: dayStart(cell.day),
            lastTime: cell.lastTime,
        };
        addTotals(bucket.totals, cell.totals);
        bucket.cost += cell.cost;
        const dayStartMs = dayStart(cell.day);
        if (dayStartMs < bucket.firstTime)
            bucket.firstTime = dayStartMs;
        if (cell.lastTime > bucket.lastTime)
            bucket.lastTime = cell.lastTime;
        cells.set(cell.sessionId, bucket);
    }
    // Lineage index: a parent the index never saw is the same as no parent.
    const parentOf = new Map();
    for (const [id, entry] of meta) {
        if (entry.parentSession !== undefined && entry.parentSession !== '')
            parentOf.set(id, entry.parentSession);
    }
    // Walk up the lineage to the topmost ancestor that holds cells; a parent
    // outside the cells (no usage in the window, or an orphan) ends the walk,
    // and a `seen` guard turns a pathological cycle into a top-level row.
    const rootOf = (id) => {
        let current = id;
        const seen = new Set([id]);
        for (;;) {
            const parent = parentOf.get(current);
            if (parent === undefined || seen.has(parent) || !cells.has(parent))
                return current;
            seen.add(parent);
            current = parent;
        }
    };
    // Two-pass fold: group every session's accumulation under its root
    // first, then merge each group — order-independent, so iteration order
    // cannot double-count a root or drop a child that landed first.
    const grouped = new Map();
    for (const [id, accum] of cells) {
        const root = rootOf(id);
        const bucket = grouped.get(root) ?? [];
        bucket.push(accum);
        grouped.set(root, bucket);
    }
    const rows = new Map();
    for (const [root, accums] of grouped) {
        const merged = { totals: emptyTotals(), cost: 0, firstTime: accums[0].firstTime, lastTime: accums[0].lastTime };
        for (const accum of accums) {
            addTotals(merged.totals, accum.totals);
            merged.cost += accum.cost;
            if (accum.firstTime < merged.firstTime)
                merged.firstTime = accum.firstTime;
            if (accum.lastTime > merged.lastTime)
                merged.lastTime = accum.lastTime;
        }
        // The root itself is one of the group's sessions (rootOf always lands
        // on a session that holds cells); the rest are its folded descendants.
        rows.set(root, { accum: merged, childCount: accums.length - 1 });
    }
    const entryOf = (id) => {
        const entry = meta.get(id);
        return entry !== undefined && (entry.title !== undefined || entry.cwd !== undefined)
            ? { ...(entry.title !== undefined ? { title: entry.title } : {}), ...(entry.cwd !== undefined ? { cwd: entry.cwd } : {}) }
            : undefined;
    };
    const out = [...rows.entries()].map(([sessionId, { accum, childCount }]) => {
        const entry = entryOf(sessionId);
        return {
            sessionId,
            ...(entry !== undefined ? entry : {}),
            // The folded-descendants badge: a subagent subtree's only visibility
            // in this table (count 0 omits the key entirely).
            ...(childCount > 0 ? { childCount } : {}),
            totals: accum.totals,
            cost: accum.cost,
            firstTime: accum.firstTime,
            lastTime: accum.lastTime,
        };
    });
    out.sort((left, right) => right.cost - left.cost || right.lastTime - left.lastTime
        || (left.sessionId < right.sessionId ? -1 : 1));
    return out.length > limit ? out.slice(0, limit) : out;
}
/**
 * Read every day file into records, in day-file order. An absent data
 * directory (nothing written yet) yields an empty list. Uncached — the
 * session-scoped route uses `readCachedRecords` so repeated chip /
 * usage-tab polls do not re-parse frozen files.
 * @param dir - the plugin's data directory.
 * @returns parsed records, or [] when the directory does not exist.
 */ export async function readAllRecords(dir, logger = consoleLogger) {
    const records = [];
    for (const name of await listDayFiles(dir)) {
        records.push(...await readDayFile(dir, name, logger));
    }
    return records;
}
const summaryQueues = new Map();
/** History sync invalidations share the rebuild queue, including temp files. */
export async function invalidateSummary(dir) {
    const previous = summaryQueues.get(dir) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
        for (const name of [ROLLUP_FILE_NAME, ROLLUP_TMP_FILE_NAME]) {
            await unlink(join(dir, name)).catch((error) => {
                if (error.code !== 'ENOENT')
                    throw error;
            });
        }
    });
    summaryQueues.set(dir, task);
    try {
        await task;
    }
    finally {
        if (summaryQueues.get(dir) === task)
            summaryQueues.delete(dir);
    }
}
export async function buildSummary(dir, now = () => new Date(), resolve = () => UNPRICED_KEY, logger = consoleLogger, pricing) {
    const previous = summaryQueues.get(dir) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(() => buildSummaryLocked(dir, now, resolve, logger, pricing));
    summaryQueues.set(dir, task);
    try {
        return await task;
    }
    finally {
        if (summaryQueues.get(dir) === task)
            summaryQueues.delete(dir);
    }
}
async function buildSummaryLocked(dir, now, resolve, logger, pricing) {
    const today = dayKey(now().getTime());
    const stored = (await readRollup(dir, logger)) ?? emptyRollup();
    const rebuild = stored.requiresRebuild === true || (pricing !== undefined && stored.pricingFingerprint !== pricing.fingerprint);
    const rollup = rebuild ? emptyRollup() : stored;
    const names = await listDayFiles(dir);
    const cold = [];
    const hot = [];
    for (const name of names) {
        const day = fileDay(name);
        if (day <= rollup.upto)
            continue;
        if (day < today || (rebuild && day <= stored.upto))
            cold.push(name);
        else
            hot.push(name);
    }
    let absorbed = rollup;
    const incomplete = async () => {
        logger.warn('[token-usage] historical source records are incomplete; retaining usage and hiding costs');
        const newer = [];
        for (const name of names)
            if (fileDay(name) > stored.upto)
                newer.push(...await readDayFile(dir, name, logger));
        return { dataDir: dir, ...mergeSummaries(stored, summarizeRecords(newer, resolve)), costState: 'history-incomplete' };
    };
    if (rebuild && stored.sourceFiles?.some(name => !names.includes(name)))
        return incomplete();
    if (cold.length > 0) {
        // names are date-ascending, so the last cold file carries the new upto
        const records = [];
        const oldRecords = [];
        for (const name of cold) {
            const parsed = await readDayFileChecked(dir, name, logger);
            if (pricing !== undefined && !parsed.complete)
                return incomplete();
            const rows = parsed.records;
            records.push(...rows);
            if (fileDay(name) <= stored.upto)
                oldRecords.push(...rows);
        }
        if (rebuild && stored.upto !== '') {
            const recovered = summarizeRecords(oldRecords).total;
            const fields = ['requests', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'failures', 'compactions'];
            if (fields.some(field => (recovered[field] ?? 0) < (stored.total[field] ?? 0))) {
                return incomplete();
            }
        }
        absorbed = {
            upto: fileDay(cold[cold.length - 1]),
            ...mergeSummaries(rollup, summarizeRecords(records, resolve)),
            ...(pricing !== undefined ? { pricingFingerprint: pricing.fingerprint } : {}),
            sourceFiles: [...new Set([...rollup.sourceFiles ?? [], ...cold])].sort(),
        };
        if (pricing === undefined || await pricing.isCurrent()) {
            await writeRollup(dir, absorbed).catch((error) => {
                logger.error('[token-usage] cannot write rollup:', error);
            });
        }
    }
    else if (rebuild && (stored.total.requests > 0 || (stored.total.failures ?? 0) > 0)) {
        return incomplete();
    }
    const fresh = [];
    let complete = true;
    for (const name of hot) {
        const parsed = await readDayFileChecked(dir, name, logger);
        fresh.push(...parsed.records);
        complete &&= parsed.complete;
    }
    return { dataDir: dir, ...mergeSummaries(absorbed, summarizeRecords(fresh, resolve)),
        ...(pricing !== undefined && !complete ? { costState: 'history-incomplete' } : {}) };
}
//# sourceMappingURL=stats.js.map