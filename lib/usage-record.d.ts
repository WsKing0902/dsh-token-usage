/**
 * Pure record vocabulary of the token-usage plugin: the JSONL row type, its
 * projections from session events (assistant messages, compaction
 * summaries, turn-ending LLM failures, and retried failed attempts), and
 * lenient line parsing for the dedupe scan. No I/O and no runtime imports,
 * so every consumer shares
 * one wire format. Rows stay minimal: request id, model, the four base
 * token buckets, time, session id, and the optional origin kind — absent
 * optional buckets are omitted, never null.
 *
 * @module token-usage/usage-record
 */
import type { TokenUsage } from '@deepseek-ai/dsh-llm';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
/** Provider-reported token buckets; absent optional buckets are omitted. */
export interface UsageFields {
    /** Uncached input tokens (billed input = this + cacheRead + cacheWrite). */
    inputTokens: number;
    /** Output tokens. */
    outputTokens: number;
    /** Cache-hit input tokens; omitted when the provider reported none. */
    cacheReadTokens?: number;
    /** Cache-write input tokens; omitted when the provider reported none. */
    cacheWriteTokens?: number;
}
/**
 * Where a record came from: a plain model request (the default), a
 * compaction summarize request (a provider-billed call of its own), a
 * failed model request (a turn that ended in an LLM error, or a provider
 * attempt that `dsh-llm-retry` scheduled a retry for — counted in its own
 * `failures` dimension, never in `requests`), or an auxiliary request (a
 * bypass model call that is not part of the conversation turn: the Auto
 * review authorization gate, session-title generation, or reasoning
 * translation).
 */
export type UsageRecordKind = 'request' | 'compaction' | 'failure' | 'aux';
/**
 * The origin of one auxiliary (bypass) model request. These calls are
 * issued by host packages directly through `ctx.llm.stream()` and never
 * produce a conversation event, so the recorder captures them on the
 * `llm/stream` waterfall instead:
 *
 * - `auto-review` — the per-tool-call authorization reviewer of
 *   `@deepseek-ai/dsh-experimental-auto-review`.
 * - `session-title` — the logged `session/title-llm-request` generation
 *   (`purpose: 'session-title'` on the request).
 * - `translation` — the reasoning/CoT translator
 *   (`@deepseek-ai/dsh-experimental-translator`).
 * - `other` — any other unmarked bypass request. A defensive bucket: DSH
 *   gives Auto review and the translator no purpose marker, so their
 *   identification is prompt-text based and a host upgrade can move them
 *   here without dropping the usage data.
 */
export type AuxKind = 'auto-review' | 'session-title' | 'translation' | 'other';
/** Every auxiliary kind, in the fixed display order the tables use. */
export declare const AUX_KINDS: readonly AuxKind[];
/** One JSONL row: one provider model call (successful or failed). */
export interface UsageRecord {
    /** Stable request identity: the assistant message id (dedupe key), a
     * synthesized `failure:<session>:<seq>` for a failed-request row, or
     * `aux:<kind>:<startedAt>:<seq>` for an auxiliary row. */
    requestId: string;
    /** Session-event wall time, epoch milliseconds. */
    time: number;
    /** Owning session id; '' for an auxiliary row (no conversation owns a
     * bypass call — see the kind field). */
    sessionId: string;
    /** Provider model id that produced the message; a failure row carries the
     * session's last-known route model ('' when none was ever observed). */
    model: string;
    /** Token buckets; omitted when the provider reported no usage at all. */
    usage?: UsageFields;
    /** Record origin; absent means a plain request (legacy rows predate the
     * key, so the on-disk default is omission, never `'request'`). */
    kind?: UsageRecordKind;
    /** Auxiliary row only: which bypass call produced it. Absent on every
     * other kind; a future unknown value normalizes to `'other'` on read. */
    auxKind?: AuxKind;
    /** Failure row only: the provider-neutral `LlmFailure.code` the attempt
     * failed with (RATE_LIMIT, TRANSPORT, QUOTA, …). Absent on every other
     * kind; a future code renders verbatim. */
    failureCode?: string;
    /** Wall time in milliseconds from request dispatch (`step/start`) to message settlement (`assistant/message`). */
    latencyMs?: number;
    /** Wall time in milliseconds from request dispatch (`step/start`) to the first non-empty token delta chunk. */
    firstTokenLatencyMs?: number;
}
/** Optional timing figures for one model request. */
export interface RequestTiming {
    /** Wall time in milliseconds from request dispatch (`step/start`) to message settlement (`assistant/message`). */
    latencyMs?: number;
    /** Wall time in milliseconds from request dispatch (`step/start`) to the first non-empty token delta chunk. */
    firstTokenLatencyMs?: number;
}
/** Whether a stream chunk carries a non-empty first-token delta. */
export declare function isTokenDelta(chunk: unknown): boolean;
/**
 * Extract the timestamp of the first token delta from an assistant stream run/chunks array.
 * Mirrors DSH llm assistantStreamFirstTokenTime for durable compact streams.
 */
export declare function extractFirstTokenTimeFromStream(stream: unknown): number | undefined;
/**
 * Project the event's optional provider usage into the four base buckets.
 * A missing record or an invalid required bucket renders the whole usage
 * absent: the row still records the request, but its numbers are not trusted.
 */
export declare function projectUsage(usage: TokenUsage | undefined): UsageFields | undefined;
/** Build the log row for one assistant/message session event. */
export declare function recordFromEvent(event: SessionEvent<'assistant/message'>, sessionId: string, timing?: RequestTiming): UsageRecord;
/**
 * Build the log row for one `compaction/summary` session event — the
 * summarize provider call that reads the compacted history and writes the
 * summary. The row is billed exactly like a plain request: `model` is the
 * event's summarize model, and the usage buckets are the provider-reported
 * figures for the call. A missing or invalid usage renders the record null:
 * an unusage compaction cannot be priced, and `shadowedTokenCount` (the
 * shadow price of the replaced context) is not a billing figure, so the
 * event is skipped rather than recorded unpriced.
 *
 * The request id is `compaction:<sessionId>:<seq>` — the event's persistent
 * seq is monotonic and unique within the session (the compactionId is an
 * opaque, unvalidated string), so one row lands per compaction and repeated
 * syncs dedupe.
 * @returns the record, or null when the event carries no usable usage.
 */
export declare function recordFromCompaction(event: SessionEvent<'compaction/summary'>, sessionId: string): UsageRecord | null;
/** One JSONL line without the trailing newline. */
export declare function serializeRecord(record: UsageRecord): string;
/**
 * Build the log row for one `turn/end` session event whose reason is an LLM
 * error — the terminal failed model request of a turn. Only
 * `reason.kind === 'error'` counts: an aborted turn was cancelled by the
 * user/parent (not a provider failure), `max-tokens` truncated a request
 * that otherwise succeeded, and `blocked`/`interrupted` never reached the
 * provider. Intermediate attempts that `dsh-llm-retry` recovered are
 * recorded separately via {@link recordFromRetry}. The row carries no
 * usage (a failed call bills nothing), the `model` the caller tracked for
 * the session's route — `turn/end` itself names no model, so the recorder
 * follows `request/context` / `assistant/message` events to keep one
 * last-known model id per session — and the provider-neutral
 * `failureCode` (the `LlmFailure.code`, e.g. RATE_LIMIT / TRANSPORT /
 * QUOTA) the failure classifier assigned.
 * @returns the record, or null when the turn ended for a non-error reason.
 */
export declare function recordFromTurnEnd(event: SessionEvent<'turn/end'>, sessionId: string, model: string): UsageRecord | null;
/**
 * Build the log row for one `llm/retry` session event — a provider attempt
 * that failed and that `dsh-llm-retry` scheduled another try for. Every
 * such event is a real failed call (the plugin writes it before the wait,
 * so a later cancel during backoff still counts the original attempt).
 * The row carries no usage; `model` is the session's last-known route
 * (the event names the provider, not the model); `failureCode` is the
 * `LlmFailure.code` on the payload. `llm/retry-started` is the wait-
 * complete marker and is not a failure — the caller ignores it.
 */
export declare function recordFromRetry(event: SessionEvent<'llm/retry'>, sessionId: string, model: string): UsageRecord;
/**
 * Project one session event into a log row, or null when the event is not
 * a recorded origin. Live listening and history sync share this so a new
 * origin cannot land on only one path. `lastModel` is the session's last
 * known route (failure rows name no model of their own); compaction
 * recording follows the same `recordCompaction` switch both callers take.
 */
export declare function recordOfEvent(event: SessionEvent, sessionId: string, lastModel: string, recordCompaction?: boolean, timing?: RequestTiming): UsageRecord | null;
/**
 * The model id an event reveals about the session's current route, when it
 * does: `request/context` announces route changes before dispatch (it logs
 * only on change), and `assistant/message` confirms the model that actually
 * produced a message. Both fold into the same last-known value, so a turn
 * that ends in an error can still attribute its failure row to a model.
 */
export declare function modelOfEvent(event: SessionEvent): string | undefined;
/**
 * Coerce an unknown value into a record, normalizing extra fields and null
 * buckets to omission, so rows written by older field sets still dedupe
 * (their request id is absorbed) without being rewritten.
 * @returns the record, or null when the value is not a valid row.
 */
export declare function coerceRecord(value: unknown): UsageRecord | null;
/**
 * Parse one JSONL line back into a record. Extra fields are ignored and null
 * buckets are normalized to omission (see {@link coerceRecord}).
 * @returns the record, or null when the line is not a valid row.
 */
export declare function parseRecord(line: string): UsageRecord | null;
//# sourceMappingURL=usage-record.d.ts.map