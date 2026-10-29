/**
 * Session-metadata index of the token-usage plugin: `sessions.json` in the
 * data directory, mapping sessionId → the identity fields the settings
 * page's session table renders — the log-backed latest-wins `session/title`
 * text (folded by this plugin, not by the host's title package) and the
 * immutable `SessionHeader` facts (cwd, subagent origin, parent session).
 *
 * The index is a derived cache: every field is recoverable from the session
 * logs, so a missing or malformed file reads as empty and the next manual
 * or automatic full sync rebuilds it — no incremental repair. Writes go
 * through one serialized queue (concurrent upserts cannot trample each
 * other) and land atomically (temp file + rename), and reads carry an
 * mtime stamp cache so the hot stats route never reparses an unchanged
 * file. The file lives inside the data directory and moves with it.
 *
 * @module token-usage/session-meta
 */
import { type LoggerLike } from './log.ts';
/** One session's identity fields; absent fields are omitted, never null. */
export interface SessionMeta {
    /** Latest `session/title` text (host-normalized); omitted when the log
     * never carried a title event (some subagents, old data). */
    title?: string;
    /** Session header's working directory; omitted when the header had none. */
    cwd?: string;
    /** Coarse subagent classification from the header; omitted for
     * top-level sessions (the only value today is `'subagent'`). */
    origin?: 'subagent';
    /** The parent session of a subagent child, from the header. */
    parentSession?: string;
}
/** The on-disk shape: one entry per known session id. */
export type SessionMetaIndex = Record<string, SessionMeta>;
/**
 * Read/write access to one data directory's session-metadata index.
 * Reads hit an mtime-stamp cache; writes serialize on one promise chain
 * and persist atomically. Every failure degrades to "empty index" —
 * the next full sync rebuilds the file from the logs.
 */
export declare class SessionMetaStore {
    private readonly dir;
    private readonly logger;
    private cache;
    private queue;
    constructor(dir: string, logger?: LoggerLike);
    /** Drop the cached parse (data-directory relocation, test seams). */
    invalidate(): void;
    /**
     * Read the index. A missing, malformed, or partially unusable file reads
     * as the entries that survived coercion (an empty object when none do) —
     * the index is rebuildable, so corruption never blocks a stats read.
     */
    read(): Promise<SessionMetaIndex>;
    /**
     * Merge one session's fields into the index. Every field is latest-wins
     * per key: a title upsert overwrites (the caller folds the title events),
     * and header facts are idempotent (the header is immutable). A patch
     * whose values all match the current index is a no-op, so repeated syncs
     * and live ticks do not rewrite the file. Serialized: a second upsert
     * waits for the first's read-merge-write to settle.
     */
    upsert(id: string, patch: SessionMeta): Promise<void>;
    /** Settle every queued write (the migration's quiescence point). */
    flush(): Promise<void>;
    /** Persist atomically: a crash mid-write leaves the old or the new file. */
    private write;
}
//# sourceMappingURL=session-meta.d.ts.map