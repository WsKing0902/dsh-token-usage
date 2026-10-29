/**
 * One-shot initialization markers: whether the plugin ever completed a
 * history sync (`initializedAt`) and whether a sync has since folded the
 * session metadata (titles, header facts) into `sessions.json`
 * (`metaSyncedAt`). The markers exist only to gate automatic runs; every
 * later sync is the user's decision (the manual command). A missing or
 * malformed marker reads as unmet: the next startup re-runs the gated
 * work, whose dedupe and idempotent upserts make the repetition a no-op.
 *
 * @module token-usage/sync-state
 */
import { type LoggerLike } from './log.ts';
/** Contents of the marker file. `metaSyncedAt` is optional: installs that
 * predate the session table never wrote it, and its absence is exactly the
 * "one metadata backfill still owed" condition. `timingSyncedAt` is optional:
 * installs that predate request timing backfill never wrote it. */
export interface SyncState {
    /** Epoch milliseconds when the first automatic sync completed. */
    initializedAt: number;
    /** Epoch milliseconds when a sync last folded session metadata into
     * `sessions.json`; absent on pre-session-table installs. */
    metaSyncedAt?: number;
    /** Epoch milliseconds when timing figures (latencyMs, firstTokenLatencyMs)
     * were backfilled into day files; absent on pre-timing installs. */
    timingSyncedAt?: number;
}
/**
 * Read the marker file. A missing or malformed file reads as null — the
 * caller treats that as unmet and re-runs the gated work idempotently.
 * @param dir - the data directory holding the marker.
 */
export declare function readSyncState(dir: string, logger?: LoggerLike): Promise<SyncState | null>;
/**
 * Whether the first automatic sync already completed. A missing or
 * malformed marker reads as uninitialized: the next startup re-runs the
 * sync, whose dedupe makes the repetition a no-op.
 * @param dir - the data directory holding the marker.
 */
export declare function isInitialized(dir: string, logger?: LoggerLike): Promise<boolean>;
/**
 * Persist the marker file atomically (temp file + rename), so a crash
 * mid-write never leaves a torn marker that would misread as settled.
 * Fields absent from `state` are omitted, never null.
 * @param dir - the data directory holding the marker.
 * @param state - the marker contents to write.
 */
export declare function writeSyncState(dir: string, state: SyncState): Promise<void>;
/**
 * Persist the initialized marker (and, when the caller says the same run
 * folded the metadata or timing, their markers alongside it). An existing
 * `metaSyncedAt` or `timingSyncedAt` survives: the first-sync write must not
 * revoke a backfill an earlier upgrade already completed.
 * @param dir - the data directory holding the marker.
 * @param now - clock source (test seam).
 * @param withMeta - whether this run also folded session metadata.
 * @param withTiming - whether this run also wrote timing figures.
 */
export declare function markInitialized(dir: string, now?: () => Date, withMeta?: boolean, withTiming?: boolean): Promise<void>;
/**
 * Stamp the metadata backfill as done, preserving `initializedAt` and `timingSyncedAt`.
 * @param dir - the data directory holding the marker.
 * @param now - clock source (test seam).
 */
export declare function markMetaSynced(dir: string, now?: () => Date): Promise<void>;
/**
 * Stamp the timing backfill as done, preserving `initializedAt` and `metaSyncedAt`.
 * @param dir - the data directory holding the marker.
 * @param now - clock source (test seam).
 */
export declare function markTimingSynced(dir: string, now?: () => Date): Promise<void>;
//# sourceMappingURL=sync-state.d.ts.map