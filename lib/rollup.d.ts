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
import { type LoggerLike } from './log.ts';
import type { UsageRecord } from './usage-record.ts';
import type { UsageAuxRow, UsageDayRow, UsageHourRow, UsageModelRow, UsageRateRow, UsageSessionRow, UsageTotals } from './wire.ts';
declare const ROLLUP_FILE = "rollup.json";
declare const TMP_FILE = "rollup.json.tmp";
/** The rollup file name, exported so callers (e.g. the post-sync
 * invalidation in index.ts) can drop the derived state by one authority. */
export { ROLLUP_FILE as ROLLUP_FILE_NAME };
export { TMP_FILE as ROLLUP_TMP_FILE_NAME };
/** The on-disk rollup: the aggregate of every day file named ≤ {@link RollupFile.upto}. */
export interface RollupFile {
    /** In-memory marker for readable legacy aggregates missing session cells. */
    requiresRebuild?: true;
    /** Identification algorithm and feed rules used to select stored RateKeys. */
    pricingFingerprint?: string;
    /** Files absorbed into this snapshot, used to detect unavailable history. */
    sourceFiles?: string[];
    /** Inclusive upper date (`YYYY-MM-DD`) of the day files already absorbed. */
    upto: string;
    /** Totals over every absorbed record. */
    total: UsageTotals;
    /** Per-local-day rows of the absorbed records, ascending by day. */
    byDay: UsageDayRow[];
    /** Per-hour × per-model rows of the absorbed records, ascending by hour
     * then model — feeds the single-day hourly trend chart without rereading
     * the frozen day files. */
    byHour: UsageHourRow[];
    /** Per-model rows of the absorbed records, descending on request count. */
    byModel: UsageModelRow[];
    /** Per-(day, model, rate identity) rows of the absorbed records — rule
     * identities, never prices; a changed pricing fingerprint rebuilds them
     * from raw records before repricing the absorbed history. */
    rateRows: UsageRateRow[];
    /** Per-(kind, day, model, rate identity) rows of the absorbed auxiliary
     * (bypass) requests — the settings page's runtime-overhead dimension. A
     * legacy rollup predating the dimension reads as an empty list: the
     * version that wrote it could not have recorded an auxiliary row, so no
     * absorbed usage is lost. */
    auxRows: UsageAuxRow[];
    /** Per-(session, day, model, rate identity) rows of the absorbed records
     * — the session dimension the settings page's session table folds from.
     * A legacy rollup missing this dimension retains usable totals but
     * requires a rebuild; unavailable source history hides unreliable costs. */
    bySession: UsageSessionRow[];
    /** The newest absorbed records, descending by time (bounded window). */
    recent: UsageRecord[];
}
/**
 * Load the rollup of one data directory. A missing, malformed, or
 * structurally invalid rollup reads as null — the caller then rebuilds it
 * from the day files, so corruption never blocks the stats read. Invalid
 * entries inside the recent window are dropped instead of failing the whole
 * rollup, mirroring how malformed JSONL lines are skipped.
 * @param dir - the plugin's data directory.
 */
export declare function readRollup(dir: string, logger?: LoggerLike): Promise<RollupFile | null>;
/**
 * Persist the rollup atomically (temp file + rename), so a crash mid-write
 * leaves either the old or the new rollup, never a torn one.
 * @param dir - the plugin's data directory.
 * @param rollup - the rollup to persist.
 */
export declare function writeRollup(dir: string, rollup: RollupFile): Promise<void>;
//# sourceMappingURL=rollup.d.ts.map