/**
 * Token-usage local plugin: a live hook persisting one JSONL row per
 * successful model request. On the FIRST startup the plugin auto-syncs the
 * historical session logs once (requests recorded before the plugin was
 * installed). When a webServer exists, the plugin also serves the stats
 * route backing the web settings page (browser half in `src/client`).
 *
 * The user-editable Config fields (`path`, `pricingRegion`) are declared
 * `.volatile()` so the dsh 0.1.7 settings service projects them into the
 * `token-usage` settings form (the browser card edits them through
 * `configForms`; saves land in the profile patch and commit live through
 * the loader without a plugin reload). A region pick re-resolves the feed
 * URL and re-syncs the mirror; a data directory change switches writes to
 * the new location and migrates every row and companion file across
 * (verbatim file copy, then source cleanup), so no restart and no manual
 * data move is needed.
 *
 * @module token-usage
 */
import type { Context, Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type DirectoryGuardView } from './wire.ts';
export interface Config {
    /** Data directory; defaults to `$DSH_HOME/token-usage` (`~/.dsh/token-usage`). */
    path?: Volatile<string | undefined> | string;
    /** Explicit cloud pricing feed URL mirrored on every startup; wins over
     * every region setting. Defaults to the model-price-table repository the
     * analyzer also pulls from. Composition-only — never projected into the
     * settings form. */
    pricingUrl?: string;
    /** Domestic (China) mirror; defaults to the gitee model-price-table feed.
     * Composition-only. */
    pricingUrlDomestic?: string;
    /** Overseas mirror; defaults to the github model-price-table feed.
     * Composition-only. */
    pricingUrlOverseas?: string;
    /** Which mirror to pull when `pricingUrl` is unset: `domestic` (default,
     * gitee) or `overseas` (github). Set once per install — no IP sniffing. */
    pricingRegion?: Volatile<'domestic' | 'overseas' | undefined> | 'domestic' | 'overseas';
    /** The provider quota feature (the input-bar button): enabled by default,
     * with the poll cadence the host asks the browser to follow.
     * Composition-only. */
    quota?: QuotaConfig;
    /** Whether compaction summarize requests (`compaction/summary` events)
     * are recorded and billed like plain requests (default `true`). `false`
     * skips them in both the live hook and the history sync. Composition-only. */
    recordCompaction?: boolean;
    /** Whether auxiliary (bypass) model requests — Auto review authorization,
     * session-title generation, reasoning translation — are recorded and billed
     * like plain requests (default `true`). Those calls never produce a
     * conversation event, so they are captured on the `llm/stream` waterfall;
     * `false` skips the capture. Composition-only. */
    recordAux?: boolean;
}
/** Composition knobs of the quota feature (cordis.yml level). */
export interface QuotaConfig {
    /** Master switch; `false` stops serving the quota route (the button hides). */
    enabled?: boolean;
    /** Poll cadence the payload stamps (seconds); clamped to 15–3600. */
    intervalSec?: number;
}
/**
 * Loading-time schema of the composition config (the official Cordis shape:
 * a `Config` type plus a same-named standard schema, validated by the loader
 * before `apply` runs). The `.volatile()` fields (`path`, `pricingRegion`)
 * are what the 0.1.7 settings service projects into the settings form — a
 * namespace with no volatile field is skipped by `settings.describe()` and
 * its browser card never appears. Keys stay optional — absent keys stay
 * absent, because the plugin's own resolution (`validateConfig` +
 * section-based defaults) is where defaults and unknown-key rejection live.
 * Schemastery's object keeps unknown keys in non-strict mode, so
 * `validateConfig` remains the loud rejection point for misspelled keys.
 */
export declare const Config: z<any>;
/** Reject stale or misspelled config keys before defaults can hide them. */
export declare function validateConfig(config: Config): void;
/**
 * Resolve the data directory: an explicit `path` wins; otherwise
 * `$DSH_HOME/token-usage` (a blank `$DSH_HOME` counts as unset), else
 * `~/.dsh/token-usage`.
 */
export declare function resolveDataDir(configPath: string | undefined): string;
export declare const name = "token-usage";
export declare const inject: string[];
/** The settings namespace this plugin serves; its browser card spells the same string. */
export declare const TOKEN_USAGE_NS = "token-usage";
/**
 * The settings-facing subset of the config: the data directory and the mirror
 * region pick. `pricingUrlDomestic` / `pricingUrlOverseas` stay
 * composition-entry keys — the plugin still honors them from cordis.yml for
 * self-maintained forks, but a user-facing card should not restate raw feed
 * URLs. A descriptive line about this section lives in the card's copy, not
 * in the document.
 */
export interface SectionConfig {
    /** Data directory; resolved through `resolveDataDir` when absent. */
    path?: string;
    /** Mirror to pull when no explicit `pricingUrl` is set: `domestic` (default) or `overseas`. */
    pricingRegion?: 'domestic' | 'overseas';
}
/** Live facts a section write is vetted against. */
export interface SectionGuard {
    /** Directory currently in force; undefined before the first start. */
    runningDir: string | undefined;
    /** Sessions mid-conversation (an open turn) at validation time. */
    interactingSessions: number;
}
/**
 * Count the sessions still mid-conversation: a session whose event log ends
 * inside an open turn (its last turn event is a `turn/start` with no closing
 * `turn/end`). Existence alone must not count — an idle open tab stays in the
 * store while its conversation ended, and events only append while a turn is
 * open, which is exactly the window that makes a migration unsafe.
 * dsh 0.1.2 made `Session.events` private behind `snapshotEvents()`;
 * callers pass each session's snapshot so this stays a plain duck type.
 * @param eventLogs - each live session's event snapshot (order irrelevant).
 * @returns how many of them are mid-conversation right now.
 */
export declare function countInteractingSessions(eventLogs: readonly (readonly {
    type: string;
}[])[]): number;
/**
 * The refusal facts of one would-be directory save: `blocked` says the
 * section validator would refuse that save right now (a directory change
 * while any session is mid-conversation), `interactingSessions` counts those
 * sessions for the card's notice. The write veto ({@link validateSectionChange})
 * and the browser card's pre-save check (the `dir-guard` route) both answer
 * through this function, so the two can never disagree.
 * @param proposed - the stored path the save would land (`undefined` when the
 * save clears the override back to the default location).
 * @param guard - the running directory and mid-conversation session count.
 * @returns the verdict the card renders.
 */
export declare function directoryGuard(proposed: string | undefined, guard: SectionGuard): DirectoryGuardView;
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map