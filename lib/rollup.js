/**
 * The per-day rollup store of the token-usage plugin: an on-disk aggregate of
 * every frozen (pre-today) day file. Live appends go to the event's own day
 * file, so a history sync or refile can write through a frozen file; the
 * stats read drops the rollup after those writes (see index.ts) and rebuilds
 * it. The stats read also advances the rollup lazily: whenever unabsorbed
 * frozen files exist, they are folded in and the rollup is rewritten
 * atomically (temp file + rename, like the sync marker). A missing or
 * malformed rollup simply reads as absent and is rebuilt from the day files.
 *
 * @module token-usage/rollup
 */
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { consoleLogger } from "./log.js";
import { coerceRecord, AUX_KINDS } from "./usage-record.js";
const ROLLUP_FILE = 'rollup.json';
const TMP_FILE = 'rollup.json.tmp';
/** The rollup file name, exported so callers (e.g. the post-sync
 * invalidation in index.ts) can drop the derived state by one authority. */
export { ROLLUP_FILE as ROLLUP_FILE_NAME };
export { TMP_FILE as ROLLUP_TMP_FILE_NAME };
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/u;
function isTotals(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const totals = value;
    return ['requests', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']
        .every(key => typeof totals[key] === 'number' && Number.isFinite(totals[key]));
}
function isDayRow(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const row = value;
    return typeof row.day === 'string' && DAY_KEY.test(row.day) && isTotals(row.totals);
}
const HOUR_KEY = /^\d{4}-\d{2}-\d{2}T\d{2}$/u;
function isHourRow(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const row = value;
    return typeof row.hour === 'string' && HOUR_KEY.test(row.hour)
        && typeof row.model === 'string' && isTotals(row.totals);
}
function isModelRow(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const row = value;
    return typeof row.model === 'string' && isTotals(row.totals);
}
function isRateKey(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const key = value;
    return ['ruleStart', 'ruleEnd', 'tier', 'slot'].every(field => typeof key[field] === 'number' && Number.isFinite(key[field]));
}
function isRateRow(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const row = value;
    return typeof row.day === 'string' && DAY_KEY.test(row.day)
        && typeof row.model === 'string' && isRateKey(row.rate) && isTotals(row.totals);
}
function isSessionRow(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const row = value;
    return typeof row.sessionId === 'string'
        && typeof row.day === 'string' && DAY_KEY.test(row.day)
        && typeof row.model === 'string' && isRateKey(row.rate)
        && typeof row.lastTime === 'number' && Number.isFinite(row.lastTime)
        && isTotals(row.totals);
}
const AUX_KIND_SET = new Set(AUX_KINDS);
function isAuxKind(value) {
    return typeof value === 'string' && AUX_KIND_SET.has(value);
}
function isAuxRow(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const row = value;
    return isAuxKind(row.auxKind)
        && typeof row.day === 'string' && DAY_KEY.test(row.day)
        && typeof row.model === 'string' && isRateKey(row.rate) && isTotals(row.totals);
}
function isRollupFile(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const rollup = value;
    return typeof rollup.upto === 'string' && DAY_KEY.test(rollup.upto)
        && (rollup.pricingFingerprint === undefined || typeof rollup.pricingFingerprint === 'string')
        && (rollup.sourceFiles === undefined || (Array.isArray(rollup.sourceFiles)
            && rollup.sourceFiles.every(name => typeof name === 'string' && /^usage-\d{4}-\d{2}-\d{2}\.jsonl$/u.test(name))))
        && isTotals(rollup.total)
        && Array.isArray(rollup.byDay) && rollup.byDay.every(isDayRow)
        && Array.isArray(rollup.byHour) && rollup.byHour.every(isHourRow)
        && Array.isArray(rollup.byModel) && rollup.byModel.every(isModelRow)
        && Array.isArray(rollup.rateRows) && rollup.rateRows.every(isRateRow)
        && (rollup.auxRows === undefined || (Array.isArray(rollup.auxRows) && rollup.auxRows.every(isAuxRow)))
        // A missing legacy dimension requires a rebuild, but usable totals
        // must survive when the raw history needed for that rebuild is lost.
        && (rollup.bySession === undefined || (Array.isArray(rollup.bySession) && rollup.bySession.every(isSessionRow)))
        && Array.isArray(rollup.recent);
}
/**
 * Load the rollup of one data directory. A missing, malformed, or
 * structurally invalid rollup reads as null — the caller then rebuilds it
 * from the day files, so corruption never blocks the stats read. Invalid
 * entries inside the recent window are dropped instead of failing the whole
 * rollup, mirroring how malformed JSONL lines are skipped.
 * @param dir - the plugin's data directory.
 */
export async function readRollup(dir, logger = consoleLogger) {
    let text;
    try {
        text = await readFile(join(dir, ROLLUP_FILE), 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        logger.error('[token-usage] cannot read rollup:', error);
        return null;
    }
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        // A torn or hand-edited rollup rebuilds from the day files.
        return null;
    }
    if (!isRollupFile(value))
        return null;
    const recent = value.recent
        .map(coerceRecord)
        .filter((record) => record !== null);
    return {
        ...value,
        recent,
        auxRows: value.auxRows ?? [],
        ...(value.bySession === undefined ? { bySession: [], requiresRebuild: true } : {}),
    };
}
/**
 * Persist the rollup atomically (temp file + rename), so a crash mid-write
 * leaves either the old or the new rollup, never a torn one.
 * @param dir - the plugin's data directory.
 * @param rollup - the rollup to persist.
 */
export async function writeRollup(dir, rollup) {
    const target = join(dir, ROLLUP_FILE);
    const tmp = join(dir, TMP_FILE);
    await writeFile(tmp, JSON.stringify(rollup), 'utf8');
    await rename(tmp, target);
}
//# sourceMappingURL=rollup.js.map