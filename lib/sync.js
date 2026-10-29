/**
 * History sync: replay every persisted session log and append the request
 * rows the log does not already hold, deduped by request id. Rows come from
 * `assistant/message` events (plain requests), `compaction/summary` events
 * (the summarize provider calls, unless disabled), `turn/end` events
 * whose reason is an LLM error (terminal failed requests), and `llm/retry`
 * events (failed attempts that the retry plugin then scheduled another try
 * for). The sync runs automatically ONCE, on the first startup after
 * installation (gated by the initialized marker). A session whose stored
 * log fails to load or validate is skipped and counted, never fatal to
 * the run — one unreadable file must not keep the rest of the history
 * out of the ledger.
 *
 * Reads go through whichever persistence seam the running host exposes: the
 * handle generation (`dsh` 0.1.3-alpha.1 and later, `open`/`read`/`close`) or
 * the older inspect generation (`dsh` 0.1.2-rc.1 and earlier, `inspect`). One
 * probe per run picks the seam, so a single build walks history on both.
 *
 * @module token-usage/sync
 */
import { markInitialized, markMetaSynced, readSyncState } from "./sync-state.js";
import { extractFirstTokenTimeFromStream, modelOfEvent, recordOfEvent } from "./usage-record.js";
/**
 * Probe which persistence seam the running host exposes and normalize it.
 *
 * The probe runs once per sync, never once per session: a host does not change
 * generation mid-process, and probing per session would report a wholesale
 * mismatch as N individually unreadable sessions — precisely the silent
 * failure the two seams invite.
 * @param persistence - the host's `ctx.sessionPersistence` (or a test twin).
 * @returns the normalized reader.
 * @throws {Error} when the persistence exposes neither seam (a host older or
 * newer than either generation), which must fail loudly rather than report
 * every session as unreadable.
 */
export function readerOf(persistence) {
    const { open, inspect } = persistence;
    const idOf = (entry) => 'header' in entry ? entry.header.id : entry.id;
    if (typeof open === 'function') {
        return {
            async list(signal) {
                return (await persistence.list(signal === undefined ? {} : { signal })).map(idOf);
            },
            async read(id, signal) {
                const handle = await open.call(persistence, id, 'read', signal === undefined ? {} : { signal });
                try {
                    const { events } = await handle.read();
                    return { events, meta: handle.header };
                }
                finally {
                    // Best-effort teardown: the rows are already collected, so a failing
                    // close must not turn a good read into an unreadable session. It
                    // still has to run on every path — the host counts a leaked read
                    // handle as a resource leak.
                    await handle.close().catch(() => { });
                }
            },
        };
    }
    if (typeof inspect === 'function') {
        return {
            async list(signal) {
                return (await persistence.list(signal)).map(idOf);
            },
            async read(id, signal) {
                return await inspect.call(persistence, id, signal);
            },
        };
    }
    throw new Error('token-usage: sessionPersistence exposes neither open() (dsh 0.1.3-alpha.1+) nor inspect() (dsh <= 0.1.2-rc.1)');
}
/**
 * The latest-wins `session/title` text of one event, or undefined: the
 * event type is host-merged (`dsh-session-title`), so the plugin reads the
 * payload duck-typed and tolerantly — a non-string or empty title is
 * skipped, never fabricated. Exported for the live recorder, which folds
 * the same event into the same index.
 */
export function titleOfEvent(event) {
    if (event.type !== 'session/title')
        return undefined;
    const title = event.data?.title;
    return typeof title === 'string' && title !== '' ? title : undefined;
}
/**
 * Append every missing request row. The log's dedupe set is rebuilt from the
 * data files first, so a second run is a no-op and rows recorded live in a
 * previous process are not duplicated.
 * @param deps - persistence and the shared log.
 * @param onTick - optional progress callback; fires once before the first
 * session (with `processed: 0` and the final `total`), then once per session
 * as it finishes. The card passes this to drive its progress bar; the
 * one-shot startup sync omits it.
 * @param signal - cancellation; an aborted run throws `AbortError`.
 */
export async function syncHistory(deps, onTick, signal) {
    await deps.log.scan();
    // Snapshot before the walk: only rows already saved are reconcile
    // candidates, so a request landing live mid-walk is never deleted.
    const eligible = deps.log.ids();
    const reader = readerOf(deps.persistence);
    const sessions = await reader.list(signal);
    let added = 0;
    let skipped = 0;
    let removed = 0;
    let failedSessions = 0;
    const total = sessions.length;
    let processed = 0;
    /** Every id this walk reproduces; the reconcile pass keeps exactly these. */
    const reproduced = new Set();
    /** Sessions this walk read in full. Only their rows may be reconciled: a
     * row whose session is missing from the list (deleted, or hidden behind a
     * header this build cannot read) is never dropped for its absence. */
    const readable = new Set();
    onTick?.({ processed, total, added, skipped, removed, failedSessions });
    for (const id of sessions) {
        signal?.throwIfAborted();
        // One unreadable session log (a format the current dsh build rejects,
        // a torn file, …) must not abort the whole walk: skip the session,
        // report it, and let the rest of the history land.
        let inspection;
        try {
            inspection = await reader.read(id, signal);
        }
        catch (error) {
            // A cancellation is the caller's (or the host read path's) abort —
            // always fatal to the run, never a session to skip.
            if (signal?.aborted || (error instanceof Error && error.name === 'AbortError'))
                throw error;
            failedSessions += 1;
            processed += 1;
            deps.onSessionFailure?.(id, error);
            onTick?.({ processed, total, added, skipped, removed, failedSessions });
            continue;
        }
        // The session was read in full: this walk is now the authority for what
        // the ledger must hold, so its stale coordinates become droppable.
        readable.add(id);
        // Last-known route model of this session: failure rows need a model to
        // attribute, and turn/end names none, so the walk follows the same
        // request/context + assistant/message events the live recorder does.
        let model = '';
        // Latest-wins title: title events append in seq order, so the LAST one
        // seen is the current title — a rename, an auto-generated title, and a
        // fallback all land as the same append, one fold covers every source.
        let title;
        let openStep = null;
        for (const event of inspection.events) {
            signal?.throwIfAborted();
            if (event.type === 'step/start') {
                openStep = {
                    turn: event.data.turn,
                    step: event.data.step,
                    startTime: event.time,
                };
            }
            const revealed = modelOfEvent(event);
            if (revealed !== undefined)
                model = revealed;
            const revealedTitle = titleOfEvent(event);
            if (revealedTitle !== undefined)
                title = revealedTitle;
            let timing;
            if (event.type === 'assistant/message'
                && openStep !== null
                && openStep.turn === event.data.turn
                && openStep.step === event.data.step) {
                const latencyMs = Math.max(0, event.time - openStep.startTime);
                // dsh 0.1.7 embeds the timed model stream inside assistant/message;
                // the first token delta's timestamp is read from those compact records.
                const firstTokenTime = 'stream' in event.data && event.data.stream
                    ? extractFirstTokenTimeFromStream(event.data.stream)
                    : undefined;
                const firstTokenLatencyMs = firstTokenTime !== undefined
                    ? Math.max(0, firstTokenTime - openStep.startTime)
                    : undefined;
                timing = {
                    latencyMs,
                    ...(firstTokenLatencyMs !== undefined ? { firstTokenLatencyMs } : {}),
                };
                openStep = null;
            }
            else if (event.type === 'step/end' || event.type === 'turn/end') {
                openStep = null;
            }
            const record = recordOfEvent(event, id, model, deps.recordCompaction !== false, timing);
            if (record === null)
                continue;
            // Keep the id whether the row was already saved or lands now: the
            // reconcile pass keeps exactly the ids this walk produced.
            reproduced.add(record.requestId);
            if (await deps.log.record(record))
                added += 1;
            else
                skipped += 1;
        }
        // One metadata upsert per session: the title fold above plus the
        // immutable header facts. The upsert is a no-op when nothing changed,
        // so repeat syncs never rewrite the index.
        if (deps.meta !== undefined) {
            const header = inspection.meta;
            const patch = {
                ...(title !== undefined ? { title } : {}),
                ...(header?.cwd !== undefined && header.cwd !== '' ? { cwd: header.cwd } : {}),
                ...(header?.origin !== undefined ? { origin: header.origin } : {}),
                ...(header?.parentSession !== undefined && header.parentSession !== '' ? { parentSession: header.parentSession } : {}),
            };
            if (Object.keys(patch).length > 0)
                await deps.meta.upsert(id, patch);
        }
        processed += 1;
        onTick?.({ processed, total, added, skipped, removed, failedSessions });
    }
    // Reconcile last, once every readable session has spoken for its rows: a
    // saved row no readable session reproduces is a relic of an older stored
    // format. A session that merely failed to load protects its own rows.
    if (deps.reconcile !== false) {
        removed = await deps.log.reconcile(reproduced, readable, eligible);
    }
    return { added, skipped, removed, failedSessions };
}
/**
 * Run the gated automatic work, then persist the markers:
 * - No `initializedAt` — the first-run backfill: one full sync (which also
 *   folds the metadata), then both markers land together.
 * - `initializedAt` present, `metaSyncedAt` absent — a pre-session-table
 *   install owes exactly one metadata backfill: run the same sync once
 *   more (every usage row dedupes to a no-op write; the walk lands the
 *   titles and header facts the old build never stored), then stamp
 *   `metaSyncedAt`.
 * - Both markers present — nothing to do.
 * A crash before the marker write leaves the marker absent, so the next
 * startup re-runs — a no-op thanks to dedupe and idempotent upserts.
 * @param deps - persistence and the shared log (with the metadata sink).
 * @param dir - the data directory holding the markers.
 * @returns the sync outcome, or null when both markers were already set.
 */
export async function autoSyncIfNeeded(deps, dir) {
    const state = await readSyncState(dir);
    if (state !== null && state.metaSyncedAt !== undefined)
        return null;
    const result = await syncHistory({ ...deps, reconcile: false });
    if (state === null)
        await markInitialized(dir, undefined, true, true);
    else
        await markMetaSynced(dir);
    return result;
}
//# sourceMappingURL=sync.js.map