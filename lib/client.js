window.__ModuleLoader__.load({
	id: "@laoyuehanni/dsh-token-usage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region src/wire.ts
		/** The stats endpoint path, served by the host half's webServer route. */
		const STATS_PATH = "/token-usage/stats";
		/** The pricing-overview endpoint path: the full cloud-mirror model list,
		* filter-free by design — the overview is not a filtered usage view. */
		const PRICING_PATH = "/token-usage/pricing";
		const PRICING_SYNC_PATH = "/token-usage/pricing-sync";
		const ASSOCIATIONS_PATH = "/token-usage/pricing-associations";
		/** Encode one repeated query key (`sessionId=a&sessionId=b`). Empty list yields ''. */
		function encodeRepeatedParam(key, values) {
			return values.map((value) => `${key}=${encodeURIComponent(value)}`).join("&");
		}
		/** Encode child groups as repeated `childId=<id>[,member…]` parameters. */
		function encodeChildGroups(groups) {
			return groups.filter((group) => group.length > 0 && group[0] !== "").map((group) => `childId=${encodeURIComponent(group.join(","))}`).join("&");
		}
		/**
		* Build the stats query string (including the leading `?`, or '' when
		* unconstrained). `fields: 'full'` is omitted — that is the default the
		* settings page already hits.
		*/
		function encodeStatsQuery(options) {
			const parts = [];
			if (options.sessionIds !== void 0 && options.sessionIds.length > 0) parts.push(encodeRepeatedParam("sessionId", options.sessionIds));
			const children = options.childGroups !== void 0 ? encodeChildGroups(options.childGroups) : "";
			if (children !== "") parts.push(children);
			if (options.fields !== void 0 && options.fields !== "full") parts.push(`fields=${options.fields}`);
			return parts.length === 0 ? "" : `?${parts.join("&")}`;
		}
		/**
		* The quota endpoint path: the input-bar quota button polls this for the
		* current provider's rate-limit / balance snapshot. Served by the host
		* half's quota route; the query carries `?session=<id>` so the host can
		* resolve the provider the ACTIVE session is using.
		*/
		const QUOTA_PATH = "/token-usage/quota";
		/** The migration-progress endpoint path, polled by the browser card. */
		const MIGRATION_PATH = "/token-usage/migration";
		/**
		* The directory-guard endpoint path, consulted by the browser card before a
		* staged directory save commits. The settings wire swallows a refused write
		* (the bound scope recovers silently and never rejects), so this route is the
		* one channel that can tell the card WHY a save would not land.
		*/
		const DIR_GUARD_PATH = "/token-usage/dir-guard";
		/**
		* The full-sync endpoint path: the card's manual "scan again" affordance.
		* `POST` starts one full scan over every session log (the same scan the
		* one-shot startup sync ran on first install — list + read + dedupe), and
		* `GET` returns the live progress. The scan is fire-and-forget on the host
		* side, so the card polls while it runs.
		*/
		const FULL_SYNC_PATH = "/token-usage/full-sync";
		//#endregion
		//#region src/client/card-form.ts
		/** Fallback target when neither configForms nor settingsScope is present in the host. */
		function createFallbackTarget() {
			return {
				getSnapshot: () => ({
					status: "unavailable",
					writable: false
				}),
				subscribe: () => () => {},
				set: async () => false,
				unset: async () => false
			};
		}
		/** The fields this card edits. */
		const CARD_FIELDS = ["path", "pricingRegion"];
		/**
		* Stages the settings edits over the `token-usage` scope.
		*
		* The form publishes through a snapshot store because the slot component
		* reads through a snapshot selector while both the scope and the local drafts
		* change underneath; every projection is rebuilt from the two together. Only
		* fields the user touched are staged, so a save writes a sparse patch and
		* never restates fields it did not see.
		*/
		var CardForm = class {
			target;
			snapshotValue;
			listeners = /* @__PURE__ */ new Set();
			drafts = {};
			saving = false;
			failed = false;
			refusal;
			migrationView;
			pollTimer;
			/**
			* @param target - the configuration source backing the card (ConfigForm or SettingsScope).
			*/
			constructor(target) {
				this.target = target;
				this.snapshotValue = this.project();
				target.subscribe(() => {
					this.publish();
				});
				this.pollMigration();
			}
			/** @returns the store the card's component reads through its bound selector. */
			bind() {
				return {
					getSnapshot: () => this.snapshotValue,
					subscribe: (listener) => {
						this.listeners.add(listener);
						return () => {
							this.listeners.delete(listener);
						};
					},
					set: (next) => {
						this.store(next);
					}
				};
			}
			/** @returns the edit, clear, save, and discard actions bound to this form. */
			actions() {
				return {
					editField: (field, text) => {
						this.drafts[field] = text;
						this.failed = false;
						this.refusal = void 0;
						this.publish();
					},
					clearField: (field) => {
						this.drafts[field] = "";
						this.failed = false;
						this.refusal = void 0;
						this.publish();
					},
					save: () => {
						this.save();
					},
					discard: () => {
						if (Object.keys(this.drafts).length === 0 && !this.failed) return;
						this.drafts = {};
						this.failed = false;
						this.refusal = void 0;
						this.publish();
					}
				};
			}
			/**
			* Write the staged edits, then re-seed from what the Host accepted.
			*
			* The Host is the only authority on acceptance — an empty draft clears the
			* field, anything else stores the trimmed text (so blanking a control and
			* saving is the same gesture as clearing it). A save that did not land keeps
			* its drafts so the user can correct it instead of retyping. A landed save
			* that moved the data directory starts the migration poll: the Host
			* relocates as a two-phase commit and the card shows the file progress
			* until it settles.
			*
			* A staged directory edit is vetted through the plugin's guard route
			* before anything writes, and re-checked when the write did not land: the
			* settings wire swallows a refused write (the bound scope recovers
			* silently), so the guard is the only channel that can name the refusal —
			* otherwise the card could only say "did not land".
			*/
			async save() {
				const edited = CARD_FIELDS.filter((field) => this.drafts[field] !== void 0);
				if (edited.length === 0 || this.saving) return;
				const intended = edited.map((field) => [field, this.drafts[field].trim()]);
				this.saving = true;
				this.failed = false;
				this.refusal = void 0;
				this.publish();
				const pathEdit = intended.find(([field]) => field === "path");
				if (pathEdit !== void 0) {
					const blocked = await this.guard(pathEdit[1]);
					if (blocked !== void 0) {
						this.saving = false;
						this.failed = true;
						this.refusal = blocked;
						this.publish();
						return;
					}
				}
				let landed = true;
				try {
					for (const [field, text] of intended) if (text === "") await this.target.unset(field);
					else await this.target.set(field, text);
					for (const [field, text] of intended) if (text === "" ? this.stored(field) : this.storedValue(field) !== text) {
						landed = false;
						break;
					}
				} catch (_settingsWriteFailure) {
					landed = false;
				}
				if (!landed && pathEdit !== void 0) {
					const blocked = await this.guard(pathEdit[1]);
					if (blocked !== void 0) this.refusal = blocked;
				}
				if (landed) for (const [field, _text] of intended) delete this.drafts[field];
				this.saving = false;
				this.failed = !landed;
				if (landed && intended.some(([field]) => field === "path")) this.pollMigration();
				this.publish();
			}
			/**
			* Ask the Host's guard route whether saving this directory would be refused
			* right now; a transport failure stays advisory (the write path's own
			* read-back still governs acceptance).
			* @param path - the staged path text ('' for the clear-to-default gesture).
			* @returns the refusal to show, or undefined when the save may proceed.
			*/
			async guard(path) {
				try {
					const response = await fetch(`${DIR_GUARD_PATH}?path=${encodeURIComponent(path)}`);
					if (!response.ok) return void 0;
					const body = await response.json();
					if (body.blocked === true && typeof body.interactingSessions === "number" && body.interactingSessions > 0) return {
						kind: "sessions-interacting",
						interactingSessions: body.interactingSessions
					};
				} catch (_guardFailure) {}
			}
			/**
			* Poll the Host's migration endpoint until it answers null (no migration
			* running), publishing each progress step.
			*/
			async pollMigration() {
				if (this.pollTimer !== void 0) return;
				const tick = async () => {
					let view;
					try {
						const response = await fetch(MIGRATION_PATH);
						if (response.ok) {
							const body = await response.json();
							if (body !== null && (body.phase === "copying" || body.phase === "cleaning") && typeof body.done === "number" && typeof body.total === "number") view = body;
						}
					} catch (_migrationPollFailure) {}
					if (view === void 0 && this.migrationView === void 0) {
						this.stopPolling();
						return;
					}
					if (view === void 0) this.stopPolling();
					this.migrationView = view;
					this.publish();
				};
				await tick();
				if (this.pollTimer === void 0 && this.migrationView !== void 0) this.pollTimer = setInterval(() => {
					tick();
				}, 300);
			}
			/** Stop the poll timer; the progress line leaves with the next publish. */
			stopPolling() {
				if (this.pollTimer !== void 0) {
					clearInterval(this.pollTimer);
					this.pollTimer = void 0;
				}
			}
			snapshot() {
				return this.target.getSnapshot();
			}
			/** The raw user layer narrowed to a record; the wire answer is `unknown`. */
			userLayer() {
				const user = this.snapshot().user;
				return typeof user === "object" && user !== null ? user : void 0;
			}
			storedValue(field) {
				return this.userLayer()?.[field];
			}
			stored(field) {
				const user = this.userLayer();
				return user !== void 0 && Object.hasOwn(user, field);
			}
			/** The resolved (draft-free) text of one field; '' means inherited. */
			effectiveOf(field) {
				const value = this.snapshot().value?.[field];
				return typeof value === "string" ? value : "";
			}
			/** The effective (draft-or-resolved) text of one field; '' means inherited. */
			textOf(field) {
				return this.drafts[field] ?? this.effectiveOf(field);
			}
			project() {
				const snapshot = this.snapshot();
				const fields = {};
				const overridden = {};
				let dirty = false;
				for (const field of CARD_FIELDS) {
					fields[field] = this.textOf(field);
					overridden[field] = this.drafts[field] !== void 0 ? this.drafts[field].trim() !== "" : this.stored(field);
					if (this.drafts[field] !== void 0 && this.drafts[field] !== this.effectiveOf(field)) dirty = true;
				}
				return {
					available: snapshot.status === "ready",
					writable: snapshot.writable,
					fields,
					overridden,
					dirty,
					saving: this.saving,
					failed: this.failed,
					refusal: this.refusal,
					migration: this.migrationView
				};
			}
			/** Replace the snapshot reference and notify, only when the fact moved. */
			store(next) {
				if (next === this.snapshotValue) return;
				this.snapshotValue = next;
				for (const listener of this.listeners) listener();
			}
			publish() {
				this.store(this.project());
			}
		};
		//#endregion
		//#region src/client/async-resource.ts
		/**
		* Shared async-resource state machine for the conversation-view consumers.
		* Every fetch-driven component repeats the same shape — three states
		* (`loading` / `error` / `ready`), a retry counter, and cancellation on
		* dependency change. Centralising the pattern here means a regression in
		* the cancellation logic lands in one spot instead of three.
		*
		* @module token-usage/client/async-resource
		*/
		/**
		* Drive one fetcher's lifecycle: reruns on dependency change, cancels the
		* previous attempt on a new fetch, and on retry-bump refetches even with
		* the same deps. `silentAfterFirst` keeps the previous value on screen —
		* the dashboard never blanks during a refresh once data is up.
		*
		* @param fetcher - the async loader; receives an `AbortSignal` for
		* cancellation. Throwing aborts the fetch (the next effect run triggers
		* a fresh attempt).
		* @param deps - the dependency list that retriggers a fetch (passed
		* through to React's effect; the retry counter joins the list).
		* @param options.silentAfterFirst - when true, the first fetch goes to
		* `loading` and subsequent refreshes keep the prior `value` on screen
		* until the new one lands.
		* @param options.retryToken - bumping this value triggers a refetch even
		* with unchanged deps (the consumer wires a "retry" button to it).
		* @returns `[state, retry]` — the current state plus a stable `retry()`
		* callback that bumps the internal counter and re-runs the effect.
		*/
		function useAsyncResource(fetcher, deps, options) {
			const silent = options.silentAfterFirst === true;
			const [state, setState] = (0, react.useState)({ status: "loading" });
			const loadedRef = (0, react.useRef)(false);
			const [retryTick, setRetryTick] = (0, react.useState)(0);
			const retry = (0, react.useCallback)(() => {
				setRetryTick((tick) => tick + 1);
			}, []);
			(0, react.useEffect)(() => {
				const controller = new AbortController();
				if (!silent || !loadedRef.current) setState({ status: "loading" });
				fetcher(controller.signal).then((value) => {
					if (controller.signal.aborted) return;
					loadedRef.current = true;
					setState({
						status: "ready",
						value
					});
				}).catch((error) => {
					if (controller.signal.aborted) return;
					if (silent && loadedRef.current) return;
					setState({
						status: "error",
						message: error instanceof Error ? error.message : String(error)
					});
				});
				return () => {
					controller.abort();
				};
			}, [
				...deps,
				options.retryToken,
				retryTick,
				silent
			]);
			return [state, retry];
		}
		/**
		* Return a value that lags behind its source by `delayMs` — a debounced
		* snapshot. The initial render already holds `value` (no null sentinel), so
		* a consumer can fetch immediately on mount without a second shot when the
		* first debounce window closes on the same value.
		*
		* @param value - the source value to debounce.
		* @param delayMs - the lag window in milliseconds.
		* @returns the debounced value.
		*/
		function useDebouncedValue(value, delayMs) {
			const [debounced, setDebounced] = (0, react.useState)(value);
			(0, react.useEffect)(() => {
				const timer = setTimeout(() => {
					setDebounced(value);
				}, delayMs);
				return () => {
					clearTimeout(timer);
				};
			}, [value, delayMs]);
			return debounced;
		}
		//#endregion
		//#region src/client/day.ts
		/** Total tokens across the four buckets (billed input = input + cacheRead + cacheWrite). */
		function totalTokens(totals) {
			return totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
		}
		/** Local `YYYY-MM-DD` key of a date, matching the host's day-file convention. */
		function dayKeyOf(date) {
			const month = String(date.getMonth() + 1).padStart(2, "0");
			const day = String(date.getDate()).padStart(2, "0");
			return `${date.getFullYear()}-${month}-${day}`;
		}
		/** Local day key of today shifted by whole days (test seam on `now`). */
		function shiftedDayKey(deltaDays, now = () => /* @__PURE__ */ new Date()) {
			const date = now();
			date.setDate(date.getDate() + deltaDays);
			return dayKeyOf(date);
		}
		/** The month view holding one day key. */
		function monthViewOf(dayKey) {
			return {
				year: Number(dayKey.slice(0, 4)),
				month: Number(dayKey.slice(5, 7)) - 1
			};
		}
		/** The month view shifted by whole months (year overflow normalized). */
		function shiftMonth(view, deltaMonths) {
			const total = view.year * 12 + view.month + deltaMonths;
			return {
				year: Math.floor(total / 12),
				month: (total % 12 + 12) % 12
			};
		}
		/**
		* The month grid of one month view: Monday-first whole weeks covering the
		* month, so every column aligns under its weekday header. Days of the
		* neighbouring months carry `inMonth: false` — the caller renders them as
		* blank placeholders, keeping the shown month's date texts unique (for
		* tests and screen readers).
		*/
		function monthGrid(view) {
			const leading = (new Date(view.year, view.month, 1).getDay() + 6) % 7;
			const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
			const total = Math.ceil((leading + daysInMonth) / 7) * 7;
			const cells = [];
			for (let index = 0; index < total; index++) {
				const cursor = new Date(view.year, view.month, 1 - leading + index);
				cells.push({
					day: dayKeyOf(cursor),
					inMonth: cursor.getFullYear() === view.year && cursor.getMonth() === view.month
				});
			}
			return cells;
		}
		/**
		* The zero-filled daily token series over a day range: every calendar day of
		* the range appears once (days without records plot as zero). Absent bounds
		* fall back to the first/last row day; no rows and no range yield [].
		* @param rows - the (already filtered) per-day rows.
		* @param from - first day key, inclusive.
		* @param to - last day key, inclusive.
		*/
		function daySeries(rows, from, to) {
			const first = from ?? rows[0]?.day;
			const last = to ?? (rows.length > 0 ? rows[rows.length - 1].day : void 0);
			if (first === void 0 || last === void 0 || first > last) return [];
			const tokens = new Map(rows.map((row) => [row.day, totalTokens(row.totals)]));
			const points = [];
			const cursor = /* @__PURE__ */ new Date(`${first}T00:00:00`);
			const end = /* @__PURE__ */ new Date(`${last}T00:00:00`);
			while (cursor <= end) {
				const day = dayKeyOf(cursor);
				points.push({
					day,
					tokens: tokens.get(day) ?? 0
				});
				cursor.setDate(cursor.getDate() + 1);
			}
			return points;
		}
		/** Local `YYYY-MM-DDTHH` key of a date, matching the host's hour convention. */
		function hourKeyOf(date) {
			const hour = String(date.getHours()).padStart(2, "0");
			return `${dayKeyOf(date)}T${hour}`;
		}
		/**
		* The zero-filled hourly token series over a day range: every whole hour of
		* the range appears once (hours without records plot as zero), so a single
		* day yields the full 00:00–23:00 sequence and future hours of today read
		* zero. The per-(hour, model) rows fold by hour. Absent bounds fall back to
		* the first/last row hour; no rows and no range yield [].
		* @param rows - the (already filtered) per-hour × per-model rows.
		* @param from - first day key (`YYYY-MM-DD`), inclusive; the series starts
		* at that day's 00:00.
		* @param to - last day key, inclusive; the series ends at that day's 23:00.
		*/
		function hourSeries(rows, from, to) {
			const first = from !== void 0 ? `${from}T00` : rows[0]?.hour;
			const last = to !== void 0 ? `${to}T23` : rows.length > 0 ? rows[rows.length - 1].hour : void 0;
			if (first === void 0 || last === void 0 || first > last) return [];
			const tokens = /* @__PURE__ */ new Map();
			for (const row of rows) tokens.set(row.hour, (tokens.get(row.hour) ?? 0) + totalTokens(row.totals));
			const points = [];
			const cursor = /* @__PURE__ */ new Date(`${first.slice(0, 10)}T${first.slice(11)}:00:00`);
			const end = /* @__PURE__ */ new Date(`${last.slice(0, 10)}T${last.slice(11)}:00:00`);
			while (cursor <= end) {
				const hour = hourKeyOf(cursor);
				points.push({
					hour,
					tokens: tokens.get(hour) ?? 0
				});
				cursor.setHours(cursor.getHours() + 1);
			}
			return points;
		}
		//#endregion
		//#region src/client/format.ts
		/** Known `LlmFailure.code`s that have a `fail.*` locale label. An unknown
		* future code is not in this map and the tooltip renders it verbatim. */
		const FAILURE_CODE_LABEL_KEYS = {
			ABORTED: "fail.ABORTED",
			AUTH: "fail.AUTH",
			CONTEXT_WINDOW_EXCEEDED: "fail.CONTEXT_WINDOW_EXCEEDED",
			EMPTY_RESPONSE: "fail.EMPTY_RESPONSE",
			FILES_API: "fail.FILES_API",
			INVALID_CREDENTIAL: "fail.INVALID_CREDENTIAL",
			INVALID_REQUEST: "fail.INVALID_REQUEST",
			MALFORMED_RESPONSE: "fail.MALFORMED_RESPONSE",
			MISSING_CREDENTIAL: "fail.MISSING_CREDENTIAL",
			QUOTA: "fail.QUOTA",
			RATE_LIMIT: "fail.RATE_LIMIT",
			REQUEST_EXTENSION: "fail.REQUEST_EXTENSION",
			SERVER: "fail.SERVER",
			STREAM_CLOSED: "fail.STREAM_CLOSED",
			TIMEOUT: "fail.TIMEOUT",
			TRANSPORT: "fail.TRANSPORT",
			UNKNOWN: "fail.UNKNOWN"
		};
		/** One decimal below 10, integer otherwise, trailing `.0` stripped. */
		function scale(value) {
			if (value >= 10) return String(Math.round(value));
			const oneDecimal = value.toFixed(1);
			return oneDecimal.endsWith(".0") ? oneDecimal.slice(0, -2) : oneDecimal;
		}
		/**
		* Abbreviate a token count: raw below 1K, `xxK` below 1M, `xxM` below 10 亿
		* (1e9) — 1 亿 is `100M`, 2.5 亿 is `250M`, 9.5 亿 is `950M` — and `xxB`
		* only from 10 亿 up (B = 10 亿, no fractional-B tier): `1B`, `1.5B`, `3B`.
		* One decimal while the scaled value is below 10, integer otherwise —
		* `950K`, `1.5M`, `950M`, `3B`.
		* @param count - a non-negative token count.
		* @returns the compact display string.
		*/
		function formatTokens(count) {
			if (count < 1e3) return String(count);
			if (count < 1e6) return scale(count / 1e3) + "K";
			if (count < 1e9) return scale(count / 1e6) + "M";
			return scale(count / 1e9) + "B";
		}
		/** Always one decimal (stripped when `.0`), unlike {@link scale}: percentages keep their precision. */
		function percent(value) {
			const oneDecimal = value.toFixed(1);
			return oneDecimal.endsWith(".0") ? oneDecimal.slice(0, -2) : oneDecimal;
		}
		/** Hit-rate thresholds (inclusive lower bound, exclusive upper). Boundary
		* values sit in the higher tier: 0.60 is `amber`, 0.80 is `lime`, 0.95
		* is `healthy`. The numbers are guideposts, not hard cutoffs — a 78%
		* cache hit rate is still in `amber`, exactly because cache misses at
		* ~1/5 of requests is worth flagging. */
		const HIT_RATE_AMBER = .6;
		const HIT_RATE_LIME = .8;
		const HIT_RATE_HEALTHY = .95;
		/** Map a 0-1 fraction to one of the four chip color buckets. */
		function bandOf(hitRate) {
			if (hitRate >= HIT_RATE_HEALTHY) return "healthy";
			if (hitRate >= HIT_RATE_LIME) return "lime";
			if (hitRate >= HIT_RATE_AMBER) return "amber";
			return "critical";
		}
		/**
		* Compute the cache hit rate's display shape in one pass.
		* @param totals - the aggregated totals.
		* @returns `{ text, band }` — `text` is `—` for an empty denominator,
		* `band` defaults to `amber` so an unused session reads as a mild
		* "no signal yet" (neither alarming nor celebratory).
		*/
		function hitRateDisplay(totals) {
			const served = totals.inputTokens + totals.cacheReadTokens;
			if (served === 0) return {
				text: "—",
				band: "amber"
			};
			const rate = totals.cacheReadTokens / served;
			return {
				text: `${percent(rate * 100)}%`,
				band: bandOf(rate)
			};
		}
		/** The RMB display view: amounts render as stored. The CNY sign is the
		* fullwidth ￥ (U+FFE5) — the standard RMB glyph in a Chinese UI, and the
		* suffix the number-first cost idiom reads naturally with. */
		const CNY_VIEW = {
			symbol: "￥",
			rate: 1
		};
		/**
		* The display view of one stats summary: USD when the region pick says so
		* (amounts ÷ `usdExchangeRate`, `$` prefix), else RMB as stored.
		* @param summary - the stats payload (its `currency`/`usdExchangeRate` fields).
		* @returns the view the format functions render through.
		*/
		function currencyViewOf(summary) {
			return summary.currency === "USD" ? {
				symbol: "$",
				rate: summary.usdExchangeRate
			} : CNY_VIEW;
		}
		/**
		* Cost as display text: two decimals plus the view's symbol SUFFIXED —
		* `1.25¥` — matching the dock row's number-first unit idiom (`12.2M tok`,
		* `98%`), where every reading leads with its magnitude. USD divides the
		* wire's RMB amount by the exchange rate (`0.18$` under a rate-7 view).
		* A cost is always shown, never omitted.
		* @param cost - a non-negative cost in ¥ (as carried on the wire).
		* @param view - the display currency view.
		* @returns e.g. `1.25¥`, or `0.18$` under a rate-7 USD view.
		*/
		function formatCost(cost, view = CNY_VIEW) {
			return `${(cost / view.rate).toFixed(2)}${view.symbol}`;
		}
		/**
		* A per-million-token rate as display text, converted through the view:
		* integral rates stay bare (`8`, `$1.14`-style conversion applied first for
		* USD), fractional ones keep up to four decimals with trailing zeros
		* stripped and a two-decimal minimum (`0.50`, `0.25`, `0.025`). The caller
		* appends the `/M` unit and the view's symbol where needed.
		* @param rate - a non-negative rate in ¥ per million tokens.
		* @param view - the display currency view.
		* @returns the display string (symbol-less, converted for USD).
		*/
		function formatRate(rate, view = CNY_VIEW) {
			const converted = rate / view.rate;
			if (Number.isInteger(converted)) return String(converted);
			let s = converted.toFixed(4);
			const dot = s.indexOf(".");
			s = s.replace(/0+$/u, "");
			if (s.endsWith(".")) s += "00";
			const minEnd = dot + 3;
			while (s.length < minEnd) s += "0";
			return s;
		}
		/**
		* A per-million-token rate as complete display text: the view's symbol plus
		* {@link formatRate}'s converted number — what the pricing table cells render.
		* @param rate - a non-negative rate in ¥ per million tokens.
		* @param view - the display currency view.
		* @returns e.g. `¥8`, or `$1.1429` under a rate-7 USD view.
		*/
		function formatRateWithSymbol(rate, view = CNY_VIEW) {
			return `${view.symbol}${formatRate(rate, view)}`;
		}
		/**
		* Average first-token latency in the shell's compact duration shape:
		* one decimal under a minute (`45.2s`), `2m42s` from there on.
		* @param ms - total first-token latency.
		* @returns the display string.
		*/
		function formatTtft(ms) {
			const s = ms / 1e3;
			if (s < 60) return `${String(Math.round(s * 10) / 10)}s`;
			const whole = Math.round(s);
			return `${Math.floor(whole / 60)}m${whole % 60}s`;
		}
		/**
		* Decode-throughput display figure in the shell's shape: whole tokens from
		* ten up, one decimal below (the `tok/s` unit lives in the locale template).
		* @param tokensPerSecond - tokens per second.
		* @returns the display number.
		*/
		function formatSpeed(tokensPerSecond) {
			const clamped = Math.max(0, tokensPerSecond);
			return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
		}
		/**
		* The failure pill's hover tooltip text: one `label ×count` line per failure
		* class, largest count first (code name ascending breaks ties), newline-joined —
		* the shell Tooltip renders `pre-line`, so each line lands on its own row.
		* Known `LlmFailure.code`s map through `fail.*` locale keys (限流 / Rate
		* limited); an unknown future code renders verbatim. A legacy shape without
		* the breakdown, or an empty map, yields '' and the caller suppresses the
		* tooltip.
		* @param byCode - the per-code failure counts from the totals (may be undefined).
		* @param t - locale lookup; codes without a `fail.*` key stay verbatim.
		* @returns the multi-line tooltip label, or '' when there is nothing to show.
		*/
		function failuresTooltip(byCode, t) {
			if (byCode === void 0) return "";
			return Object.entries(byCode).filter(([, count]) => count > 0).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([code, count]) => `${failureCodeLabel(code, t)} ×${count}`).join("\n");
		}
		/** Locale label for one failure code; unknown codes stay verbatim. */
		function failureCodeLabel(code, t) {
			if (Object.hasOwn(FAILURE_CODE_LABEL_KEYS, code)) return t(FAILURE_CODE_LABEL_KEYS[code]);
			return code;
		}
		//#endregion
		//#region src/client/PricingStatus.tsx
		function costsAvailable(state) {
			return state === void 0 || state === "ready";
		}
		/** Shared failure reasons; matching and prices remain entirely on the host. */
		function PricingStatus({ costState, pricingUnavailableReason, associationStorageError, t }) {
			const storageWarning = associationStorageError !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				role: "status",
				children: t("pricing.associationStorageUnavailable")
			}) : null;
			const costWarning = !costsAvailable(costState) ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
				role: "status",
				children: [t(costState === "history-incomplete" ? "pricing.historyIncomplete" : "pricing.unavailable"), costState === "pricing-unavailable" && pricingUnavailableReason !== void 0 ? ` ${t(`pricing.reason.${pricingUnavailableReason}`)}` : ""]
			}) : null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [storageWarning, costWarning] });
		}
		//#endregion
		//#region src/model-resolution.ts
		/** Full-name comparison only: spelling remains intact in records and displays. */
		const modelKey = (name) => name.toLowerCase();
		/** Parse the upstream portable subset rather than accepting arbitrary JS regex. */
		function compileAliasPattern(pattern) {
			if (!pattern.startsWith("^") || !pattern.endsWith("$")) throw new Error("alias pattern requires ^ and $");
			const body = pattern.slice(1, -1);
			let offset = 0;
			function expression(depth) {
				if (depth > 32) throw new Error("alias pattern nesting is too deep");
				let atoms = 0;
				while (offset < body.length && body[offset] !== ")") {
					const char = body[offset++];
					if (char === "|") {
						if (atoms === 0) throw new Error("empty alias pattern branch");
						atoms = 0;
						continue;
					}
					if (char === "(") {
						expression(depth + 1);
						if (body[offset++] !== ")") throw new Error("unclosed alias pattern group");
					} else if (char === "\\") {
						const literal = body[offset++];
						if (literal === void 0 || /[A-Za-z0-9\s]/.test(literal)) throw new Error("alias patterns allow escaped punctuation only");
					} else if (!/[A-Za-z0-9_/:\-]/.test(char)) throw new Error("unsupported alias pattern syntax");
					atoms++;
					if (body[offset] === "?") offset++;
				}
				if (atoms === 0) throw new Error("empty alias pattern branch");
			}
			expression(0);
			if (offset !== body.length) throw new Error("unbalanced alias pattern group");
			return new RegExp(pattern, "i");
		}
		/** `$` also accepts a trailing newline in JS; require a full-span match. */
		function matchesAliasPattern(regex, name) {
			const match = regex.exec(name);
			return match !== null && match.index === 0 && match[0].length === name.length;
		}
		//#endregion
		//#region \0dsh-css:/Users/chii/.dsh/local-src/dsh-token-usage/src/client/PricingDialog.module.css.mjs
		const css$13 = "._5db60G_dialog{width:min(600px,100vw - 48px);max-height:calc(100vh - 48px);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:14px 16px;overflow-y:auto}._5db60G_dialog::backdrop{background:#0006}._5db60G_dialogHead{justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px;display:flex}._5db60G_dialogTitle{text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;font-size:14px;font-weight:600;overflow:hidden}._5db60G_dialogClose{color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:6px;flex:none;padding:2px 8px;font-size:12px;line-height:18px}._5db60G_dialogClose:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-interactive-bg-hover)}._5db60G_rateNote{color:var(--dsw-alias-label-secondary);margin:6px 0 0;font-size:12px}._5db60G_tableWrap{max-height:420px;overflow:auto}._5db60G_table{border-collapse:collapse;font-variant-numeric:tabular-nums;width:100%;min-width:420px;font-size:12px}._5db60G_table th,._5db60G_table td{text-align:right;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap;padding:4px 6px}._5db60G_table th{color:var(--dsw-alias-label-secondary);z-index:1;background:var(--dsw-alias-bg-layer-2);font-weight:500;position:sticky;top:0}._5db60G_table td{color:var(--dsw-alias-label-primary)}th._5db60G_conditionHead,td._5db60G_conditionCell{text-align:left;white-space:normal;min-width:200px}td._5db60G_conditionCell{color:var(--dsw-alias-label-secondary);padding-left:20px}._5db60G_groupRow>td{text-align:left;white-space:normal;color:var(--dsw-alias-label-secondary);border-bottom:none;padding-top:8px;font-size:11px;font-weight:600}._5db60G_groupRow:not(:first-child)>td{border-top:1px solid var(--dsw-alias-border-l1)}";
		const tagId$13 = "@laoyuehanni/dsh-token-usage/PricingDialog.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$13) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-token-usage";
			tag.dataset.pluginCss = tagId$13;
			tag.textContent = css$13;
			document.head.appendChild(tag);
		}
		var PricingDialog_module_css_default = {
			"conditionCell": "_5db60G_conditionCell",
			"conditionHead": "_5db60G_conditionHead",
			"dialog": "_5db60G_dialog",
			"dialogClose": "_5db60G_dialogClose",
			"dialogHead": "_5db60G_dialogHead",
			"dialogTitle": "_5db60G_dialogTitle",
			"groupRow": "_5db60G_groupRow",
			"rateNote": "_5db60G_rateNote",
			"table": "_5db60G_table",
			"tableWrap": "_5db60G_tableWrap"
		};
		//#endregion
		//#region src/client/PricingDialog.tsx
		/**
		* The pricing dialog of one model: a native `<dialog>` (Esc closes, focus
		* is trapped, the backdrop dims, and the top layer renders it above the
		* table's scroll shell) holding that model's full price table — billing
		* conditions (default / context tiers / peak slots / time rules) × the four
		* per-million rates, converted for a USD view. Shared by the settings
		* page's per-model “定价” affordance and the pricing-overview dialog's
		* drill-in rows; a native showModal naturally stacks a second instance
		* above the overview.
		*
		* @module token-usage/client/PricingDialog
		*/
		/** The four base rates of one model as display text (symbol included,
		* converted for a USD view); a missing cache rate bills at the input rate. */
		function billedRates(rates, view) {
			return {
				input: formatRateWithSymbol(rates.inputPerMillion, view),
				output: formatRateWithSymbol(rates.outputPerMillion, view),
				cacheRead: formatRateWithSymbol(rates.cacheReadPerMillion ?? rates.inputPerMillion, view),
				cacheWrite: formatRateWithSymbol(rates.cacheWritePerMillion ?? rates.inputPerMillion, view)
			};
		}
		/** `HH:MM-HH:MM` of one peak window (half-open, local minutes). */
		function windowText(window) {
			const clock = (minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
			return `${clock(window.startMinute)}-${clock(window.endMinute)}`;
		}
		/** The when-it-applies text of one peak slot: its label plus its windows. */
		function slotCondition(slot, t) {
			return `${slot.label ?? t("pricing.peak")} ${slot.windows.map(windowText).join(t("pricing.windowSep"))}`;
		}
		/**
		* The price rows of one rate node (a time rule's or the model root's): the
		* node's own base rates, then its peak slots, then its context tiers
		* (ascending), each tier followed by the peak slots hanging on that tier —
		* mirroring {@link resolveRate}'s node chain, where a matching tier's slots
		* replace the node's and peak rates replace the node's rates wholesale.
		*/
		function nodePriceRows(node, t) {
			const rows = [{
				condition: t("pricing.default"),
				rates: node.rates
			}];
			const tiers = [...node.tiers ?? []].sort((a, b) => a.threshold - b.threshold);
			for (const tier of tiers) {
				const tierCondition = t("pricing.tier", { threshold: formatTokens(tier.threshold) });
				rows.push({
					condition: tierCondition,
					rates: tier.rates
				});
				for (const slot of tier.dailySlots ?? []) rows.push({
					condition: `${tierCondition} · ${slotCondition(slot, t)}`,
					rates: slot.rates
				});
			}
			for (const slot of node.slots ?? []) rows.push({
				condition: slotCondition(slot, t),
				rates: slot.rates
			});
			return rows;
		}
		/**
		* One model's price table: rows are billing conditions — grouped into the
		* model root (“常规”, omitted when it is the only group) and one group per
		* time rule with its date window — so tier, peak, and time-rule pricing
		* each show when they apply and what they bill. The structure mirrors
		* {@link resolveRate}'s node chain.
		*/
		function ModelPriceTable({ rules, view, t }) {
			const groups = [{
				title: rules.timeRules.length > 0 ? t("pricing.regular") : null,
				rows: nodePriceRows({
					rates: rules.base,
					tiers: rules.contextTiers,
					slots: rules.dailySlots
				}, t)
			}, ...[...rules.timeRules].sort((a, b) => b.endTime - a.endTime).map((rule) => ({
				title: `${rule.label !== void 0 ? `${rule.label} ` : ""}${rule.startTime > 0 ? `${dayKeyOf(/* @__PURE__ */ new Date(rule.startTime * 1e3))} ~ ` : "~ "}${dayKeyOf(/* @__PURE__ */ new Date(rule.endTime * 1e3))}`,
				rows: nodePriceRows({
					rates: rule.rates,
					tiers: rule.contextTiers,
					slots: rule.dailySlots
				}, t)
			}))];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: PricingDialog_module_css_default["tableWrap"],
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
					className: PricingDialog_module_css_default["table"],
					"aria-label": t("pricing.title"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
							className: PricingDialog_module_css_default["conditionHead"],
							children: t("pricing.condition")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", { children: [t("pricing.input"), t("pricing.perMillion")] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", { children: [t("pricing.output"), t("pricing.perMillion")] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", { children: [t("pricing.cacheRead"), t("pricing.perMillion")] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", { children: [t("pricing.cacheWrite"), t("pricing.perMillion")] })
					] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: groups.flatMap((group) => [...group.title !== null ? [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", {
						className: PricingDialog_module_css_default["groupRow"],
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
							colSpan: 5,
							children: group.title
						})
					}, group.title)] : [], ...group.rows.map((row, index) => {
						const billed = billedRates(row.rates, view);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
								className: PricingDialog_module_css_default["conditionCell"],
								children: row.condition
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: billed.input }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: billed.output }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: billed.cacheRead }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: billed.cacheWrite })
						] }, `${group.title ?? ""}-${index}-${row.condition}`);
					})]) })]
				}), view.symbol === "$" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: PricingDialog_module_css_default["rateNote"],
					children: t("pricing.exchangeRateNote", { rate: formatRate(view.rate) })
				}) : null]
			});
		}
		/**
		* The pricing dialog of one model. Mounts only while a model is selected;
		* every close path funnels through the dialog's `close` event, which clears
		* the selection and unmounts it.
		*/
		function PricingDialog({ model, rules, view, onClose, t }) {
			const dialogRef = (0, react.useRef)(null);
			const backdropPress = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				const dialog = dialogRef.current;
				if (dialog !== null && !dialog.open) dialog.showModal();
			}, []);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dialog", {
				ref: dialogRef,
				className: PricingDialog_module_css_default["dialog"],
				"aria-label": t("pricing.title"),
				onClose,
				onMouseDown: (event) => {
					backdropPress.current = event.target === dialogRef.current;
				},
				onClick: (event) => {
					if (event.target === dialogRef.current && backdropPress.current) dialogRef.current?.close();
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: PricingDialog_module_css_default["dialogHead"],
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: PricingDialog_module_css_default["dialogTitle"],
						children: model
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: PricingDialog_module_css_default["dialogClose"],
						"aria-label": t("pricing.close"),
						onClick: () => dialogRef.current?.close(),
						children: "✕"
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelPriceTable, {
					rules,
					view,
					t
				})]
			});
		}
		//#endregion
		//#region src/client/pricing-associations.ts
		const CHANGED_EVENT = "token-usage:pricing-associations-changed";
		const TABLE_CHANGED_EVENT = "token-usage:pricing-table-changed";
		/** All mounted usage views refresh their existing query after a real commit. */
		function pricingAssociationsChanged() {
			window.dispatchEvent(new Event(CHANGED_EVENT));
		}
		function pricingTableChanged() {
			window.dispatchEvent(new Event(TABLE_CHANGED_EVENT));
		}
		function usePricingAssociationRefresh(refresh) {
			const latest = (0, react.useRef)(refresh);
			latest.current = refresh;
			(0, react.useEffect)(() => {
				const changed = () => {
					latest.current();
				};
				window.addEventListener(CHANGED_EVENT, changed);
				window.addEventListener(TABLE_CHANGED_EVENT, changed);
				return () => {
					window.removeEventListener(CHANGED_EVENT, changed);
					window.removeEventListener(TABLE_CHANGED_EVENT, changed);
				};
			}, []);
		}
		var AssociationRequestError = class extends Error {
			code;
			current;
			constructor(code, current) {
				super(code);
				this.code = code;
				this.current = current;
			}
		};
		/** Optional pricing references and the current feed version; no usage or credentials. */
		function pricingIssueUrl(resolution, version) {
			const lines = [
				"1. Pricing reference (optional)",
				"   - Currency:",
				"   - Input price per 1 million tokens:",
				"   - Output price per 1 million tokens:",
				"   - Cache read price per 1 million tokens:",
				"   - Cache write price per 1 million tokens:",
				"   - Context window (tokens):",
				"",
				"2. Official pricing URL (optional)",
				"   - URL:",
				"",
				"3. Current pricing table version",
				`   - ${version ?? "Unknown"}`
			];
			const url = new URL("https://github.com/LaoYueHanNi/model-price-table/issues/new");
			url.searchParams.set("title", `Add model pricing: ${resolution.rawName}`);
			url.searchParams.set("body", lines.join("\n"));
			return url.href;
		}
		//#endregion
		//#region \0dsh-css:/Users/chii/.dsh/local-src/dsh-token-usage/src/client/PricingAssociations.module.css.mjs
		const css$12 = ".uQb9hW_actions{flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0;display:flex}.uQb9hW_button,.uQb9hW_link{font:inherit;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;background:0 0;border-radius:6px;padding:4px 8px;font-size:12px}.uQb9hW_button:hover,.uQb9hW_link:hover{background:var(--dsw-interactive-bg-hover)}.uQb9hW_button:disabled{opacity:.5;cursor:default}.uQb9hW_badgeWrap{vertical-align:middle;flex:none;display:inline-flex}.uQb9hW_badgeWrap [role=tooltip]{white-space:normal;overflow-wrap:anywhere;max-width:min(360px,100vw - 24px);font-size:12px;font-style:normal;font-weight:400;line-height:1.4;animation:none}.uQb9hW_badge{color:var(--dsw-alias-label-secondary);cursor:default;flex:none;align-items:center;display:inline-flex}.uQb9hW_badge:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:50%}.uQb9hW_link{border:none;padding:2px 4px}.uQb9hW_dialog{box-sizing:border-box;width:min(480px,100vw - 48px);font-size:13px;line-height:1.5}.uQb9hW_dialog p,.uQb9hW_unpricedDialog p{margin:8px 0;font-size:12px;line-height:1.5}.uQb9hW_dialog h2,.uQb9hW_unpricedDialog h2{margin:0;font-size:14px;line-height:1.5}.uQb9hW_dialog .uQb9hW_source{margin:12px 0 8px;font-size:13px;font-weight:500}.uQb9hW_unpricedDialog{box-sizing:border-box;width:min(400px,100vw - 48px);font-size:13px;line-height:1.5}.uQb9hW_unpricedTag{appearance:none;font:inherit;color:var(--dsw-alias-state-warn-label);background:var(--dsw-alias-state-warn-tertiary);cursor:pointer;white-space:nowrap;border:none;border-radius:8px;flex:none;margin:0;padding:0 6px;font-size:10px;line-height:16px}.uQb9hW_unpricedTag:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.uQb9hW_name{overflow-wrap:anywhere;white-space:normal}.uQb9hW_label{color:var(--dsw-alias-label-secondary);margin:10px 0 4px;font-size:12px;display:block}.uQb9hW_search{box-sizing:border-box;width:100%;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:6px 8px;font-size:12px}.uQb9hW_candidates{border:1px solid var(--dsw-alias-border-l1);border-radius:6px;max-height:180px;margin:8px 0;overflow-y:auto}.uQb9hW_candidate{cursor:pointer;overflow-wrap:anywhere;align-items:center;gap:8px;padding:6px 8px;font-size:12px;display:flex}.uQb9hW_candidate:hover{background:var(--dsw-interactive-bg-hover)}.uQb9hW_candidate small{color:var(--dsw-alias-label-secondary);margin-inline-start:auto}.uQb9hW_entry{border-bottom:1px solid var(--dsw-alias-border-l1);padding:10px 0}.uQb9hW_mappingRow{grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px 12px;padding:8px 0;display:grid}.uQb9hW_mappingRow>.uQb9hW_name{min-width:0}.uQb9hW_mappingRow>.uQb9hW_button{white-space:nowrap}.uQb9hW_revokeConfirmation{grid-column:1/-1;margin:0}.uQb9hW_selection{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px;margin:8px 0;font-size:12px;display:flex}.uQb9hW_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.uQb9hW_save:hover:not(:disabled){background:var(--dsw-alias-label-primary);opacity:.9}.uQb9hW_note{color:var(--dsw-alias-label-secondary);white-space:normal;font-size:12px}.uQb9hW_error{color:var(--dsw-alias-label-primary);white-space:normal;font-size:12px}";
		const tagId$12 = "@laoyuehanni/dsh-token-usage/PricingAssociations.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$12) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-token-usage";
			tag.dataset.pluginCss = tagId$12;
			tag.textContent = css$12;
			document.head.appendChild(tag);
		}
		var PricingAssociations_module_css_default = {
			"actions": "uQb9hW_actions",
			"badge": "uQb9hW_badge",
			"badgeWrap": "uQb9hW_badgeWrap",
			"button": "uQb9hW_button",
			"candidate": "uQb9hW_candidate",
			"candidates": "uQb9hW_candidates",
			"dialog": "uQb9hW_dialog",
			"entry": "uQb9hW_entry",
			"error": "uQb9hW_error",
			"label": "uQb9hW_label",
			"link": "uQb9hW_link",
			"mappingRow": "uQb9hW_mappingRow",
			"name": "uQb9hW_name",
			"note": "uQb9hW_note",
			"revokeConfirmation": "uQb9hW_revokeConfirmation",
			"save": "uQb9hW_save",
			"search": "uQb9hW_search",
			"selection": "uQb9hW_selection",
			"source": "uQb9hW_source",
			"unpricedDialog": "uQb9hW_unpricedDialog",
			"unpricedTag": "uQb9hW_unpricedTag"
		};
		//#endregion
		//#region src/client/PricingAssociations.tsx
		const AssociationUiContext = (0, react.createContext)(null);
		function PricingAssociationProvider({ resolutions = [], feedVersion, view, t, children }) {
			const [source, setSource] = (0, react.useState)(void 0);
			const [unpriced, setUnpriced] = (0, react.useState)(null);
			const opener = (0, react.useRef)(null);
			const rememberOpener = () => {
				opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(AssociationUiContext.Provider, {
				value: {
					open: (name) => {
						rememberOpener();
						setSource(name ?? null);
					},
					showUnpriced: (resolution) => {
						rememberOpener();
						setUnpriced(resolution);
					},
					resolutions,
					...feedVersion !== void 0 ? { feedVersion } : {}
				},
				children: [
					children,
					unpriced !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnpricedModelDialog, {
						resolution: unpriced,
						version: feedVersion,
						t,
						onClose: () => setUnpriced(null),
						onAssociate: () => {
							setUnpriced(null);
							setSource(unpriced.rawName);
						}
					}),
					source !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PricingAssociationDialog, {
						initialSource: source,
						returnFocus: opener.current,
						view,
						t,
						onClose: () => setSource(void 0)
					})
				]
			});
		}
		/** Entry remains available even when the usage filter has no rows. */
		function PricingAssociationManagerButton({ t, onOpen }) {
			const ui = (0, react.useContext)(AssociationUiContext);
			const open = onOpen ?? (ui === null ? void 0 : () => ui.open());
			return open === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				"data-pricing-association-manager": true,
				className: PricingAssociations_module_css_default.button,
				onClick: open,
				children: t("association.manage")
			});
		}
		function PricingIssueLink({ resolution, version, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
				className: PricingAssociations_module_css_default.link,
				href: pricingIssueUrl(resolution, version),
				target: "_blank",
				rel: "noopener noreferrer",
				children: t("association.issue")
			});
		}
		function UnpricedModelTag({ model, t }) {
			const ui = (0, react.useContext)(AssociationUiContext);
			const resolution = ui?.resolutions.find((row) => modelKey(row.rawName) === modelKey(model)) ?? {
				rawName: model,
				status: "unmatched",
				strippedPrefix: false,
				candidates: []
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: PricingAssociations_module_css_default.unpricedTag,
				"aria-haspopup": "dialog",
				disabled: ui === null || model === "",
				onClick: () => ui?.showUnpriced(resolution),
				children: t("pricing.unpriced")
			});
		}
		function UnpricedModelDialog({ resolution, version, t, onClose, onAssociate }) {
			const dialogRef = (0, react.useRef)(null);
			const backdropPress = (0, react.useRef)(false);
			const opener = (0, react.useRef)(document.activeElement instanceof HTMLElement ? document.activeElement : null);
			(0, react.useEffect)(() => {
				dialogRef.current?.showModal();
				return () => {
					if (opener.current?.isConnected) opener.current.focus();
				};
			}, []);
			const automatic = resolution.automatic ?? resolution;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dialog", {
				ref: dialogRef,
				className: `${PricingDialog_module_css_default.dialog} ${PricingAssociations_module_css_default.unpricedDialog}`,
				"aria-label": t("association.unpricedTitle"),
				onClose: (event) => {
					if (event.target === dialogRef.current) onClose();
				},
				onMouseDown: (event) => {
					backdropPress.current = event.target === dialogRef.current;
				},
				onClick: (event) => {
					if (event.target === dialogRef.current && backdropPress.current) dialogRef.current?.close();
				},
				onKeyDown: (event) => {
					if (event.key === "Escape") event.stopPropagation();
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PricingDialog_module_css_default.dialogHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: PricingDialog_module_css_default.dialogTitle,
							children: t("association.unpricedTitle")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: PricingDialog_module_css_default.dialogClose,
							"aria-label": t("association.close"),
							onClick: () => dialogRef.current?.close(),
							children: "✕"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PricingAssociations_module_css_default.name,
						children: resolution.rawName
					}),
					automatic.status === "ambiguous" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PricingAssociations_module_css_default.note,
						children: t("pricing.ambiguous", { models: automatic.candidates.join(", ") })
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PricingAssociations_module_css_default.actions,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: PricingAssociations_module_css_default.button,
							onClick: onAssociate,
							children: t("association.choose")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PricingIssueLink, {
							resolution,
							version,
							t
						})]
					})
				]
			});
		}
		/** Show original associated IDs on hover without expanding the statistics row. */
		function ModelAssociationBadge({ model, t }) {
			const ui = (0, react.useContext)(AssociationUiContext);
			if (ui === null || model === "") return null;
			const associated = ui.resolutions.filter((row) => modelKey(row.modelId ?? row.rawName) === modelKey(model)).filter((row) => row.association !== void 0);
			if (associated.length === 0) return null;
			const label = t("association.tooltip", { models: associated.map((row) => row.rawName).join(", ") });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: PricingAssociations_module_css_default.badgeWrap,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label,
					side: "top",
					delayMs: 100,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: PricingAssociations_module_css_default.badge,
						role: "img",
						"aria-label": label,
						tabIndex: 0,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
							width: "14",
							height: "14",
							viewBox: "0 0 16 16",
							fill: "none",
							"aria-hidden": "true",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
									cx: "8",
									cy: "8",
									r: "6",
									stroke: "currentColor"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
									d: "M6.5 6a1.5 1.5 0 0 1 3 0c0 1-1.5 1-1.5 2.5",
									stroke: "currentColor",
									strokeLinecap: "round"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
									cx: "8",
									cy: "10.5",
									r: ".7",
									fill: "currentColor"
								})
							]
						})
					})
				})
			});
		}
		function AssociationStatus({ row, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
				className: PricingAssociations_module_css_default.note,
				children: [t(`association.state.${row.state}`), row.state === "automatic-takeover" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					" ",
					t("association.automaticTarget", { model: row.automaticModelId ?? "" }),
					row.targetDiffers && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [" ", t("association.targetDiffers", { model: row.targetModelId })] }),
					" ",
					t("association.reactivate")
				] })]
			});
		}
		async function readJson(url, signal) {
			const response = await fetch(url, {
				signal,
				cache: "no-store"
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			return response.json();
		}
		function checkAssociations(value) {
			if (value === null || typeof value !== "object" || typeof value.directoryToken !== "string" || !["ready", "unavailable"].includes(value.storageState) || !Array.isArray(value.associations) || typeof value.pricingAvailable !== "boolean" || typeof value.writesPaused !== "boolean" || value.storageState === "ready" && (!Number.isSafeInteger(value.revision) || value.revision < 0) || value.associations.some((row) => row === null || typeof row.sourceModel !== "string" || typeof row.targetModelId !== "string")) throw new Error("unexpected association response");
			return value;
		}
		function checkPricing(value) {
			if (value === null || typeof value !== "object" || !Array.isArray(value.models) || value.models.some((row) => row === null || typeof row.modelId !== "string" || !Array.isArray(row.aliasPatterns) || !row.aliasPatterns.every((pattern) => typeof pattern === "string") || row.rules?.base === void 0)) throw new Error("unexpected pricing response");
			return value;
		}
		function requestMessage(error, t) {
			if (!(error instanceof AssociationRequestError)) return t("association.writeFailed");
			switch (error.code) {
				case "revision-conflict":
				case "directory-conflict": return t("association.conflict");
				case "migration-in-progress": return t("association.migrating");
				case "source-automatically-priced": return t("association.automaticOnly");
				case "target-unavailable": return t("association.targetUnavailable");
				case "pricing-unavailable": return t("pricing.unavailable");
				case "association-storage-unavailable": return t("pricing.associationStorageUnavailable");
				default: return t("association.writeFailed");
			}
		}
		function PricingAssociationDialog({ initialSource, view, t, onClose, returnFocus }) {
			const dialogRef = (0, react.useRef)(null);
			const searchId = (0, react.useId)();
			const backdropPress = (0, react.useRef)(false);
			const mounted = (0, react.useRef)(true);
			const writing = (0, react.useRef)(false);
			const opener = (0, react.useRef)(returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null));
			const source = initialSource;
			const [query, setQuery] = (0, react.useState)("");
			const [target, setTarget] = (0, react.useState)(null);
			const [detail, setDetail] = (0, react.useState)(null);
			const [pending, setPending] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [notice, setNotice] = (0, react.useState)(null);
			const [confirmRevoke, setConfirmRevoke] = (0, react.useState)(null);
			const [override, setOverride] = (0, react.useState)(null);
			const [state, retry] = useAsyncResource(async (signal) => {
				const [associations, pricing] = await Promise.all([readJson(ASSOCIATIONS_PATH + (source !== null ? `?sourceModel=${encodeURIComponent(source)}` : ""), signal).then(checkAssociations), readJson(PRICING_PATH, signal).then(checkPricing).catch(() => null)]);
				return {
					associations,
					pricing,
					source
				};
			}, [source], { retryToken: 0 });
			(0, react.useEffect)(() => {
				const dialog = dialogRef.current;
				dialog?.showModal();
				const parent = dialog?.parentElement;
				mounted.current = true;
				return () => {
					mounted.current = false;
					if (opener.current?.isConnected) opener.current.focus();
					else (parent?.querySelector("[data-pricing-association-manager]") ?? parent?.querySelector("[data-pricing-overview-trigger]") ?? parent?.querySelector("button"))?.focus();
				};
			}, []);
			const ready = state.status === "ready" && state.value.source === source;
			const snapshot = override ?? (ready ? state.value.associations : null);
			const models = ready ? state.value.pricing?.models ?? [] : [];
			const candidateView = ready && state.value.pricing !== null ? currencyViewOf(state.value.pricing) : view;
			const selected = models.find((model) => modelKey(model.modelId) === modelKey(target ?? ""));
			const currentChoice = snapshot?.associations.find((row) => modelKey(row.sourceModel) === modelKey(source ?? ""));
			const savedTarget = models.find((model) => modelKey(model.modelId) === modelKey(currentChoice?.targetModelId ?? ""));
			const automatic = snapshot?.resolution?.automatic ?? snapshot?.resolution;
			const writable = ready && snapshot?.storageState === "ready" && !snapshot.writesPaused && !pending;
			const canSave = writable && snapshot?.pricingAvailable && ready && state.value.pricing !== null && state.value.pricing.costState !== "pricing-unavailable" && automatic !== void 0 && automatic.status !== "matched" && selected !== void 0 && source !== null;
			const searchModelId = modelKey(query.trim());
			const candidates = searchModelId === "" ? [] : models.filter((model) => modelKey(model.modelId).includes(searchModelId));
			const reload = () => {
				setOverride(null);
				setError(null);
				retry();
			};
			const mutate = async (operation, name) => {
				if (writing.current || snapshot === null || snapshot.revision === null) return;
				writing.current = true;
				setPending(true);
				setError(null);
				setNotice(null);
				try {
					const response = await fetch(ASSOCIATIONS_PATH, {
						method: operation === "save" ? "POST" : "DELETE",
						cache: "no-store",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							sourceModel: name,
							...operation === "save" ? { targetModelId: selected?.modelId } : {},
							revision: snapshot.revision,
							directoryToken: snapshot.directoryToken
						})
					});
					const result = await response.json();
					if (!response.ok) throw new AssociationRequestError(result.error ?? "write-failed", result.current);
					checkAssociations(result);
					pricingAssociationsChanged();
					if (!mounted.current) return;
					if (operation === "save") {
						dialogRef.current?.close();
						return;
					}
					setOverride(result);
					setConfirmRevoke(null);
					setNotice(t("association.revoked"));
				} catch (failure) {
					if (!mounted.current) return;
					if (failure instanceof AssociationRequestError && failure.current !== void 0) {
						setOverride(failure.current);
						if (failure.code === "directory-conflict") {
							setTarget(null);
							setDetail(null);
							setOverride(null);
							retry();
							pricingAssociationsChanged();
						}
					}
					setError(requestMessage(failure, t));
				} finally {
					writing.current = false;
					if (mounted.current) setPending(false);
				}
			};
			const revokeButtons = (name) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: confirmRevoke === name ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: `${PricingAssociations_module_css_default.actions} ${PricingAssociations_module_css_default.revokeConfirmation}`,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: PricingAssociations_module_css_default.note,
						children: t("association.revokeImpact")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: PricingAssociations_module_css_default.button,
						disabled: !writable,
						onClick: () => {
							mutate("delete", name);
						},
						children: t("association.confirmRevoke")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: PricingAssociations_module_css_default.button,
						disabled: pending,
						onClick: () => setConfirmRevoke(null),
						children: t("association.cancel")
					})
				]
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: PricingAssociations_module_css_default.button,
				disabled: !writable,
				onClick: () => setConfirmRevoke(name),
				children: t("association.revoke")
			}) });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dialog", {
				ref: dialogRef,
				className: `${PricingDialog_module_css_default.dialog} ${PricingAssociations_module_css_default.dialog}`,
				"aria-label": t("association.title"),
				onClose: (event) => {
					if (event.target === dialogRef.current) onClose();
				},
				onCancel: (event) => {
					if (event.target === dialogRef.current && writing.current) event.preventDefault();
				},
				onMouseDown: (event) => {
					backdropPress.current = event.target === dialogRef.current;
				},
				onClick: (event) => {
					if (event.target === dialogRef.current && backdropPress.current && !writing.current) dialogRef.current?.close();
				},
				onKeyDown: (event) => {
					if (event.key === "Escape") event.stopPropagation();
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PricingDialog_module_css_default.dialogHead,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: PricingDialog_module_css_default.dialogTitle,
							children: t("association.title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: PricingDialog_module_css_default.dialogClose,
							"aria-label": t("association.close"),
							disabled: pending,
							onClick: () => dialogRef.current?.close(),
							children: "✕"
						})]
					}),
					state.status === "loading" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("loading") }),
					state.status === "error" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						children: t("association.loadFailed")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: PricingAssociations_module_css_default.button,
						onClick: reload,
						children: t("retry")
					})] }),
					source !== null && ready && state.value.pricing === null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "alert",
						children: t("association.candidatesUnavailable")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: PricingAssociations_module_css_default.button,
						disabled: pending,
						onClick: reload,
						children: t("retry")
					})] }),
					error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						role: "alert",
						className: PricingAssociations_module_css_default.error,
						children: [
							error,
							" ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: PricingAssociations_module_css_default.button,
								disabled: pending,
								onClick: reload,
								children: t("association.refresh")
							})
						]
					}),
					notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						role: "status",
						children: notice
					}),
					snapshot !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						snapshot.storageState !== "ready" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "alert",
							children: t("pricing.associationStorageUnavailable")
						}),
						snapshot.writesPaused && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "status",
							children: t("association.migrating")
						}),
						!snapshot.pricingAvailable && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							role: "status",
							children: t("pricing.unavailable")
						}),
						source === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: PricingAssociations_module_css_default.note,
								children: t("association.allHint")
							}),
							snapshot.associations.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: PricingAssociations_module_css_default.note,
								children: t("association.empty")
							}),
							snapshot.associations.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: `${PricingAssociations_module_css_default.entry} ${PricingAssociations_module_css_default.mappingRow}`,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: PricingAssociations_module_css_default.name,
									children: [
										row.sourceModel,
										" → ",
										row.resolvedTargetModelId ?? row.targetModelId
									]
								}), revokeButtons(row.sourceModel)]
							}, modelKey(row.sourceModel)))
						] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: `${PricingAssociations_module_css_default.name} ${PricingAssociations_module_css_default.source}`,
								children: source
							}),
							automatic?.status === "ambiguous" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", { children: t("pricing.ambiguous", { models: automatic.candidates.join(", ") }) }),
							currentChoice !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
								className: PricingAssociations_module_css_default.entry,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: PricingAssociations_module_css_default.name,
										children: [
											source,
											" → ",
											currentChoice.resolvedTargetModelId ?? currentChoice.targetModelId
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AssociationStatus, {
										row: currentChoice,
										t
									}),
									savedTarget !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: PricingAssociations_module_css_default.button,
										onClick: () => setDetail(savedTarget),
										children: t("association.preview")
									}),
									revokeButtons(source)
								]
							}),
							automatic?.status === "matched" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", { children: [
								t("association.automaticOnly"),
								" ",
								automatic.modelId
							] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
									className: PricingAssociations_module_css_default.label,
									htmlFor: searchId,
									children: t("association.search")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									id: searchId,
									className: PricingAssociations_module_css_default.search,
									type: "search",
									placeholder: t("association.searchHint"),
									value: query,
									disabled: pending,
									onChange: (event) => {
										setQuery(event.target.value);
										setTarget(null);
									}
								}),
								candidates.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: PricingAssociations_module_css_default.candidates,
									role: "group",
									"aria-label": t("association.candidates"),
									children: candidates.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
										className: PricingAssociations_module_css_default.candidate,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												type: "radio",
												name: searchId + "-target",
												checked: target !== null && modelKey(target) === modelKey(model.modelId),
												disabled: !writable || !snapshot.pricingAvailable,
												onChange: () => {
													setTarget(model.modelId);
													setNotice(null);
												}
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: model.modelId }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: model.family })
										]
									}, model.modelId))
								}),
								query.trim() !== "" && candidates.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: PricingAssociations_module_css_default.note,
									children: t("association.noResults")
								}),
								selected !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: PricingAssociations_module_css_default.selection,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: PricingAssociations_module_css_default.name,
										children: t("association.target", { model: selected.modelId })
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: PricingAssociations_module_css_default.button,
										onClick: () => setDetail(selected),
										children: t("association.preview")
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: PricingAssociations_module_css_default.note,
									children: t("association.impact")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: `${PricingAssociations_module_css_default.button} ${PricingAssociations_module_css_default.save}`,
									disabled: !canSave,
									onClick: () => {
										mutate("save", source);
									},
									children: t(pending ? "association.saving" : "association.save")
								})
							] })
						] })
					] }),
					detail !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PricingDialog, {
						model: detail.modelId,
						rules: detail.rules,
						view: candidateView,
						t,
						onClose: () => setDetail(null)
					})
				]
			});
		}
		//#endregion
		//#region src/client/session-stats.ts
		/** Build a session-parent → direct-subagent-children index in one O(n) pass:
		* every session whose `origin === 'subagent'` lands in its `parentId`'s
		* bucket, in iteration order (so the result matches {@link directSubagentIds}).
		* @param rows - the retained session-summary mirror.
		* @returns the immutable child index.
		*/
		function buildChildIndex(rows) {
			const index = /* @__PURE__ */ new Map();
			for (const [id, summary] of Object.entries(rows)) {
				if (summary.origin !== "subagent" || summary.parentId === void 0) continue;
				const bucket = index.get(summary.parentId);
				if (bucket === void 0) index.set(summary.parentId, [id]);
				else bucket.push(id);
			}
			return index;
		}
		/** Look up the direct subagent children of one session. Falls back to a
		* fresh {@link buildChildIndex} when the caller has no cached index. */
		function directSubagentIds(rows, parentId, index) {
			if (index !== void 0) return index.get(parentId) ?? [];
			return buildChildIndex(rows).get(parentId) ?? [];
		}
		/**
		* The whole subagent subtree of one session, including the root itself,
		* using the parent → children index for an O(n) walk regardless of depth.
		* Cycles are bounded by a `seen` set (a depth-first traversal visits each
		* id once), so a self-referential or cyclic record set returns the root
		* alone. Stacks are reversed after pushing so siblings come back out in
		* insertion order, matching the runtime's lineage index.
		* @param rows - the retained session-summary mirror (unused when the
		* caller already built an index).
		* @param rootId - the scope's root session id.
		* @param index - optional precomputed index from {@link buildChildIndex}.
		* @returns the root and its subagent descendants, depth-first.
		*/
		function subtreeIds(rows, rootId, index = buildChildIndex(rows)) {
			const out = [rootId];
			if (!index.has(rootId) && rows[rootId] === void 0) return out;
			const seen = /* @__PURE__ */ new Set([rootId]);
			const stack = [];
			const seedChildren = index.get(rootId) ?? [];
			for (let i = seedChildren.length - 1; i >= 0; i -= 1) stack.push(seedChildren[i]);
			while (stack.length > 0) {
				const current = stack.pop();
				if (seen.has(current)) continue;
				seen.add(current);
				out.push(current);
				const children = index.get(current) ?? [];
				for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
			}
			return out;
		}
		/**
		* The immediate subagent parent of one session, when the record names one.
		* The check is on `parentId` rather than `origin` so a mirrored summary that
		* lost its origin tag still answers its lineage — the index is built once
		* per render and shared across all three helpers via {@link ChildIndex}.
		* @param rows - the retained session-summary mirror.
		* @param id - the current focus session id.
		* @returns the parent session id, or undefined when the record has no
		* parent link (a top-level session or an ordinary fork).
		*/
		function subagentParentOf(rows, id) {
			const parent = rows[id]?.parentId;
			return parent === void 0 || parent === id ? void 0 : parent;
		}
		/**
		* Sum one or more `SessionStatsProjection` values over a scope. A scope with
		* no value at all yields `undefined` — the view renders an em-dash for an
		* absent capability. The `contributing` count lets the caller tell
		* "every scope session was empty" apart from "the scope itself was empty".
		* @param values - the per-session projection values (typically drawn from
		* the mirror + the live hook).
		* @returns the summed buckets plus the contributing count, or undefined
		* when no projection was present.
		*/
		function aggregateProjections(values) {
			let ttftMs = 0;
			let ttftSteps = 0;
			let decodeMs = 0;
			let decodeTokens = 0;
			let contributing = 0;
			for (const stats of values) {
				if (stats === void 0) continue;
				contributing += 1;
				ttftMs += stats.ttftMs;
				ttftSteps += stats.ttftSteps;
				decodeMs += stats.decodeMs;
				decodeTokens += stats.decodeTokens;
			}
			if (contributing === 0) return void 0;
			return {
				ttftMs,
				ttftSteps,
				decodeMs,
				decodeTokens,
				contributing
			};
		}
		/**
		* Compact fingerprint of one session's retained stats projection — bumps on
		* every finished request step (same signal that drives TTFT / throughput).
		*/
		function sessionStatsFingerprint(stats) {
			if (stats === void 0) return "-";
			return [
				stats.steps,
				stats.ttftSteps,
				stats.decodeTokens,
				stats.turns
			].join(".");
		}
		/**
		* Build a debounce key from mirror `updatedAt` plus `sessionStats` churn.
		* The active session reads live projection values from `useProjection`; every
		* other scoped id reads the mirror copy.
		*/
		function buildStatsFreshnessKey(ids, options) {
			return ids.map((id) => {
				const row = options.rows[id];
				const stats = id === options.activeSessionId ? options.liveSessionStats ?? row?.projectionValues?.sessionStats : row?.projectionValues?.sessionStats;
				return `${id}:${String(row?.updatedAt ?? 0)}:${sessionStatsFingerprint(stats)}`;
			}).join(",");
		}
		//#endregion
		//#region src/client/use-color-scheme.ts
		/**
		* Shared browser-half hook: mirror the shell's root `color-scheme` onto a
		* plugin-owned root element. The shell sets the property on
		* `document.documentElement` only, so form controls inside plugin surfaces
		* render with the UA default (white) in dark mode; scoping the property to
		* the surface's root fixes selects, inputs, and dialogs without touching
		* anything outside it. Used by the settings section and the conversation
		* view tab.
		*
		* @module token-usage/client/use-color-scheme
		*/
		/**
		* Mirror the shell's `color-scheme` inline style onto the given root element.
		* @param rootRef - the surface's root element ref.
		*/
		function useColorSchemeMirror(rootRef) {
			(0, react.useEffect)(() => {
				const root = document.documentElement;
				const element = rootRef.current;
				if (element === null) return;
				const sync = () => {
					const scheme = root.style.colorScheme;
					if (scheme !== "") element.style.colorScheme = scheme;
					else element.style.removeProperty("color-scheme");
				};
				sync();
				const observer = new MutationObserver(sync);
				observer.observe(root, {
					attributes: true,
					attributeFilter: ["style"]
				});
				return () => observer.disconnect();
			}, [rootRef]);
		}
		/**
		* Hook reporting whether the current shell/page environment is in light mode.
		* Evaluates `document.documentElement.style.colorScheme` first (the DSH shell
		* rewrites this on every theme switch), falling back to `(prefers-color-scheme: light)`.
		*/
		function useIsLightMode() {
			const [isLight, setIsLight] = (0, react.useState)(() => {
				if (typeof document === "undefined") return false;
				const rootScheme = document.documentElement.style.colorScheme;
				if (rootScheme === "light") return true;
				if (rootScheme === "dark") return false;
				return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: light)").matches : false;
			});
			(0, react.useEffect)(() => {
				if (typeof document === "undefined") return;
				const root = document.documentElement;
				const media = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: light)") : null;
				const check = () => {
					const scheme = root.style.colorScheme;
					if (scheme === "light") setIsLight(true);
					else if (scheme === "dark") setIsLight(false);
					else setIsLight(media?.matches ?? false);
				};
				check();
				const observer = new MutationObserver(check);
				observer.observe(root, {
					attributes: true,
					attributeFilter: ["style"]
				});
				if (media?.addEventListener) media.addEventListener("change", check);
				return () => {
					observer.disconnect();
					if (media?.removeEventListener) media.removeEventListener("change", check);
				};
			}, []);
			return isLight;
		}
		//#endregion
		//#region src/client/cost-inflate-motion.ts
		/** The user's motion preference: both runners refuse to animate (returning
		* null) when the OS asks for reduced motion. Exported so the chip hook can
		* skip spawning the DOM for flies that would never animate — a static +Δ
		* flash reads as a glitch, not information. */
		function motionAllowed() {
			return typeof window.matchMedia !== "function" || !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		}
		function waapiAvailable(el) {
			return typeof el.animate === "function";
		}
		/** Scale bounce on the cost figure (`costPop`). The mix base is the pill's
		* resting tertiary (NOT label-primary): the pill reads tertiary beside the
		* official pills, and a primary-tinted final frame would leave the figure
		* permanently highlighted after the animation's fill. */
		function runCostPop(el, v) {
			if (!motionAllowed() || !waapiAvailable(el)) return null;
			const popScale = Number(v.popScale);
			const echo = 1 + (popScale - 1) * .28;
			const warnMix = v.warnMix;
			return el.animate([
				{
					transform: "scale(1)",
					color: "var(--dsw-alias-label-tertiary)"
				},
				{
					transform: `scale(${String(popScale)})`,
					color: `color-mix(in srgb, var(--dsw-alias-state-warn-primary) ${warnMix}, var(--dsw-alias-label-tertiary))`,
					offset: .35
				},
				{
					transform: `scale(${String(echo)})`,
					color: `color-mix(in srgb, var(--dsw-alias-state-warn-primary) ${warnMix}, var(--dsw-alias-label-tertiary))`,
					offset: .7
				},
				{
					transform: "scale(1)",
					color: "var(--dsw-alias-label-tertiary)"
				}
			], {
				duration: v.inflateMs,
				easing: "cubic-bezier(0.25, 0.85, 0.35, 1)"
			});
		}
		/** +Δ label fall (`deltaFall`). Caller must position the element (absolute,
		* below the pill — the dock sits under the composer, so the label falls
		* away from the message scrollport rather than climbing into it). */
		function runDeltaFly(el, v) {
			if (!motionAllowed() || !waapiAvailable(el)) return null;
			return el.animate([
				{
					opacity: 0,
					transform: "translate(-50%, 20%)"
				},
				{
					opacity: 1,
					transform: "translate(-50%, 20%)",
					offset: .15
				},
				{
					opacity: 0,
					transform: `translate(calc(-50% + ${v.flyX}), calc(100% + ${v.flyY}))`
				}
			], {
				duration: v.inflateMs,
				easing: "cubic-bezier(0.22, 0.55, 0.25, 1)",
				fill: "both"
			});
		}
		//#endregion
		//#region \0dsh-css:/Users/chii/.dsh/local-src/dsh-token-usage/src/client/CostPill.module.css.mjs
		const css$11 = "._4FMi4W_root{min-width:0;display:inline-flex;position:relative}._4FMi4W_pill{box-sizing:border-box;max-width:100%;color:var(--dsw-alias-label-tertiary);font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));font-variant-numeric:tabular-nums;white-space:nowrap;background:0 0;border:none;border-radius:999px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}._4FMi4W_glyph{flex:none;width:14px;height:14px}button._4FMi4W_pill{cursor:pointer}button._4FMi4W_pill:hover,button._4FMi4W_pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}._4FMi4W_cost{transform-origin:50%;z-index:2;display:inline-flex;position:relative}._4FMi4W_deltaLayer{pointer-events:none;z-index:3;position:absolute;inset:0;overflow:visible}._4FMi4W_deltaFly{color:var(--dsw-alias-state-warn-primary);font-variant-numeric:tabular-nums;white-space:nowrap;pointer-events:none;text-shadow:0 0 8px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 35%, transparent);margin-top:2px;font-size:11px;font-weight:600;position:absolute;top:100%;left:50%}@media (prefers-reduced-motion:reduce){._4FMi4W_deltaFly{display:none}}._4FMi4W_panel{background:var(--dsw-specific-menu);width:300px;backdrop-filter:var(--dsw-menu-backdrop-filter);border:1px solid var(--dsw-alias-border-inverted);box-shadow:var(--dsw-shadow-lv3);z-index:30;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);color:var(--dsw-alias-label-primary);border-radius:12px;padding:12px 14px;position:absolute;bottom:calc(100% + 8px)}._4FMi4W_panelHead{border-bottom:1px solid var(--dsw-alias-border-l1);justify-content:space-between;align-items:baseline;padding-bottom:8px;display:flex}._4FMi4W_panelTitle{align-items:center;gap:6px;font-weight:600;display:inline-flex}._4FMi4W_scopeTag{color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:1px 5px;font-size:10px;font-weight:400}._4FMi4W_panelTotal{font-variant-numeric:tabular-nums;font-size:14px;font-weight:600}._4FMi4W_usageLine{font-variant-numeric:tabular-nums;align-items:center;gap:6px;margin-top:8px;display:flex}._4FMi4W_dot{color:var(--dsw-alias-separator-primary)}._4FMi4W_rows{flex-direction:column;margin-top:8px;display:flex}._4FMi4W_row{font-variant-numeric:tabular-nums;justify-content:space-between;padding:4px 0;display:flex}._4FMi4W_rowLabel{color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;display:inline-flex}._4FMi4W_rowValue{color:var(--dsw-alias-label-primary)}._4FMi4W_rowSub ._4FMi4W_rowValue{color:var(--dsw-alias-label-secondary)}._4FMi4W_tok{color:var(--dsw-alias-label-tertiary);margin-left:6px;font-size:11px}._4FMi4W_groupLabel{color:var(--dsw-alias-label-tertiary);letter-spacing:.06em;margin-top:10px;font-size:10px}._4FMi4W_requests{color:var(--dsw-alias-label-tertiary);font-size:11px}._4FMi4W_unpriced ._4FMi4W_rowLabel,._4FMi4W_unpriced ._4FMi4W_rowValue{color:var(--dsw-alias-label-tertiary);font-style:italic}._4FMi4W_pending{color:var(--dsw-alias-label-tertiary)}";
		const tagId$11 = "@laoyuehanni/dsh-token-usage/CostPill.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$11) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-token-usage";
			tag.dataset.pluginCss = tagId$11;
			tag.textContent = css$11;
			document.head.appendChild(tag);
		}
		var CostPill_module_css_default = {
			"cost": "_4FMi4W_cost",
			"deltaFly": "_4FMi4W_deltaFly",
			"deltaLayer": "_4FMi4W_deltaLayer",
			"dot": "_4FMi4W_dot",
			"glyph": "_4FMi4W_glyph",
			"groupLabel": "_4FMi4W_groupLabel",
			"panel": "_4FMi4W_panel",
			"panelHead": "_4FMi4W_panelHead",
			"panelTitle": "_4FMi4W_panelTitle",
			"panelTotal": "_4FMi4W_panelTotal",
			"pending": "_4FMi4W_pending",
			"pill": "_4FMi4W_pill",
			"requests": "_4FMi4W_requests",
			"root": "_4FMi4W_root",
			"row": "_4FMi4W_row",
			"rowLabel": "_4FMi4W_rowLabel",
			"rowSub": "_4FMi4W_rowSub",
			"rowValue": "_4FMi4W_rowValue",
			"rows": "_4FMi4W_rows",
			"scopeTag": "_4FMi4W_scopeTag",
			"tok": "_4FMi4W_tok",
			"unpriced": "_4FMi4W_unpriced",
			"usageLine": "_4FMi4W_usageLine"
		};
		//#endregion
		//#region src/client/CostDeltaFlyLabel.tsx
		/** One +Δ fly label; animation starts on mount via WAAPI. */
		function CostDeltaFlyLabel({ text, vars }) {
			const ref = (0, react.useRef)(null);
			(0, react.useLayoutEffect)(() => {
				const el = ref.current;
				if (el === null) return;
				const anim = runDeltaFly(el, vars);
				if (anim === null) {
					el.style.visibility = "hidden";
					return;
				}
				return () => {
					anim.cancel();
				};
			}, [vars]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				ref,
				className: CostPill_module_css_default["deltaFly"],
				children: text
			});
		}
		//#endregion
		//#region src/client/cost-inflate.ts
		const MISS_RATE_CAP = .55;
		const OUT_CAP = 32e3;
		/** Clamp to the unit interval. */
		function clamp01(n) {
			return Math.max(0, Math.min(1, n));
		}
		/** Token totals of one refresh minus the previous snapshot (non-negative). */
		function deltaTotals(prev, next) {
			return {
				requests: Math.max(0, next.requests - prev.requests),
				inputTokens: Math.max(0, next.inputTokens - prev.inputTokens),
				outputTokens: Math.max(0, next.outputTokens - prev.outputTokens),
				cacheReadTokens: Math.max(0, next.cacheReadTokens - prev.cacheReadTokens),
				cacheWriteTokens: Math.max(0, next.cacheWriteTokens - prev.cacheWriteTokens)
			};
		}
		/**
		* Single-step intensity from the latest request's token delta (not session
		* cumulative hit rate): `I = clamp01(0.55·norm(miss) + 0.45·norm(output))`.
		*/
		function computeIntensityFromDelta(delta) {
			const served = delta.inputTokens + delta.cacheReadTokens;
			const miss = clamp01((1 - (served > 0 ? delta.cacheReadTokens / served : .5)) / MISS_RATE_CAP);
			const out = clamp01(delta.outputTokens / OUT_CAP);
			return clamp01(.55 * miss + .45 * out);
		}
		function lerp(a, b, t) {
			return a + (b - a) * t;
		}
		/** Map step intensity I to animation parameters. */
		function animVars(I) {
			return {
				inflateMs: Math.round(lerp(1e3, 1800, I)),
				popScale: lerp(1.08, 1.32, I).toFixed(3),
				warnMix: `${Math.round(lerp(0, 55, I))}%`,
				flyY: `${lerp(22, 38, I).toFixed(1)}px`,
				flyX: `${((Math.random() - .5) * 10).toFixed(1)}px`
			};
		}
		//#endregion
		//#region src/client/use-cost-inflate.ts
		/**
		* Request-driven cost-figure inflate animation for the composer-dock usage
		* pill: detects new usage from summary deltas and drives WAAPI motion on
		* the cost figure and ephemeral +Δ fly labels.
		*
		* @module token-usage/client/use-cost-inflate
		*/
		const MIN_WIRE_DELTA_COST = 5e-4;
		function hasUsageChurn(prev, summary) {
			const delta = deltaTotals(prev.totals, summary.total);
			if (delta.requests > 0) return true;
			if (summary.totalCost - prev.totalCost > MIN_WIRE_DELTA_COST) return true;
			return totalTokens(delta) > 0;
		}
		/**
		* Hook the pill uses to play costPop + deltaFall on each new request.
		* @param scopeKey - changes reset the diff baseline.
		* @param costRef - the live cost figure span (WAAPI target).
		*/
		function useCostInflate(scopeKey, costRef) {
			const prevRef = (0, react.useRef)(null);
			const flyIdRef = (0, react.useRef)(0);
			const timersRef = (0, react.useRef)([]);
			const flyCountRef = (0, react.useRef)(0);
			const popAnimRef = (0, react.useRef)(null);
			const [flies, setFlies] = (0, react.useState)([]);
			const [flyOverflow, setFlyOverflow] = (0, react.useState)(false);
			const clearTimers = (0, react.useCallback)(() => {
				for (const id of timersRef.current) window.clearTimeout(id);
				timersRef.current = [];
			}, []);
			const schedule = (0, react.useCallback)((fn, ms) => {
				const id = window.setTimeout(fn, ms);
				timersRef.current.push(id);
			}, []);
			const reset = (0, react.useCallback)(() => {
				clearTimers();
				popAnimRef.current?.cancel();
				popAnimRef.current = null;
				prevRef.current = null;
				flyIdRef.current = 0;
				flyCountRef.current = 0;
				setFlies([]);
				setFlyOverflow(false);
			}, [clearTimers]);
			(0, react.useEffect)(() => {
				reset();
			}, [scopeKey, reset]);
			(0, react.useEffect)(() => () => {
				clearTimers();
			}, [clearTimers]);
			const maybeClearOverflow = (0, react.useCallback)(() => {
				if (flyCountRef.current <= 0) setFlyOverflow(false);
			}, []);
			const playCostPop = (0, react.useCallback)((v) => {
				const el = costRef.current;
				if (el === null) return;
				popAnimRef.current?.cancel();
				popAnimRef.current = runCostPop(el, v);
			}, [costRef]);
			return {
				flies,
				flyOverflow,
				onSummary: (0, react.useCallback)((summary) => {
					if (!costsAvailable(summary.costState)) {
						reset();
						return;
					}
					const nextSnapshot = {
						totals: summary.total,
						totalCost: summary.totalCost
					};
					const prev = prevRef.current;
					prevRef.current = nextSnapshot;
					if (prev === null) return;
					if (!hasUsageChurn(prev, summary)) return;
					if (!motionAllowed()) return;
					const v = animVars(computeIntensityFromDelta(deltaTotals(prev.totals, summary.total)));
					setFlyOverflow(true);
					window.requestAnimationFrame(() => {
						playCostPop(v);
					});
					const wireDeltaCost = summary.totalCost - prev.totalCost;
					if (wireDeltaCost > MIN_WIRE_DELTA_COST) {
						const view = currencyViewOf(summary);
						const text = `+${(wireDeltaCost / view.rate).toFixed(2)}${view.symbol}`;
						const id = ++flyIdRef.current;
						flyCountRef.current += 1;
						setFlies((current) => [...current, {
							id,
							text,
							vars: v
						}]);
						schedule(() => {
							flyCountRef.current -= 1;
							setFlies((current) => current.filter((fly) => fly.id !== id));
							maybeClearOverflow();
						}, v.inflateMs + 40);
					} else schedule(maybeClearOverflow, v.inflateMs + 40);
				}, [
					maybeClearOverflow,
					playCostPop,
					schedule,
					reset
				]),
				reset
			};
		}
		//#endregion
		//#region src/client/CostPill.tsx
		/**
		* Composer-dock usage pill (browser half): a cost trigger registered into
		* the `conversation.composer.dock` slot (`order: 10`, after the official
		* stats pills at `order: 0`), rendered as one capsule in the official
		* StatsPills skin. The figure is the WITH-SUBAGENTS fold — the one number
		* no official surface carries — suffixed with a quiet "with subagents"
		* badge only when the scope actually spans a subtree; a solo session's
		* cost renders bare, same scope as the official pills beside it.
		*
		* Clicking opens a detail panel (harness menu chrome, upward of the dock)
		* that explains the total: the folded token figure and cache-hit rate next
		* to it (official pills carry only the single-session token count, so the
		* subtree share has no home but here), the session / subagents split, and
		* a per-model breakdown with the unpriced-models footnote. Panel data is
		* LAZY: the trigger polls `fields=chip` (totals only, subtree scope); the
		* two richer reads (`fields=session` for byModel, a solo-session `chip`
		* read for the split) fire when the panel first opens and again whenever
		* request churn debounces through.
		*
		* The pill refreshes at REQUEST granularity (the header chip's former
		* cadence, inherited whole): `sessionStats` projection churn plus mirror
		* `updatedAt` is debounced 250 ms into one fetch, a failed FIRST fetch
		* retries itself on a 3 s cadence, and later failures keep the prior
		* figures. When cost rises on a new request the figure plays `costPop`
		* and a +Δ label FALLS below the pill (the dock sits under the composer;
		* the header chip's upward rise would climb into the message scrollport).
		* Reduced-motion users get silent figure updates.
		*
		* Visibility contract: a session with no recorded requests renders
		* nothing; a transient fetch miss keeps the previous render.
		*
		* @module token-usage/client/CostPill
		*/
		/** Refresh debounce: bursts of session-mirror updates (one request's events)
		* collapse into a single fetch — the header chip's request-scale cadence. */
		const REFRESH_DEBOUNCE_MS$1 = 250;
		/** Self-heal cadence after a failed first fetch: refresh failures after the
		* first land keep the prior figures (silent mode) and self-heal on the next
		* request churn, so they never reach the error state. */
		const FETCH_FAILURE_RETRY_MS = 3e3;
		/** Detail panel width (px); the viewport-clamped centering uses it. */
		const PANEL_WIDTH = 300;
		const PANEL_VIEWPORT_MARGIN$1 = 16;
		/**
		* Subtract a solo-session summary from its subtree fold.
		* @param tree - the subtree-scoped folded summary.
		* @param self - the solo-session summary (same session, no children).
		* @returns the two shares; costs and tokens are additive so subtraction is
		* exact, and the hit rate is NEVER split (a ratio is not subtractable — the
		* panel recomputes the folded rate from the tree totals instead).
		*/
		function splitUsage(tree, self) {
			const sub = (whole, part) => whole - part > 0 ? whole - part : 0;
			return {
				selfCost: self.totalCost,
				subsCost: sub(tree.totalCost, self.totalCost),
				selfTokens: totalTokens(self.total),
				subsTokens: sub(totalTokens(tree.total), totalTokens(self.total))
			};
		}
		/**
		* Render the composer-dock usage pill for the active session. Renders
		* nothing when the session has no recorded usage or while the first fetch
		* is in flight — the "data has no value, the block does not render" rule.
		* @param props - framework session id, the session-list mirror, and the locale seat.
		* @returns the pill (plus its open detail panel), or null when empty/unavailable.
		*/
		function CostPill({ sessionId, useSessions, useProjection, t }) {
			const rootRef = (0, react.useRef)(null);
			const costRef = (0, react.useRef)(null);
			useColorSchemeMirror(rootRef);
			const [open, setOpen] = (0, react.useState)(false);
			const [associationTick, setAssociationTick] = (0, react.useState)(0);
			usePricingAssociationRefresh(() => setAssociationTick((tick) => tick + 1));
			const byId = useSessions((state) => state.byId);
			const childIndex = (0, react.useMemo)(() => buildChildIndex(byId), [byId]);
			const scopeIds = (0, react.useMemo)(() => sessionId === "" ? [] : subtreeIds(byId, sessionId, childIndex), [
				byId,
				sessionId,
				childIndex
			]);
			const hasSubs = scopeIds.length > 1;
			const freshnessKey = buildStatsFreshnessKey(scopeIds, {
				activeSessionId: sessionId,
				rows: byId,
				liveSessionStats: useProjection("sessionStats")
			});
			const debouncedKey = useDebouncedValue(`${scopeIds.join("\n")}\n\t${freshnessKey}`, REFRESH_DEBOUNCE_MS$1);
			const { flies, onSummary } = useCostInflate(scopeIds.join("\n"), costRef);
			const [treeRes, retryTree] = useAsyncResource((signal) => {
				const [idsPart] = debouncedKey.split("\n	");
				return fetchSummary$1((idsPart ?? "").split("\n").filter((id) => id !== ""), "chip", signal);
			}, [debouncedKey, associationTick], {
				silentAfterFirst: true,
				retryToken: 0
			});
			const summary = treeRes.status === "ready" ? treeRes.value : null;
			(0, react.useEffect)(() => {
				if (summary !== null) onSummary(summary);
			}, [summary, onSummary]);
			(0, react.useEffect)(() => {
				if (treeRes.status !== "error") return;
				const timer = window.setTimeout(retryTree, FETCH_FAILURE_RETRY_MS);
				return () => {
					window.clearTimeout(timer);
				};
			}, [treeRes, retryTree]);
			const [detailRes] = useAsyncResource((signal) => {
				if (!open) return Promise.resolve(null);
				const [idsPart] = debouncedKey.split("\n	");
				return fetchSummary$1((idsPart ?? "").split("\n").filter((id) => id !== ""), "session", signal);
			}, [
				open,
				debouncedKey,
				associationTick
			], {
				silentAfterFirst: true,
				retryToken: 0
			});
			const [selfRes] = useAsyncResource((signal) => {
				if (!open || sessionId === "") return Promise.resolve(null);
				return fetchSummary$1([sessionId], "chip", signal);
			}, [
				open,
				sessionId,
				debouncedKey,
				associationTick
			], {
				silentAfterFirst: true,
				retryToken: 0
			});
			(0, react.useEffect)(() => {
				setOpen(false);
			}, [sessionId]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					if (event.target instanceof Node && rootRef.current?.contains(event.target) === true) return;
					setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open]);
			const [panelLeft, setPanelLeft] = (0, react.useState)(void 0);
			const measurePanelLeft = (0, react.useCallback)(() => {
				const wrapper = rootRef.current;
				if (wrapper === null) return;
				const { left: wrapperLeft, width: wrapperWidth } = wrapper.getBoundingClientRect();
				const panelWidth = Math.min(PANEL_WIDTH, window.innerWidth - 32);
				const desired = (wrapperWidth - panelWidth) / 2;
				const minLeft = PANEL_VIEWPORT_MARGIN$1 - wrapperLeft;
				const maxLeft = window.innerWidth - PANEL_VIEWPORT_MARGIN$1 - panelWidth - wrapperLeft;
				setPanelLeft(Math.min(Math.max(desired, minLeft), Math.max(minLeft, maxLeft)));
			}, []);
			(0, react.useEffect)(() => {
				if (!open) return;
				measurePanelLeft();
				window.addEventListener("resize", measurePanelLeft);
				return () => {
					window.removeEventListener("resize", measurePanelLeft);
				};
			}, [open, measurePanelLeft]);
			if (summary === null || summary.total.requests === 0) return null;
			const view = currencyViewOf(summary);
			const costText = costsAvailable(summary.costState) ? formatCost(summary.totalCost, view) : "—";
			const tokensValue = formatTokens(totalTokens(summary.total));
			const hit = hitRateDisplay(summary.total);
			const ariaLabel = hasSubs ? t("pill.costWithSubs", { value: costText }) : t("pill.cost", { value: costText });
			const selfSummary = selfRes.status === "ready" ? selfRes.value : null;
			const detail = detailRes.status === "ready" ? detailRes.value : null;
			const split = selfSummary !== null ? splitUsage(summary, selfSummary) : null;
			const subCount = scopeIds.length - 1;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: rootRef,
				className: CostPill_module_css_default.root,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(PricingAssociationProvider, {
					resolutions: detail?.modelResolutions,
					feedVersion: summary.feedVersion,
					view,
					t,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: CostPill_module_css_default.pill,
						"aria-haspopup": "dialog",
						"aria-expanded": open,
						"aria-label": `${ariaLabel}，${t("panel.openHint")}`,
						onClick: () => {
							setOpen(!open);
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
								className: CostPill_module_css_default.glyph,
								viewBox: "0 0 14 14",
								width: "14",
								height: "14",
								"aria-hidden": true,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
									cx: "7",
									cy: "7",
									r: "5.5",
									fill: "none",
									stroke: "currentColor",
									strokeWidth: "1.2"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
									d: "M4.8 4.5 L7 7.2 L9.2 4.5 M7 7.2 V10 M5.2 8 H8.8 M5.2 9.4 H8.8",
									fill: "none",
									stroke: "currentColor",
									strokeWidth: "1.2"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								ref: costRef,
								className: CostPill_module_css_default.cost,
								children: costText
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: CostPill_module_css_default.deltaLayer,
								"aria-hidden": "true",
								children: flies.map((fly) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CostDeltaFlyLabel, {
									text: fly.text,
									vars: fly.vars
								}, fly.id))
							})
						]
					}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: CostPill_module_css_default.panel,
						role: "dialog",
						"aria-label": t("panel.title"),
						style: { left: panelLeft },
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: CostPill_module_css_default.panelHead,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: CostPill_module_css_default.panelTitle,
									children: [t("panel.title"), hasSubs && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: CostPill_module_css_default.scopeTag,
										children: t("pill.scopeTag")
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: CostPill_module_css_default.panelTotal,
									children: costText
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: CostPill_module_css_default.usageLine,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("panel.tokens", { value: tokensValue }) }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: CostPill_module_css_default.dot,
										children: "·"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("panel.hitRate", { value: hit.text }) })
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: CostPill_module_css_default.rows,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PricingStatus, {
										costState: summary.costState,
										pricingUnavailableReason: summary.pricingUnavailableReason,
										associationStorageError: summary.associationStorageError,
										t
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: CostPill_module_css_default.row,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: CostPill_module_css_default.rowLabel,
											children: t("panel.self")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: CostPill_module_css_default.rowValue,
											children: split === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: CostPill_module_css_default.pending,
												children: "…"
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [costsAvailable(summary.costState) && costsAvailable(selfSummary?.costState) ? formatCost(split.selfCost, view) : "—", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: CostPill_module_css_default.tok,
												children: t("panel.tokens", { value: formatTokens(split.selfTokens) })
											})] })
										})]
									}),
									hasSubs && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: `${CostPill_module_css_default.row} ${CostPill_module_css_default.rowSub}`,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: CostPill_module_css_default.rowLabel,
											children: t("panel.subs", { count: subCount })
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: CostPill_module_css_default.rowValue,
											children: split === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: CostPill_module_css_default.pending,
												children: "…"
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [costsAvailable(summary.costState) && costsAvailable(selfSummary?.costState) ? formatCost(split.subsCost, view) : "—", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: CostPill_module_css_default.tok,
												children: t("panel.tokens", { value: formatTokens(split.subsTokens) })
											})] })
										})]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: CostPill_module_css_default.groupLabel,
								children: t("panel.byModel")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: CostPill_module_css_default.rows,
								children: detail === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: CostPill_module_css_default.row,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: CostPill_module_css_default.pending,
										children: "…"
									})
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [detail.byModel.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelRow, {
									row,
									view,
									t,
									unpriced: detail.unpricedModels.includes(row.model),
									available: costsAvailable(detail.costState) && !detail.unpricedModels.includes(row.model)
								}, row.model)), costsAvailable(detail.costState) && detail.unpricedModels.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: `${CostPill_module_css_default.row} ${CostPill_module_css_default.unpriced}`,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: CostPill_module_css_default.rowLabel,
										children: t("panel.unpriced", { count: detail.unpricedModels.length })
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: CostPill_module_css_default.rowValue,
										children: t("panel.unpricedNote")
									})]
								})] })
							})
						]
					})]
				})
			});
		}
		/** One per-model breakdown row: model id + request count, billed cost, tokens. */
		function ModelRow({ row, view, available, unpriced, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: CostPill_module_css_default.row,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: CostPill_module_css_default.rowLabel,
					children: [
						row.model,
						unpriced && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnpricedModelTag, {
							model: row.model,
							t
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelAssociationBadge, {
							model: row.model,
							t
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: CostPill_module_css_default.requests,
							children: ["× ", row.totals.requests]
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: CostPill_module_css_default.rowValue,
					children: [available ? formatCost(row.cost, view) : "—", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: CostPill_module_css_default.tok,
						children: formatTokens(totalTokens(row.totals))
					})]
				})]
			});
		}
		/** Defensive shape check: an older host build or a misrouted response
		* would otherwise paint the pill with garbage. */
		function looksLikeUsageSummary(value) {
			return typeof value === "object" && value !== null && typeof value.total === "object" && value.total !== null;
		}
		/**
		* Fetch one stats summary. Throws on transport failure (network, abort,
		* non-2xx response, or a payload that doesn't look like a stats summary) so
		* the hook can keep the previous render in place.
		* @param sessionIds - the scope's session ids; an empty list skips the
		* fetch (returning null rather than throwing, so the hook's first-load
		* gate stays at "loading").
		* @param fields - `chip` for totals-only reads, `session` when byModel is
		* needed (the detail panel's per-model block).
		* @param signal - the cancellation signal from the hook.
		*/
		async function fetchSummary$1(sessionIds, fields, signal) {
			if (sessionIds.length === 0) return null;
			const response = await fetch(STATS_PATH + encodeStatsQuery({
				sessionIds,
				fields
			}), {
				headers: { accept: "application/json" },
				signal
			});
			if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
			const value = await response.json();
			if (!looksLikeUsageSummary(value)) throw new Error("unexpected stats response");
			return value;
		}
		//#endregion
		//#region src/client/quota-format.ts
		/** Severity thresholds on the REMAINING share (percent) — the traffic-light
		* standard: above 60 reads green (plenty left), 20–60 yellow (watch it),
		* below 20 red (effectively gone). */
		const REMAIN_YELLOW = 60;
		const REMAIN_RED = 20;
		/** Whole-number percent, one decimal kept when it exists (`62%`, `87.5%`). */
		function formatQuotaPercent(value) {
			const rounded = Math.round(value * 10) / 10;
			return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}%`;
		}
		/** A money figure with its symbol: `$6.80` / `¥110.00`. */
		function formatQuotaMoney(value, unit) {
			return `${unit === "usd" ? "$" : "¥"}${value.toFixed(2)}`;
		}
		/**
		* The used share of one window, 0–100, whichever direction the provider
		* reported: the explicit `usedPercent`, else `remainingPercent` inverted,
		* else the balance fraction (`1 - remaining/max`). Undefined when the
		* window carries no computable ratio (a balance without a total).
		*/
		function quotaUsedPercent(window) {
			if (window.usedPercent !== void 0) return clampPercent(window.usedPercent);
			if (window.remainingPercent !== void 0) return clampPercent(100 - window.remainingPercent);
			if (window.remainingValue !== void 0 && window.maxValue !== void 0 && window.maxValue > 0) return clampPercent((1 - window.remainingValue / window.maxValue) * 100);
		}
		/**
		* The remaining share of one window, 0–100 — the severity input (severity
		* reads what is LEFT, not what is spent). Mirrors {@link quotaUsedPercent}'s
		* fallback chain in the opposite direction.
		*/
		function quotaRemainingPercent(window) {
			if (window.remainingPercent !== void 0) return clampPercent(window.remainingPercent);
			if (window.usedPercent !== void 0) return clampPercent(100 - window.usedPercent);
			if (window.remainingValue !== void 0 && window.maxValue !== void 0 && window.maxValue > 0) return clampPercent(window.remainingValue / window.maxValue * 100);
		}
		/** Map a remaining share (percent) to the traffic-light band: green above
		* 60, yellow 20–60, red below 20. A window with no computable ratio reads
		* by its absolute amount: an overdrawn/empty balance (≤ 0) is red,
		* anything else uncolored — a plain balance never paints alarm just for
		* lacking a total. */
		function quotaSeverityOf(window) {
			const remaining = quotaRemainingPercent(window);
			if (remaining === void 0) return window.remainingValue !== void 0 && window.remainingValue <= 0 ? "exhausted" : "ok";
			if (remaining < REMAIN_RED) return "exhausted";
			if (remaining <= REMAIN_YELLOW) return "warn";
			return "ok";
		}
		/**
		* The FINEST-granularity window of a payload — 5-hour over weekly over
		* monthly over balance. The trigger icon reads this one, not the worst
		* across windows: the finest unit is the constraint the session is
		* currently acting inside (a calm 5-hour window carries the icon even when
		* the weekly pool runs low). Undefined when there is no window at all.
		*/
		function finestQuotaWindow(windows) {
			const rank = {
				five_hour: 0,
				weekly: 1,
				monthly: 2,
				balance: 3
			};
			let pick;
			for (const window of windows) if (pick === void 0 || rank[window.tier] < rank[pick.tier]) pick = window;
			return pick;
		}
		/**
		* Fill share of the trigger ring, 0–1. Ratio windows map the remaining
		* percent; a funded balance without a total paints a full ring (the color
		* stays neutral — amounts tint only at ≤ 0); empty / overdrawn / missing
		* windows leave the track only.
		*/
		function quotaIconFillShare(window) {
			if (window === void 0) return 0;
			const remaining = quotaRemainingPercent(window);
			if (remaining !== void 0) return remaining / 100;
			if (window.remainingValue !== void 0 && window.remainingValue > 0) return 1;
			return 0;
		}
		/**
		* The trigger tooltip's figure for one window: the remaining share as a
		* percent when a ratio exists (any direction, or the balance fraction),
		* else the remaining amount (a ratio-less balance, the DeepSeek shape);
		* undefined when the window carries neither (nothing to show beyond the
		* plain label).
		*/
		function quotaTriggerFigure(window) {
			if (window === void 0) return void 0;
			const remaining = quotaRemainingPercent(window);
			if (remaining !== void 0) return formatQuotaPercent(remaining);
			if (window.remainingValue !== void 0) return formatQuotaMoney(window.remainingValue, window.unit ?? "cny");
		}
		/**
		* The reset countdown in the shell's compact shape: `2h 14m` under a day,
		* `48m` under an hour, `1d 3h` above; a non-positive remainder reads `0m`
		* (the next poll refreshes the stale window).
		* @param resetAt - epoch ms of the window's reset.
		* @param now - epoch ms the countdown is taken at.
		*/
		function formatResetCountdown(resetAt, now) {
			const minutes = Math.max(0, Math.floor((resetAt - now) / 6e4));
			if (minutes < 60) return `${String(minutes)}m`;
			const hours = Math.floor(minutes / 60);
			if (hours < 24) return `${String(hours)}h ${String(minutes % 60)}m`;
			return `${String(Math.floor(hours / 24))}d ${String(hours % 24)}h`;
		}
		/** A wall-clock `HH:MM` stamp of an epoch-ms time (the "updated at" figure). */
		function formatQuotaClock(ms) {
			const date = new Date(ms);
			const pad = (value) => String(value).padStart(2, "0");
			return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
		}
		/** Clamp into 0–100. */
		function clampPercent(value) {
			return Math.min(100, Math.max(0, value));
		}
		//#endregion
		//#region \0dsh-css:/Users/chii/.dsh/local-src/dsh-token-usage/src/client/QuotaButton.module.css.mjs
		const css$10 = ".ifQetG_root{flex:none;display:inline-flex;position:relative}.ifQetG_trigger{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:999px;flex:none;place-items:center;padding:0;display:grid}.ifQetG_trigger svg{display:block}.ifQetG_trigger:hover,.ifQetG_trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.ifQetG_trigger.ifQetG_icon-ok:hover,.ifQetG_trigger.ifQetG_icon-ok[aria-expanded=true]{color:var(--dsw-alias-state-success-primary)}.ifQetG_trigger.ifQetG_icon-warn:hover,.ifQetG_trigger.ifQetG_icon-warn[aria-expanded=true]{color:var(--dsw-alias-state-warn-primary)}.ifQetG_trigger.ifQetG_icon-exhausted:hover,.ifQetG_trigger.ifQetG_icon-exhausted[aria-expanded=true]{color:var(--dsw-alias-state-error-primary)}.ifQetG_icon-ok{color:var(--dsw-alias-state-success-primary)}.ifQetG_icon-warn{color:var(--dsw-alias-state-warn-primary)}.ifQetG_icon-exhausted{color:var(--dsw-alias-state-error-primary)}.ifQetG_panel{z-index:100;box-sizing:border-box;border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-specific-menu);width:320px;max-width:calc(100vw - 32px);backdrop-filter:var(--dsw-menu-backdrop-filter);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-secondary);text-align:left;cursor:default;border-radius:12px;padding:12px;font-size:12px;line-height:20px;position:absolute;bottom:calc(100% + 8px)}.ifQetG_header{justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:10px;display:flex}.ifQetG_title{color:var(--dsw-alias-label-primary);white-space:nowrap;text-overflow:ellipsis;font-size:13px;font-weight:500;overflow:hidden}.ifQetG_plan{color:var(--dsw-alias-label-tertiary);font-weight:400}.ifQetG_updated{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none;font-size:11px}.ifQetG_grid{grid-template-columns:repeat(var(--cols,3), 1fr);gap:14px;display:grid}.ifQetG_col{min-width:0}.ifQetG_label{color:var(--dsw-alias-label-tertiary);white-space:nowrap;text-overflow:ellipsis;margin-bottom:2px;font-size:11px;line-height:16px;overflow:hidden}.ifQetG_value{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;white-space:nowrap;margin-bottom:6px;font-size:13px;font-weight:600;line-height:18px}.ifQetG_meta{color:var(--dsw-alias-label-tertiary);font-size:11px;font-weight:400}.ifQetG_bar{background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;height:4px;overflow:hidden}.ifQetG_fill{border-radius:999px;height:100%;transition:width .3s}.ifQetG_ok{background:var(--dsw-alias-state-success-primary)}.ifQetG_warn{background:var(--dsw-alias-state-warn-primary)}.ifQetG_exhausted{background:var(--dsw-alias-state-error-primary)}.ifQetG_aux{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap;margin-top:4px;font-size:11px;line-height:14px}.ifQetG_dot{vertical-align:middle;border-radius:50%;width:5px;height:5px;margin-right:3px;display:inline-block}.ifQetG_error{flex-direction:column;gap:8px;display:flex}.ifQetG_errorText{color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;font-size:12px;line-height:18px}.ifQetG_retry{color:var(--dsw-alias-label-primary);cursor:pointer;text-underline-offset:2px;background:0 0;border:none;align-self:flex-start;padding:0;font-size:12px;text-decoration:underline}.ifQetG_retry:hover{color:var(--dsw-alias-brand-primary)}";
		const tagId$10 = "@laoyuehanni/dsh-token-usage/QuotaButton.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$10) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-token-usage";
			tag.dataset.pluginCss = tagId$10;
			tag.textContent = css$10;
			document.head.appendChild(tag);
		}
		var QuotaButton_module_css_default = {
			"aux": "ifQetG_aux",
			"bar": "ifQetG_bar",
			"col": "ifQetG_col",
			"dot": "ifQetG_dot",
			"error": "ifQetG_error",
			"errorText": "ifQetG_errorText",
			"exhausted": "ifQetG_exhausted",
			"fill": "ifQetG_fill",
			"grid": "ifQetG_grid",
			"header": "ifQetG_header",
			"icon-exhausted": "ifQetG_icon-exhausted",
			"icon-ok": "ifQetG_icon-ok",
			"icon-warn": "ifQetG_icon-warn",
			"label": "ifQetG_label",
			"meta": "ifQetG_meta",
			"ok": "ifQetG_ok",
			"panel": "ifQetG_panel",
			"plan": "ifQetG_plan",
			"retry": "ifQetG_retry",
			"root": "ifQetG_root",
			"title": "ifQetG_title",
			"trigger": "ifQetG_trigger",
			"updated": "ifQetG_updated",
			"value": "ifQetG_value",
			"warn": "ifQetG_warn"
		};
		//#endregion
		//#region src/client/QuotaButton.tsx
		/**
		* Input-bar quota button (browser half): a 28×28 round trigger registered
		* into the `conversation.input.right` slot (it renders left of the model
		* chip — the host's fixed tool-row order). The glyph is a remaining-share
		* ring (ContextMeter family) colored by the finest window. Clicking opens a
		* width-tiered popup (amount-only 200px / one progress bar 232px / two
		* bars 320px) centered on the button with the current provider's quota
		* windows: progress columns (5 小时 / 每周) for coding-plan providers, an
		* amount row for balance providers.
		*
		* The provider follows the model CHIP's live selection (the shell's
		* model-selection service reports the host's next selection before any
		* request is sent); without that service the host falls back to the last
		* request's provider, else the default selection.
		*
		* The button SELF-GATES: it renders nothing while the host cannot
		* determine a provider (`no-provider`), the provider has no quota adapter
		* (`unsupported`), or the feature is off (`disabled`) — switching
		* providers makes it appear again. A supported provider whose query fails
		* KEEPS the button and shows the error with a retry inside the panel.
		*
		* The hover tooltip reads provider name + the finest window's exact
		* remaining figure (percent, or the amount when no ratio exists).
		*
		* The interaction copies ContextMeter verbatim (click toggles, document
		* pointerdown outside closes, Escape closes); mutual exclusion with the
		* ContextMeter panel falls out of both components' outside-close
		* handlers — opening one closes the other on its next pointerdown.
		*
		* @module token-usage/client/QuotaButton
		*/
		/** The poll cadence fallback (seconds) while no payload has named one. */
		const DEFAULT_POLL_SEC = 60;
		/** Panel width tiers (px), by how much the windows paint: a lone amount
		* reads at a glance, one progress bar needs breathing room, two bars (the
		* 5-hour + weekly coding plans, or a long error body) the full plate. Kept
		* in sync with the CSS max-width clamp. */
		const PANEL_WIDTH_BALANCE = 200;
		const PANEL_WIDTH_SINGLE = 232;
		const PANEL_WIDTH_FULL = 320;
		const PANEL_VIEWPORT_MARGIN = 16;
		/** Tier → label key; the locale dictionaries carry both languages. */
		const TIER_LABEL_KEYS = {
			five_hour: "quota.tier.fiveHour",
			weekly: "quota.tier.weekly",
			monthly: "quota.tier.monthly",
			balance: "quota.tier.balance"
		};
		/**
		* Render the input-bar quota button for the active session's provider.
		* @param props - the framework session id, the locale seat, and the
		* optional model-directory holder (the chip's live selection).
		* @returns the trigger + panel, or null while hidden (see the module note).
		*/
		function QuotaButton({ sessionId, t, modelDirectory }) {
			const rootRef = (0, react.useRef)(null);
			useColorSchemeMirror(rootRef);
			const [open, setOpen] = (0, react.useState)(false);
			const [panelLeft, setPanelLeft] = (0, react.useState)(void 0);
			const measurePanelLeft = (0, react.useCallback)((width) => {
				const wrapper = rootRef.current;
				if (wrapper === null) return;
				const { left: wrapperLeft, width: wrapperWidth } = wrapper.getBoundingClientRect();
				const panelWidth = Math.min(width, window.innerWidth - 32);
				const desired = (wrapperWidth - panelWidth) / 2;
				const minLeft = PANEL_VIEWPORT_MARGIN - wrapperLeft;
				const maxLeft = window.innerWidth - PANEL_VIEWPORT_MARGIN - panelWidth - wrapperLeft;
				setPanelLeft(Math.min(Math.max(desired, minLeft), Math.max(minLeft, maxLeft)));
			}, []);
			const modelService = modelDirectory?.service;
			const readChipProvider = () => {
				if (sessionId === "" || modelService === void 0) return void 0;
				try {
					return modelService.directoryFor(sessionId).store.getSnapshot().current?.provider ?? void 0;
				} catch {
					return;
				}
			};
			const [chipProvider, setChipProvider] = (0, react.useState)(readChipProvider);
			(0, react.useEffect)(() => {
				setChipProvider(readChipProvider());
				if (sessionId === "" || modelService === void 0) return;
				let directory;
				try {
					directory = modelService.directoryFor(sessionId);
				} catch {
					return;
				}
				return directory.store.subscribe(() => {
					setChipProvider(readChipProvider());
				});
			}, [sessionId, modelService]);
			const [resource, retry] = useAsyncResource((signal) => fetchQuotaPayload(sessionId, chipProvider, signal), [sessionId, chipProvider], {
				silentAfterFirst: true,
				retryToken: 0
			});
			const payload = resource.status === "ready" ? resource.value : null;
			const panelWidth = panelWidthOf(payload);
			const pollMs = (payload?.intervalSec ?? DEFAULT_POLL_SEC) * 1e3;
			(0, react.useEffect)(() => {
				const timer = setInterval(retry, pollMs);
				return () => {
					clearInterval(timer);
				};
			}, [pollMs, retry]);
			const visible = payload !== null && (payload.status === "ok" || payload.status === "error");
			(0, react.useEffect)(() => {
				if (!visible && open) setOpen(false);
			}, [visible, open]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					if (event.target instanceof Node && rootRef.current?.contains(event.target) === true) return;
					setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const onViewportChange = () => {
					measurePanelLeft(panelWidth);
				};
				measurePanelLeft(panelWidth);
				window.addEventListener("resize", onViewportChange);
				window.addEventListener("scroll", onViewportChange, true);
				return () => {
					window.removeEventListener("resize", onViewportChange);
					window.removeEventListener("scroll", onViewportChange, true);
				};
			}, [
				open,
				panelWidth,
				measurePanelLeft
			]);
			if (!visible || payload === null) return null;
			const finest = finestQuotaWindow(payload.status === "ok" ? payload.windows : []);
			const severity = finest === void 0 ? "ok" : quotaSeverityOf(finest);
			const triggerClass = [QuotaButton_module_css_default.trigger];
			if (severity === "warn") triggerClass.push(QuotaButton_module_css_default["icon-warn"]);
			else if (severity === "exhausted") triggerClass.push(QuotaButton_module_css_default["icon-exhausted"]);
			else if (finest !== void 0 && quotaRemainingPercent(finest) !== void 0) triggerClass.push(QuotaButton_module_css_default["icon-ok"]);
			const triggerClassName = triggerClass.join(" ").trim();
			const figure = quotaTriggerFigure(finest);
			const triggerTip = figure === void 0 ? t("quota.trigger") : t("quota.triggerSummary", {
				name: payload.providerName ?? payload.provider,
				figure
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				ref: rootRef,
				className: QuotaButton_module_css_default.root,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: triggerTip,
					side: "top",
					delayMs: 200,
					disabled: open,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: triggerClassName,
						"aria-haspopup": "dialog",
						"aria-expanded": open,
						"aria-label": t("quota.trigger"),
						onClick: () => {
							if (!open) {
								retry();
								measurePanelLeft(panelWidth);
							}
							setOpen(!open);
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuotaGlyph, { share: quotaIconFillShare(finest) })
					})
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: QuotaButton_module_css_default.panel,
					role: "dialog",
					"aria-label": t("quota.panel"),
					style: {
						width: `${String(panelWidth)}px`,
						...panelLeft === void 0 ? {} : { left: `${String(panelLeft)}px` }
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: QuotaButton_module_css_default.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: QuotaButton_module_css_default.title,
							children: [payload.providerName ?? payload.provider, payload.status === "ok" && payload.planTier !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: QuotaButton_module_css_default.plan,
								children: [" · ", payload.planTier]
							}) : null]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: QuotaButton_module_css_default.updated,
							children: t("quota.updatedAt", { time: formatQuotaClock(payload.fetchedAt) })
						})]
					}), payload.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: QuotaButton_module_css_default.error,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: QuotaButton_module_css_default.errorText,
							children: errorText(payload.error, t)
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: QuotaButton_module_css_default.retry,
							onClick: retry,
							children: t("quota.retry")
						})]
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: QuotaButton_module_css_default.grid,
						style: { "--cols": String(Math.min(payload.windows.length, 3)) },
						children: payload.windows.map((window, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(QuotaColumn, {
							window,
							t
						}, `${window.tier}:${String(index)}`))
					})]
				})]
			});
		}
		/** Ring geometry matches ContextMeter: 14px viewBox, r 5.5, 2px stroke.
		* Circumference feeds the remaining-share dasharray, starting at 12
		* o'clock. A 0 share omits the fill stroke — a round cap at 0 would still
		* paint a dot. */
		const RING_R = 5.5;
		const RING_C = 2 * Math.PI * RING_R;
		/** Round caps paint half a stroke width beyond each dash end; their
		* combined reach is what the dash compensation subtracts, so the painted
		* arc (dash + caps) equals the nominal share and the caps cannot seal the
		* 12-o'clock gap. */
		const RING_CAP_REACH = 2;
		/** The trigger glyph: a ContextMeter-family donut whose fill arc is the
		* remaining share of the finest window. Color comes from the button's
		* severity class (`currentColor`); this only draws the arc. */
		function QuotaGlyph({ share }) {
			const clamped = Math.min(1, Math.max(0, share));
			const nominal = clamped * RING_C;
			const dashLen = clamped >= 1 ? RING_C : nominal <= RING_CAP_REACH ? nominal : nominal - RING_CAP_REACH;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				viewBox: "0 0 14 14",
				width: "14",
				height: "14",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "7",
					cy: "7",
					r: RING_R,
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "2",
					opacity: "0.22"
				}), clamped > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
					cx: "7",
					cy: "7",
					r: RING_R,
					fill: "none",
					stroke: "currentColor",
					strokeWidth: "2",
					strokeLinecap: clamped < 1 ? "round" : "butt",
					strokeDasharray: `${dashLen.toFixed(3)} ${RING_C.toFixed(3)}`,
					transform: "rotate(-90 7 7)"
				}) : null]
			});
		}
		/** One progress column: label / value / bar / aux. The value and the bar
		* both carry the REMAINING share (the traffic-light standard reads what is
		* left), colored by severity. */
		function QuotaColumn({ window, t }) {
			const remaining = quotaRemainingPercent(window);
			const severity = quotaSeverityOf(window);
			const label = window.balanceKind === "recharge" ? t("quota.tier.recharge") : window.balanceKind === "bonus" ? t("quota.tier.bonus") : t(TIER_LABEL_KEYS[window.tier]);
			let value;
			let meta;
			if (window.tier === "balance" && window.remainingValue !== void 0) {
				const unit = window.unit ?? "cny";
				value = formatQuotaMoney(window.remainingValue, unit);
				if (window.maxValue !== void 0) meta = `/ ${formatQuotaMoney(window.maxValue, unit)}`;
			} else value = remaining !== void 0 ? formatQuotaPercent(remaining) : "—";
			const aux = window.resetAt !== void 0 ? t("quota.resetIn", { time: formatResetCountdown(window.resetAt, Date.now()) }) : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: QuotaButton_module_css_default.col,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: QuotaButton_module_css_default.label,
						children: label
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: QuotaButton_module_css_default.value,
						children: [value, meta !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: QuotaButton_module_css_default.meta,
							children: [" ", meta]
						}) : null]
					}),
					remaining !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: QuotaButton_module_css_default.bar,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: `${QuotaButton_module_css_default.fill} ${QuotaButton_module_css_default[severity]}`,
							style: { width: `${String(Math.round(remaining))}%` }
						})
					}),
					aux !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: QuotaButton_module_css_default.aux,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: `${QuotaButton_module_css_default.dot} ${QuotaButton_module_css_default[severity]}` }), aux]
					})
				]
			});
		}
		/** The panel's width tier for one payload: what the windows PAINT decides —
		* a lone amount (no computable bar, the API-key DeepSeek shape) reads at
		* the minimal plate, two amount purses (account recharge + bonus) the
		* full plate, one bar (a weekly-only plan, or a balance with a spend
		* total like OpenRouter) the middle one, two or more bars the full plate.
		* Errors and payloads without windows read the full plate (their copy
		* runs long). */
		function panelWidthOf(payload) {
			if (payload === null || payload.status !== "ok") return PANEL_WIDTH_FULL;
			const bars = payload.windows.filter((window) => quotaUsedPercent(window) !== void 0).length;
			if (bars === 0) {
				if (payload.windows.length === 1) return PANEL_WIDTH_BALANCE;
				return PANEL_WIDTH_FULL;
			}
			return bars === 1 ? PANEL_WIDTH_SINGLE : PANEL_WIDTH_FULL;
		}
		/** Friendly locale copy for one normalized query error. */
		function errorText(error, t) {
			switch (error.kind) {
				case "auth": return t("quota.error.auth", { message: error.message });
				case "no-credential": return t("quota.error.noCredential", { ref: error.message });
				case "signed-out": return t("quota.error.signedOut");
				case "http": return t("quota.error.http", { message: error.message });
				case "network": return t("quota.error.network", { message: error.message });
				case "parse": return t("quota.error.parse", { message: error.message });
			}
		}
		/** Defensive shape check: a misrouted response must not paint the button. */
		function looksLikeQuotaPayload(value) {
			return typeof value === "object" && value !== null && typeof value.status === "string" && typeof value.intervalSec === "number";
		}
		/**
		* Fetch the quota payload for the active session, naming the chip-selected
		* provider when one is known. Throws on transport failure or a payload that
		* does not look like one, so the hook can keep the previous render
		* (silentAfterFirst) or stay hidden (first failure).
		*/
		async function fetchQuotaPayload(sessionId, provider, signal) {
			const params = new URLSearchParams();
			if (sessionId !== "") params.set("session", sessionId);
			if (provider !== void 0 && provider !== "") params.set("provider", provider);
			const encoded = params.toString();
			const query = encoded === "" ? "" : `?${encoded}`;
			const response = await fetch(QUOTA_PATH + query, {
				headers: { accept: "application/json" },
				signal
			});
			if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
			const value = await response.json();
			if (!looksLikeQuotaPayload(value)) throw new Error("unexpected quota response");
			return value;
		}
		//#endregion
		//#region \0dsh-css:/Users/chii/.dsh/local-src/dsh-token-usage/src/client/TokenUsageCard.module.css.mjs
		const css$9 = ".dp5ema_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}.dp5ema_card:hover{border-color:var(--dsw-alias-label-dimmed)}.dp5ema_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}.dp5ema_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}.dp5ema_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}.dp5ema_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}.dp5ema_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}.dp5ema_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}.dp5ema_pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.dp5ema_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}.dp5ema_chevronOpen{transform:rotate(180deg)}.dp5ema_body{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:10px;margin:0 16px;padding:12px 0 8px;display:flex}.dp5ema_note{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.dp5ema_field{flex-direction:column;gap:4px;display:flex}.dp5ema_fieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}.dp5ema_input{box-sizing:border-box;width:100%;font:inherit;color:var(--dsw-alias-label-primary);background-color:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);appearance:none;border-radius:6px;padding:4px 8px;font-size:13px;line-height:20px}.dp5ema_input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}.dp5ema_input:disabled{opacity:.6}.dp5ema_inputRow{align-items:center;gap:6px;display:flex}.dp5ema_inputRow .dp5ema_input{flex:1;min-width:0}.dp5ema_regionRow{grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px;display:grid}.dp5ema_syncFeedback{grid-column:1/-1}.dp5ema_browse{appearance:none;border:1px solid var(--dsw-alias-border-l2);font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border-radius:6px;flex:none;padding:4px 10px;font-size:13px;line-height:20px}.dp5ema_browse:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.dp5ema_browse:disabled{opacity:.4;cursor:default}.dp5ema_browse:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.dp5ema_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}.dp5ema_migration{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:6px;flex-direction:column;gap:4px;padding:8px 10px;display:flex}.dp5ema_migrationLabel{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:12px;line-height:1.5}.dp5ema_migrationBar{background:var(--dsw-alias-bg-multi-select);border-radius:2px;height:4px;display:block;overflow:hidden}.dp5ema_migrationFill{background:var(--dsw-alias-brand-primary);border-radius:2px;height:100%;transition:width .2s;display:block}.dp5ema_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:8px 0 4px;display:flex}.dp5ema_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}.dp5ema_discard,.dp5ema_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}.dp5ema_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}.dp5ema_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.dp5ema_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.dp5ema_discard:disabled,.dp5ema_save:disabled{opacity:.4;cursor:default}.dp5ema_discard:focus-visible,.dp5ema_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.dp5ema_fullSync{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:8px;flex-direction:column;gap:8px;padding:10px 12px;display:flex}.dp5ema_fullSyncHeader{flex-direction:column;gap:2px;display:flex}.dp5ema_fullSyncTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:1.4}.dp5ema_fullSyncHint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}.dp5ema_fullSyncButton{appearance:none;border:1px solid var(--dsw-alias-border-l2);font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border-radius:6px;align-self:flex-start;padding:4px 12px;font-size:13px;line-height:20px}.dp5ema_fullSyncButton:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}.dp5ema_fullSyncButton:disabled{opacity:.5;cursor:default}.dp5ema_fullSyncButton:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}.dp5ema_fullSyncProgress{flex-direction:column;gap:4px;display:flex}.dp5ema_fullSyncProgressLabel{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:12px;line-height:1.5}.dp5ema_fullSyncBar{background:var(--dsw-alias-bg-multi-select);border-radius:2px;height:4px;display:block;overflow:hidden}.dp5ema_fullSyncFill{background:var(--dsw-alias-brand-primary);border-radius:2px;height:100%;transition:width .2s;display:block}.dp5ema_fullSyncResult{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;margin:0;font-size:12px;line-height:1.5}.dp5ema_fullSyncError{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}";
		const tagId$9 = "@laoyuehanni/dsh-token-usage/TokenUsageCard.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$9) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-token-usage";
			tag.dataset.pluginCss = tagId$9;
			tag.textContent = css$9;
			document.head.appendChild(tag);
		}
		var TokenUsageCard_module_css_default = {
			"body": "dp5ema_body",
			"browse": "dp5ema_browse",
			"card": "dp5ema_card",
			"cardOpen": "dp5ema_cardOpen",
			"chevron": "dp5ema_chevron",
			"chevronOpen": "dp5ema_chevronOpen",
			"description": "dp5ema_description",
			"discard": "dp5ema_discard",
			"failed": "dp5ema_failed",
			"field": "dp5ema_field",
			"fieldLabel": "dp5ema_fieldLabel",
			"footer": "dp5ema_footer",
			"fullSync": "dp5ema_fullSync",
			"fullSyncBar": "dp5ema_fullSyncBar",
			"fullSyncButton": "dp5ema_fullSyncButton",
			"fullSyncError": "dp5ema_fullSyncError",
			"fullSyncFill": "dp5ema_fullSyncFill",
			"fullSyncHeader": "dp5ema_fullSyncHeader",
			"fullSyncHint": "dp5ema_fullSyncHint",
			"fullSyncProgress": "dp5ema_fullSyncProgress",
			"fullSyncProgressLabel": "dp5ema_fullSyncProgressLabel",
			"fullSyncResult": "dp5ema_fullSyncResult",
			"fullSyncTitle": "dp5ema_fullSyncTitle",
			"headText": "dp5ema_headText",
			"header": "dp5ema_header",
			"hint": "dp5ema_hint",
			"input": "dp5ema_input",
			"inputRow": "dp5ema_inputRow",
			"migration": "dp5ema_migration",
			"migrationBar": "dp5ema_migrationBar",
			"migrationFill": "dp5ema_migrationFill",
			"migrationLabel": "dp5ema_migrationLabel",
			"name": "dp5ema_name",
			"note": "dp5ema_note",
			"pending": "dp5ema_pending",
			"regionRow": "dp5ema_regionRow",
			"save": "dp5ema_save",
			"syncFeedback": "dp5ema_syncFeedback"
		};
		//#endregion
		//#region src/client/TokenUsageCard.tsx
		/**
		* The token-usage card on the Plugins configuration tab: a collapsible row
		* whose header names the plugin over a one-line description of what its
		* settings govern, disclosing the data-directory control and the mirror
		* region pick (`domestic` gitee / `overseas` github) when open. The card owns
		* everything inside it — chrome, controls, and copy — per the keyed-slot
		* contract; the tab only dispatches it under the `token-usage` namespace key.
		*
		* Renders nothing while the namespace is unavailable: a deployment that did
		* not compose the host half shows no trace of the card. A region change takes
		* effect live (the host re-syncs the pricing mirror); a directory change the
		* guard refuses while conversations run shows the wait-for-them notice on the
		* failure line, and one that lands migrates the data across under a live
		* progress bar that locks the controls until it settles.
		*
		* @module token-usage/client/TokenUsageCard
		*/
		/**
		* Render the token-usage settings card.
		* @param props - locale copy, the card snapshot, and its form actions.
		* @returns the card, or nothing when the namespace is unavailable.
		*/
		function TokenUsageCard(props) {
			const [open, setOpen] = (0, react.useState)(props.view === "page");
			const [picking, setPicking] = (0, react.useState)(false);
			const { t } = props;
			const state = props.useTokenUsageCard((snapshot) => snapshot);
			const discardRef = (0, react.useRef)(props.discard);
			discardRef.current = props.discard;
			(0, react.useEffect)(() => () => {
				discardRef.current();
			}, []);
			if (!state.available) return null;
			if (props.view === "summary") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: TokenUsageCard_module_css_default.description,
				children: t("card.description")
			});
			const migrating = state.migration !== void 0;
			const lockInput = !state.writable || migrating;
			const lockActions = !state.dirty || state.saving || migrating;
			/**
			* Open the shell's native folder dialog and stage the chosen path — the
			* same picker the workspace flows use, driven through the injected
			* workspace service. A dismissal leaves the staged draft exactly as it
			* was; the text input stays the fallback either way.
			*/
			const browse = async () => {
				if (picking || lockInput) return;
				setPicking(true);
				try {
					const picked = await props.pickDirectory();
					if (picked !== null && picked !== "") props.editField("path", picked);
				} catch (_pickFailure) {} finally {
					setPicking(false);
				}
			};
			const [fullSync, setFullSync] = (0, react.useState)({ status: "idle" });
			const fullSyncRunning = fullSync.status === "running";
			/**
			* Fetch the current full-sync status from the host. A transport failure
			* keeps the previous view (a transient miss never blanks the bar).
			*/
			const fetchFullSync = (0, react.useCallback)(async () => {
				try {
					const response = await fetch(FULL_SYNC_PATH, { headers: { accept: "application/json" } });
					if (!response.ok) return null;
					const body = await response.json();
					if (body.status === "idle") return { status: "idle" };
					if (body.status === "running" || body.status === "done") {
						if (typeof body.processed === "number" && typeof body.total === "number" && typeof body.added === "number" && typeof body.skipped === "number") return {
							status: body.status,
							processed: body.processed,
							total: body.total,
							added: body.added,
							skipped: body.skipped,
							removed: typeof body.removed === "number" ? body.removed : 0,
							failedSessions: typeof body.failedSessions === "number" ? body.failedSessions : 0
						};
						return null;
					}
					if (body.status === "failed" && typeof body.error === "string") return {
						status: "failed",
						error: body.error
					};
					return null;
				} catch (_pollFailure) {
					return null;
				}
			}, []);
			(0, react.useEffect)(() => {
				if (!fullSyncRunning) return;
				let cancelled = false;
				const tick = async () => {
					const next = await fetchFullSync();
					if (cancelled || next === null) return;
					setFullSync(next);
				};
				tick();
				const timer = setInterval(() => {
					tick();
				}, 300);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, [fullSyncRunning, fetchFullSync]);
			/**
			* Kick off one full scan. The button shows the request as soon as the
			* POST returns 202; the polling effect above then drives the bar until
			* the host settles into `done` or `failed`. A 409 (already running) is
			* a no-op — the polling will already see the running state.
			*/
			const startFullSync = (0, react.useCallback)(async () => {
				try {
					const response = await fetch(FULL_SYNC_PATH, { method: "POST" });
					if (response.status === 202) {
						setFullSync({
							status: "running",
							processed: 0,
							total: 0,
							added: 0,
							skipped: 0,
							removed: 0,
							failedSessions: 0
						});
						return;
					}
					if (response.status === 409) {
						const next = await fetchFullSync();
						if (next !== null) setFullSync(next);
					}
				} catch (_triggerFailure) {}
			}, [fetchFullSync]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: open ? `${TokenUsageCard_module_css_default.card} ${TokenUsageCard_module_css_default.cardOpen}` : TokenUsageCard_module_css_default.card,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: TokenUsageCard_module_css_default.header,
					"aria-expanded": open,
					"aria-label": `${t(open ? "card.collapse" : "card.expand")}: ${t("card.title")}`,
					onClick: () => {
						setOpen(!open);
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: TokenUsageCard_module_css_default.headText,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: TokenUsageCard_module_css_default.name,
								children: t("card.title")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: TokenUsageCard_module_css_default.description,
								children: t("card.description")
							})]
						}),
						state.dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: TokenUsageCard_module_css_default.pending,
							children: t("card.unsaved")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutlineMedium, { className: open ? `${TokenUsageCard_module_css_default.chevron} ${TokenUsageCard_module_css_default.chevronOpen}` : TokenUsageCard_module_css_default.chevron })
					]
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: TokenUsageCard_module_css_default.body,
					children: [
						!state.writable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: TokenUsageCard_module_css_default.note,
							role: "status",
							children: t("card.readOnly")
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							className: TokenUsageCard_module_css_default.field,
							htmlFor: "token-usage-card-path",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: TokenUsageCard_module_css_default.fieldLabel,
								children: t("card.pathLabel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: TokenUsageCard_module_css_default.inputRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									id: "token-usage-card-path",
									className: TokenUsageCard_module_css_default.input,
									type: "text",
									spellCheck: false,
									value: state.fields.path,
									disabled: lockInput,
									onChange: (event) => {
										props.editField("path", event.target.value);
									}
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: TokenUsageCard_module_css_default.browse,
									disabled: lockInput || picking,
									onClick: () => {
										browse();
									},
									children: t(picking ? "card.picking" : "card.browse")
								})]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: TokenUsageCard_module_css_default.hint,
							children: t("card.pathHint")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: TokenUsageCard_module_css_default.field,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								className: TokenUsageCard_module_css_default.fieldLabel,
								htmlFor: "token-usage-card-region",
								children: t("card.regionLabel")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: TokenUsageCard_module_css_default.regionRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									id: "token-usage-card-region",
									className: TokenUsageCard_module_css_default.input,
									value: state.fields.pricingRegion,
									disabled: lockInput,
									onChange: (event) => {
										props.editField("pricingRegion", event.target.value);
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "",
											children: t("card.regionDefault")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "domestic",
											children: t("card.region.domestic")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "overseas",
											children: t("card.region.overseas")
										})
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PricingSyncButton, {
									disabled: lockInput || state.saving,
									dirty: state.dirty,
									t
								})]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: TokenUsageCard_module_css_default.hint,
							children: [t("card.hint"), state.overridden.pricingRegion ? ` ${t("card.overridden")}` : ""]
						}),
						state.migration !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: TokenUsageCard_module_css_default.migration,
							role: "status",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: TokenUsageCard_module_css_default.migrationLabel,
								children: t(state.migration.phase === "copying" ? "card.migratingCopy" : "card.migratingClean").replace("{done}", String(state.migration.done)).replace("{total}", String(state.migration.total))
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: TokenUsageCard_module_css_default.migrationBar,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: TokenUsageCard_module_css_default.migrationFill,
									style: { width: `${String(Math.round(state.migration.done / Math.max(state.migration.total, 1) * 100))}%` }
								})
							})]
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: TokenUsageCard_module_css_default.fullSync,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: TokenUsageCard_module_css_default.fullSyncHeader,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: TokenUsageCard_module_css_default.fullSyncTitle,
										children: t("card.fullSync.title")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: TokenUsageCard_module_css_default.fullSyncHint,
										children: t("card.fullSync.hint")
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: TokenUsageCard_module_css_default.fullSyncButton,
									disabled: fullSyncRunning,
									onClick: () => {
										startFullSync();
									},
									children: t(fullSyncRunning ? "card.fullSync.running" : "card.fullSync.button")
								}),
								fullSync.status === "running" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: TokenUsageCard_module_css_default.fullSyncProgress,
									role: "status",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: TokenUsageCard_module_css_default.fullSyncProgressLabel,
										children: [t("card.fullSync.progress", {
											processed: String(fullSync.processed),
											total: String(fullSync.total),
											added: String(fullSync.added),
											skipped: String(fullSync.skipped),
											removed: String(fullSync.removed)
										}), fullSync.failedSessions > 0 ? t("card.fullSync.failuresNote", { count: String(fullSync.failedSessions) }) : ""]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: TokenUsageCard_module_css_default.fullSyncBar,
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: TokenUsageCard_module_css_default.fullSyncFill,
											style: { width: `${String(Math.round(fullSync.processed / Math.max(fullSync.total, 1) * 100))}%` }
										})
									})]
								}) : null,
								fullSync.status === "done" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
									className: TokenUsageCard_module_css_default.fullSyncResult,
									role: "status",
									children: [t("card.fullSync.done", {
										added: String(fullSync.added),
										skipped: String(fullSync.skipped),
										removed: String(fullSync.removed)
									}), fullSync.failedSessions > 0 ? t("card.fullSync.failuresNote", { count: String(fullSync.failedSessions) }) : ""]
								}) : null,
								fullSync.status === "failed" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: TokenUsageCard_module_css_default.fullSyncError,
									role: "status",
									children: t("card.fullSync.failed", { error: fullSync.error })
								}) : null
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: TokenUsageCard_module_css_default.footer,
							children: [
								state.failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: TokenUsageCard_module_css_default.failed,
									role: "status",
									children: state.refusal !== void 0 ? t("card.saveBlockedSessions").replace("{count}", String(state.refusal.interactingSessions)) : t("card.saveFailed")
								}) : null,
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: TokenUsageCard_module_css_default.discard,
									disabled: lockActions,
									onClick: props.discard,
									children: t("card.discard")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: TokenUsageCard_module_css_default.save,
									disabled: lockActions,
									onClick: props.save,
									children: t(state.saving ? "card.saving" : "card.save")
								})
							]
						})
					]
				}) : null]
			});
		}
		function PricingSyncButton({ disabled, dirty, t }) {
			const [status, setStatus] = (0, react.useState)("idle");
			const [result, setResult] = (0, react.useState)(null);
			const running = (0, react.useRef)(false);
			const mounted = (0, react.useRef)(true);
			(0, react.useEffect)(() => {
				mounted.current = true;
				return () => {
					mounted.current = false;
				};
			}, []);
			const sync = async () => {
				if (running.current || disabled || dirty) return;
				running.current = true;
				setStatus("running");
				setResult(null);
				try {
					const response = await fetch(PRICING_SYNC_PATH, {
						method: "POST",
						cache: "no-store"
					});
					if (!response.ok) {
						const body = await response.json();
						if (mounted.current) setStatus(body.error === "migration-in-progress" ? "migrating" : body.error === "directory-conflict" || body.error === "pricing-source-changed" ? "changed" : "failed");
						return;
					}
					const body = await response.json();
					if (body === null || typeof body !== "object" || ![
						body.version,
						body.updatedAt,
						body.models,
						body.aliasPatterns,
						body.usdExchangeRate
					].every((value) => typeof value === "number" && Number.isFinite(value))) throw new Error("unexpected pricing sync response");
					pricingTableChanged();
					if (mounted.current) {
						setResult(body);
						setStatus("done");
					}
				} catch {
					if (mounted.current) setStatus("failed");
				} finally {
					running.current = false;
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: TokenUsageCard_module_css_default.browse,
				disabled: disabled || dirty || status === "running",
				onClick: () => {
					sync();
				},
				children: t(status === "running" ? "card.pricingSync.running" : "card.pricingSync.button")
			}), dirty ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: `${TokenUsageCard_module_css_default.hint} ${TokenUsageCard_module_css_default.syncFeedback}`,
				children: t("card.pricingSync.unsaved")
			}) : status === "done" && result !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: `${TokenUsageCard_module_css_default.note} ${TokenUsageCard_module_css_default.syncFeedback}`,
				role: "status",
				children: t("card.pricingSync.done", {
					version: String(result.version),
					models: String(result.models)
				})
			}) : status === "failed" || status === "changed" || status === "migrating" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: `${TokenUsageCard_module_css_default.failed} ${TokenUsageCard_module_css_default.syncFeedback}`,
				role: "alert",
				children: t(`card.pricingSync.${status}`)
			}) : null] });
		}
		//#endregion
		//#region \0dsh-css:/Users/chii/.dsh/local-src/dsh-token-usage/src/client/DateRangePicker.module.css.mjs
		const css$8 = ".C7cdVW_wrapper{flex:none;display:inline-flex;position:relative}.C7cdVW_trigger{box-sizing:border-box;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);background-color:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;white-space:nowrap;border-radius:6px;flex:none;padding:4px 10px;font-size:13px;line-height:20px}.C7cdVW_trigger:hover,.C7cdVW_trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}.C7cdVW_panel{z-index:100;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);width:266px;max-width:calc(100vw - 32px);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-secondary);text-align:left;cursor:default;border-radius:12px;padding:10px;font-size:12px;line-height:20px;position:absolute;top:calc(100% + 6px);left:0}.C7cdVW_head{justify-content:space-between;align-items:center;gap:4px;margin-bottom:6px;display:flex}.C7cdVW_nav{width:24px;height:24px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:6px;flex:none;padding:0;font-size:14px;line-height:1}.C7cdVW_nav:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}.C7cdVW_monthTitle{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-size:13px;font-weight:500}.C7cdVW_weekdays,.C7cdVW_grid{grid-template-columns:repeat(7,1fr);gap:2px;display:grid}.C7cdVW_weekday{text-align:center;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}.C7cdVW_blank{visibility:hidden;height:26px}.C7cdVW_day{font-variant-numeric:tabular-nums;text-align:center;height:26px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:6px;padding:0;font-size:12px;line-height:26px}.C7cdVW_day:hover{background:var(--dsw-alias-interactive-bg-hover)}.C7cdVW_dayToday{box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}.C7cdVW_dayAnchor,.C7cdVW_daySelected{color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary);font-weight:600}.C7cdVW_dayInRange{background:var(--dsw-alias-interactive-bg-hover);border-radius:0}.C7cdVW_foot{border-top:1px solid var(--dsw-alias-border-l1);justify-content:flex-end;margin-top:8px;padding-top:8px;display:flex}.C7cdVW_clear{color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:6px;padding:2px 8px;font-size:12px;line-height:18px}.C7cdVW_clear:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}";
		const tagId$8 = "@laoyuehanni/dsh-token-usage/DateRangePicker.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$8) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-token-usage";
			tag.dataset.pluginCss = tagId$8;
			tag.textContent = css$8;
			document.head.appendChild(tag);
		}
		var DateRangePicker_module_css_default = {
			"blank": "C7cdVW_blank",
			"clear": "C7cdVW_clear",
			"day": "C7cdVW_day",
			"dayAnchor": "C7cdVW_dayAnchor",
			"dayInRange": "C7cdVW_dayInRange",
			"daySelected": "C7cdVW_daySelected",
			"dayToday": "C7cdVW_dayToday",
			"foot": "C7cdVW_foot",
			"grid": "C7cdVW_grid",
			"head": "C7cdVW_head",
			"monthTitle": "C7cdVW_monthTitle",
			"nav": "C7cdVW_nav",
			"panel": "C7cdVW_panel",
			"trigger": "C7cdVW_trigger",
			"weekday": "C7cdVW_weekday",
			"weekdays": "C7cdVW_weekdays",
			"wrapper": "C7cdVW_wrapper"
		};
		//#endregion
		//#region src/client/DateRangePicker.tsx
		/**
		* Range date picker (browser half): the filter bar's single date control —
		* one trigger showing the active day range plus a lightweight calendar
		* popover. The range is picked with two clicks: the first lands an anchor
		* (start or end, order does not matter), the second settles the range
		* (min/max sorted); month navigation keeps the anchor, so a range may span
		* months (navigate, click, navigate back, click). While an anchor is live,
		* hovering previews the pending range; Escape or an outside pointerdown
		* closes the popover and DISCARDS the unfinished anchor (the committed
		* filters never change on cancel). A clear affordance releases the range
		* back to unconstrained — the capability the two native date inputs it
		* replaces carried.
		*
		* The popover interaction copies QuotaButton's pattern verbatim (click
		* toggles, document pointerdown outside closes, Escape closes); the plate
		* styling mirrors its panel (menu background, inverted border, shadow,
		* z-index 100).
		*
		* @module token-usage/client/DateRangePicker
		*/
		/** Monday-first weekday header keys (index 0 = Monday). */
		const WEEKDAY_KEYS = [
			"calendar.weekday.0",
			"calendar.weekday.1",
			"calendar.weekday.2",
			"calendar.weekday.3",
			"calendar.weekday.4",
			"calendar.weekday.5",
			"calendar.weekday.6"
		];
		/** The month view the popover opens on: the range end, else its start, else today. */
		function initialView(from, to) {
			return monthViewOf(to !== "" ? to : from !== "" ? from : dayKeyOf(/* @__PURE__ */ new Date()));
		}
		/**
		* Render the trigger + calendar popover.
		* @param props - the committed range, the change lift, and the locale seat.
		* @returns the inline wrapper holding the trigger and, while open, the panel.
		*/
		function DateRangePicker({ from, to, onChange, t }) {
			const rootRef = (0, react.useRef)(null);
			const [open, setOpen] = (0, react.useState)(false);
			const [view, setView] = (0, react.useState)(() => initialView(from, to));
			const [anchor, setAnchor] = (0, react.useState)(null);
			const [hovered, setHovered] = (0, react.useState)(null);
			const closePanel = () => {
				setOpen(false);
				setAnchor(null);
				setHovered(null);
			};
			const openPanel = () => {
				setView(initialView(from, to));
				setAnchor(null);
				setHovered(null);
				setOpen(true);
			};
			(0, react.useEffect)(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					if (event.target instanceof Node && rootRef.current?.contains(event.target) === true) return;
					closePanel();
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") closePanel();
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open]);
			const pickDay = (day) => {
				if (anchor === null) {
					setAnchor(day);
					return;
				}
				const lo = anchor < day ? anchor : day;
				const hi = anchor < day ? day : anchor;
				closePanel();
				onChange({
					from: lo,
					to: hi
				});
			};
			const clear = () => {
				closePanel();
				onChange({
					from: "",
					to: ""
				});
			};
			const shown = anchor !== null ? {
				from: hovered !== null && hovered < anchor ? hovered : anchor,
				to: hovered !== null && hovered > anchor ? hovered : anchor
			} : {
				from,
				to
			};
			const today = dayKeyOf(/* @__PURE__ */ new Date());
			const summary = from !== "" && to !== "" ? `${from} ${t("filter.separator")} ${to}` : from !== "" ? from : to !== "" ? to : t("filter.allDates");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				ref: rootRef,
				className: DateRangePicker_module_css_default["wrapper"],
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: DateRangePicker_module_css_default["trigger"],
					"aria-label": t("filter.dateRange"),
					"aria-expanded": open,
					onClick: () => {
						(open ? closePanel : openPanel)();
					},
					children: summary
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: DateRangePicker_module_css_default["panel"],
					role: "dialog",
					"aria-label": t("filter.dateRange"),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: DateRangePicker_module_css_default["head"],
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: DateRangePicker_module_css_default["nav"],
									"aria-label": t("calendar.prevMonth"),
									onClick: () => {
										setView(shiftMonth(view, -1));
									},
									children: "‹"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: DateRangePicker_module_css_default["monthTitle"],
									children: t("calendar.monthTitle", {
										year: String(view.year),
										month: String(view.month + 1)
									})
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: DateRangePicker_module_css_default["nav"],
									"aria-label": t("calendar.nextMonth"),
									onClick: () => {
										setView(shiftMonth(view, 1));
									},
									children: "›"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: DateRangePicker_module_css_default["weekdays"],
							children: WEEKDAY_KEYS.map((key) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: DateRangePicker_module_css_default["weekday"],
								children: t(key)
							}, key))
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: DateRangePicker_module_css_default["grid"],
							children: monthGrid(view).map((cell) => {
								if (!cell.inMonth) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: DateRangePicker_module_css_default["blank"],
									"aria-hidden": "true"
								}, `blank-${cell.day}`);
								const classes = [DateRangePicker_module_css_default["day"]];
								if (cell.day === shown.from || cell.day === shown.to) classes.push(DateRangePicker_module_css_default["daySelected"]);
								else if (shown.from !== "" && cell.day > shown.from && cell.day < shown.to) classes.push(DateRangePicker_module_css_default["dayInRange"]);
								if (cell.day === today) classes.push(DateRangePicker_module_css_default["dayToday"]);
								return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: classes.join(" "),
									"aria-label": cell.day,
									"aria-pressed": cell.day === shown.from || cell.day === shown.to,
									"aria-current": cell.day === today ? "date" : void 0,
									onMouseEnter: () => {
										setHovered(cell.day);
									},
									onMouseLeave: () => {
										setHovered(null);
									},
									onClick: () => {
										pickDay(cell.day);
									},
									children: Number(cell.day.slice(8))
								}, cell.day);
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: DateRangePicker_module_css_default["foot"],
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: DateRangePicker_module_css_default["clear"],
								onClick: clear,
								children: t("filter.clear")
							})
						})
					]
				}) : null]
			});
		}
		//#endregion
		//#region \0dsh-css:/Users/chii/.dsh/local-src/dsh-token-usage/src/client/hit-rate-band.module.css.mjs
		const css$7 = ".JH733W_band_critical{color:var(--dsw-alias-state-error-primary,#dc2626)}.JH733W_band_amber{color:#f59e0b}.JH733W_band_lime{color:#84cc16}.JH733W_band_healthy{color:var(--dsw-alias-state-success-primary,#16a34a)}";
		const tagId$7 = "@laoyuehanni/dsh-token-usage/hit-rate-band.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$7) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-token-usage";
			tag.dataset.pluginCss = tagId$7;
			tag.textContent = css$7;
			document.head.appendChild(tag);
		}
		var hit_rate_band_module_css_default = {
			"band_amber": "JH733W_band_amber",
			"band_critical": "JH733W_band_critical",
			"band_healthy": "JH733W_band_healthy",
			"band_lime": "JH733W_band_lime"
		};
		//#endregion
		//#region src/client/HitRateText.tsx
		/** CSS-module class for one hit-rate colour bucket. */
		function bandClassOf(band) {
			return hit_rate_band_module_css_default[`band_${band}`] ?? "";
		}
		/**
		* Render a hit-rate percentage (or `—`) in its threshold colour.
		* @param totals - the aggregated token buckets the rate is computed from.
		*/
		function HitRateText({ totals }) {
			const { text, band } = hitRateDisplay(totals);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: bandClassOf(band),
				children: text
			});
		}
		//#endregion
		//#region \0dsh-css:/Users/chii/.dsh/local-src/dsh-token-usage/src/client/MenuSelect.module.css.mjs
		const css$6 = ".-Txqnq_wrapper{display:inline-flex;position:relative}.-Txqnq_trigger{box-sizing:border-box;color:var(--dsw-alias-label-primary);background-color:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;white-space:nowrap;text-overflow:ellipsis;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E/%3C/svg%3E\");background-position:right 6px center;background-repeat:no-repeat;background-size:12px 12px;border-radius:6px;flex:none;padding:4px 24px 4px 8px;font-size:13px;line-height:20px;overflow:hidden}.-Txqnq_trigger:hover,.-Txqnq_trigger[aria-expanded=true]{background-color:var(--dsw-alias-interactive-bg-hover)}.-Txqnq_grow{flex:0 auto;min-width:0;max-width:220px}.-Txqnq_panel{z-index:100;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);min-width:100%;max-width:260px;max-height:240px;box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-secondary);text-align:left;cursor:default;border-radius:12px;padding:6px;font-size:13px;line-height:20px;position:absolute;top:calc(100% + 6px);left:0;overflow-y:auto}.-Txqnq_option{width:100%;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-radius:6px;justify-content:space-between;align-items:center;gap:12px;padding:4px 8px;font-size:13px;line-height:20px;display:flex}.-Txqnq_option:hover{background:var(--dsw-alias-interactive-bg-hover)}.-Txqnq_optionLabel{text-overflow:ellipsis;overflow:hidden}.-Txqnq_optionSelected{color:var(--dsw-alias-brand-primary)}.-Txqnq_check{color:var(--dsw-alias-brand-primary);flex:none}";
		const tagId$6 = "@laoyuehanni/dsh-token-usage/MenuSelect.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$6) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-token-usage";
			tag.dataset.pluginCss = tagId$6;
			tag.textContent = css$6;
			document.head.appendChild(tag);
		}
		var MenuSelect_module_css_default = {
			"check": "-Txqnq_check",
			"grow": "-Txqnq_grow",
			"option": "-Txqnq_option",
			"optionLabel": "-Txqnq_optionLabel",
			"optionSelected": "-Txqnq_optionSelected",
			"panel": "-Txqnq_panel",
			"trigger": "-Txqnq_trigger",
			"wrapper": "-Txqnq_wrapper"
		};
		//#endregion
		//#region src/client/MenuSelect.tsx
		/**
		* Menu select (browser half): the filter bar's themed dropdown — one
		* trigger button plus a menu popover. It replaces the native `<select>`,
		* whose UA-painted option list ignores every design token (the shell sets
		* no color-scheme on plugin content, so it renders unthemed), and pairs
		* with the DateRangePicker so all three filter controls share one popover
		* language.
		*
		* Keyboard follows the listbox idiom: opening (trigger click, Enter, or
		* its arrow keys) lands focus on the SELECTED option — scrolled to the
		* center like the native select — or the first one; ArrowUp/Down and
		* Home/End roam (options are tabIndex -1, so Tab skips the list);
		* Enter/Space commits the focused row; Escape closes and returns focus
		* to the trigger; committing closes and refocuses the trigger too. An
		* outside pointerdown closes without stealing focus. The option list
		* carries listbox/option semantics with the selection marked
		* (aria-selected plus a check).
		*
		* The popover interaction copies QuotaButton's pattern verbatim (click
		* toggles, document pointerdown outside closes, Escape closes); the plate
		* styling mirrors the date-range picker's panel.
		*
		* @module token-usage/client/MenuSelect
		*/
		/**
		* Render the trigger + menu popover.
		* @param props - the committed value, options, name, and change lift.
		* @returns the inline wrapper holding the trigger and, while open, the list.
		*/
		function MenuSelect({ value, options, ariaLabel, onChange, grow = false }) {
			const rootRef = (0, react.useRef)(null);
			const triggerRef = (0, react.useRef)(null);
			const optionRefs = (0, react.useRef)([]);
			const [open, setOpen] = (0, react.useState)(false);
			const focusIndexRef = (0, react.useRef)(0);
			const close = () => {
				setOpen(false);
				triggerRef.current?.focus();
			};
			const openMenu = () => {
				const selected = options.findIndex((option) => option.value === value);
				focusIndexRef.current = selected >= 0 ? selected : 0;
				setOpen(true);
			};
			(0, react.useEffect)(() => {
				if (!open) return;
				const onPointerDown = (event) => {
					if (event.target instanceof Node && rootRef.current?.contains(event.target) === true) return;
					setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") close();
				};
				document.addEventListener("pointerdown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				return () => {
					document.removeEventListener("pointerdown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
				};
			}, [open]);
			(0, react.useEffect)(() => {
				if (!open) return;
				const button = optionRefs.current[focusIndexRef.current];
				if (button === void 0 || button === null) return;
				button.focus({ preventScroll: true });
				if (typeof button.scrollIntoView === "function") button.scrollIntoView({ block: "center" });
			}, [open]);
			const commit = (index) => {
				const option = options[index];
				if (option === void 0) return;
				close();
				onChange(option.value);
			};
			const moveFocus = (index) => {
				const next = Math.max(0, Math.min(options.length - 1, index));
				focusIndexRef.current = next;
				optionRefs.current[next]?.focus();
			};
			const onPanelKeyDown = (event) => {
				if (event.key === "ArrowDown") {
					event.preventDefault();
					moveFocus(focusIndexRef.current + 1);
				} else if (event.key === "ArrowUp") {
					event.preventDefault();
					moveFocus(focusIndexRef.current - 1);
				} else if (event.key === "Home") {
					event.preventDefault();
					moveFocus(0);
				} else if (event.key === "End") {
					event.preventDefault();
					moveFocus(options.length - 1);
				} else if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					commit(focusIndexRef.current);
				}
			};
			const onTriggerKeyDown = (event) => {
				if (event.key === "ArrowDown" || event.key === "ArrowUp") {
					event.preventDefault();
					if (!open) openMenu();
				}
			};
			const selected = options.find((option) => option.value === value);
			const triggerClass = [MenuSelect_module_css_default["trigger"], grow === true ? MenuSelect_module_css_default["grow"] : ""].join(" ").trim();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				ref: rootRef,
				className: MenuSelect_module_css_default["wrapper"],
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					ref: triggerRef,
					className: triggerClass,
					"aria-label": ariaLabel,
					"aria-expanded": open,
					"aria-haspopup": "listbox",
					onClick: () => {
						open ? close() : openMenu();
					},
					onKeyDown: onTriggerKeyDown,
					children: selected?.label ?? value
				}), open ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: MenuSelect_module_css_default["panel"],
					role: "listbox",
					"aria-label": ariaLabel,
					onKeyDown: onPanelKeyDown,
					children: options.map((option, index) => {
						const isSelected = option.value === value;
						const optionClass = [MenuSelect_module_css_default["option"], isSelected ? MenuSelect_module_css_default["optionSelected"] : ""].join(" ").trim();
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							role: "option",
							tabIndex: -1,
							ref: (element) => {
								optionRefs.current[index] = element;
							},
							className: optionClass,
							"aria-selected": isSelected,
							onClick: () => {
								commit(index);
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: MenuSelect_module_css_default["optionLabel"],
								children: option.label
							}), isSelected ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: MenuSelect_module_css_default["check"],
								"aria-hidden": "true",
								children: "✓"
							}) : null]
						}, option.value);
					})
				}) : null]
			});
		}
		//#endregion
		//#region \0dsh-css:/Users/chii/.dsh/local-src/dsh-token-usage/src/client/PricingOverviewDialog.module.css.mjs
		const css$5 = ".uOMeJW_overview{width:min(720px,100vw - 48px)}.uOMeJW_titleActions{flex-wrap:wrap;align-items:center;gap:8px;min-width:0;display:flex}.uOMeJW_note{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px}.uOMeJW_failRow{align-items:center;gap:8px;display:flex}.uOMeJW_retryButton{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;border-radius:6px;flex:none;padding:2px 12px;font-size:12px;line-height:18px}.uOMeJW_retryButton:hover{background:var(--dsw-interactive-bg-hover)}.uOMeJW_search{width:100%;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;margin-bottom:8px;padding:4px 8px;font-size:13px}.uOMeJW_buckets{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:6px;flex-wrap:nowrap;align-items:stretch;margin-bottom:8px;padding:4px;display:flex}.uOMeJW_bucket{flex:1 1 0;align-items:center;gap:4px;min-width:0;padding:0 10px;display:flex}.uOMeJW_bucket+.uOMeJW_bucket{border-left:1px solid var(--dsw-alias-border-l1)}.uOMeJW_bucketLabel{color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:none;font-size:11px;line-height:14px}.uOMeJW_unitGroup{flex:none;display:flex}.uOMeJW_unit{color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;background:0 0;padding:0 5px;font-size:10px;line-height:14px}.uOMeJW_unit:first-child{border-radius:3px 0 0 3px}.uOMeJW_unit:last-child{border-radius:0 3px 3px 0}.uOMeJW_unit+.uOMeJW_unit{border-left:none}.uOMeJW_unit:hover{background:var(--dsw-interactive-bg-hover)}.uOMeJW_unit[aria-pressed=true]{color:var(--dsw-alias-label-primary);background:color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);font-weight:600}.uOMeJW_bucketInput{width:100%;min-width:0;color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2);font-variant-numeric:tabular-nums;background:0 0;border:none;border-radius:4px;flex:1 1 0;padding:2px 18px 2px 6px;font-size:12px}.uOMeJW_bucketInput::-webkit-outer-spin-button,.uOMeJW_bucketInput::-webkit-inner-spin-button{opacity:1;cursor:pointer;height:100%}.uOMeJW_bucketInput:focus{background:var(--dsw-alias-bg-layer-3);outline:none}.uOMeJW_scenarios{flex-wrap:wrap;gap:6px;margin-bottom:8px;display:flex}.uOMeJW_scenario{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;border-radius:6px;padding:4px 12px;font-size:12px;line-height:18px}.uOMeJW_scenario:hover{background:var(--dsw-interactive-bg-hover)}.uOMeJW_scenario[aria-pressed=true]{border-color:var(--dsw-alias-label-primary)}.uOMeJW_tableWrap{height:min(60vh,520px);overflow:auto}.uOMeJW_table{table-layout:fixed;border-collapse:collapse;font-variant-numeric:tabular-nums;width:100%;min-width:560px;font-size:12px}.uOMeJW_table th,.uOMeJW_table td{text-align:right;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap;padding:4px 6px}.uOMeJW_table th{color:var(--dsw-alias-label-secondary);z-index:1;background:var(--dsw-alias-bg-layer-2);font-weight:500;position:sticky;top:0}.uOMeJW_table td{color:var(--dsw-alias-label-primary)}th.uOMeJW_modelHead,td.uOMeJW_modelCell{text-align:left}th.uOMeJW_modelHead{width:40%}.uOMeJW_sortHead{font:inherit;font-weight:inherit;color:inherit;cursor:pointer;white-space:nowrap;background:0 0;border:none;padding:0}.uOMeJW_sortHead:hover{text-decoration:underline}.uOMeJW_sortArrow{font-size:10px}.uOMeJW_sortArrowIdle{opacity:.5}.uOMeJW_modelRow{cursor:pointer}.uOMeJW_modelRow:hover>td{background:var(--dsw-interactive-bg-hover)}.uOMeJW_cellInner{align-items:center;gap:6px;max-width:100%;display:inline-flex}.uOMeJW_modelName{text-overflow:ellipsis;white-space:nowrap;flex:0 auto;min-width:0;font-weight:500;overflow:hidden}.uOMeJW_usedTag{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3);border-radius:8px;flex:none;padding:0 6px;font-size:10px;line-height:16px}.uOMeJW_expandArrow{width:16px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-size:10px;line-height:16px}.uOMeJW_expandArrow:hover{color:var(--dsw-alias-label-primary)}.uOMeJW_arrowGap{flex:none;width:16px}.uOMeJW_expansionRow>td{padding:0 6px 4px}.uOMeJW_specialRows{flex-direction:column;gap:2px;display:flex}.uOMeJW_specialRow{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;grid-template-columns:3.2fr 1fr 1fr 1fr 1fr 1fr;gap:4px;padding:1px 0 1px 28px;font-size:11px;display:grid}.uOMeJW_specialLabel{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;text-align:left;overflow:hidden}.uOMeJW_specialRate{text-align:right;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}";
		const tagId$5 = "@laoyuehanni/dsh-token-usage/PricingOverviewDialog.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$5) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-token-usage";
			tag.dataset.pluginCss = tagId$5;
			tag.textContent = css$5;
			document.head.appendChild(tag);
		}
		var PricingOverviewDialog_module_css_default = {
			"arrowGap": "uOMeJW_arrowGap",
			"bucket": "uOMeJW_bucket",
			"bucketInput": "uOMeJW_bucketInput",
			"bucketLabel": "uOMeJW_bucketLabel",
			"buckets": "uOMeJW_buckets",
			"cellInner": "uOMeJW_cellInner",
			"expandArrow": "uOMeJW_expandArrow",
			"expansionRow": "uOMeJW_expansionRow",
			"failRow": "uOMeJW_failRow",
			"modelCell": "uOMeJW_modelCell",
			"modelHead": "uOMeJW_modelHead",
			"modelName": "uOMeJW_modelName",
			"modelRow": "uOMeJW_modelRow",
			"note": "uOMeJW_note",
			"overview": "uOMeJW_overview",
			"retryButton": "uOMeJW_retryButton",
			"scenario": "uOMeJW_scenario",
			"scenarios": "uOMeJW_scenarios",
			"search": "uOMeJW_search",
			"sortArrow": "uOMeJW_sortArrow",
			"sortArrowIdle": "uOMeJW_sortArrowIdle",
			"sortHead": "uOMeJW_sortHead",
			"specialLabel": "uOMeJW_specialLabel",
			"specialRate": "uOMeJW_specialRate",
			"specialRow": "uOMeJW_specialRow",
			"specialRows": "uOMeJW_specialRows",
			"table": "uOMeJW_table",
			"tableWrap": "uOMeJW_tableWrap",
			"titleActions": "uOMeJW_titleActions",
			"unit": "uOMeJW_unit",
			"unitGroup": "uOMeJW_unitGroup",
			"usedTag": "uOMeJW_usedTag"
		};
		//#endregion
		//#region src/client/pricing-search.ts
		const patternCache = /* @__PURE__ */ new WeakMap();
		function patternsOf(model) {
			let patterns = patternCache.get(model);
			if (patterns === void 0) {
				patterns = model.aliasPatterns.map(compileAliasPattern);
				patternCache.set(model, patterns);
			}
			return patterns;
		}
		function sortPricingModels(models) {
			return [...models].sort((a, b) => {
				const familyA = a.family ?? "other", familyB = b.family ?? "other";
				if (familyA !== familyB) return familyA < familyB ? -1 : 1;
				return a.modelId < b.modelId ? -1 : a.modelId > b.modelId ? 1 : 0;
			});
		}
		/** Substrings are a search aid only; server resolution determines identity. */
		function matchesPricingSearch(model, query) {
			if (query === "") return true;
			const needle = query.toLowerCase();
			return model.modelId.toLowerCase().includes(needle) || (model.family ?? "other").toLowerCase().includes(needle) || patternsOf(model).some((regex) => matchesAliasPattern(regex, query));
		}
		//#endregion
		//#region src/client/PricingOverviewDialog.tsx
		/**
		* The pricing-overview dialog of the settings page: the full cloud-mirror
		* model list served by the filter-free `/token-usage/pricing` route — one
		* flat row per model, sorted by the feed's upstream `family` field (zero
		* client-side mapping) then by modelId, each row's four base rates in the
		* page's display currency. Families drive order and search only — there is
		* no grouping UI, every row is directly visible. Rows the page's filters
		* have used carry a “已用” tag; clicking a row opens that model's full
		* price table as a second native dialog stacked above.
		*
		* Above the table, four token-bucket inputs drive a simulated-cost column:
		* what the buckets would bill at each model's base rates. Each bucket is
		* an amount under a picked K/M/B unit — switching converts the amount, the
		* token count stands still. Preset case buttons (「案例1」, hover-titled
		* with the workload picture) refill the buckets compact in one click; the
		* first case is prefilled on open, and the pressed highlight tracks exact
		* token matches, so a manual edit un-presses. The column sorts by a
		* three-state header cycle (family order → cost desc → cost asc → family);
		* the header's glyph never disappears: a dim ⇅ in the default family
		* order, then ▾ desc and ▴ asc.
		*
		* Aliases never render — they stay a search dimension only (a hit on an
		* alias surfaces the model, whose id then reads as the result).
		*
		* @module token-usage/client/PricingOverviewDialog
		*/
		/** The preset cases the buttons fill the inputs with (maintainer-curated
		* classic workloads). The first prefills the inputs on open. */
		const SIM_SCENARIOS = [
			{
				inputTokens: 2e6,
				cacheReadTokens: 98e6,
				outputTokens: 457e3,
				cacheWriteTokens: 0
			},
			{
				inputTokens: 5e6,
				cacheReadTokens: 95e6,
				outputTokens: 6e5,
				cacheWriteTokens: 0
			},
			{
				inputTokens: 1e8,
				cacheReadTokens: 0,
				outputTokens: 1e8,
				cacheWriteTokens: 0
			}
		];
		/** The units a bucket's amount can carry. */
		const BUCKET_UNITS = [
			"K",
			"M",
			"B"
		];
		const UNIT_MULT = {
			K: 1e3,
			M: 1e6,
			B: 1e9
		};
		/** The whole-token count a bucket stands for: amount × unit, float fuzz
		* rounded off; empty, negative, or non-numeric amounts read as zero. */
		function tokensOf(bucket) {
			const parsed = Number(bucket.amount);
			if (!Number.isFinite(parsed) || parsed <= 0) return 0;
			return Math.round(parsed * UNIT_MULT[bucket.unit]);
		}
		/** The amount string for the same tokens under a new unit — converting so
		* the token count stands still (98M reads 98000K). Trims float fuzz to
		* six decimals so 0.457M ↔ 457K round-trips cleanly. */
		function convertBucketAmount(bucket, unit) {
			const parsed = Number(bucket.amount);
			if (!Number.isFinite(parsed)) return "";
			const converted = parsed * UNIT_MULT[bucket.unit] / UNIT_MULT[unit];
			return String(Math.round(converted * 1e6) / 1e6);
		}
		/** The compact refill shape of one token count: a short amount under the
		* fitting unit (98M, 457K), K as the floor for the sub-1K tail. */
		function compactBucket(tokens) {
			if (tokens >= UNIT_MULT.B) return {
				amount: String(tokens / UNIT_MULT.B),
				unit: "B"
			};
			if (tokens >= UNIT_MULT.M) return {
				amount: String(tokens / UNIT_MULT.M),
				unit: "M"
			};
			return {
				amount: String(tokens / UNIT_MULT.K),
				unit: "K"
			};
		}
		/** The refill shape of a whole case: every bucket compact. */
		function bucketsOfCase(scenario) {
			return {
				inputTokens: compactBucket(scenario.inputTokens),
				cacheReadTokens: compactBucket(scenario.cacheReadTokens),
				outputTokens: compactBucket(scenario.outputTokens),
				cacheWriteTokens: compactBucket(scenario.cacheWriteTokens)
			};
		}
		/**
		* The simulated cost (¥) of one scenario under a model's base rates —
		* the same arithmetic as the host half's `costOf` (a missing cache rate
		* bills at the input rate), re-implemented here because pricing.ts lives
		* on the node side of the bundle boundary.
		*/
		function simCostOf(scenario, rates) {
			const M = 1e6;
			const cacheRead = rates.cacheReadPerMillion ?? rates.inputPerMillion;
			const cacheWrite = rates.cacheWritePerMillion ?? rates.inputPerMillion;
			return (scenario.inputTokens * rates.inputPerMillion + scenario.outputTokens * rates.outputPerMillion + scenario.cacheReadTokens * cacheRead + scenario.cacheWriteTokens * cacheWrite) / M;
		}
		/** The largest tier whose threshold the context clears. */
		function hitTier(tiers, ctxTokens) {
			let hit;
			for (const tier of tiers) if (ctxTokens >= tier.threshold && (hit === void 0 || tier.threshold > hit.threshold)) hit = tier;
			return hit;
		}
		function hitNodeOf(rules, ctxTokens, nowMs) {
			const nowSec = Math.floor(nowMs / 1e3);
			const rule = rules.timeRules.find((candidate) => candidate.startTime <= nowSec && nowSec <= candidate.endTime);
			if (rule !== void 0) return {
				baseRates: rule.rates,
				slots: rule.dailySlots ?? [],
				tier: hitTier(rule.contextTiers ?? [], ctxTokens)
			};
			return {
				baseRates: rules.base,
				slots: rules.dailySlots,
				tier: hitTier(rules.contextTiers, ctxTokens)
			};
		}
		/** The workload picture of one case — the input line (input-side total
		* with its cache-hit share) and the output line — joined into the case
		* button's hover title. */
		function scenarioLabel(scenario, t) {
			const total = scenario.inputTokens + scenario.cacheReadTokens;
			const pct = Math.round(scenario.cacheReadTokens / total * 100);
			return {
				inputLine: `${t("pricing.simInput", { tokens: formatTokens(total) })}${t("pricing.simCache", { pct: String(pct) })}`,
				outputLine: t("pricing.simOutput", { tokens: formatTokens(scenario.outputTokens) })
			};
		}
		/** One bucket's K/M/B unit segment. Switching converts the amount so the
		* token count stands still. */
		function UnitPicker({ t, bucket, unit, onPick }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: PricingOverviewDialog_module_css_default["unitGroup"],
				children: BUCKET_UNITS.map((candidate) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					className: PricingOverviewDialog_module_css_default["unit"],
					"aria-pressed": candidate === unit,
					"aria-label": t("pricing.simUnitOf", {
						bucket,
						unit: candidate
					}),
					onClick: () => {
						if (candidate !== unit) onPick(candidate);
					},
					children: candidate
				}, candidate))
			});
		}
		/**
		* Fetch the pricing overview from the local route — deliberately without
		* any query parameters: the overview is not a filtered view, so changing
		* the page's filters never changes what this dialog shows. An empty model
		* list (a first startup whose sync has not landed a mirror yet) reads as
		* the same failure the fetch error does: nothing to show, retry offered.
		*/
		function fetchPricingOverview(signal) {
			return fetch(PRICING_PATH, { signal }).then((response) => {
				if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
				return response.json();
			}).then((value) => {
				if (typeof value !== "object" || value === null || !Array.isArray(value.models)) throw new Error("unexpected pricing response");
				if (value.costState === "pricing-unavailable") return value;
				if (value.models.length === 0) throw new Error("pricing mirror is empty");
				return value;
			});
		}
		/**
		* The pricing-overview dialog. `usedModels` is the open-time snapshot of
		* the page's filtered model selection (the modal's backdrop covers the
		* filter row, so it cannot change while the dialog is open); `view` is the
		* page's display currency. Mounts only while open; every close path
		* funnels through the dialog's `close` event, which unmounts it.
		*/
		function PricingOverviewDialog({ usedModels, view, onClose, t }) {
			const dialogRef = (0, react.useRef)(null);
			const backdropPress = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				const dialog = dialogRef.current;
				if (dialog !== null && !dialog.open) dialog.showModal();
			}, []);
			const [state, retry] = useAsyncResource(fetchPricingOverview, [], { retryToken: 0 });
			usePricingAssociationRefresh(retry);
			const [search, setSearch] = (0, react.useState)("");
			const [buckets, setBuckets] = (0, react.useState)(() => bucketsOfCase(SIM_SCENARIOS[0]));
			const [sortMode, setSortMode] = (0, react.useState)("family");
			const [detail, setDetail] = (0, react.useState)(null);
			const [associationsOpen, setAssociationsOpen] = (0, react.useState)(false);
			const [nowMs] = (0, react.useState)(() => Date.now());
			const [expandedId, setExpandedId] = (0, react.useState)(null);
			const sorted = (0, react.useMemo)(() => sortPricingModels(state.status === "ready" ? state.value.models : []), [state]);
			const scenario = (0, react.useMemo)(() => ({
				inputTokens: tokensOf(buckets.inputTokens),
				cacheReadTokens: tokensOf(buckets.cacheReadTokens),
				outputTokens: tokensOf(buckets.outputTokens),
				cacheWriteTokens: tokensOf(buckets.cacheWriteTokens)
			}), [buckets]);
			const ctxTokens = scenario.inputTokens + scenario.cacheReadTokens;
			const pressedCase = SIM_SCENARIOS.find((candidate) => candidate.inputTokens === scenario.inputTokens && candidate.cacheReadTokens === scenario.cacheReadTokens && candidate.outputTokens === scenario.outputTokens && candidate.cacheWriteTokens === scenario.cacheWriteTokens);
			const query = search.trim();
			const rows = (0, react.useMemo)(() => {
				const withCost = sorted.map((model) => {
					const node = hitNodeOf(model.rules, ctxTokens, nowMs);
					return {
						model,
						node,
						cost: simCostOf(scenario, node.baseRates),
						specials: [...node.tier !== void 0 ? [{
							kind: "tier",
							tier: node.tier,
							slot: void 0,
							cost: simCostOf(scenario, node.tier.rates)
						}] : [], ...node.slots.map((slot) => ({
							kind: "slot",
							tier: void 0,
							slot,
							cost: simCostOf(scenario, slot.rates)
						}))]
					};
				}).filter(({ model }) => query === "" || matchesPricingSearch(model, query));
				if (sortMode === "family") return withCost;
				return [...withCost].sort((a, b) => sortMode === "cost-desc" ? b.cost - a.cost : a.cost - b.cost);
			}, [
				sorted,
				scenario,
				query,
				sortMode,
				ctxTokens,
				nowMs
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("dialog", {
				ref: dialogRef,
				className: `${PricingDialog_module_css_default["dialog"]} ${PricingOverviewDialog_module_css_default["overview"]}`,
				"aria-label": t("pricing.table"),
				onClose: (event) => {
					if (event.target === dialogRef.current) onClose();
				},
				onMouseDown: (event) => {
					backdropPress.current = event.target === dialogRef.current;
				},
				onClick: (event) => {
					if (event.target === dialogRef.current && backdropPress.current) dialogRef.current?.close();
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PricingDialog_module_css_default["dialogHead"],
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: PricingOverviewDialog_module_css_default.titleActions,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: PricingDialog_module_css_default["dialogTitle"],
								children: t("pricing.table")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PricingAssociationManagerButton, {
								t,
								onOpen: () => setAssociationsOpen(true)
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: PricingDialog_module_css_default["dialogClose"],
							"aria-label": t("pricing.close"),
							onClick: () => dialogRef.current?.close(),
							children: "✕"
						})]
					}),
					associationsOpen && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PricingAssociationDialog, {
						initialSource: null,
						view,
						t,
						onClose: () => setAssociationsOpen(false)
					}),
					state.status === "loading" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: PricingOverviewDialog_module_css_default["note"],
						children: t("loading")
					}) : null,
					state.status === "error" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PricingOverviewDialog_module_css_default["failRow"],
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: PricingOverviewDialog_module_css_default["note"],
							children: t("pricing.overviewFailed")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: PricingOverviewDialog_module_css_default["retryButton"],
							onClick: retry,
							children: t("retry")
						})]
					}) : null,
					state.status === "ready" && !costsAvailable(state.value.costState) ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: PricingOverviewDialog_module_css_default["failRow"],
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PricingStatus, {
							costState: state.value.costState,
							...state.value.pricingUnavailableReason !== void 0 ? { pricingUnavailableReason: state.value.pricingUnavailableReason } : {},
							t
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: PricingOverviewDialog_module_css_default["retryButton"],
							onClick: retry,
							children: t("retry")
						})]
					}) : null,
					state.status === "ready" && costsAvailable(state.value.costState) ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							type: "search",
							className: PricingOverviewDialog_module_css_default["search"],
							placeholder: t("pricing.search"),
							"aria-label": t("pricing.search"),
							value: search,
							onChange: (event) => setSearch(event.target.value)
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: PricingOverviewDialog_module_css_default["buckets"],
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: PricingOverviewDialog_module_css_default["bucket"],
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: PricingOverviewDialog_module_css_default["bucketLabel"],
											children: t("pricing.simBucketInput")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "number",
											min: 0,
											step: "any",
											className: PricingOverviewDialog_module_css_default["bucketInput"],
											"aria-label": t("pricing.simBucketInput"),
											value: buckets.inputTokens.amount,
											onChange: (event) => setBuckets((previous) => ({
												...previous,
												inputTokens: {
													...previous.inputTokens,
													amount: event.target.value
												}
											}))
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnitPicker, {
											t,
											bucket: t("pricing.simBucketInput"),
											unit: buckets.inputTokens.unit,
											onPick: (unit) => setBuckets((previous) => ({
												...previous,
												inputTokens: {
													amount: convertBucketAmount(previous.inputTokens, unit),
													unit
												}
											}))
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: PricingOverviewDialog_module_css_default["bucket"],
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: PricingOverviewDialog_module_css_default["bucketLabel"],
											children: t("pricing.simBucketCacheRead")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "number",
											min: 0,
											step: "any",
											className: PricingOverviewDialog_module_css_default["bucketInput"],
											"aria-label": t("pricing.simBucketCacheRead"),
											value: buckets.cacheReadTokens.amount,
											onChange: (event) => setBuckets((previous) => ({
												...previous,
												cacheReadTokens: {
													...previous.cacheReadTokens,
													amount: event.target.value
												}
											}))
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnitPicker, {
											t,
											bucket: t("pricing.simBucketCacheRead"),
											unit: buckets.cacheReadTokens.unit,
											onPick: (unit) => setBuckets((previous) => ({
												...previous,
												cacheReadTokens: {
													amount: convertBucketAmount(previous.cacheReadTokens, unit),
													unit
												}
											}))
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: PricingOverviewDialog_module_css_default["bucket"],
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: PricingOverviewDialog_module_css_default["bucketLabel"],
											children: t("pricing.simBucketOutput")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "number",
											min: 0,
											step: "any",
											className: PricingOverviewDialog_module_css_default["bucketInput"],
											"aria-label": t("pricing.simBucketOutput"),
											value: buckets.outputTokens.amount,
											onChange: (event) => setBuckets((previous) => ({
												...previous,
												outputTokens: {
													...previous.outputTokens,
													amount: event.target.value
												}
											}))
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnitPicker, {
											t,
											bucket: t("pricing.simBucketOutput"),
											unit: buckets.outputTokens.unit,
											onPick: (unit) => setBuckets((previous) => ({
												...previous,
												outputTokens: {
													amount: convertBucketAmount(previous.outputTokens, unit),
													unit
												}
											}))
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: PricingOverviewDialog_module_css_default["bucket"],
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: PricingOverviewDialog_module_css_default["bucketLabel"],
											children: t("pricing.simBucketCacheWrite")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "number",
											min: 0,
											step: "any",
											className: PricingOverviewDialog_module_css_default["bucketInput"],
											"aria-label": t("pricing.simBucketCacheWrite"),
											value: buckets.cacheWriteTokens.amount,
											onChange: (event) => setBuckets((previous) => ({
												...previous,
												cacheWriteTokens: {
													...previous.cacheWriteTokens,
													amount: event.target.value
												}
											}))
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnitPicker, {
											t,
											bucket: t("pricing.simBucketCacheWrite"),
											unit: buckets.cacheWriteTokens.unit,
											onPick: (unit) => setBuckets((previous) => ({
												...previous,
												cacheWriteTokens: {
													amount: convertBucketAmount(previous.cacheWriteTokens, unit),
													unit
												}
											}))
										})
									]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: PricingOverviewDialog_module_css_default["scenarios"],
							children: SIM_SCENARIOS.map((candidate, index) => {
								const label = scenarioLabel(candidate, t);
								return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: PricingOverviewDialog_module_css_default["scenario"],
									"aria-pressed": pressedCase === candidate,
									title: `${label.inputLine} ${label.outputLine}`,
									onClick: () => {
										setBuckets(bucketsOfCase(candidate));
									},
									children: t("pricing.simCase", { index: String(index + 1) })
								}, index);
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: PricingOverviewDialog_module_css_default["tableWrap"],
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								className: PricingOverviewDialog_module_css_default["table"],
								"aria-label": t("pricing.table"),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										className: PricingOverviewDialog_module_css_default["modelHead"],
										children: t("filter.model")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", { children: [t("pricing.input"), t("pricing.perMillion")] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", { children: [t("pricing.output"), t("pricing.perMillion")] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", { children: [t("pricing.cacheRead"), t("pricing.perMillion")] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", { children: [t("pricing.cacheWrite"), t("pricing.perMillion")] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
										type: "button",
										className: PricingOverviewDialog_module_css_default["sortHead"],
										onClick: () => {
											setSortMode((previous) => previous === "family" ? "cost-desc" : previous === "cost-desc" ? "cost-asc" : "family");
										},
										children: [t("pricing.simCost"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: sortMode === "family" ? `${PricingOverviewDialog_module_css_default["sortArrow"]} ${PricingOverviewDialog_module_css_default["sortArrowIdle"]}` : PricingOverviewDialog_module_css_default["sortArrow"],
											"aria-hidden": true,
											children: sortMode === "family" ? " ⇅" : sortMode === "cost-desc" ? " ▾" : " ▴"
										})]
									}) })
								] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: rows.map(({ model, node, cost, specials }) => {
									const billed = billedRates(node.baseRates, view);
									const expanded = expandedId === model.modelId;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
										className: PricingOverviewDialog_module_css_default["modelRow"],
										role: "button",
										tabIndex: 0,
										"aria-label": t("pricing.view", { model: model.modelId }),
										onClick: () => setDetail(model),
										onKeyDown: (event) => {
											if (event.key === "Enter" || event.key === " ") {
												event.preventDefault();
												setDetail(model);
											}
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: PricingOverviewDialog_module_css_default["modelCell"],
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: PricingOverviewDialog_module_css_default["cellInner"],
													children: [
														specials.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															type: "button",
															className: PricingOverviewDialog_module_css_default["expandArrow"],
															"aria-expanded": expanded,
															"aria-label": t("pricing.expand"),
															onClick: (event) => {
																event.stopPropagation();
																setExpandedId((previous) => previous === model.modelId ? null : model.modelId);
															},
															children: expanded ? "▾" : "▸"
														}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: PricingOverviewDialog_module_css_default["arrowGap"],
															"aria-hidden": true
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: PricingOverviewDialog_module_css_default["modelName"],
															children: model.modelId
														}),
														usedModels.has(model.modelId) ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: PricingOverviewDialog_module_css_default["usedTag"],
															children: t("pricing.used")
														}) : null
													]
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: billed.input }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: billed.output }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: billed.cacheRead }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: billed.cacheWrite }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: formatCost(cost, view) })
										]
									}), expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", {
										className: PricingOverviewDialog_module_css_default["expansionRow"],
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
											colSpan: 6,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: PricingOverviewDialog_module_css_default["specialRows"],
												children: specials.map((special, index) => {
													const specialBilled = billedRates(special.tier?.rates ?? special.slot.rates, view);
													const label = special.kind === "tier" ? t("pricing.tier", { threshold: formatTokens(special.tier.threshold) }) : `${special.slot.label ?? t("pricing.peak")} ${special.slot.windows.map(windowText).join(t("pricing.windowSep"))}`;
													return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: PricingOverviewDialog_module_css_default["specialRow"],
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: PricingOverviewDialog_module_css_default["specialLabel"],
																children: label
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: PricingOverviewDialog_module_css_default["specialRate"],
																children: specialBilled.input
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: PricingOverviewDialog_module_css_default["specialRate"],
																children: specialBilled.output
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: PricingOverviewDialog_module_css_default["specialRate"],
																children: specialBilled.cacheRead
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: PricingOverviewDialog_module_css_default["specialRate"],
																children: specialBilled.cacheWrite
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: PricingOverviewDialog_module_css_default["specialRate"],
																children: formatCost(special.cost, view)
															})
														]
													}, index);
												})
											})
										})
									}) : null] }, model.modelId);
								}) })]
							}), view.symbol === "$" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: PricingDialog_module_css_default["rateNote"],
								children: t("pricing.exchangeRateNote", { rate: formatRate(view.rate) })
							}) : null]
						})
					] }) : null,
					detail !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PricingDialog, {
						model: detail.modelId,
						rules: detail.rules,
						view,
						onClose: () => setDetail(null),
						t
					}) : null
				]
			});
		}
		//#endregion
		//#region \0dsh-css:/Users/chii/.dsh/local-src/dsh-token-usage/src/client/StatCard.module.css.mjs
		const css$4 = ".sXHjDW_card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-fill-container,transparent);border-radius:8px;flex-direction:column;gap:2px;min-width:0;padding:10px 12px;display:flex}.sXHjDW_cardLabel{color:var(--dsw-alias-label-secondary);white-space:nowrap;text-overflow:ellipsis;font-size:11px;overflow:hidden}.sXHjDW_cardValue{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);flex-wrap:wrap;align-items:baseline;gap:4px 8px;min-width:0;font-size:18px;font-weight:600;display:flex}.sXHjDW_cardValueMain{white-space:nowrap;text-overflow:ellipsis;min-width:0;overflow:hidden}.sXHjDW_pillWrap{flex-shrink:0;display:inline-flex}.sXHjDW_pillWrap [role=tooltip]{white-space:pre;width:max-content;min-width:max-content;max-width:none;font-size:12px;font-weight:400;line-height:1.4}.sXHjDW_split{grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:baseline;column-gap:4px;width:100%;display:grid}.sXHjDW_splitOk{text-align:right;min-width:0}.sXHjDW_splitSep{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}.sXHjDW_splitFailHead{text-align:left;min-width:0}.sXHjDW_splitFail{text-align:left;min-width:0;color:var(--dsw-alias-state-error-primary);display:block}.sXHjDW_split>.sXHjDW_pillWrap{justify-self:stretch;min-width:0;display:block}.sXHjDW_pill{font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);border:1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 28%, transparent);border-radius:999px;flex-shrink:0;padding:1px 7px;font-size:12px;font-weight:400;line-height:1.4}";
		const tagId$4 = "@laoyuehanni/dsh-token-usage/StatCard.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$4) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-token-usage";
			tag.dataset.pluginCss = tagId$4;
			tag.textContent = css$4;
			document.head.appendChild(tag);
		}
		var StatCard_module_css_default = {
			"card": "sXHjDW_card",
			"cardLabel": "sXHjDW_cardLabel",
			"cardValue": "sXHjDW_cardValue",
			"cardValueMain": "sXHjDW_cardValueMain",
			"pill": "sXHjDW_pill",
			"pillWrap": "sXHjDW_pillWrap",
			"split": "sXHjDW_split",
			"splitFail": "sXHjDW_splitFail",
			"splitFailHead": "sXHjDW_splitFailHead",
			"splitOk": "sXHjDW_splitOk",
			"splitSep": "sXHjDW_splitSep"
		};
		//#endregion
		//#region src/client/StatCard.tsx
		/**
		* Render one stat card. The value uses the standard label-primary color.
		* The label clamps to one line and ellipsizes if the column is squeezed.
		*/
		function StatCard({ label, value }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: StatCard_module_css_default["card"],
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: StatCard_module_css_default["cardLabel"],
					children: label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: StatCard_module_css_default["cardValue"],
					children: value
				})]
			});
		}
		/**
		* Compact "失败 n" chip for the requests **card** only. Hovering or focusing
		* it lists `限流 ×count` per class. Zero failures render nothing. Per-model
		* tables do not use this — they print `A/B` via {@link RequestsCell}.
		*/
		function FailurePill({ failures, failuresByCode, t }) {
			if (failures === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: StatCard_module_css_default["pillWrap"],
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: failuresTooltip(failuresByCode, t),
					side: "bottom",
					delayMs: 200,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: StatCard_module_css_default["pill"],
						tabIndex: 0,
						children: t("stat.failuresPill", { count: failures.toLocaleString() })
					})
				})
			});
		}
		/**
		* The requests tile both dashboards share: hero figure is the successful
		* count; a compact pill to its right carries the failure count.
		*/
		function RequestsStatCard({ requests, failures, failuresByCode, t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
				label: t("stat.requests"),
				value: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: StatCard_module_css_default["cardValueMain"],
					children: requests.toLocaleString()
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FailurePill, {
					failures,
					failuresByCode,
					t
				})] })
			});
		}
		/** Column header for the per-model success/fail split: same 3-track
		* grid as {@link RequestsCell} so the slash sits on the column midline. */
		function RequestsSplitHead({ t }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: StatCard_module_css_default["split"],
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: StatCard_module_css_default["splitOk"],
						children: t("stat.ok")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: StatCard_module_css_default["splitSep"],
						"aria-hidden": true,
						children: "/"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: StatCard_module_css_default["splitFailHead"],
						children: t("stat.fail")
					})
				]
			});
		}
		/** One table cell: successful count, and when failures > 0 a slash on
		* the column midline plus the failure count in the error color.
		* Zero failures print only A (same left track, so the figure still
		* lines up with rows that have a B). Hovering B lists the per-code
		* breakdown. */
		function RequestsCell({ requests, failures, failuresByCode, t }) {
			const ok = requests.toLocaleString();
			const okFigure = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: StatCard_module_css_default["splitOk"],
				children: ok
			});
			if (failures === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: StatCard_module_css_default["split"],
				children: okFigure
			});
			const fail = failures.toLocaleString();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: StatCard_module_css_default["split"],
				children: [
					okFigure,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: StatCard_module_css_default["splitSep"],
						"aria-hidden": true,
						children: "/"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: StatCard_module_css_default["pillWrap"],
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
							label: failuresTooltip(failuresByCode, t),
							side: "bottom",
							delayMs: 200,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: StatCard_module_css_default["splitFail"],
								tabIndex: 0,
								"aria-label": t("stat.failuresPill", { count: fail }),
								children: fail
							})
						})
					})
				]
			});
		}
		//#endregion
		//#region \0dsh-css:/Users/chii/.dsh/local-src/dsh-token-usage/src/client/SessionTable.module.css.mjs
		const css$3 = "._0D-dDq_head{justify-content:flex-start;align-items:center;gap:8px;display:flex}._0D-dDq_segmented{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-fill-container,transparent);border-radius:8px;align-items:stretch;gap:2px;padding:2px;display:inline-flex}._0D-dDq_segBtn{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));cursor:pointer;background:0 0;border:none;border-radius:6px;padding:4px 12px;font-size:12px;font-weight:500}._0D-dDq_segBtn:hover:not(._0D-dDq_segActive){color:var(--dsw-alias-label-secondary);background:color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent)}._0D-dDq_segBtn:focus-visible{outline:2px solid var(--dsw-alias-border-l2);outline-offset:1px}._0D-dDq_segActive{background:color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);color:var(--dsw-alias-label-primary);font-weight:600}._0D-dDq_tableWrap{max-height:420px;overflow:auto}._0D-dDq_table{border-collapse:collapse;font-variant-numeric:tabular-nums;width:100%;min-width:480px;font-size:12px}._0D-dDq_table th,._0D-dDq_table td{text-align:right;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap;padding:4px 6px}._0D-dDq_table th._0D-dDq_sessionHead,._0D-dDq_table td._0D-dDq_sessionCol{text-align:left;width:220px;max-width:220px}._0D-dDq_table td._0D-dDq_sessionIndent{padding-left:18px}._0D-dDq_table th{color:var(--dsw-alias-label-secondary);z-index:1;background:var(--dsw-alias-bg-layer-2);border-bottom:1.5px solid var(--dsw-alias-border-l2);font-weight:600;position:sticky;top:0}._0D-dDq_table tbody tr{transition:background-color .12s}._0D-dDq_table tbody tr:hover{background-color:var(--dsw-interactive-bg-hover)}._0D-dDq_costCol{font-weight:600}._0D-dDq_table td{color:var(--dsw-alias-label-primary)}._0D-dDq_sortBtn{font:inherit;color:inherit;cursor:pointer;white-space:nowrap;background:0 0;border:none;padding:0;font-weight:500}._0D-dDq_sortBtn:hover{color:var(--dsw-alias-label-primary)}._0D-dDq_sortMark{margin-left:3px;font-size:9px}._0D-dDq_sessionCell{align-items:baseline;gap:4px;max-width:208px;display:inline-flex}._0D-dDq_sessionName{text-overflow:ellipsis;white-space:nowrap;font:inherit;color:inherit;text-align:left;background:0 0;border:none;border-bottom:1.5px dashed #0000;max-width:100%;padding:0;overflow:hidden}._0D-dDq_jumpable{cursor:pointer;border-bottom-color:var(--dsw-alias-label-secondary);color:var(--dsw-alias-label-primary);text-decoration:none}._0D-dDq_jumpable:hover{border-bottom-color:var(--dsw-alias-label-primary)}._0D-dDq_badge{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none;font-size:10px}._0D-dDq_dirTail{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;font-size:10px;display:block;overflow:hidden}._0D-dDq_table td._0D-dDq_groupRow{border-bottom:none;padding-top:8px}._0D-dDq_table td._0D-dDq_groupHead{color:var(--dsw-alias-label-secondary);text-align:left;white-space:nowrap;font-size:11px;font-weight:600}._0D-dDq_groupCount{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;margin-left:6px}";
		const tagId$3 = "@laoyuehanni/dsh-token-usage/SessionTable.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$3) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-token-usage";
			tag.dataset.pluginCss = tagId$3;
			tag.textContent = css$3;
			document.head.appendChild(tag);
		}
		var SessionTable_module_css_default = {
			"badge": "_0D-dDq_badge",
			"costCol": "_0D-dDq_costCol",
			"dirTail": "_0D-dDq_dirTail",
			"groupCount": "_0D-dDq_groupCount",
			"groupHead": "_0D-dDq_groupHead",
			"groupRow": "_0D-dDq_groupRow",
			"head": "_0D-dDq_head",
			"jumpable": "_0D-dDq_jumpable",
			"segActive": "_0D-dDq_segActive",
			"segBtn": "_0D-dDq_segBtn",
			"segmented": "_0D-dDq_segmented",
			"sessionCell": "_0D-dDq_sessionCell",
			"sessionCol": "_0D-dDq_sessionCol",
			"sessionHead": "_0D-dDq_sessionHead",
			"sessionIndent": "_0D-dDq_sessionIndent",
			"sessionName": "_0D-dDq_sessionName",
			"sortBtn": "_0D-dDq_sortBtn",
			"sortMark": "_0D-dDq_sortMark",
			"table": "_0D-dDq_table",
			"tableWrap": "_0D-dDq_tableWrap"
		};
		//#endregion
		//#region src/client/SessionTable.tsx
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
		/** The last path segment of a directory, on either separator. */
		function dirTailOf(cwd) {
			const parts = cwd.split(/[\\/]/u).filter((part) => part !== "");
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
		const SESSION_GROUPED_KEY = "dsh.token-usage.sessionGrouped";
		function readGroupedPreference() {
			if (typeof localStorage === "undefined") return true;
			try {
				return localStorage.getItem(SESSION_GROUPED_KEY) !== "0";
			} catch {
				return true;
			}
		}
		function writeGroupedPreference(grouped) {
			try {
				if (grouped) localStorage.removeItem(SESSION_GROUPED_KEY);
				else localStorage.setItem(SESSION_GROUPED_KEY, "0");
			} catch {}
		}
		function sortValueOf(row, key) {
			if (key === "tokens") return totalTokens(row.totals);
			if (key === "cost") return row.cost;
			return row.lastTime;
		}
		function nextSort(current, key) {
			if (current?.key !== key) return {
				key,
				dir: "desc"
			};
			if (current.dir === "desc") return {
				key,
				dir: "asc"
			};
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
		function SessionTable({ rows, view, t, sessionListed, openSession, costState }) {
			const [grouped, setGrouped] = (0, react.useState)(readGroupedPreference);
			const toggleGrouped = (next) => {
				setGrouped(next);
				writeGroupedPreference(next);
			};
			const [sort, setSort] = (0, react.useState)(null);
			const [ctrlHeld, setCtrlHeld] = (0, react.useState)(false);
			(0, react.useEffect)(() => {
				const down = (event) => {
					if (event.key === "Control" || event.key === "Meta") setCtrlHeld(true);
				};
				const up = (event) => {
					if (event.key === "Control" || event.key === "Meta") setCtrlHeld(false);
				};
				const move = (event) => {
					const active = event.ctrlKey || event.metaKey;
					setCtrlHeld((previous) => previous === active ? previous : active);
				};
				const blur = () => setCtrlHeld(false);
				window.addEventListener("keydown", down);
				window.addEventListener("keyup", up);
				window.addEventListener("mousemove", move);
				window.addEventListener("blur", blur);
				return () => {
					window.removeEventListener("keydown", down);
					window.removeEventListener("keyup", up);
					window.removeEventListener("mousemove", move);
					window.removeEventListener("blur", blur);
				};
			}, []);
			const jumpable = (id) => ctrlHeld && sessionListed !== void 0 && openSession !== void 0 && sessionListed(id);
			const sorted = (0, react.useMemo)(() => {
				if (sort === null) return rows;
				const factor = sort.dir === "desc" ? -1 : 1;
				return [...rows].sort((left, right) => factor * (sortValueOf(left, sort.key) - sortValueOf(right, sort.key)) || (left.sessionId < right.sessionId ? -1 : 1));
			}, [rows, sort]);
			const groups = (0, react.useMemo)(() => {
				if (!grouped) return null;
				const map = /* @__PURE__ */ new Map();
				for (const row of sorted) {
					const key = row.cwd ?? "";
					const bucket = map.get(key) ?? [];
					bucket.push(row);
					map.set(key, bucket);
				}
				return [...map.entries()].sort((left, right) => {
					if (left[0] === "") return 1;
					if (right[0] === "") return -1;
					return left[0].localeCompare(right[0]);
				});
			}, [sorted, grouped]);
			/** One sortable header cell: the column name as the toggle, the current
			* direction marked and announced via aria-sort. */
			const sortHead = (key, label) => {
				const active = sort?.key === key;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
					...active ? { "aria-sort": sort.dir === "desc" ? "descending" : "ascending" } : {},
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: SessionTable_module_css_default["sortBtn"],
						onClick: () => setSort((previous) => nextSort(previous, key)),
						children: [label, active ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: SessionTable_module_css_default["sortMark"],
							children: sort.dir === "desc" ? "▼" : "▲"
						}) : null]
					})
				});
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: SessionTable_module_css_default["head"],
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: SessionTable_module_css_default["segmented"],
					role: "group",
					"aria-label": t("session.group.label"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: grouped ? `${SessionTable_module_css_default["segBtn"]} ${SessionTable_module_css_default["segActive"]}` : SessionTable_module_css_default["segBtn"],
						"aria-pressed": grouped,
						onClick: () => toggleGrouped(true),
						children: t("session.group.on")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: !grouped ? `${SessionTable_module_css_default["segBtn"]} ${SessionTable_module_css_default["segActive"]}` : SessionTable_module_css_default["segBtn"],
						"aria-pressed": !grouped,
						onClick: () => toggleGrouped(false),
						children: t("session.group.off")
					})]
				})
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: SessionTable_module_css_default["tableWrap"],
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
					className: SessionTable_module_css_default["table"],
					"aria-label": t("bySession.title"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
							className: SessionTable_module_css_default["sessionHead"],
							children: t("session.titleCol")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
							"aria-label": t("stat.successFail"),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RequestsSplitHead, { t })
						}),
						sortHead("tokens", t("stat.totalTokens")),
						sortHead("cost", t("stat.cost")),
						sortHead("lastTime", t("session.lastActive"))
					] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: groups === null ? sorted.map((row) => renderRow(row, false)) : groups.map(([cwd, groupRows]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FragmentGroup, {
						cwd,
						count: groupRows.length,
						t,
						children: groupRows.map((row) => renderRow(row, true))
					}, cwd === "" ? "\0" : cwd)) })]
				})
			})] });
			function renderRow(row, indented) {
				const jump = jumpable(row.sessionId);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
						className: indented ? `${SessionTable_module_css_default["sessionCol"]} ${SessionTable_module_css_default["sessionIndent"]}` : SessionTable_module_css_default["sessionCol"],
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: SessionTable_module_css_default["sessionCell"],
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: jump ? `${SessionTable_module_css_default["sessionName"]} ${SessionTable_module_css_default["jumpable"]}` : SessionTable_module_css_default["sessionName"],
								title: jump ? t("session.openHint") : void 0,
								onClick: jump || ctrlHeld ? (event) => {
									event.preventDefault();
									openSession?.(row.sessionId);
								} : void 0,
								children: row.title !== void 0 ? row.title : `${shortIdOf(row.sessionId)} · ${dayKeyOf(new Date(row.firstTime))} – ${dayKeyOf(new Date(row.lastTime))}`
							}), row.childCount !== void 0 && row.childCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: SessionTable_module_css_default["badge"],
								"aria-label": t("view.subagents.nested", { count: String(row.childCount) }),
								children: t("view.subagents.nested", { count: String(row.childCount) })
							}) : null]
						}), !indented && row.cwd !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: SessionTable_module_css_default["dirTail"],
							children: dirTailOf(row.cwd)
						}) : null]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RequestsCell, {
						requests: row.totals.requests,
						failures: row.totals.failures ?? 0,
						failuresByCode: row.totals.failuresByCode,
						t
					}) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: formatTokens(totalTokens(row.totals)) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
						className: SessionTable_module_css_default["costCol"],
						children: costsAvailable(costState) ? formatCost(row.cost, view) : "—"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: dayKeyOf(new Date(row.lastTime)) })
				] }, row.sessionId);
			}
		}
		/** One directory group: a full-width head row with the directory tail, then
		* the group's rows (a keyed fragment keeps `<tr>`s table-legal). */
		function FragmentGroup({ cwd, count, t, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", {
				className: SessionTable_module_css_default["groupRow"],
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
					colSpan: 5,
					className: SessionTable_module_css_default["groupHead"],
					children: [cwd === "" ? t("session.untitledDir") : dirTailOf(cwd), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: SessionTable_module_css_default["groupCount"],
						children: String(count)
					})]
				})
			}), children] });
		}
		//#endregion
		//#region src/client/trend-chart/axis.ts
		/**
		* Trend-chart axis helpers: the roundest step from 1/2/2.5/5 × 10ⁿ not
		* below a rough target, and the y-axis tick values (one nice step apart,
		* inclusive of the chart top). Pure functions, no React, no I/O.
		*
		* @module token-usage/client/trend-chart/axis
		*/
		/**
		* The roundest step from {1, 2, 2.5, 5, 10} × 10ⁿ not below `rough`.
		* A `niceStep(0)` returns 1; a `niceStep(80)` returns 100 (the next nice
		* step above 80 in the same decade).
		* @param rough - the target value (positive).
		* @returns the nice step.
		*/
		function niceStep(rough) {
			const base = 10 ** Math.floor(Math.log10(rough));
			const fraction = rough / base;
			return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * base;
		}
		/** The y-axis tick values from one step up to the chart top (inclusive). */
		function tickValues(max) {
			if (max === 0) return {
				top: 1,
				ticks: []
			};
			const step = niceStep(max / 4);
			const top = Math.ceil(max / step) * step;
			const ticks = [];
			for (let value = step; value < top; value += step) ticks.push(value);
			ticks.push(top);
			return {
				top,
				ticks
			};
		}
		//#endregion
		//#region src/client/trend-chart/path.ts
		/**
		* Per-segment gap flags: `flags[i]` is true when the next bucket starts
		* after this bucket's exclusive `end`. Adjacent uniform buckets have
		* `next.time === prev.end` and are not gaps.
		*/
		function gapAfter(points) {
			const flags = [];
			for (let index = 0; index < points.length - 1; index += 1) flags.push(points[index + 1].time > points[index].end);
			return flags;
		}
		/**
		* Generate a smooth cubic Bezier path using Fritsch-Carlson monotone cubic
		* Hermite interpolation. Preserves monotonicity so zero-filled plateaus stay
		* strictly flat at baseline without undershooting, and peaks round smoothly.
		*
		* @param xs - scaled x coordinates (monotonic ascending).
		* @param ys - scaled y coordinates.
		* @returns SVG `d` string containing M, L, and C commands.
		*/
		function monotoneSplinePath(xs, ys) {
			const n = xs.length;
			if (n === 0) return "";
			if (n === 1) return `M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`;
			if (n === 2) return `M${xs[0].toFixed(1)},${ys[0].toFixed(1)} L${xs[1].toFixed(1)},${ys[1].toFixed(1)}`;
			const dx = [];
			const slopes = [];
			for (let i = 0; i < n - 1; i += 1) {
				const dX = xs[i + 1] - xs[i];
				const dY = ys[i + 1] - ys[i];
				dx.push(dX);
				slopes.push(dX === 0 ? 0 : dY / dX);
			}
			const m = new Array(n);
			m[0] = slopes[0];
			m[n - 1] = slopes[n - 2];
			for (let i = 1; i < n - 1; i += 1) {
				const s0 = slopes[i - 1];
				const s1 = slopes[i];
				if (s0 * s1 <= 0) m[i] = 0;
				else m[i] = (s0 + s1) / 2;
			}
			for (let i = 0; i < n - 1; i += 1) {
				const slope = slopes[i];
				if (slope === 0) {
					m[i] = 0;
					m[i + 1] = 0;
				} else {
					const alpha = m[i] / slope;
					const beta = m[i + 1] / slope;
					const dist = alpha * alpha + beta * beta;
					if (dist > 9) {
						const tau = 3 / Math.sqrt(dist);
						m[i] = tau * alpha * slope;
						m[i + 1] = tau * beta * slope;
					}
				}
			}
			const parts = [`M${xs[0].toFixed(1)},${ys[0].toFixed(1)}`];
			for (let i = 0; i < n - 1; i += 1) {
				const dX = dx[i];
				const x0 = xs[i];
				const y0 = ys[i];
				const x1 = xs[i + 1];
				const y1 = ys[i + 1];
				const cp1x = x0 + dX / 3;
				const cp1y = y0 + m[i] * (dX / 3);
				const cp2x = x1 - dX / 3;
				const cp2y = y1 - m[i + 1] * (dX / 3);
				parts.push(`C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`);
			}
			return parts.join(" ");
		}
		/**
		* Close a line/curve path down to the baseline (`yZero`) to form an area polygon.
		* Returns an empty string when the input path is empty or has fewer than 2 points.
		*
		* @param linePath - the line or curve `d` string.
		* @param xs - the plotted x coordinates.
		* @param yZero - the baseline y coordinate.
		* @returns SVG `d` string closed with Z for fill.
		*/
		function areaPath(linePath, xs, yZero) {
			if (linePath === "" || xs.length < 2) return "";
			const firstX = xs[0].toFixed(1);
			const lastX = xs[xs.length - 1].toFixed(1);
			const baseY = yZero.toFixed(1);
			return `${linePath} L${lastX},${baseY} L${firstX},${baseY} Z`;
		}
		/**
		* Return coordinates with gap hold points inserted so temporal series can be
		* smoothly interpolated with monotonic cubic splines without smearing idle spans.
		*/
		function gapPatchedPoints(input) {
			const { xs, ys, yZero, hold, gaps, xEnds } = input;
			if (xs.length === 0) return {
				xs: [],
				ys: []
			};
			const outXs = [xs[0]];
			const outYs = [ys[0]];
			for (let index = 0; index < xs.length - 1; index += 1) {
				const xNext = xs[index + 1];
				const yNext = ys[index + 1];
				if (gaps?.[index] === true) {
					const ends = xEnds ?? xs;
					const xEnd = ends[index];
					const nextWidth = Math.max(ends[index + 1] - xNext, 0);
					const xHold = Math.max(xEnd, xNext - nextWidth);
					const holdY = hold === "previous" ? ys[index] : yZero;
					if (xEnd > outXs[outXs.length - 1]) {
						outXs.push(xEnd);
						outYs.push(holdY);
					}
					if (xHold > xEnd) {
						outXs.push(xHold);
						outYs.push(holdY);
					}
					outXs.push(xNext);
					outYs.push(yNext);
				} else {
					outXs.push(xNext);
					outYs.push(yNext);
				}
			}
			return {
				xs: outXs,
				ys: outYs
			};
		}
		/**
		* Generate a smooth spline path for either equidistant or gap-patched temporal series.
		*/
		function smoothSeriesPath(input) {
			const { xs, ys, yZero, gaps, xEnds, hold } = input;
			if (gaps !== void 0 && gaps.some((g) => g)) {
				const patched = gapPatchedPoints({
					xs,
					ys,
					yZero,
					hold,
					gaps,
					xEnds
				});
				return monotoneSplinePath(patched.xs, patched.ys);
			}
			return monotoneSplinePath(xs, ys);
		}
		//#endregion
		//#region src/trend-bucket.ts
		/**
		* Bucket widths tried from fine to coarse (ms); the first whose bucket count
		* stays at or under {@link MAX_BUCKETS} wins, so a short session gets
		* fine-grained 5-second buckets and a multi-day session one per several
		* hours — always within the render cap.
		*/
		const BUCKET_STEPS_MS = [
			5e3,
			15e3,
			6e4,
			3e5,
			9e5,
			36e5,
			108e5,
			216e5,
			432e5,
			864e5
		];
		/** The bucket width for one span: the finest step whose count fits the cap. */
		function bucketWidth(spanMs) {
			for (const step of BUCKET_STEPS_MS) if (Math.ceil(spanMs / step) <= 60) return step;
			return Math.ceil(spanMs / 60 / 36e5) * 36e5;
		}
		/**
		* Fold a request series into uniformly sized time buckets spanning the
		* series' own first-to-last window. The axis starts at the series' first
		* record, ends at its latest, and the middle is evenly divided — the chart
		* shows the trend over TIME, not one point per request. Buckets align to
		* the window's first record, not to wall-clock round hours.
		*
		* Implementation note: the buckets are tracked in a `Map` keyed by their
		* 0-based index, not in a sparse array. A multi-month session could
		* otherwise blow past V8's sparse-array bounds (the indices approach
		* `spanMs / 5_000` which is unbounded); the Map collapses absent keys
		* cleanly.
		*
		* @param requests - the per-request series, time-ascending.
		* @returns the buckets in time order (empty for an empty series; only
		* buckets holding at least one request are emitted).
		*/
		function bucketSeries(requests) {
			if (requests.length === 0) return [];
			const first = requests[0].time;
			const last = requests[requests.length - 1].time;
			const width = bucketWidth(Math.max(last - first, 1));
			const buckets = /* @__PURE__ */ new Map();
			for (const request of requests) {
				const index = Math.floor((request.time - first) / width);
				const existing = buckets.get(index);
				if (existing === void 0) buckets.set(index, {
					start: first + index * width,
					end: first + (index + 1) * width,
					tokens: request.tokens,
					count: 1
				});
				else {
					existing.tokens += request.tokens;
					existing.count += 1;
				}
			}
			return [...buckets.entries()].sort(([left], [right]) => left - right).map(([, bucket]) => bucket);
		}
		//#endregion
		//#region src/client/trend-chart/bucket.ts
		/**
		* Scale one wall time into an x offset across the series' actual span —
		* the first and last points pin the axis ends, and everything in between
		* lands at its real proportion of that span (a 55-request session
		* spreads across the full width, a burst inside one minute bunches up).
		* @param firstTime - the series' first record time.
		* @param lastTime - the series' last record time.
		* @param time - the record's wall time.
		* @param innerWidth - the plottable width in pixels.
		* @returns the x offset from the left edge; the center when every record
		* shares one timestamp (a zero span cannot scale).
		*/
		function scaleToSpan(firstTime, lastTime, time, innerWidth) {
			const span = lastTime - firstTime;
			if (span <= 0) return innerWidth / 2;
			return (time - firstTime) / span * innerWidth;
		}
		//#endregion
		//#region src/client/trend-chart/scale.ts
		function clampX(value, leftEdge, rightEdge) {
			return Math.min(Math.max(value, leftEdge), rightEdge);
		}
		/**
		* Pick the right x scale for a {@link ChartSeries} and produce the
		* per-point offsets in absolute viewBox coordinates. Equidistant modes
		* lay points one stride apart across the `[leftEdge, rightEdge]` span;
		* temporal mode uses each point's wall time against the series' own
		* first-start to last-start span and adds `leftEdge` to the result.
		* A zero span (one point, or every start equal) pins to the centerline.
		* Temporal results include `xEnds` for the gap-path bucket width.
		*
		* @param series - the discriminated-union series from {@link buildChartPoints}.
		* @param leftEdge - the absolute SVG x of the chart's left edge (the
		* y-axis line in the renderer).
		* @param rightEdge - the absolute SVG x of the chart's right edge
		* (typically `viewBox.width − RIGHT.margin`).
		* @returns the per-point x offsets plus `innerWidth = rightEdge − leftEdge`.
		*/
		function scaleSeries(series, leftEdge, rightEdge) {
			const innerWidth = rightEdge - leftEdge;
			const { points } = series;
			if (series.mode === "equidistant") {
				const xs = [];
				if (points.length === 1) xs.push((leftEdge + rightEdge) / 2);
				else {
					const stride = innerWidth / (points.length - 1);
					for (let i = 0; i < points.length; i += 1) xs.push(leftEdge + i * stride);
				}
				return {
					xs,
					innerWidth
				};
			}
			const temporal = series.points;
			const first = temporal[0].time;
			const lastStart = temporal[temporal.length - 1].time;
			if (temporal.length === 1 || first === lastStart) {
				const mid = (leftEdge + rightEdge) / 2;
				const xs = temporal.map(() => mid);
				return {
					xs,
					xEnds: [...xs],
					innerWidth
				};
			}
			const xs = [];
			const xEnds = [];
			for (const point of temporal) {
				const x = clampX(leftEdge + scaleToSpan(first, lastStart, point.time, innerWidth), leftEdge, rightEdge);
				const xEnd = clampX(leftEdge + scaleToSpan(first, lastStart, point.end, innerWidth), leftEdge, rightEdge);
				xs.push(x);
				xEnds.push(Math.max(x, xEnd));
			}
			return {
				xs,
				xEnds,
				innerWidth
			};
		}
		/**
		* The x-axis label positions: first, middle, and last point for long
		* ranges. Short ranges (≤3 points) label every point so a 1- or 2- day
		* window does not skip the only "middle" data.
		*/
		function labelIndices(length) {
			if (length <= 3) return Array.from({ length }, (_, index) => index);
			const middle = Math.floor((length - 1) / 2);
			return [.../* @__PURE__ */ new Set([
				0,
				middle,
				length - 1
			])];
		}
		/** Choose a dot radius that survives dense point clouds without
		* overlapping but stays visible for sparse ones. Three tiers, picked by
		* point count. */
		function dotRadius(pointCount) {
			if (pointCount > 90) return 1.5;
			if (pointCount > 30) return 2;
			return 3;
		}
		//#endregion
		//#region \0dsh-css:/Users/chii/.dsh/local-src/dsh-token-usage/src/client/TrendChart.module.css.mjs
		const css$2 = "._VIPSa_chart{user-select:none;width:100%;height:auto;display:block}._VIPSa_axis{stroke:var(--dsw-alias-border-l1);stroke-width:1px}._VIPSa_grid{stroke:var(--dsw-alias-border-l2);stroke-width:1px;stroke-dasharray:4 4;stroke-opacity:.6}._VIPSa_area{pointer-events:none}._VIPSa_line{fill:none;stroke:var(--dsw-alias-label-primary);stroke-width:1.8px;stroke-linejoin:round;stroke-linecap:round}._VIPSa_chartLight ._VIPSa_dotHalo,[style*=\"color-scheme: light\"] ._VIPSa_chart ._VIPSa_dotHalo{fill:color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent)}._VIPSa_chartLight ._VIPSa_grid,[style*=\"color-scheme: light\"] ._VIPSa_chart ._VIPSa_grid{stroke-opacity:.45}@media (prefers-color-scheme:light){._VIPSa_chart:not([data-theme=dark]) ._VIPSa_dotHalo{fill:color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent)}._VIPSa_chart:not([data-theme=dark]) ._VIPSa_grid{stroke-opacity:.45}}._VIPSa_dot{fill:var(--dsw-alias-label-primary)}._VIPSa_dotHalo{fill:color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent)}._VIPSa_dotActive{fill:var(--dsw-alias-label-primary);stroke:var(--dsw-alias-bg-layer-1);stroke-width:2px}._VIPSa_guide{stroke:var(--dsw-alias-label-secondary);stroke-width:1px;stroke-dasharray:3 3;stroke-opacity:.45}._VIPSa_hit{cursor:crosshair;outline:none}._VIPSa_pointLabel>rect{fill:var(--dsw-alias-bg-layer-3);stroke:var(--dsw-alias-border-l2);stroke-width:1px;filter:drop-shadow(0 3px 8px #00000047)}._VIPSa_pointLabel text{fill:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-size:11px;font-weight:500}._VIPSa_tick{fill:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-variant-numeric:tabular-nums;font-size:11px}._VIPSa_empty{text-align:center;color:var(--dsw-alias-label-secondary);margin:0;padding:24px 0;font-size:13px}._VIPSa_multiWrap{display:block}._VIPSa_legend{flex-wrap:wrap;align-items:center;gap:4px 14px;margin:0 0 6px;padding:0 2px;display:flex}._VIPSa_legendItem{min-width:0;color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;font-size:12px;display:inline-flex}._VIPSa_swatch{border-radius:3px;flex:none;width:10px;height:10px}._VIPSa_legendName{text-overflow:ellipsis;white-space:nowrap;max-width:14em;overflow:hidden}._VIPSa_legendValue{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}._VIPSa_modelLine{fill:none;stroke-width:1.8px;stroke-linejoin:round;stroke-linecap:round}._VIPSa_modelDot{stroke:var(--dsw-alias-bg-layer-1);stroke-width:1.5px}._VIPSa_pointLabel ._VIPSa_tooltipTitle{fill:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-size:11px;font-weight:600}._VIPSa_pointLabel ._VIPSa_tooltipText{fill:var(--dsw-alias-label-secondary);font-size:11px}._VIPSa_pointLabel ._VIPSa_tooltipValue{fill:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-size:11px}";
		const tagId$2 = "@laoyuehanni/dsh-token-usage/TrendChart.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$2) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-token-usage";
			tag.dataset.pluginCss = tagId$2;
			tag.textContent = css$2;
			document.head.appendChild(tag);
		}
		var TrendChart_module_css_default = {
			"area": "_VIPSa_area",
			"axis": "_VIPSa_axis",
			"chart": "_VIPSa_chart",
			"chartLight": "_VIPSa_chartLight",
			"dot": "_VIPSa_dot",
			"dotActive": "_VIPSa_dotActive",
			"dotHalo": "_VIPSa_dotHalo",
			"empty": "_VIPSa_empty",
			"grid": "_VIPSa_grid",
			"guide": "_VIPSa_guide",
			"hit": "_VIPSa_hit",
			"legend": "_VIPSa_legend",
			"legendItem": "_VIPSa_legendItem",
			"legendName": "_VIPSa_legendName",
			"legendValue": "_VIPSa_legendValue",
			"line": "_VIPSa_line",
			"modelDot": "_VIPSa_modelDot",
			"modelLine": "_VIPSa_modelLine",
			"multiWrap": "_VIPSa_multiWrap",
			"pointLabel": "_VIPSa_pointLabel",
			"swatch": "_VIPSa_swatch",
			"tick": "_VIPSa_tick",
			"tooltipText": "_VIPSa_tooltipText",
			"tooltipTitle": "_VIPSa_tooltipTitle",
			"tooltipValue": "_VIPSa_tooltipValue"
		};
		//#endregion
		//#region src/client/MultiModelTrendChart.tsx
		/**
		* Per-model daily token trend chart (browser half): one line per model in
		* its own color, a legend carrying each model's range total, and a hover
		* card breaking the active day down by model. Follows the ZCode usage
		* page's daily model trend: the top models get fixed palette hues, the
		* tail folds into a neutral "other" line, and the y axis shrinks to the
		* largest *visible* series value — a total-scaled axis would press every
		* model line onto the baseline.
		*
		* Pure presentation: folding lives in `./trend-chart/models.ts`, and the
		* canvas metrics are shared with the single-series renderer through
		* `./trend-chart/layout.ts`.
		*
		* @module token-usage/client/MultiModelTrendChart
		*/
		/** Approximate glyph width used to size the floating hover card. */
		const TOOLTIP_CHAR_WIDTH = 6.2;
		/** Vertical pitch of one tooltip row. */
		const TOOLTIP_ROW_HEIGHT = 15;
		/** Truncate a long model id so one hover row cannot blow up the card. */
		function shortLabel(label) {
			return label.length > 26 ? `${label.slice(0, 25)}…` : label;
		}
		/**
		* Render the per-model daily token trend.
		*
		* @param props - the day points in plot order, the ranked model series
		* (aligned with those points), and the locale seat.
		* @returns the legend plus the SVG chart.
		*/
		function MultiModelTrendChart({ points, series, t }) {
			const [active, setActive] = (0, react.useState)(null);
			const equidistant = {
				mode: "equidistant",
				points: [...points]
			};
			const innerHeight = 140;
			const { top, ticks } = tickValues(Math.max(1, ...series.flatMap((item) => item.values)));
			const { xs, innerWidth } = scaleSeries(equidistant, 44, 784);
			const y = (tokens) => 152 - tokens / top * innerHeight;
			const yZero = y(0);
			const paths = series.map((item) => smoothSeriesPath({
				xs,
				ys: item.values.map((value) => y(value)),
				yZero,
				hold: "zero"
			}));
			const handleMouseMove = (event) => {
				if (points.length <= 1) return;
				const rect = event.currentTarget.getBoundingClientRect();
				if (rect.width <= 0) return;
				const svgX = (event.clientX - rect.left) / rect.width * 800;
				let closest = 0;
				let minDiff = Math.abs(xs[0] - svgX);
				for (let index = 1; index < xs.length; index += 1) {
					const diff = Math.abs(xs[index] - svgX);
					if (diff < minDiff) {
						minDiff = diff;
						closest = index;
					}
				}
				setActive(closest);
			};
			/** Invisible column around one point, spanning to its neighbours' midpoints. */
			const hitExtent = (index) => {
				if (points.length === 1) return {
					start: 44,
					width: innerWidth
				};
				const center = xs[index];
				const before = index === 0 ? void 0 : xs[index - 1];
				const after = index === points.length - 1 ? void 0 : xs[index + 1];
				const toPrev = before === void 0 ? innerWidth : (center - before) / 2;
				const toNext = after === void 0 ? innerWidth : (after - center) / 2;
				const half = Math.max(Math.min(toPrev, toNext), 6);
				return {
					start: center - half,
					width: half * 2
				};
			};
			const activePoint = active === null ? null : points[active] ?? null;
			const activeRows = active === null ? [] : series.map((item) => ({
				key: item.key,
				label: item.label,
				color: item.color,
				value: item.values[active] ?? 0
			})).filter((row) => row.value > 0).sort((left, right) => right.value - left.value);
			const tipTitle = activePoint === null ? "" : t("chart.pointLabel", {
				day: activePoint.full,
				tokens: formatTokens(activePoint.tokens)
			});
			const tipWidth = Math.min(740, Math.max(tipTitle.length, ...activeRows.map((row) => shortLabel(row.label).length + formatTokens(row.value).length + 4), 12) * TOOLTIP_CHAR_WIDTH + 30);
			const tipHeight = 22 + activeRows.length * TOOLTIP_ROW_HEIGHT + 8;
			const tipLeft = activePoint === null ? 44 : Math.min(Math.max(xs[active] - tipWidth / 2, 44), 784 - tipWidth);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: TrendChart_module_css_default.multiWrap,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: TrendChart_module_css_default.legend,
					role: "list",
					children: series.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: TrendChart_module_css_default.legendItem,
						role: "listitem",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: TrendChart_module_css_default.swatch,
								style: { backgroundColor: item.color }
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: TrendChart_module_css_default.legendName,
								title: item.label,
								children: item.label
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: TrendChart_module_css_default.legendValue,
								children: formatTokens(item.total)
							})
						]
					}, item.key))
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
					role: "img",
					"aria-label": t("chart.ariaModels"),
					viewBox: `0 0 800 190`,
					className: TrendChart_module_css_default.chart,
					onMouseMove: handleMouseMove,
					onMouseLeave: () => setActive(null),
					children: [
						ticks.map((tick) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
							x1: 44,
							y1: y(tick),
							x2: 784,
							y2: y(tick),
							className: TrendChart_module_css_default.grid
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
							x: 38,
							y: y(tick) + 3,
							textAnchor: "end",
							className: TrendChart_module_css_default.tick,
							children: formatTokens(tick)
						})] }, tick)),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
							x1: 44,
							y1: y(0),
							x2: 784,
							y2: y(0),
							className: TrendChart_module_css_default.axis
						}),
						series.map((item, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
							d: paths[index],
							className: TrendChart_module_css_default.modelLine,
							style: { stroke: item.color }
						}, item.key)),
						active !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
							pointerEvents: "none",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
								x1: xs[active],
								y1: 12,
								x2: xs[active],
								y2: yZero,
								className: TrendChart_module_css_default.guide
							}), series.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
								cx: xs[active],
								cy: y(item.values[active] ?? 0),
								r: 3.5,
								className: TrendChart_module_css_default.modelDot,
								style: { fill: item.color }
							}, item.key))]
						}) : null,
						points.map((point, index) => {
							const hit = hitExtent(index);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
								x: hit.start,
								y: 12,
								width: hit.width,
								height: innerHeight,
								fill: "transparent",
								"aria-label": t("chart.pointLabel", {
									day: point.full,
									tokens: formatTokens(point.tokens)
								}),
								role: "button",
								tabIndex: 0,
								className: TrendChart_module_css_default.hit,
								onMouseEnter: () => setActive(index),
								onFocus: () => setActive(index),
								onBlur: () => setActive((current) => current === index ? null : current)
							}, point.key);
						}),
						activePoint !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
							className: TrendChart_module_css_default.pointLabel,
							pointerEvents: "none",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
									x: tipLeft,
									y: 16,
									width: tipWidth,
									height: tipHeight,
									rx: 6
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
									x: tipLeft + 12,
									y: 31,
									className: TrendChart_module_css_default.tooltipTitle,
									children: tipTitle
								}),
								activeRows.map((row, index) => {
									const rowY = 46 + index * TOOLTIP_ROW_HEIGHT;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
											x: tipLeft + 12,
											y: rowY - 6,
											width: 8,
											height: 8,
											rx: 2,
											style: { fill: row.color }
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
											x: tipLeft + 26,
											y: rowY + 1,
											className: TrendChart_module_css_default.tooltipText,
											children: shortLabel(row.label)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
											x: tipLeft + tipWidth - 10,
											y: rowY + 1,
											textAnchor: "end",
											className: TrendChart_module_css_default.tooltipValue,
											children: formatTokens(row.value)
										})
									] }, row.key);
								})
							]
						}) : null,
						labelIndices(points.length).map((index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
							x: xs[index],
							y: 184,
							textAnchor: index === 0 ? "start" : index === points.length - 1 ? "end" : "middle",
							className: TrendChart_module_css_default.tick,
							children: points[index].label
						}, index))
					]
				})]
			});
		}
		//#endregion
		//#region src/client/trend-chart/models.ts
		/** Fixed palette: enough hues to keep six models apart in both light and
		* dark themes; index order is the ranking order (biggest model first). */
		const MODEL_CHART_COLORS = [
			"#5B8FF9",
			"#5AD8A6",
			"#F6BD16",
			"#E8684A",
			"#9270CA",
			"#6DC8EC",
			"#FF9D4D",
			"#269A99"
		];
		/** Synthetic series key of the folded tail beyond the display limit. */
		const OTHER_MODEL_KEY = "__other__";
		/** Neutrals keep the folded tail visible without claiming a palette hue. */
		const OTHER_MODEL_COLOR = "#9CA3AF";
		/**
		* Fold `rateRows` into ranked per-model daily token series.
		*
		* Rows sharing a day and model across different rate identities (and the
		* same model met under two spellings) sum into one cell, so a model line is
		* its whole billed input + output + cache traffic. Failure rows (`model ===
		* ''`) and zero-token cells stay out: they carry no line to draw.
		*
		* @param input - the filtered rate rows, the chart's day keys in plot order,
		* the display limit, and the localised label for the folded tail.
		* @returns up to `limit` ranked series plus an optional folded "other" series
		* (omitted when the tail is empty); `[]` when nothing has tokens.
		*/
		function buildModelDaySeries(input) {
			const perModel = /* @__PURE__ */ new Map();
			const totals = /* @__PURE__ */ new Map();
			for (const row of input.rateRows) {
				if (row.model === "") continue;
				const tokens = totalTokens(row.totals);
				if (tokens <= 0) continue;
				let byDay = perModel.get(row.model);
				if (byDay === void 0) {
					byDay = /* @__PURE__ */ new Map();
					perModel.set(row.model, byDay);
				}
				byDay.set(row.day, (byDay.get(row.day) ?? 0) + tokens);
				totals.set(row.model, (totals.get(row.model) ?? 0) + tokens);
			}
			if (totals.size === 0) return [];
			const ranked = [...totals.entries()].sort((left, right) => right[1] - left[1]);
			const limit = Math.max(1, input.limit ?? 6);
			const top = ranked.slice(0, limit);
			const rest = ranked.slice(limit);
			const series = top.map(([model, total], index) => ({
				key: model,
				label: model,
				color: MODEL_CHART_COLORS[index % MODEL_CHART_COLORS.length],
				values: input.dayKeys.map((day) => perModel.get(model)?.get(day) ?? 0),
				total
			}));
			if (rest.length > 0) {
				const restTotals = new Map(rest.map(([model]) => [model, perModel.get(model) ?? /* @__PURE__ */ new Map()]));
				series.push({
					key: OTHER_MODEL_KEY,
					label: input.otherLabel,
					color: OTHER_MODEL_COLOR,
					values: input.dayKeys.map((day) => {
						let sum = 0;
						for (const byDay of restTotals.values()) sum += byDay.get(day) ?? 0;
						return sum;
					}),
					total: rest.reduce((sum, [, total]) => sum + total, 0)
				});
			}
			return series;
		}
		//#endregion
		//#region src/client/trend-chart/points.ts
		/** Render-mode priority: request buckets outrank per-hour, which
		* outranks per-day. A session-scoped read passes `requests`; the settings
		* page passes `hours` for a single-day range; everything else plots days. */
		function buildChartPoints(input) {
			if (input.requests !== void 0 && input.requests.length > 0) {
				const buckets = bucketsOf(input.requests);
				if (buckets.length > 0) {
					const crossDay = new Date(buckets[0].start).toDateString() !== new Date(buckets[buckets.length - 1].start).toDateString();
					return {
						mode: "temporal",
						points: buckets.map((bucket, index) => ({
							key: `b${index}`,
							label: bucketLabel(bucket.start, crossDay),
							full: `${bucketLabel(bucket.start, crossDay)}–${bucketLabel(bucket.end, crossDay)}`,
							tokens: bucket.tokens,
							time: bucket.start,
							end: bucket.end,
							count: bucket.count
						}))
					};
				}
			}
			if (input.hours !== void 0) {
				const points = hourSeries(input.hours, input.from, input.to);
				if (points.length > 0) return {
					mode: "equidistant",
					points: points.map(hourToPoint)
				};
			}
			const points = daySeries(input.rows, input.from, input.to);
			if (points.length > 0) return {
				mode: "equidistant",
				points: points.map(dayToPoint)
			};
			return null;
		}
		/**
		* The cumulative view of a series: every point's `tokens` replaced by the
		* running total up to and including that point (a prefix sum), so the chart
		* reads as a monotonic rise. Orthogonal to the mode — all three input
		* shapes are time-ascending, so a plain forward fold is order-correct. The
		* input series is left untouched; each point is copied with only `tokens`
		* rewritten, so the renderer's shape probes (`'time' in point`) keep working.
		* @param series - the series from {@link buildChartPoints}.
		* @returns a new series of the same mode and shape.
		*/
		function cumulateSeries(series) {
			let running = 0;
			const fold = (points) => points.map((point) => {
				running += point.tokens;
				return {
					...point,
					tokens: running
				};
			});
			if (series.mode === "equidistant") return {
				mode: "equidistant",
				points: fold(series.points)
			};
			return {
				mode: "temporal",
				points: fold(series.points)
			};
		}
		/** A series that already carries `count` (the host's `fields=session`
		* downsample) is plotted as-is; a raw per-request series is folded here. */
		function bucketsOf(requests) {
			if (requests[0]?.count !== void 0) return requests.map((point) => ({
				start: point.time,
				end: point.end ?? point.time,
				tokens: point.tokens,
				count: point.count ?? 1
			}));
			return bucketSeries(requests);
		}
		function dayToPoint(point) {
			return {
				key: point.day,
				label: point.day.slice(5),
				full: point.day,
				tokens: point.tokens
			};
		}
		function hourToPoint(point) {
			return {
				key: point.hour,
				label: `${point.hour.slice(11)}:00`,
				full: `${point.hour.slice(0, 10)} ${point.hour.slice(11)}:00`,
				tokens: point.tokens
			};
		}
		/** Zero-padded HH:mm of one wall time, local-time. */
		function clockOf(time) {
			const d = new Date(time);
			return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
		}
		/** The x-axis label of one bucket start: HH:mm within one day,
		* MM-DD HH:mm once the session crosses midnight. */
		function bucketLabel(time, crossDay) {
			if (!crossDay) return clockOf(time);
			const d = new Date(time);
			return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${clockOf(time)}`;
		}
		//#endregion
		//#region src/client/TrendChart.tsx
		/**
		* Daily / hourly / request-bucketed token trend chart (browser half):
		* a dependency-free SVG line chart over the already-filtered summary.
		* The renderer is pure presentation; the bucketing, scaling, and
		* point-shape decisions live in `./trend-chart/*` so each piece can be
		* tested in isolation.
		*
		* Two granularities share one renderer — per-day rows (x axis spans
		* every calendar day of the active range, days without records plot as
		* zero) and per-hour rows (a single-day window plots every whole hour of
		* that day, 00:00–23:00, future hours of today reading zero). The
		* third mode — request buckets — folds the request series into uniformly
		* sized time buckets spanning the session's actual first-to-last window
		* and scales each bucket at its real temporal proportion of the span.
		*
		* Hovering (or keyboard-focusing) a point highlights it and floats a
		* label with that point's date/time and total tokens.
		*
		* @module token-usage/client/TrendChart
		*/
		/** SVG canvas metrics; shared with the per-model renderer so both charts
		* line up under the same section width and margins. */
		const WIDTH = 800;
		const HEIGHT = 190;
		const TOP = 12;
		const LEFT = 44;
		/**
		* Apply the `t`-based localisation to a point's `full` tooltip. The pre-shape
		* labels live in points.ts; the chart's aria-label and the floating tooltip
		* both use this single source so the two stay consistent. Cumulative mode
		* swaps in its own phrasing so "total" never reads ambiguous next to a
		* running sum.
		* @param t - the locale seat.
		* @param point - the pre-shaped point.
		* @param mode - the active y-axis mode.
		* @returns the tooltip / aria-label text.
		*/
		function tipOf(t, point, mode) {
			if (point.time !== void 0) {
				const params = {
					window: point.full,
					count: String(point.count ?? 0),
					tokens: formatTokens(point.tokens)
				};
				return mode === "cumulative" ? t("chart.cumulativeBucket", params) : t("chart.bucket", params);
			}
			const params = {
				day: point.full,
				tokens: formatTokens(point.tokens)
			};
			return mode === "cumulative" ? t("chart.cumulativePoint", params) : t("chart.pointLabel", params);
		}
		/**
		* Render the daily / hourly / request-bucketed token line chart. Pure
		* presentation: every data-driven decision (bucketing, axis scaling,
		* point ordering) lives in `./trend-chart/*`; this component picks the
		* right `chartAria` string for screen readers and forwards hover /
		* focus state to the dot + label.
		*
		* Empty ranges (no data on any branch) render a placeholder instead of an
		* axis so the layout does not collapse to an empty SVG.
		*
		* @param props - the filtered per-day rows plus the optional per-hour rows
		* (when present the chart plots hours instead of days), the optional
		* per-request series (session-scoped reads), the active range bounds
		* (absent when unfiltered; the chart then spans first to last row), the
		* optional y-axis mode (interval totals, or their running cumulative sum),
		* and
		* the `t` seat for the empty hint and chart aria-label.
		* @returns the SVG chart, or a placeholder for an empty range.
		*/
		function TrendChart({ rows, hours, requests, from, to, mode = "interval", rateRows, t }) {
			const isLight = useIsLightMode();
			const gradientId = (0, react.useId)();
			const [active, setActive] = (0, react.useState)(null);
			const base = buildChartPoints({
				rows,
				hours,
				requests,
				from,
				to
			});
			if (base === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: TrendChart_module_css_default.empty,
				children: t("chart.empty")
			});
			const series = mode === "cumulative" ? cumulateSeries(base) : base;
			if (rateRows !== void 0 && mode === "interval" && hours === void 0 && series.mode === "equidistant") {
				const modelSeries = buildModelDaySeries({
					rateRows,
					dayKeys: series.points.map((point) => point.key),
					otherLabel: t("chart.modelOther")
				});
				if (modelSeries.length >= 2) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MultiModelTrendChart, {
					points: series.points,
					series: modelSeries,
					t
				});
			}
			const points = series.points.map((point) => ({
				key: point.key,
				label: point.label,
				full: point.full,
				tokens: point.tokens,
				time: "time" in point ? point.time : void 0,
				count: "count" in point ? point.count : void 0
			}));
			const { top, ticks } = tickValues(Math.max(...points.map((p) => p.tokens)));
			const innerHeight = 140;
			const { xs, xEnds, innerWidth } = scaleSeries(series, LEFT, 784);
			const radius = dotRadius(points.length);
			const activePoint = active === null ? null : points[active] ?? null;
			const y = (tokens) => 152 - tokens / top * innerHeight;
			const ys = points.map((point) => y(point.tokens));
			const yZero = y(0);
			const path = smoothSeriesPath({
				xs,
				ys,
				yZero,
				gaps: series.mode === "temporal" ? gapAfter(series.points) : void 0,
				xEnds: series.mode === "temporal" ? xEnds ?? xs : void 0,
				hold: mode === "cumulative" ? "previous" : "zero"
			});
			const area = areaPath(path, xs, yZero);
			const chartAria = mode === "cumulative" ? t("chart.ariaCumulative") : series.mode === "temporal" ? t("chart.ariaRequests") : hours !== void 0 ? t("chart.ariaHour") : t("chart.aria");
			const hitExtent = (index) => {
				if (points.length === 1) return {
					start: LEFT,
					width: innerWidth
				};
				const center = xs[index];
				const before = index === 0 ? void 0 : xs[index - 1];
				const after = index === points.length - 1 ? void 0 : xs[index + 1];
				const toPrev = before === void 0 ? innerWidth : (center - before) / 2;
				const toNext = after === void 0 ? innerWidth : (after - center) / 2;
				const half = Math.max(Math.min(toPrev, toNext), 6);
				return {
					start: center - half,
					width: half * 2
				};
			};
			const handleMouseMove = (event) => {
				if (points.length <= 1) return;
				const rect = event.currentTarget.getBoundingClientRect();
				if (rect.width <= 0) return;
				const svgX = (event.clientX - rect.left) / rect.width * WIDTH;
				let closest = 0;
				let minDiff = Math.abs(xs[0] - svgX);
				for (let i = 1; i < xs.length; i += 1) {
					const diff = Math.abs(xs[i] - svgX);
					if (diff < minDiff) {
						minDiff = diff;
						closest = i;
					}
				}
				setActive(closest);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				role: "img",
				"aria-label": chartAria,
				viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
				className: `${TrendChart_module_css_default.chart} ${isLight ? TrendChart_module_css_default.chartLight : ""}`.trim(),
				"data-theme": isLight ? "light" : "dark",
				onMouseMove: handleMouseMove,
				onMouseLeave: () => setActive(null),
				children: [
					isLight ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("defs", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("linearGradient", {
						id: gradientId,
						x1: "0",
						y1: "0",
						x2: "0",
						y2: "1",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
								offset: "0%",
								stopColor: "var(--dsw-alias-label-primary)",
								stopOpacity: "0.045"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
								offset: "55%",
								stopColor: "var(--dsw-alias-label-primary)",
								stopOpacity: "0.012"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("stop", {
								offset: "100%",
								stopColor: "var(--dsw-alias-label-primary)",
								stopOpacity: "0.0"
							})
						]
					}) }) : null,
					ticks.map((tick) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: LEFT,
						y1: y(tick),
						x2: 784,
						y2: y(tick),
						className: TrendChart_module_css_default.grid
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
						x: 38,
						y: y(tick) + 3,
						textAnchor: "end",
						className: TrendChart_module_css_default.tick,
						children: formatTokens(tick)
					})] }, tick)),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: LEFT,
						y1: y(0),
						x2: 784,
						y2: y(0),
						className: TrendChart_module_css_default.axis
					}),
					isLight && area !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: area,
						fill: `url(#${gradientId})`,
						className: TrendChart_module_css_default.area
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
						d: path,
						className: TrendChart_module_css_default.line
					}),
					activePoint !== null && active !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
						pointerEvents: "none",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							cx: xs[active],
							cy: y(activePoint.tokens),
							r: radius + 3.5,
							className: TrendChart_module_css_default.dotHalo
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
							cx: xs[active],
							cy: y(activePoint.tokens),
							r: radius,
							className: TrendChart_module_css_default.dotActive
						})]
					}) : points.length === 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
						cx: xs[0],
						cy: y(points[0].tokens),
						r: radius,
						className: TrendChart_module_css_default.dot
					}) : null,
					activePoint !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: xs[active],
						y1: y(activePoint.tokens),
						x2: xs[active],
						y2: y(0),
						className: TrendChart_module_css_default.guide
					}) : null,
					points.map((point, index) => {
						const hit = hitExtent(index);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
							x: hit.start,
							y: TOP,
							width: hit.width,
							height: innerHeight,
							fill: "transparent",
							"aria-label": tipOf(t, point, mode),
							role: "button",
							tabIndex: 0,
							className: TrendChart_module_css_default.hit,
							onMouseEnter: () => setActive(index),
							onFocus: () => setActive(index),
							onBlur: () => setActive((current) => current === index ? null : current)
						}, point.key);
					}),
					activePoint !== null ? (() => {
						const label = tipOf(t, activePoint, mode);
						const labelWidth = label.length * 6.2 + 14;
						const center = xs[active];
						const left = Math.min(Math.max(center - labelWidth / 2, LEFT), 784 - labelWidth);
						const labelY = Math.max(y(activePoint.tokens) - 12, 20);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("g", {
							className: TrendChart_module_css_default.pointLabel,
							pointerEvents: "none",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
								x: left,
								y: labelY - 14,
								width: labelWidth,
								height: 22,
								rx: 6
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
								x: left + labelWidth / 2,
								y: labelY + 1,
								textAnchor: "middle",
								children: label
							})]
						});
					})() : null,
					labelIndices(points.length).map((index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("text", {
						x: xs[index],
						y: 184,
						textAnchor: index === 0 ? "start" : index === points.length - 1 ? "end" : "middle",
						className: TrendChart_module_css_default.tick,
						children: points[index].label
					}, index))
				]
			});
		}
		//#endregion
		//#region \0dsh-css:/Users/chii/.dsh/local-src/dsh-token-usage/src/client/TokenUsageSection.module.css.mjs
		const css$1 = ".RhazIa_section{flex-direction:column;gap:16px;width:100%;display:flex}.RhazIa_head{justify-content:space-between;align-items:center;gap:12px;display:flex}.RhazIa_title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:600}.RhazIa_muted{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px}.RhazIa_error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px}.RhazIa_subtitle{color:var(--dsw-alias-label-secondary);margin:0;font-size:14px;font-weight:600}.RhazIa_segmented{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-fill-container,transparent);border-radius:8px;align-items:stretch;gap:2px;padding:2px;display:inline-flex}.RhazIa_segBtn{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));cursor:pointer;background:0 0;border:none;border-radius:6px;padding:4px 12px;font-size:12px;font-weight:500}.RhazIa_segBtn:hover:not(.RhazIa_segActive){color:var(--dsw-alias-label-secondary);background:color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent)}.RhazIa_segBtn:focus-visible{outline:2px solid var(--dsw-alias-border-l2);outline-offset:1px}.RhazIa_segActive{background:color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);color:var(--dsw-alias-label-primary);font-weight:600}.RhazIa_tableWrap{max-height:420px;overflow:auto}.RhazIa_table{border-collapse:collapse;font-variant-numeric:tabular-nums;width:100%;min-width:500px;font-size:12px}.RhazIa_table th,.RhazIa_table td{text-align:right;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap;padding:4px 6px}.RhazIa_table th.RhazIa_modelHead,.RhazIa_table td.RhazIa_modelCol{text-align:left;width:150px;max-width:150px}.RhazIa_table td.RhazIa_auxModelCell{color:var(--dsw-alias-label-secondary);padding-left:18px}.RhazIa_auxKindToggle{max-width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;align-items:center;gap:4px;margin:0;padding:0;display:inline-flex}.RhazIa_auxKindToggle:focus-visible{outline:2px solid var(--dsw-alias-border-l2);outline-offset:1px}.RhazIa_auxChevron{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));flex:none;font-size:9px;line-height:1;transition:transform .12s}.RhazIa_auxKindToggle[aria-expanded=true] .RhazIa_auxChevron{transform:rotate(90deg)}.RhazIa_table th{color:var(--dsw-alias-label-secondary);z-index:1;background:var(--dsw-alias-bg-layer-2);border-bottom:1.5px solid var(--dsw-alias-border-l2);font-weight:600;position:sticky;top:0}.RhazIa_table tbody tr{transition:background-color .12s}.RhazIa_table tbody tr:hover{background-color:var(--dsw-interactive-bg-hover)}.RhazIa_costCol{font-weight:600}.RhazIa_zeroDim{color:var(--dsw-alias-label-tertiary);opacity:.55}.RhazIa_table td{color:var(--dsw-alias-label-primary)}.RhazIa_empty{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px}.RhazIa_button{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;border-radius:6px;padding:4px 12px;font-size:13px;line-height:20px}.RhazIa_button:hover{background:var(--dsw-interactive-bg-hover)}.RhazIa_filters{flex-wrap:nowrap;align-items:center;gap:8px;display:flex}.RhazIa_cards{grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;display:grid}.RhazIa_modelCell{align-items:center;gap:4px;max-width:138px;display:inline-flex;position:relative}.RhazIa_modelName{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}button.RhazIa_modelName{max-width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;margin:0;padding:0}button.RhazIa_modelName:hover{color:var(--dsw-alias-link-primary,var(--dsw-alias-label-primary))}.RhazIa_pricingLink{color:var(--dsw-alias-link-primary,var(--dsw-alias-label-primary));cursor:pointer;white-space:nowrap;background:0 0;border:none;border-radius:6px;flex:none;margin-left:auto;padding:4px 8px;font-size:13px;line-height:20px}.RhazIa_pricingLink:hover{background:var(--dsw-interactive-bg-hover)}";
		const tagId$1 = "@laoyuehanni/dsh-token-usage/TokenUsageSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-token-usage";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var TokenUsageSection_module_css_default = {
			"auxChevron": "RhazIa_auxChevron",
			"auxKindToggle": "RhazIa_auxKindToggle",
			"auxModelCell": "RhazIa_auxModelCell",
			"button": "RhazIa_button",
			"cards": "RhazIa_cards",
			"costCol": "RhazIa_costCol",
			"empty": "RhazIa_empty",
			"error": "RhazIa_error",
			"filters": "RhazIa_filters",
			"head": "RhazIa_head",
			"modelCell": "RhazIa_modelCell",
			"modelCol": "RhazIa_modelCol",
			"modelHead": "RhazIa_modelHead",
			"modelName": "RhazIa_modelName",
			"muted": "RhazIa_muted",
			"pricingLink": "RhazIa_pricingLink",
			"section": "RhazIa_section",
			"segActive": "RhazIa_segActive",
			"segBtn": "RhazIa_segBtn",
			"segmented": "RhazIa_segmented",
			"subtitle": "RhazIa_subtitle",
			"table": "RhazIa_table",
			"tableWrap": "RhazIa_tableWrap",
			"title": "RhazIa_title",
			"zeroDim": "RhazIa_zeroDim"
		};
		//#endregion
		//#region src/client/TokenUsageSection.tsx
		/**
		* Token-usage settings page (browser half): fetches the stats summary from
		* the host route and renders the filter bar (inclusive day range, model
		* select, 1d/7d/30d quick ranges where 1d spans today 00:00–23:59), the
		* total-usage strip, the daily-token trend chart, and the per-model detail
		* table with the hit rate last — all following the active filters. A
		* priced model name is the row's price affordance (one click opens
		* PricingDialog.tsx); unpriced rows keep the in-cell tag. The filter
		* row's tail link opens the filter-free pricing-overview dialog
		* (PricingOverviewDialog.tsx). There is no refresh
		* button: entering the page or changing a filter refetches (the route
		* answers no-store); only the error state keeps a retry.
		*
		* @module token-usage/client/TokenUsageSection
		*/
		/** Fetch the summary for one query string; the caller owns the failure
		* presentation. The AbortSignal wires into the request so a filter change
		* cancels the in-flight fetch instead of letting its response overwrite
		* the next filter's data. */
		function fetchSummary(query, signal) {
			return fetch(STATS_PATH + query, { signal }).then((response) => {
				if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
				return response.json();
			}).then((value) => {
				if (typeof value !== "object" || value === null || typeof value.total !== "object") throw new Error("unexpected stats response");
				return value;
			});
		}
		/**
		* The query string of one filter selection ('' when unconstrained), or null
		* while the range is mid-edit (`from > to`): editing the two date inputs
		* one at a time passes through inverted ranges, and fetching those would
		* only flash an HTTP 400 — the request waits until the range settles.
		*/
		function filterQuery(filters) {
			if (filters.from !== "" && filters.to !== "" && filters.from > filters.to) return null;
			const params = new URLSearchParams();
			if (filters.from !== "") params.set("from", filters.from);
			if (filters.to !== "") params.set("to", filters.to);
			if (filters.model !== "") params.set("model", filters.model);
			return Array.from(params).length > 0 ? `?${params.toString()}` : "";
		}
		/** The day keys of one quick range: today minus (days - 1) through today. */
		function quickRange(days) {
			return {
				from: shiftedDayKey(-(days - 1)),
				to: shiftedDayKey(0)
			};
		}
		/** Whether the filters exactly hold one quick range. */
		function isQuickActive(days, filters) {
			const range = quickRange(days);
			return filters.from === range.from && filters.to === range.to;
		}
		/** Quick-range menu entries (labels are locale-free day counts). */
		const QUICK_OPTIONS = [
			{
				value: "1",
				label: "1d"
			},
			{
				value: "7",
				label: "7d"
			},
			{
				value: "30",
				label: "30d"
			}
		];
		/** The filter bar: quick range menu, day-range picker popover, model
		* menu — one row, one popover language. The row's tail link is an action,
		* not a selector: it opens the filter-free pricing overview. */
		function FilterBar({ filters, models, onChange, onPricingTable, t }) {
			const quickValue = QUICK_OPTIONS.find((option) => isQuickActive(Number(option.value), filters))?.value ?? (filters.from === "" && filters.to === "" ? "all" : "custom");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: TokenUsageSection_module_css_default["filters"],
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MenuSelect, {
						ariaLabel: t("filter.quickRange"),
						value: quickValue,
						options: [
							...QUICK_OPTIONS,
							{
								value: "all",
								label: t("filter.allDates")
							},
							{
								value: "custom",
								label: t("filter.custom")
							}
						],
						onChange: (value) => {
							if (value === "all") onChange({
								...filters,
								from: "",
								to: ""
							});
							const days = Number(value);
							if (days > 0) onChange({
								...filters,
								...quickRange(days)
							});
						}
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(DateRangePicker, {
						from: filters.from,
						to: filters.to,
						onChange: (next) => onChange({
							...filters,
							...next
						}),
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MenuSelect, {
						ariaLabel: t("filter.model"),
						grow: true,
						value: filters.model,
						options: [{
							value: "",
							label: t("filter.allModels")
						}, ...models.map((model) => ({
							value: model,
							label: model
						}))],
						onChange: (model) => onChange({
							...filters,
							model
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						"data-pricing-overview-trigger": true,
						className: TokenUsageSection_module_css_default["pricingLink"],
						onClick: onPricingTable,
						children: t("pricing.table")
					})
				]
			});
		}
		/**
		* The runtime-overhead tab content: the auxiliary (bypass) model requests —
		* Auto review, session-title generation, translation, and the defensive
		* "other" bucket — split by kind. Those calls are provider-billed requests of
		* a concrete model, so their usage is already folded into the totals above
		* and into the by-model table; this content is a read-only breakdown of that
		* share, never an additional total. Each kind row is a collapsed-by-default
		* disclosure: its per-model detail lines appear only while the kind's toggle
		* is activated. A summary without auxiliary requests
		* renders its empty hint inside the tab, so the dimension switch keeps a
		* stable set of tabs. The aux layer is read defensively: a host that predates
		* the field sends no `aux` at all, and that shape renders the same empty hint.
		* @param props - the aux layer of the summary (possibly absent on an older
		* host payload), the cost state, the display currency view, and the locale
		* translator.
		* @returns the tab content: an empty hint, or the per-kind table (kinds
		* collapsed, expanding to their per-model lines) with its total row.
		*/
		function AuxOverheadSection({ aux, costState, view, t }) {
			const [expandedKinds, setExpandedKinds] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const toggleKind = (0, react.useCallback)((auxKind) => {
				setExpandedKinds((previous) => {
					const next = new Set(previous);
					if (next.has(auxKind)) next.delete(auxKind);
					else next.add(auxKind);
					return next;
				});
			}, []);
			if (aux === void 0 || aux.total.requests === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: TokenUsageSection_module_css_default["muted"],
				children: t("aux.empty")
			});
			const numericCells = (totals, cost) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: totals.requests.toLocaleString() }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
					className: TokenUsageSection_module_css_default["costCol"],
					children: costsAvailable(costState) ? formatCost(cost, view) : "—"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: formatTokens(totalTokens(totals)) }),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
					className: totals.inputTokens === 0 ? TokenUsageSection_module_css_default["zeroDim"] : void 0,
					children: formatTokens(totals.inputTokens)
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
					className: totals.outputTokens === 0 ? TokenUsageSection_module_css_default["zeroDim"] : void 0,
					children: formatTokens(totals.outputTokens)
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
					className: totals.cacheReadTokens === 0 ? TokenUsageSection_module_css_default["zeroDim"] : void 0,
					children: formatTokens(totals.cacheReadTokens)
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
					className: totals.cacheWriteTokens === 0 ? TokenUsageSection_module_css_default["zeroDim"] : void 0,
					children: formatTokens(totals.cacheWriteTokens)
				})
			] });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: TokenUsageSection_module_css_default["tableWrap"],
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
					className: TokenUsageSection_module_css_default["table"],
					"aria-label": t("aux.tab"),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
							className: TokenUsageSection_module_css_default["modelHead"],
							children: t("aux.kind")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("aux.requests") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.cost") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.totalTokens") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.input") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.output") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.cacheRead") }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.cacheWrite") })
					] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tbody", { children: [(aux.byKind ?? []).map((kindRow) => {
						const expanded = expandedKinds.has(kindRow.auxKind);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
							className: TokenUsageSection_module_css_default["modelCol"],
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: TokenUsageSection_module_css_default["auxKindToggle"],
								"aria-expanded": expanded,
								onClick: () => toggleKind(kindRow.auxKind),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: TokenUsageSection_module_css_default["auxChevron"],
									"aria-hidden": "true",
									children: "▸"
								}), t(`aux.kind.${kindRow.auxKind}`)]
							})
						}), numericCells(kindRow.totals, kindRow.cost)] }), expanded && (kindRow.byModel ?? []).map((modelRow) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
							className: `${TokenUsageSection_module_css_default["modelCol"]} ${TokenUsageSection_module_css_default["auxModelCell"]}`,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: TokenUsageSection_module_css_default["modelCell"],
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: TokenUsageSection_module_css_default["modelName"],
									children: modelRow.model
								})
							})
						}), numericCells(modelRow.totals, modelRow.cost)] }, `${kindRow.auxKind}:${modelRow.model}`))] }, kindRow.auxKind);
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
						className: TokenUsageSection_module_css_default["modelCol"],
						children: t("aux.total")
					}), numericCells(aux.total, aux.cost)] })] })]
				})
			}) });
		}
		/**
		* Render the Token Usage section content column. The `t` seat arrives from
		* the registration's `locale:` declaration and follows the active locale.
		* The session jump seats (`sessionListed` / `openSession`) come from the
		* registration's `inject:` — the session table's Ctrl+click affordance
		* reads the controller's list and opens the target session.
		* @param props - the settings shell's owner share (close rides along to the
		* session jump: the jump closes the panel) plus the injected jump seats and
		* the framework-injected translate seat.
		* @returns the section, one of loading / error / ready.
		*/
		function TokenUsageSection({ t, close, sessionListed, openSession }) {
			const rootRef = (0, react.useRef)(null);
			useColorSchemeMirror(rootRef);
			const [toastText, setToastText] = (0, react.useState)(null);
			const [toastSeq, setToastSeq] = (0, react.useState)(0);
			const showToast = (0, react.useCallback)((text) => {
				setToastSeq((previous) => previous + 1);
				setToastText(text);
			}, []);
			const dismissToast = (0, react.useCallback)(() => {
				setToastText(null);
			}, []);
			const handleOpenSession = (0, react.useCallback)((id) => {
				if (!openSession) return;
				const result = openSession(id);
				if (result && typeof result === "object" && "ok" in result) {
					if (result.ok) close();
					else if (result.reason === "workspaceDeleted") showToast(t("session.workspaceDeleted"));
					return;
				}
				if (result === true) close();
			}, [
				openSession,
				close,
				showToast,
				t
			]);
			const [filters, setFilters] = (0, react.useState)(() => ({
				model: "",
				...quickRange(1)
			}));
			const [detailMode, setDetailMode] = (0, react.useState)("model");
			const [models, setModels] = (0, react.useState)([]);
			const [detailModel, setDetailModel] = (0, react.useState)(null);
			const [pricingTableOpen, setPricingTableOpen] = (0, react.useState)(false);
			const [usedSnapshot, setUsedSnapshot] = (0, react.useState)(() => /* @__PURE__ */ new Set());
			const [retryToken, setRetryToken] = (0, react.useState)(0);
			const lastSummary = (0, react.useRef)(null);
			const retry = (0, react.useCallback)(() => {
				setRetryToken((previous) => previous + 1);
			}, []);
			usePricingAssociationRefresh(retry);
			const query = filterQuery(filters);
			const lastValidQueryRef = (0, react.useRef)(query ?? "");
			if (query !== null) lastValidQueryRef.current = query;
			const fetchQuery = query ?? lastValidQueryRef.current;
			const [state] = useAsyncResource((signal) => fetchSummary(fetchQuery, signal), [fetchQuery, retryToken], {
				silentAfterFirst: false,
				retryToken
			});
			(0, react.useEffect)(() => {
				if (state.status !== "ready") return;
				if (filters.model !== "") return;
				const next = state.value.byModel.map((row) => row.model);
				if (next.length === models.length && next.every((m, i) => m === models[i])) return;
				setModels(next);
			}, [
				state,
				filters.model,
				models
			]);
			if (state.status === "ready") lastSummary.current = state.value;
			const retainedView = lastSummary.current !== null ? currencyViewOf(lastSummary.current) : {
				symbol: "￥",
				rate: 1
			};
			const pricingOverview = pricingTableOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PricingOverviewDialog, {
				usedModels: usedSnapshot,
				view: retainedView,
				onClose: () => setPricingTableOpen(false),
				t
			}) : null;
			if (state.status === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: rootRef,
				className: TokenUsageSection_module_css_default["section"],
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(PricingAssociationProvider, {
					resolutions: lastSummary.current?.modelResolutions,
					feedVersion: lastSummary.current?.feedVersion,
					view: retainedView,
					t,
					children: [
						pricingOverview,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: TokenUsageSection_module_css_default["title"],
							children: t("nav.label")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: TokenUsageSection_module_css_default["muted"],
							children: t("loading")
						})
					]
				})
			});
			if (state.status === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: rootRef,
				className: TokenUsageSection_module_css_default["section"],
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(PricingAssociationProvider, {
					resolutions: lastSummary.current?.modelResolutions,
					feedVersion: lastSummary.current?.feedVersion,
					view: retainedView,
					t,
					children: [
						pricingOverview,
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: TokenUsageSection_module_css_default["head"],
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
								className: TokenUsageSection_module_css_default["title"],
								children: t("nav.label")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: TokenUsageSection_module_css_default["button"],
								onClick: retry,
								children: t("retry")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: TokenUsageSection_module_css_default["error"],
							children: t("loadFailed", { message: state.message })
						})
					]
				})
			});
			const { total } = state.value;
			const view = currencyViewOf(state.value);
			const auxRequests = state.value.aux?.total.requests ?? 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: rootRef,
				className: TokenUsageSection_module_css_default["section"],
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(PricingAssociationProvider, {
					resolutions: state.value.modelResolutions,
					feedVersion: state.value.feedVersion,
					view,
					t,
					children: [
						pricingOverview,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							className: TokenUsageSection_module_css_default["title"],
							children: t("nav.label")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: TokenUsageSection_module_css_default["muted"],
							children: t("dataDir", { path: state.value.dataDir })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilterBar, {
							filters,
							models,
							onChange: setFilters,
							onPricingTable: () => {
								setUsedSnapshot(new Set(state.value.byModel.map((row) => row.model)));
								setPricingTableOpen(true);
							},
							t
						}),
						total.requests === 0 && (total.failures ?? 0) === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: TokenUsageSection_module_css_default["empty"],
							children: t("empty")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: TokenUsageSection_module_css_default["cards"],
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RequestsStatCard, {
										requests: total.requests,
										failures: total.failures ?? 0,
										failuresByCode: total.failuresByCode,
										t
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
										label: t("stat.cost"),
										value: costsAvailable(state.value.costState) ? formatCost(state.value.totalCost, view) : "—"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
										label: t("stat.totalTokens"),
										value: formatTokens(totalTokens(total))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
										label: t("stat.hitRate"),
										value: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HitRateText, { totals: total })
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: TokenUsageSection_module_css_default["cards"],
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
										label: t("stat.input"),
										value: formatTokens(total.inputTokens)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
										label: t("stat.output"),
										value: formatTokens(total.outputTokens)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
										label: t("stat.cacheRead"),
										value: formatTokens(total.cacheReadTokens)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
										label: t("stat.cacheWrite"),
										value: formatTokens(total.cacheWriteTokens)
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PricingStatus, {
								costState: state.value.costState,
								pricingUnavailableReason: state.value.pricingUnavailableReason,
								associationStorageError: state.value.associationStorageError,
								t
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TrendChart, {
								rows: state.value.byDay,
								rateRows: state.value.rateRows,
								t,
								...filters.from !== "" ? { from: filters.from } : {},
								...filters.to !== "" ? { to: filters.to } : {},
								...filters.from !== "" && filters.from === filters.to ? { hours: state.value.byHour } : {}
							}),
							state.value.byModel.length > 0 || (state.value.sessionRows?.length ?? 0) > 0 || auxRequests > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: TokenUsageSection_module_css_default["segmented"],
								role: "group",
								"aria-label": t("detail.switch.label"),
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: detailMode === "model" ? `${TokenUsageSection_module_css_default["segBtn"]} ${TokenUsageSection_module_css_default["segActive"]}` : TokenUsageSection_module_css_default["segBtn"],
										"aria-pressed": detailMode === "model",
										onClick: () => setDetailMode("model"),
										children: t("byModel.title")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: detailMode === "session" ? `${TokenUsageSection_module_css_default["segBtn"]} ${TokenUsageSection_module_css_default["segActive"]}` : TokenUsageSection_module_css_default["segBtn"],
										"aria-pressed": detailMode === "session",
										onClick: () => setDetailMode("session"),
										children: t("bySession.title")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: detailMode === "aux" ? `${TokenUsageSection_module_css_default["segBtn"]} ${TokenUsageSection_module_css_default["segActive"]}` : TokenUsageSection_module_css_default["segBtn"],
										"aria-pressed": detailMode === "aux",
										onClick: () => setDetailMode("aux"),
										children: t("aux.tab")
									})
								]
							}), detailMode === "model" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: TokenUsageSection_module_css_default["tableWrap"],
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
									className: TokenUsageSection_module_css_default["table"],
									"aria-label": t("byModel.title"),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
											className: TokenUsageSection_module_css_default["modelHead"],
											children: t("filter.model")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
											"aria-label": t("stat.successFail"),
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RequestsSplitHead, { t })
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.cost") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.totalTokens") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.input") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.output") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.cacheRead") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.cacheWrite") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.hitRate") })
									] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: state.value.byModel.map((row) => {
										const rules = state.value.pricing[row.model];
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: TokenUsageSection_module_css_default["modelCol"],
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: TokenUsageSection_module_css_default["modelCell"],
													children: [rules !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														type: "button",
														className: TokenUsageSection_module_css_default["modelName"],
														"aria-label": t("pricing.view", { model: row.model }),
														onClick: () => setDetailModel(row.model),
														children: row.model
													}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: TokenUsageSection_module_css_default["modelName"],
														children: row.model
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnpricedModelTag, {
														model: row.model,
														t
													})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelAssociationBadge, {
														model: row.model,
														t
													})]
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RequestsCell, {
												requests: row.totals.requests,
												failures: row.totals.failures ?? 0,
												failuresByCode: row.totals.failuresByCode,
												t
											}) }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: TokenUsageSection_module_css_default["costCol"],
												children: costsAvailable(state.value.costState) && rules !== void 0 ? formatCost(row.cost, view) : "—"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: formatTokens(totalTokens(row.totals)) }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: row.totals.inputTokens === 0 ? TokenUsageSection_module_css_default["zeroDim"] : void 0,
												children: formatTokens(row.totals.inputTokens)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: row.totals.outputTokens === 0 ? TokenUsageSection_module_css_default["zeroDim"] : void 0,
												children: formatTokens(row.totals.outputTokens)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: row.totals.cacheReadTokens === 0 ? TokenUsageSection_module_css_default["zeroDim"] : void 0,
												children: formatTokens(row.totals.cacheReadTokens)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: row.totals.cacheWriteTokens === 0 ? TokenUsageSection_module_css_default["zeroDim"] : void 0,
												children: formatTokens(row.totals.cacheWriteTokens)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HitRateText, { totals: row.totals }) })
										] }, row.model);
									}) })]
								})
							}) : detailMode === "session" ? (state.value.sessionRows?.length ?? 0) > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SessionTable, {
								rows: state.value.sessionRows ?? [],
								costState: state.value.costState,
								view,
								t,
								...sessionListed !== void 0 && openSession !== void 0 ? {
									sessionListed,
									openSession: handleOpenSession
								} : {}
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: TokenUsageSection_module_css_default["muted"],
								children: t("chart.empty")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AuxOverheadSection, {
								aux: state.value.aux,
								costState: state.value.costState,
								view,
								t
							})] }) : null,
							detailModel !== null && state.value.pricing[detailModel] !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PricingDialog, {
								model: detailModel,
								rules: state.value.pricing[detailModel],
								view,
								onClose: () => setDetailModel(null),
								t
							}) : null
						] }),
						toastText !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Toast, {
							text: toastText,
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, {}),
							onDone: dismissToast
						}, toastSeq)
					]
				})
			});
		}
		//#endregion
		//#region \0dsh-css:/Users/chii/.dsh/local-src/dsh-token-usage/src/client/UsageView.module.css.mjs
		const css = "._31nSua_root{box-sizing:border-box;width:100%;padding:12px calc(var(--dsh-composer-side-clearance,16px) + 16px);padding-bottom:calc(var(--dsh-composer-height,152px) + 16px);flex-direction:column;gap:12px;max-width:1400px;height:100%;min-height:0;margin:0 auto;display:flex;overflow-y:auto}._31nSua_head{flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:12px;display:flex}._31nSua_headRight{align-items:center;gap:10px;display:flex}._31nSua_back{border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border-radius:6px;padding:3px 10px;font-size:12px}._31nSua_back:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}._31nSua_segmented{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-fill-container,transparent);border-radius:8px;align-items:stretch;gap:2px;padding:2px;display:inline-flex}._31nSua_segBtn{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));cursor:pointer;background:0 0;border:none;border-radius:6px;padding:4px 12px;font-size:12px;font-weight:500}._31nSua_segBtn:hover:not(._31nSua_segActive){color:var(--dsw-alias-label-secondary);background:color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent)}._31nSua_segBtn:focus-visible{outline:2px solid var(--dsw-alias-border-l2);outline-offset:1px}._31nSua_segActive{background:color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);color:var(--dsw-alias-label-primary);font-weight:600}._31nSua_muted{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px}._31nSua_error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:13px}._31nSua_empty{color:var(--dsw-alias-label-secondary);text-align:center;margin:24px 0 0;font-size:13px}._31nSua_button{border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border-radius:6px;align-self:flex-start;padding:3px 10px;font-size:12px}._31nSua_warning{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary));margin:0;font-size:12px}._31nSua_note{color:var(--dsw-alias-label-tertiary);margin:0;font-size:11px}._31nSua_cards{grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;display:grid}._31nSua_tokenStrip{color:var(--dsw-alias-label-secondary);flex-wrap:wrap;gap:18px;padding:6px 2px 0;font-size:12px;display:flex}._31nSua_tokenStrip b{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}._31nSua_mid{grid-template-columns:minmax(0,3fr) minmax(0,2fr);align-items:start;gap:14px;display:grid}._31nSua_chartCol,._31nSua_modelCol,._31nSua_subagents{flex-direction:column;gap:6px;min-width:0;display:flex}._31nSua_subagentsHead,._31nSua_chartHead{align-items:center;gap:8px;display:flex}._31nSua_subtitle{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;font-weight:600}._31nSua_tableWrap{overflow-x:auto}._31nSua_table{border-collapse:collapse;font-variant-numeric:tabular-nums;width:100%;min-width:480px;font-size:12px}._31nSua_table th,._31nSua_table td{text-align:right;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap;padding:4px 6px}._31nSua_table tbody tr{transition:background-color .12s}._31nSua_table tbody tr:hover{background-color:var(--dsw-interactive-bg-hover)}._31nSua_table th{border-bottom:1.5px solid var(--dsw-alias-border-l2);font-weight:600}._31nSua_costCol{font-weight:600}._31nSua_zeroDim{color:var(--dsw-alias-label-tertiary);opacity:.55}._31nSua_table th:first-child,._31nSua_table td:first-child,._31nSua_modelHead{text-align:left}._31nSua_modelCell{font-variant-numeric:normal;text-overflow:ellipsis;max-width:180px;overflow:hidden}._31nSua_modelIdentity{align-items:center;gap:4px;max-width:180px;display:inline-flex}._31nSua_modelName{text-overflow:ellipsis;min-width:0;overflow:hidden}._31nSua_childLink{color:var(--dsw-alias-link-primary,var(--dsw-alias-label-primary));cursor:pointer;text-align:left;text-overflow:ellipsis;white-space:nowrap;background:0 0;border:none;max-width:220px;padding:0;font-size:12px;overflow:hidden}._31nSua_childLink:hover{text-decoration:underline}._31nSua_nestedBadge{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;margin-left:6px;font-size:11px}@media (width<=900px){._31nSua_cards{grid-template-columns:repeat(3,minmax(0,1fr))}._31nSua_mid{grid-template-columns:1fr}}";
		const tagId = "@laoyuehanni/dsh-token-usage/UsageView.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@laoyuehanni/dsh-token-usage";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var UsageView_module_css_default = {
			"back": "_31nSua_back",
			"button": "_31nSua_button",
			"cards": "_31nSua_cards",
			"chartCol": "_31nSua_chartCol",
			"chartHead": "_31nSua_chartHead",
			"childLink": "_31nSua_childLink",
			"costCol": "_31nSua_costCol",
			"empty": "_31nSua_empty",
			"error": "_31nSua_error",
			"head": "_31nSua_head",
			"headRight": "_31nSua_headRight",
			"mid": "_31nSua_mid",
			"modelCell": "_31nSua_modelCell",
			"modelCol": "_31nSua_modelCol",
			"modelHead": "_31nSua_modelHead",
			"modelIdentity": "_31nSua_modelIdentity",
			"modelName": "_31nSua_modelName",
			"muted": "_31nSua_muted",
			"nestedBadge": "_31nSua_nestedBadge",
			"note": "_31nSua_note",
			"root": "_31nSua_root",
			"segActive": "_31nSua_segActive",
			"segBtn": "_31nSua_segBtn",
			"segmented": "_31nSua_segmented",
			"subagents": "_31nSua_subagents",
			"subagentsHead": "_31nSua_subagentsHead",
			"subtitle": "_31nSua_subtitle",
			"table": "_31nSua_table",
			"tableWrap": "_31nSua_tableWrap",
			"tokenStrip": "_31nSua_tokenStrip",
			"warning": "_31nSua_warning",
			"zeroDim": "_31nSua_zeroDim"
		};
		//#endregion
		//#region src/client/UsageView.tsx
		/**
		* The conversation view tab "Usage" (browser half): one entry of the
		* `conversation.view` slot ring (beside Chat / Trajectory), rendering the
		* per-session token & cost dashboard for the ACTIVE conversation. The tab
		* shows the focused session's totals (successful requests with a failure
		* pill, 4 token buckets, cost, hit rate, TTFT average, decode throughput) with a
		* scope switch between the session alone and its whole subagent subtree, a
		* per-hour trend chart and the per-model table from the host stats route
		* (`sessionId`-scoped), and a subagent table below — each row drill-in
		* switches the focus to that child.
		*
		* Data sources: token/cost figures come from the host route (the pricing
		* rule chain's authority); TTFT and throughput come from the framework's
		* retained `sessionStats` projection values (`useProjection` for the current
		* session, `byId[].projectionValues` for every other session), which cover
		* the whole log including history written before this plugin was installed.
		* A footnote states the two scopes so the difference is not a surprise.
		*
		* The root declares `data-conversation-composer-overlay` — the same host
		* opt-in Trajectory uses. ConversationRoot hides the chat-column width
		* handles when that attribute is present, and the view owns its own
		* scroller instead of sharing the transcript's constrained column.
		*
		* @module token-usage/client/UsageView
		*/
		/** Refresh debounce: bursts of session-mirror updates (one request's events)
		* collapse into a single fetch, so the dashboard refreshes at REQUEST
		* granularity instead of per event or per turn. */
		const REFRESH_DEBOUNCE_MS = 250;
		/** Host contract (ui-conversation ConversationRoot): views that own a
		* full-bleed scroller set this so the chat-column width handles hide and
		* the composer seat overlays instead of stealing clicks over the dashboard. */
		const COMPOSER_OVERLAY = { "data-conversation-composer-overlay": "" };
		/** One fetch of the session-scoped summary from the host stats route,
		* including the direct-child breakdown for the subagent table. */
		function fetchSessionSummary(sessionIds, childGroups, signal) {
			return fetch(STATS_PATH + encodeStatsQuery({
				sessionIds,
				childGroups,
				fields: "session"
			}), { signal }).then((response) => {
				if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
				return response.json();
			}).then((value) => {
				if (typeof value !== "object" || value === null || typeof value.total !== "object") throw new Error("unexpected stats response");
				return value;
			});
		}
		/**
		* Render the Usage view tab for the active conversation.
		* @param props - the framework session kit, the session mirror, and the
		* locale seat (from the registration's `locale:` declaration).
		* @returns the dashboard: header (title, scope switch, back), stat cards
		* and the 4-token strip, the chart/model columns, and the subagent table.
		*/
		function UsageView({ useSessions, useProjection, sessionId, t }) {
			const rootRef = (0, react.useRef)(null);
			useColorSchemeMirror(rootRef);
			const [scope, setScope] = (0, react.useState)("session");
			const [chartMode, setChartMode] = (0, react.useState)("interval");
			const [focusId, setFocusId] = (0, react.useState)(sessionId);
			(0, react.useEffect)(() => {
				setFocusId(sessionId);
			}, [sessionId]);
			const [retryToken, setRetryToken] = (0, react.useState)(0);
			const retry = () => {
				setRetryToken((token) => token + 1);
			};
			usePricingAssociationRefresh(retry);
			const byId = useSessions((state) => state.byId);
			const childIndex = (0, react.useMemo)(() => buildChildIndex(byId), [byId]);
			const scopeIds = (0, react.useMemo)(() => scope === "tree" ? subtreeIds(byId, focusId, childIndex) : [focusId], [
				byId,
				scope,
				focusId,
				childIndex
			]);
			const children = (0, react.useMemo)(() => directSubagentIds(byId, focusId, childIndex), [
				byId,
				focusId,
				childIndex
			]);
			const childGroups = (0, react.useMemo)(() => children.map((id) => scope === "tree" ? subtreeIds(byId, id, childIndex) : [id]), [
				children,
				scope,
				byId,
				childIndex
			]);
			const backParent = subagentParentOf(byId, focusId);
			const liveStats = useProjection("sessionStats");
			const freshnessKey = buildStatsFreshnessKey([.../* @__PURE__ */ new Set([...scopeIds, ...children])], {
				activeSessionId: sessionId,
				rows: byId,
				liveSessionStats: liveStats
			});
			const debouncedKey = useDebouncedValue(`${scopeIds.join("\n")}\n\t${childGroups.map((group) => group.join(",")).join(";")}\n\t${freshnessKey}`, REFRESH_DEBOUNCE_MS);
			const [summaryState] = useAsyncResource((signal) => {
				const [idsPart, groupsPart] = debouncedKey.split("\n	");
				return fetchSessionSummary((idsPart ?? "").split("\n").filter((id) => id !== ""), (groupsPart ?? "").split(";").filter((group) => group !== "").map((group) => group.split(",")), signal);
			}, [debouncedKey, retryToken], {
				silentAfterFirst: true,
				retryToken
			});
			const stats = (0, react.useMemo)(() => {
				return aggregateProjections(scopeIds.map((id) => {
					if (id === sessionId) return liveStats;
					return byId[id]?.projectionValues?.sessionStats;
				}));
			}, [
				scopeIds,
				sessionId,
				liveStats,
				byId
			]);
			const ttftText = stats !== void 0 && stats.ttftSteps > 0 ? formatTtft(stats.ttftMs / stats.ttftSteps) : "—";
			const speedText = stats !== void 0 && stats.decodeMs > 0 ? formatSpeed(stats.decodeTokens / (stats.decodeMs / 1e3)) : "—";
			const header = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("header", {
				className: UsageView_module_css_default["head"],
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: UsageView_module_css_default["headRight"],
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: UsageView_module_css_default["segmented"],
						role: "group",
						"aria-label": t("view.scope.label"),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: scope === "session" ? `${UsageView_module_css_default["segBtn"]} ${UsageView_module_css_default["segActive"]}` : UsageView_module_css_default["segBtn"],
							"aria-pressed": scope === "session",
							onClick: () => setScope("session"),
							children: t("view.scope.session")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: scope === "tree" ? `${UsageView_module_css_default["segBtn"]} ${UsageView_module_css_default["segActive"]}` : UsageView_module_css_default["segBtn"],
							"aria-pressed": scope === "tree",
							onClick: () => setScope("tree"),
							children: t("view.scope.tree")
						})]
					})
				})
			});
			if (summaryState.status === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: rootRef,
				className: UsageView_module_css_default["root"],
				...COMPOSER_OVERLAY,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(PricingAssociationProvider, {
					view: {
						symbol: "￥",
						rate: 1
					},
					t,
					children: [header, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: UsageView_module_css_default["muted"],
						children: t("loading")
					})]
				})
			});
			if (summaryState.status === "error") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: rootRef,
				className: UsageView_module_css_default["root"],
				...COMPOSER_OVERLAY,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(PricingAssociationProvider, {
					view: {
						symbol: "￥",
						rate: 1
					},
					t,
					children: [
						header,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: UsageView_module_css_default["error"],
							children: t("loadFailed", { message: summaryState.message })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: UsageView_module_css_default["button"],
							onClick: retry,
							children: t("retry")
						})
					]
				})
			});
			const summary = summaryState.value;
			const view = currencyViewOf(summary);
			const { total } = summary;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: rootRef,
				className: UsageView_module_css_default["root"],
				...COMPOSER_OVERLAY,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(PricingAssociationProvider, {
					resolutions: summary.modelResolutions,
					feedVersion: summary.feedVersion,
					view,
					t,
					children: [
						header,
						total.requests === 0 && (total.failures ?? 0) === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: UsageView_module_css_default["empty"],
							children: t("view.empty")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: UsageView_module_css_default["cards"],
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RequestsStatCard, {
										requests: total.requests,
										failures: total.failures ?? 0,
										failuresByCode: total.failuresByCode,
										t
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
										label: t("stat.cost"),
										value: costsAvailable(summary.costState) ? formatCost(summary.totalCost, view) : "—"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
										label: t("stat.totalTokens"),
										value: formatTokens(totalTokens(total))
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
										label: t("stat.hitRate"),
										value: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HitRateText, { totals: total })
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
										label: t("view.ttft"),
										value: ttftText
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(StatCard, {
										label: t("view.speed"),
										value: `${speedText} tok/s`
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: UsageView_module_css_default["tokenStrip"],
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										t("stat.input"),
										" ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: formatTokens(total.inputTokens) })
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										t("stat.output"),
										" ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: formatTokens(total.outputTokens) })
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										t("stat.cacheRead"),
										" ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: formatTokens(total.cacheReadTokens) })
									] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
										t("stat.cacheWrite"),
										" ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: formatTokens(total.cacheWriteTokens) })
									] })
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(PricingStatus, {
								costState: summary.costState,
								pricingUnavailableReason: summary.pricingUnavailableReason,
								associationStorageError: summary.associationStorageError,
								t
							}),
							costsAvailable(summary.costState) && summary.unpricedModels.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: UsageView_module_css_default["warning"],
								role: "status",
								children: t("unpriced.warning", {
									count: String(summary.unpricedModels.length),
									models: summary.unpricedModels.join(", "),
									zero: formatCost(0, view)
								})
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: UsageView_module_css_default["mid"],
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: UsageView_module_css_default["chartCol"],
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: UsageView_module_css_default["chartHead"],
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
											className: UsageView_module_css_default["subtitle"],
											children: t("view.chart.title")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: UsageView_module_css_default["segmented"],
											role: "group",
											"aria-label": t("chart.mode.label"),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: chartMode === "interval" ? `${UsageView_module_css_default["segBtn"]} ${UsageView_module_css_default["segActive"]}` : UsageView_module_css_default["segBtn"],
												"aria-pressed": chartMode === "interval",
												onClick: () => setChartMode("interval"),
												children: t("chart.mode.interval")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: chartMode === "cumulative" ? `${UsageView_module_css_default["segBtn"]} ${UsageView_module_css_default["segActive"]}` : UsageView_module_css_default["segBtn"],
												"aria-pressed": chartMode === "cumulative",
												onClick: () => setChartMode("cumulative"),
												children: t("chart.mode.cumulative")
											})]
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TrendChart, {
										rows: summary.byDay,
										mode: chartMode,
										t,
										...summary.requestSeries !== void 0 ? { requests: summary.requestSeries } : {},
										...summary.byDay.length === 1 ? { hours: summary.byHour } : {}
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: UsageView_module_css_default["modelCol"],
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										className: UsageView_module_css_default["subtitle"],
										children: t("byModel.title")
									}), summary.byModel.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: UsageView_module_css_default["tableWrap"],
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
											className: UsageView_module_css_default["table"],
											"aria-label": t("byModel.title"),
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
													className: UsageView_module_css_default["modelHead"],
													children: t("filter.model")
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
													"aria-label": t("stat.successFail"),
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RequestsSplitHead, { t })
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.input") }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.output") }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.cacheRead") }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.cacheWrite") }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.hitRate") }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.cost") })
											] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: summary.byModel.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													className: UsageView_module_css_default["modelCell"],
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: UsageView_module_css_default.modelIdentity,
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: UsageView_module_css_default.modelName,
																children: row.model
															}),
															summary.unpricedModels.includes(row.model) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UnpricedModelTag, {
																model: row.model,
																t
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelAssociationBadge, {
																model: row.model,
																t
															})
														]
													})
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RequestsCell, {
													requests: row.totals.requests,
													failures: row.totals.failures ?? 0,
													failuresByCode: row.totals.failuresByCode,
													t
												}) }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													className: row.totals.inputTokens === 0 ? UsageView_module_css_default["zeroDim"] : void 0,
													children: formatTokens(row.totals.inputTokens)
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													className: row.totals.outputTokens === 0 ? UsageView_module_css_default["zeroDim"] : void 0,
													children: formatTokens(row.totals.outputTokens)
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													className: row.totals.cacheReadTokens === 0 ? UsageView_module_css_default["zeroDim"] : void 0,
													children: formatTokens(row.totals.cacheReadTokens)
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													className: row.totals.cacheWriteTokens === 0 ? UsageView_module_css_default["zeroDim"] : void 0,
													children: formatTokens(row.totals.cacheWriteTokens)
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HitRateText, { totals: row.totals }) }),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
													className: UsageView_module_css_default["costCol"],
													children: costsAvailable(summary.costState) && !summary.unpricedModels.includes(row.model) ? formatCost(row.cost, view) : "—"
												})
											] }, row.model)) })]
										})
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: UsageView_module_css_default["muted"],
										children: t("chart.empty")
									})]
								})]
							})
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
							className: UsageView_module_css_default["subagents"],
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: UsageView_module_css_default["subagentsHead"],
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: UsageView_module_css_default["subtitle"],
									children: t("view.subagents.title", { count: String(children.length) })
								}), (() => {
									if (backParent === void 0) return null;
									const parentSummary = byId[backParent];
									if (parentSummary === void 0) return null;
									const parentId = backParent;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: UsageView_module_css_default["back"],
										onClick: () => setFocusId(parentId),
										children: t("view.back", { title: parentSummary.displayTitle ?? parentId })
									});
								})()]
							}), children.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: UsageView_module_css_default["muted"],
								children: t("view.subagents.none")
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: UsageView_module_css_default["tableWrap"],
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
									className: UsageView_module_css_default["table"],
									"aria-label": t("view.subagents.title", { count: String(children.length) }),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
											className: UsageView_module_css_default["modelHead"],
											children: t("view.subagents.titleCol")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.requests") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.totalTokens") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.cost") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("stat.hitRate") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("view.ttft") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { children: t("view.speed") })
									] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: children.map((id) => {
										const child = byId[id];
										const row = summary.children?.[id];
										const childStats = aggregateProjections([byId[id]?.projectionValues?.sessionStats]);
										const nestedCount = directSubagentIds(byId, id, childIndex).length;
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("td", {
												className: UsageView_module_css_default["modelCell"],
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: UsageView_module_css_default["childLink"],
													onClick: () => setFocusId(id),
													children: child?.displayTitle ?? id
												}), nestedCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: UsageView_module_css_default["nestedBadge"],
													"aria-label": t("view.subagents.nested", { count: String(nestedCount) }),
													children: [
														"(",
														nestedCount,
														")"
													]
												}) : null]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: row?.total.requests.toLocaleString() ?? "—" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: row !== void 0 ? formatTokens(totalTokens(row.total)) : "—" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												className: UsageView_module_css_default["costCol"],
												children: row !== void 0 && costsAvailable(summary.costState) && costsAvailable(row.costState) ? formatCost(row.totalCost, view) : "—"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: row !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HitRateText, { totals: row.total }) : "—" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: childStats !== void 0 && childStats.ttftSteps > 0 ? formatTtft(childStats.ttftMs / childStats.ttftSteps) : "—" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { children: childStats !== void 0 && childStats.decodeMs > 0 ? `${formatSpeed(childStats.decodeTokens / (childStats.decodeMs / 1e3))} tok/s` : "—" })
										] }, id);
									}) })]
								})
							})]
						}),
						(total.requests > 0 || (total.failures ?? 0) > 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: UsageView_module_css_default["note"],
							children: t("view.note")
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* `token-usage` locale namespace dictionaries (browser half). zh is the
		* key-set source of truth; en is checked complete against it — the typed
		* `ctx.locale.register(NS, { zh, en })` call enforces both at compile time
		* and the `t` standard seat narrows its key domain to this union plus the
		* shared common vocabulary.
		*
		* @module token-usage/client/locales
		*/
		/** Dictionary namespace owned by this plugin. */
		const NS = "token-usage";
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"association.manage": "模型别名关联",
			"association.title": "模型别名关联",
			"association.unpricedTitle": "模型未定价",
			"association.close": "关闭模型关联",
			"association.choose": "关联现有模型",
			"association.issue": "增加模型定价",
			"association.tooltip": "此模型含手动关联：[{models}]",
			"association.allHint": "模型别名与模型的本地映射",
			"association.empty": "无数据",
			"association.details": "查看／修改",
			"association.state.active": "手动关联正在生效。",
			"association.state.automatic-takeover": "已由自动识别接管，保存的关联未生效。",
			"association.state.target-missing": "关联目标已失效，可重新选择或撤销。",
			"association.state.pricing-unavailable": "定价表不可用，关联暂未生效。",
			"association.automaticTarget": "自动目标：{model}。",
			"association.targetDiffers": "与保存的目标 {model} 不同。",
			"association.reactivate": "以后自动识别失败且原目标仍有效时，保存的关联会重新生效；可撤销以停止此行为。",
			"association.automaticOnly": "该名称已有唯一自动识别结果，不能用手动关联覆盖。",
			"association.search": "搜索模型",
			"association.searchHint": "搜索模型 ID",
			"association.candidates": "定价模型候选",
			"association.noResults": "未找到模型，请调整搜索词",
			"association.target": "所选目标：{model}",
			"association.preview": "查看定价",
			"association.impact": "绑定后，此别名的历史及后续用量将按所选模型计费。",
			"association.save": "绑定模型",
			"association.saving": "正在保存…",
			"association.saved": "关联已保存，正在刷新用量与费用。",
			"association.revoke": "撤销关联",
			"association.confirmRevoke": "确认撤销",
			"association.revokeImpact": "撤销将重新计算全部历史与后续用量；仍有自动匹配时继续定价，否则恢复未定价。",
			"association.cancel": "取消",
			"association.revoked": "关联已撤销，正在刷新用量与费用。",
			"association.loadFailed": "无法加载模型关联与定价候选，请重试。",
			"association.candidatesUnavailable": "定价候选加载失败，请重试；已保存的关联仍可查看和撤销。",
			"association.writeFailed": "操作失败，尚未确认生效；请刷新真实状态后重试。",
			"association.conflict": "关联或数据目录已变化，已读取当前状态；请核对后重新选择并提交。",
			"association.migrating": "数据目录正在迁移，暂时不能修改关联。",
			"association.targetUnavailable": "所选目标已不在当前定价表中，请刷新并重新选择。",
			"association.refresh": "刷新当前状态",
			"pricing.unavailable": "定价表不可用，费用暂不可计算；用量统计仍可查看。",
			"pricing.reason.missing": "本机尚无定价镜像，请重试定价同步。",
			"pricing.reason.unreadable": "本机定价镜像无法读取。",
			"pricing.reason.invalid-json": "本机定价镜像不是有效 JSON。",
			"pricing.reason.invalid-feed": "本机定价镜像未通过格式、模型 ID 或别名正则校验。",
			"pricing.historyIncomplete": "历史源记录不完整，无法可靠重算费用；已保留可用用量统计。",
			"pricing.associationStorageUnavailable": "本地模型关联文件无法读取或格式损坏，手动关联暂不生效；自动识别仍可使用。请先检查数据目录中的 pricing-associations.json。",
			"pricing.identificationDetails": "查看模型识别详情",
			"pricing.ambiguous": "模型识别存在歧义：{models}",
			"pricing.unmatched": "未找到对应定价模型",
			"nav.label": "Token 用量",
			"filter.quickRange": "快捷区间",
			"filter.custom": "自定义",
			"filter.dateRange": "日期范围",
			"filter.allDates": "全部日期",
			"filter.clear": "清除范围",
			"filter.separator": "至",
			"filter.model": "模型",
			"filter.allModels": "全部模型",
			"calendar.monthTitle": "{year}年{month}月",
			"calendar.prevMonth": "上个月",
			"calendar.nextMonth": "下个月",
			"calendar.weekday.0": "一",
			"calendar.weekday.1": "二",
			"calendar.weekday.2": "三",
			"calendar.weekday.3": "四",
			"calendar.weekday.4": "五",
			"calendar.weekday.5": "六",
			"calendar.weekday.6": "日",
			"stat.requests": "成功请求数",
			"stat.successFail": "成功/失败",
			"stat.ok": "成功",
			"stat.fail": "失败",
			"stat.failuresPill": "失败 {count}",
			"fail.RATE_LIMIT": "限流",
			"fail.SERVER": "服务异常",
			"fail.TIMEOUT": "超时",
			"fail.TRANSPORT": "网络异常",
			"fail.EMPTY_RESPONSE": "空响应",
			"fail.QUOTA": "配额耗尽",
			"fail.CONTEXT_WINDOW_EXCEEDED": "上下文超限",
			"fail.INVALID_CREDENTIAL": "凭证无效",
			"fail.AUTH": "鉴权失败",
			"fail.INVALID_REQUEST": "请求无效",
			"fail.MISSING_CREDENTIAL": "缺少凭证",
			"fail.ABORTED": "已中止",
			"fail.REQUEST_EXTENSION": "请求扩展失败",
			"fail.FILES_API": "文件接口异常",
			"fail.STREAM_CLOSED": "流中断",
			"fail.MALFORMED_RESPONSE": "响应异常",
			"fail.UNKNOWN": "未知错误",
			"stat.totalTokens": "总 token",
			"stat.hitRate": "命中率",
			"stat.cost": "费用",
			"stat.input": "入",
			"stat.output": "出",
			"stat.cacheRead": "缓",
			"stat.cacheWrite": "写",
			"byModel.title": "按模型",
			"bySession.title": "按会话",
			"aux.tab": "运行开销",
			"aux.kind": "类别",
			"aux.kind.auto-review": "自动审查",
			"aux.kind.session-title": "标题生成",
			"aux.kind.translation": "推理翻译",
			"aux.kind.other": "其他",
			"aux.requests": "次数",
			"aux.total": "合计",
			"aux.empty": "暂无运行开销记录。",
			"detail.switch.label": "明细维度",
			"session.titleCol": "会话",
			"session.group.label": "目录分组",
			"session.group.on": "分组",
			"session.group.off": "列表",
			"session.untitledDir": "未指定目录",
			"session.subagentBadge": "子会话",
			"session.lastActive": "最近活跃",
			"session.openHint": "按住 Ctrl 点击打开该会话（用量页签跟随该会话上次的选择）",
			"session.workspaceDeleted": "该会话所属工作区已删除，无法跳转",
			"pricing.title": "模型定价",
			"pricing.view": "查看 {model} 定价",
			"pricing.viewShort": "定价",
			"pricing.close": "关闭",
			"pricing.condition": "计费条件",
			"pricing.default": "默认",
			"pricing.regular": "常规（规则期外）",
			"pricing.tier": "上下文 ≥{threshold}",
			"pricing.peak": "峰时",
			"pricing.input": "入",
			"pricing.output": "出",
			"pricing.cacheRead": "缓",
			"pricing.cacheWrite": "写",
			"pricing.perMillion": "/M",
			"pricing.exchangeRateNote": "按 1 USD = {rate} CNY 换算",
			"pricing.unpriced": "未定价",
			"pricing.windowSep": "、",
			"pricing.table": "定价表",
			"pricing.search": "搜索模型",
			"pricing.used": "已用",
			"pricing.overviewFailed": "模型定价获取失败",
			"pricing.simCost": "模拟费用",
			"pricing.simInput": "输入 {tokens}",
			"pricing.simCache": "（缓存 {pct}%）",
			"pricing.simOutput": "输出 {tokens}",
			"pricing.simBucketInput": "输入",
			"pricing.simBucketCacheRead": "缓存读",
			"pricing.simBucketOutput": "输出",
			"pricing.simBucketCacheWrite": "缓存写",
			"pricing.simCase": "案例{index}",
			"pricing.simUnitOf": "{bucket}（{unit}）",
			"pricing.expand": "展开定价条件",
			"unpriced.warning": "{count} 个模型未定价：{models}（费用按 {zero} 计）",
			"dataDir": "数据目录：{path}",
			"card.title": "Token 用量",
			"card.description": "数据目录与定价数据源",
			"card.expand": "展开",
			"card.collapse": "折叠",
			"card.unsaved": "未保存",
			"card.readOnly": "设置文档当前为只读，本次无法修改。",
			"card.pathLabel": "数据目录",
			"card.pathHint": "留空使用默认位置（~/.dsh/token-usage）。",
			"card.browse": "浏览…",
			"card.picking": "选择中…",
			"card.migratingCopy": "正在复制数据 {done}/{total} 个文件…",
			"card.migratingClean": "正在清理旧目录 {done}/{total} 个文件…",
			"card.regionLabel": "定价区域",
			"card.regionDefault": "默认（国内 Gitee）",
			"card.region.domestic": "国内（Gitee）",
			"card.region.overseas": "全球（GitHub）",
			"card.pricingSync.button": "同步定价表",
			"card.pricingSync.running": "同步中…",
			"card.pricingSync.done": "定价表已同步：版本 {version}，共 {models} 个模型。",
			"card.pricingSync.failed": "定价表同步失败，已保留原有定价表，请重试。",
			"card.pricingSync.changed": "定价区域或数据目录已变更，请重新同步。",
			"card.pricingSync.migrating": "数据目录正在迁移，请稍后再同步。",
			"card.pricingSync.unsaved": "请先保存或放弃设置修改，再同步定价表。",
			"card.hint": "切换到「全球」后从 GitHub 镜像拉取定价表，费用按美元展示（RMB ÷ 汇率）；保存后立即重新同步，失败沿用旧镜像。",
			"card.overridden": "已覆盖默认值",
			"card.save": "保存",
			"card.saving": "保存中…",
			"card.saveFailed": "保存未生效，请重试。",
			"card.saveBlockedSessions": "有会话正在进行对话，无法保存目录修改；请等待对话结束（当前 {count} 个）。",
			"card.discard": "放弃",
			"card.fullSync.title": "全量扫描同步",
			"card.fullSync.hint": "手动扫一遍所有 session 日志，把可能漏掉的历史请求补进来（已记录的会跳过）。",
			"card.fullSync.button": "开始扫描",
			"card.fullSync.running": "扫描中…",
			"card.fullSync.progress": "已处理 {processed}/{total} 个 session，新增 {added} 条，跳过 {skipped} 条，删除 {removed} 条",
			"card.fullSync.failuresNote": "，无法读取 {count} 个 session 已跳过",
			"card.fullSync.done": "扫描完成：新增 {added} 条，跳过 {skipped} 条，删除 {removed} 条",
			"card.fullSync.failed": "扫描失败：{error}",
			"loadFailed": "统计加载失败：{message}",
			"empty": "暂无数据。可调整筛选条件；模型请求成功后会自动写入，安装前已发生的历史记录会在首次启动时自动补齐。",
			"chart.empty": "区间内暂无数据",
			"chart.aria": "每日总 token 曲线",
			"chart.ariaModels": "每日分模型 token 曲线",
			"chart.modelOther": "其他",
			"chart.ariaHour": "单日分时 token 曲线",
			"chart.ariaRequests": "按时间分段的 token 曲线",
			"chart.pointLabel": "{day} 总量 {tokens}",
			"chart.bucket": "{window} · {count} 请求 · {tokens}",
			"chart.mode.label": "趋势模式",
			"chart.mode.interval": "分时",
			"chart.mode.cumulative": "累计",
			"chart.ariaCumulative": "累计 token 曲线",
			"chart.cumulativePoint": "{day} 累计 {tokens}",
			"chart.cumulativeBucket": "{window} · {count} 请求 · 累计 {tokens}",
			"view.usage": "用量",
			"view.scope.label": "统计范围",
			"view.scope.session": "本会话",
			"view.scope.tree": "含子会话",
			"view.back": "← 返回 {title}",
			"view.ttft": "平均首token",
			"view.speed": "token速度",
			"view.empty": "该会话暂无用量记录。",
			"view.chart.title": "趋势",
			"view.subagents.title": "子会话（{count}）",
			"view.subagents.none": "无子会话",
			"view.subagents.titleCol": "会话",
			"view.subagents.nested": "含 {count} 个子会话",
			"view.note": "注：token 与费用来自本插件的请求记录（安装后）；平均首token 与 token速度来自 DSH 会话投影（含安装前历史）。",
			"pill.cost": "费用 {value}",
			"pill.costWithSubs": "费用（含子会话）{value}",
			"pill.scopeTag": "含子会话",
			"panel.title": "用量明细",
			"panel.openHint": "点击展开用量明细",
			"panel.tokens": "{value} tok",
			"panel.hitRate": "缓存命中 {value}",
			"panel.self": "本会话",
			"panel.subs": "子会话 ×{count}",
			"panel.byModel": "按模型",
			"panel.unpriced": "未定价模型 ×{count}",
			"panel.unpricedNote": "仅计 token",
			"quota.trigger": "供应商配额",
			"quota.triggerSummary": "{name} · {figure}",
			"quota.panel": "供应商配额面板",
			"quota.tier.fiveHour": "5 小时",
			"quota.tier.weekly": "每周",
			"quota.tier.monthly": "每月",
			"quota.tier.balance": "余额",
			"quota.tier.recharge": "充值余额",
			"quota.tier.bonus": "赠金余额",
			"quota.resetIn": "{time} 后重置",
			"quota.updatedAt": "更新于 {time}",
			"quota.retry": "重试",
			"quota.error.auth": "鉴权失败（{message}）；请检查该供应商的 API Key。",
			"quota.error.noCredential": "未解析到 API Key（{ref}）；请先在供应商设置中配置密钥。",
			"quota.error.http": "供应商接口返回错误（{message}）。",
			"quota.error.network": "网络错误（{message}）。",
			"quota.error.signedOut": "未登录 DeepSeek 账号，登录后可查看余额。",
			"quota.error.parse": "响应解析失败（{message}）。"
		};
		/** English dictionary (same key set). */
		const en = {
			"association.manage": "Model alias associations",
			"association.title": "Model alias associations",
			"association.unpricedTitle": "Unpriced model",
			"association.close": "Close model associations",
			"association.choose": "Associate an existing model",
			"association.issue": "Add model pricing",
			"association.tooltip": "This model includes manual associations: [{models}]",
			"association.allHint": "Local mappings between model aliases and models",
			"association.empty": "No data",
			"association.details": "View / edit",
			"association.state.active": "Manual association is active.",
			"association.state.automatic-takeover": "Automatic identification takes priority; the saved choice is inactive.",
			"association.state.target-missing": "The target is no longer available. Choose another model or revoke.",
			"association.state.pricing-unavailable": "Pricing is unavailable; the association is inactive.",
			"association.automaticTarget": "Automatic target: {model}.",
			"association.targetDiffers": "It differs from the saved target {model}.",
			"association.reactivate": "The saved choice will reactivate if automatic identification fails and the original target is still valid. Revoke to stop this behavior.",
			"association.automaticOnly": "This name has a unique automatic match. Manual associations cannot override it.",
			"association.search": "Search models",
			"association.searchHint": "Search model IDs",
			"association.candidates": "Pricing model candidates",
			"association.noResults": "No models found. Try another search.",
			"association.target": "Selected target: {model}",
			"association.preview": "View pricing",
			"association.impact": "Past and future usage of this alias will use the selected model’s pricing.",
			"association.save": "Bind model",
			"association.saving": "Saving…",
			"association.saved": "Association saved. Refreshing usage and costs.",
			"association.revoke": "Revoke association",
			"association.confirmRevoke": "Confirm revocation",
			"association.revokeImpact": "Recalculates all past and future usage. Automatic matches remain priced; otherwise the name becomes unpriced.",
			"association.cancel": "Cancel",
			"association.revoked": "Association revoked. Refreshing usage and costs.",
			"association.loadFailed": "Could not load associations and pricing candidates. Please retry.",
			"association.candidatesUnavailable": "Pricing candidates could not be loaded. Retry; saved associations can still be viewed and revoked.",
			"association.writeFailed": "The operation was not confirmed. Refresh the actual state before retrying.",
			"association.conflict": "Associations or the data directory changed. Current state was retrieved; review, choose again and submit.",
			"association.migrating": "The data directory is migrating. Associations cannot be changed yet.",
			"association.targetUnavailable": "The selected target is no longer in the current pricing table. Refresh and choose again.",
			"association.refresh": "Refresh current state",
			"pricing.unavailable": "Pricing is unavailable. Costs cannot be calculated; usage remains available.",
			"pricing.reason.missing": "No local pricing mirror exists yet. Retry pricing sync.",
			"pricing.reason.unreadable": "The local pricing mirror cannot be read.",
			"pricing.reason.invalid-json": "The local pricing mirror is not valid JSON.",
			"pricing.reason.invalid-feed": "The local mirror failed schema, model ID, or alias pattern validation.",
			"pricing.historyIncomplete": "Historical source records are incomplete. Reliable costs cannot be recalculated; available usage is retained.",
			"pricing.associationStorageUnavailable": "Local model associations are unreadable or malformed. Manual choices are inactive; automatic identification remains available. Check pricing-associations.json in the data directory.",
			"pricing.identificationDetails": "Model identification details",
			"pricing.ambiguous": "Ambiguous model identification: {models}",
			"pricing.unmatched": "No matching pricing model",
			"nav.label": "Token Usage",
			"filter.quickRange": "Quick range",
			"filter.custom": "Custom",
			"filter.dateRange": "Date range",
			"filter.allDates": "All dates",
			"filter.clear": "Clear range",
			"filter.separator": "to",
			"filter.model": "Model",
			"filter.allModels": "All models",
			"calendar.monthTitle": "{month} {year}",
			"calendar.prevMonth": "Previous month",
			"calendar.nextMonth": "Next month",
			"calendar.weekday.0": "Mo",
			"calendar.weekday.1": "Tu",
			"calendar.weekday.2": "We",
			"calendar.weekday.3": "Th",
			"calendar.weekday.4": "Fr",
			"calendar.weekday.5": "Sa",
			"calendar.weekday.6": "Su",
			"stat.requests": "Successful requests",
			"stat.successFail": "OK/Fail",
			"stat.ok": "OK",
			"stat.fail": "Fail",
			"stat.failuresPill": "Failed {count}",
			"fail.RATE_LIMIT": "Rate limited",
			"fail.SERVER": "Server error",
			"fail.TIMEOUT": "Timed out",
			"fail.TRANSPORT": "Network error",
			"fail.EMPTY_RESPONSE": "Empty response",
			"fail.QUOTA": "Quota exceeded",
			"fail.CONTEXT_WINDOW_EXCEEDED": "Context exceeded",
			"fail.INVALID_CREDENTIAL": "Invalid credential",
			"fail.AUTH": "Auth failed",
			"fail.INVALID_REQUEST": "Invalid request",
			"fail.MISSING_CREDENTIAL": "Missing credential",
			"fail.ABORTED": "Aborted",
			"fail.REQUEST_EXTENSION": "Request extension failed",
			"fail.FILES_API": "Files API error",
			"fail.STREAM_CLOSED": "Stream closed",
			"fail.MALFORMED_RESPONSE": "Malformed response",
			"fail.UNKNOWN": "Unknown error",
			"stat.totalTokens": "Total",
			"stat.hitRate": "Hit %",
			"stat.cost": "Cost",
			"stat.input": "In",
			"stat.output": "Out",
			"stat.cacheRead": "Cache",
			"stat.cacheWrite": "Write",
			"byModel.title": "By model",
			"bySession.title": "By session",
			"aux.tab": "Runtime overhead",
			"aux.kind": "Category",
			"aux.kind.auto-review": "Auto review",
			"aux.kind.session-title": "Session titles",
			"aux.kind.translation": "Translation",
			"aux.kind.other": "Other",
			"aux.requests": "Calls",
			"aux.total": "Total",
			"aux.empty": "No runtime overhead recorded.",
			"detail.switch.label": "Detail dimension",
			"session.titleCol": "Session",
			"session.group.label": "Directory grouping",
			"session.group.on": "Grouped",
			"session.group.off": "List",
			"session.untitledDir": "No directory",
			"session.subagentBadge": "Subagent",
			"session.lastActive": "Last active",
			"session.openHint": "Ctrl+click to open this session (the usage tab follows its last selection)",
			"session.workspaceDeleted": "The workspace for this session has been deleted and cannot be opened",
			"pricing.title": "Model pricing",
			"pricing.view": "View rates for {model}",
			"pricing.viewShort": "Rates",
			"pricing.close": "Close",
			"pricing.condition": "Condition",
			"pricing.default": "Default",
			"pricing.regular": "Regular (outside rule windows)",
			"pricing.tier": "context ≥{threshold}",
			"pricing.peak": "Peak",
			"pricing.input": "In",
			"pricing.output": "Out",
			"pricing.cacheRead": "Cache",
			"pricing.cacheWrite": "Write",
			"pricing.perMillion": "/M",
			"pricing.exchangeRateNote": "Converted at 1 USD = {rate} CNY",
			"pricing.unpriced": "Unpriced",
			"pricing.windowSep": ", ",
			"pricing.table": "Pricing",
			"pricing.search": "Search models",
			"pricing.used": "Used",
			"pricing.overviewFailed": "Failed to load model pricing",
			"pricing.simCost": "Est. cost",
			"pricing.simInput": "In {tokens}",
			"pricing.simCache": " (cache {pct}%)",
			"pricing.simOutput": "Out {tokens}",
			"pricing.simBucketInput": "Input",
			"pricing.simBucketCacheRead": "Cache read",
			"pricing.simBucketOutput": "Output",
			"pricing.simBucketCacheWrite": "Cache write",
			"pricing.simCase": "Case {index}",
			"pricing.simUnitOf": "{bucket} ({unit})",
			"pricing.expand": "Show rate conditions",
			"unpriced.warning": "{count} models unpriced: {models} (cost counts as {zero})",
			"dataDir": "Data directory: {path}",
			"card.title": "Token Usage",
			"card.description": "Data directory and pricing source",
			"card.expand": "Expand",
			"card.collapse": "Collapse",
			"card.unsaved": "Unsaved",
			"card.readOnly": "The settings document is read-only right now; changes are disabled.",
			"card.pathLabel": "Data directory",
			"card.pathHint": "Leave empty for the default location (~/.dsh/token-usage).",
			"card.browse": "Browse…",
			"card.picking": "Picking…",
			"card.migratingCopy": "Copying data {done}/{total} files…",
			"card.migratingClean": "Cleaning the old directory {done}/{total} files…",
			"card.regionLabel": "Pricing region",
			"card.regionDefault": "Default (Gitee)",
			"card.region.domestic": "CN (Gitee)",
			"card.region.overseas": "Global (GitHub)",
			"card.pricingSync.button": "Sync pricing table",
			"card.pricingSync.running": "Syncing…",
			"card.pricingSync.done": "Pricing synced: version {version}, {models} models.",
			"card.pricingSync.failed": "Pricing sync failed. The previous table is retained; try again.",
			"card.pricingSync.changed": "The pricing region or data directory changed. Sync again.",
			"card.pricingSync.migrating": "The data directory is moving. Try syncing later.",
			"card.pricingSync.unsaved": "Save or discard your settings changes before syncing pricing.",
			"card.hint": "Switching to Global pulls the pricing table from the GitHub mirror and shows costs in USD (RMB ÷ rate); saving re-syncs immediately, falling back to the previous mirror on failure.",
			"card.overridden": "Overriding the default",
			"card.save": "Save",
			"card.saving": "Saving…",
			"card.saveFailed": "The save did not land; try again.",
			"card.saveBlockedSessions": "A conversation is still in progress, so the directory change was not saved; wait for it to end first ({count} active).",
			"card.discard": "Discard",
			"card.fullSync.title": "Full scan sync",
			"card.fullSync.hint": "Walk every session log once and fold any historical requests the log does not yet hold (rows already recorded are skipped).",
			"card.fullSync.button": "Start scan",
			"card.fullSync.running": "Scanning…",
			"card.fullSync.progress": "Processed {processed}/{total} sessions, added {added}, skipped {skipped}, removed {removed}",
			"card.fullSync.failuresNote": ", {count} unreadable sessions skipped",
			"card.fullSync.done": "Scan complete: added {added}, skipped {skipped}, removed {removed}",
			"card.fullSync.failed": "Scan failed: {error}",
			"loadFailed": "Failed to load stats: {message}",
			"empty": "No data yet. Adjust the filters; requests are written automatically after each successful model call, and pre-install history is backfilled automatically on the first startup.",
			"chart.empty": "No data in range",
			"chart.aria": "Daily total token trend",
			"chart.ariaModels": "Daily token trend by model",
			"chart.modelOther": "Other",
			"chart.ariaHour": "Single-day hourly token trend",
			"chart.ariaRequests": "Time-bucketed token trend",
			"chart.pointLabel": "{day} total {tokens}",
			"chart.bucket": "{window} · {count} requests · {tokens}",
			"chart.mode.label": "Trend mode",
			"chart.mode.interval": "Interval",
			"chart.mode.cumulative": "Cumulative",
			"chart.ariaCumulative": "Cumulative token trend",
			"chart.cumulativePoint": "{day} cumulative {tokens}",
			"chart.cumulativeBucket": "{window} · {count} requests · cumulative {tokens}",
			"view.usage": "Usage",
			"view.scope.label": "Scope",
			"view.scope.session": "Session",
			"view.scope.tree": "With subagents",
			"view.back": "← Back to {title}",
			"view.ttft": "Avg TTFT",
			"view.speed": "Token speed",
			"view.empty": "No usage recorded for this session.",
			"view.chart.title": "Trend",
			"view.subagents.title": "Subagents ({count})",
			"view.subagents.none": "No subagents",
			"view.subagents.titleCol": "Session",
			"view.subagents.nested": "With {count} subagents",
			"view.note": "Note: tokens and cost come from this plugin's request log (post-install); average TTFT and token speed come from the DSH session projection (includes pre-install history).",
			"pill.cost": "Cost {value}",
			"pill.costWithSubs": "Cost with subagents {value}",
			"pill.scopeTag": "with subagents",
			"panel.title": "Usage details",
			"panel.openHint": "click to open usage details",
			"panel.tokens": "{value} tok",
			"panel.hitRate": "cache hit {value}",
			"panel.self": "This session",
			"panel.subs": "Subagents ×{count}",
			"panel.byModel": "By model",
			"panel.unpriced": "Unpriced model ×{count}",
			"panel.unpricedNote": "tokens only",
			"quota.trigger": "Provider quota",
			"quota.triggerSummary": "{name} · {figure}",
			"quota.panel": "Provider quota panel",
			"quota.tier.fiveHour": "5-hour",
			"quota.tier.weekly": "Weekly",
			"quota.tier.monthly": "Monthly",
			"quota.tier.balance": "Balance",
			"quota.tier.recharge": "Topped-up balance",
			"quota.tier.bonus": "Granted balance",
			"quota.resetIn": "resets in {time}",
			"quota.updatedAt": "Updated {time}",
			"quota.retry": "Retry",
			"quota.error.auth": "Authentication failed ({message}); check this provider's API key.",
			"quota.error.noCredential": "No API key resolved ({ref}); configure the provider's key first.",
			"quota.error.http": "The provider endpoint returned an error ({message}).",
			"quota.error.network": "Network error ({message}).",
			"quota.error.signedOut": "Sign in to DeepSeek to view the account balance.",
			"quota.error.parse": "Failed to parse the response ({message})."
		};
		//#endregion
		//#region src/client/index.ts
		/**
		* Namespace of the token-usage settings section. Spelled here rather than
		* imported: a client package must not depend on a Host package.
		*/
		const TOKEN_USAGE_NS = "token-usage";
		/**
		* Candidate keys under which the Host may serve this plugin's settings
		* form. The 0.1.7 host keys `ConfigForms.get` by the plugin's ENTRY ID (the
		* namespace); the full package name stays as a fallback for a host that keyed
		* it by package instead.
		*/
		const CONFIG_FORM_KEYS = [TOKEN_USAGE_NS, "@laoyuehanni/dsh-token-usage"];
		/**
		* Resolve the form target from the describe mirror's LIVE namespace list.
		* The 0.1.7 `ConfigForms.get()` unconditionally creates and caches a
		* controller for ANY key — it never returns undefined — so key validity must
		* come from the namespaces the mirror actually serves. A `get()` on a key the
		* mirror does not list yields a controller stuck at 'unavailable' forever,
		* and the card renders nothing. No view yet (mirror still loading) answers
		* undefined so the caller keeps its current target.
		*/
		const resolveConfigFormsTarget = (forms) => {
			const namespaces = typeof forms.describe === "function" ? forms.describe()?.getSnapshot()?.view?.namespaces : void 0;
			if (namespaces === void 0) return void 0;
			const served = CONFIG_FORM_KEYS.find((key) => namespaces.some((row) => row.ns === key));
			return served === void 0 ? void 0 : forms.get(served);
		};
		/** Required services: the slot registry, the locale dictionaries, the
		* workspace navigation service (its native directory picker backs the card's
		* browse button), and the session controller (the stats page's Ctrl+click
		* session jump reads the list and opens the target). Configuration sources
		* (`configForms` in dsh 0.1.7+, `settingsScope` in pre-0.1.7) attach dynamically. */
		const inject = [
			"slots",
			"locale",
			"connection",
			"remote",
			"uiWorkspace",
			"sessions",
			"workspaces"
		];
		/**
		* Register the dictionary pair, then the settings page and the plugin
		* configuration card once the shell's declarations are on the ledger.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "token-usage: dictionaries");
			const t = ctx.locale.bind(NS);
			const getSessions = () => ctx.get?.("sessions") ?? ctx.sessions;
			const getUiWorkspace = () => ctx.get?.("uiWorkspace") ?? ctx.uiWorkspace;
			const getWorkspaces = () => ctx.get?.("workspaces") ?? ctx.workspaces;
			const isSessionInController = (id) => {
				return (getSessions()?.list?.getSnapshot())?.byId?.[id] !== void 0;
			};
			const isWorkspaceAlive = (id) => {
				const ws = getWorkspaces()?.list?.getSnapshot();
				if (!ws || ws.phase === "pending") return true;
				const sid = id;
				return ws.items.some((item) => item.sessionIds.includes(sid));
			};
			const sessionListed = (id) => {
				return isSessionInController(id) && isWorkspaceAlive(id);
			};
			const openSession = (id) => {
				if (!isSessionInController(id)) return {
					ok: false,
					reason: "sessionNotFound"
				};
				if (!isWorkspaceAlive(id)) return {
					ok: false,
					reason: "workspaceDeleted"
				};
				getUiWorkspace()?.openSession(id);
				return { ok: true };
			};
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "token-usage",
				order: 50,
				label: () => t("nav.label"),
				locale: NS,
				inject: () => ({
					sessionListed,
					openSession
				})
			}, TokenUsageSection));
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "usage",
				order: 20,
				label: () => t("view.usage"),
				locale: NS
			}, UsageView));
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "token-usage-cost",
				order: 10,
				locale: NS
			}, CostPill));
			const modelDirectory = { service: void 0 };
			ctx.inject(["modelDirectories"], (modelCtx) => {
				modelCtx.effect(() => {
					modelDirectory.service = modelCtx.modelDirectories;
					return () => {
						modelDirectory.service = void 0;
					};
				}, "token-usage: model directory seam");
			});
			ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
				name: "conversation.input.right",
				id: "token-usage-quota",
				order: 10,
				locale: NS,
				inject: () => ({ modelDirectory })
			}, QuotaButton));
			const lookupCurrentTarget = () => {
				const configForms = ctx.get("configForms");
				if (configForms && typeof configForms.get === "function") {
					const byMirror = resolveConfigFormsTarget(configForms);
					if (byMirror !== void 0) return byMirror;
				}
				const settingsScope = ctx.get("settingsScope");
				if (settingsScope && typeof settingsScope.bind === "function") return settingsScope.bind({ namespace: TOKEN_USAGE_NS });
			};
			let activeTarget = lookupCurrentTarget() ?? createFallbackTarget();
			const targetListeners = /* @__PURE__ */ new Set();
			let unsubActive = activeTarget.subscribe(() => {
				for (const listener of targetListeners) listener();
			});
			const switchTarget = (next) => {
				if (next === activeTarget) return;
				unsubActive?.();
				activeTarget = next;
				unsubActive = activeTarget.subscribe(() => {
					for (const listener of targetListeners) listener();
				});
				for (const listener of targetListeners) listener();
			};
			ctx.inject(["configForms"], (configCtx) => {
				configCtx.effect(() => {
					const forms = configCtx.get("configForms");
					if (!forms || typeof forms.get !== "function") return () => {};
					const mirror = typeof forms.describe === "function" ? forms.describe() : void 0;
					const resolve = () => {
						const target = resolveConfigFormsTarget(forms);
						if (target !== void 0) switchTarget(target);
					};
					resolve();
					mirror?.ensure?.();
					const unsubscribe = mirror?.subscribe(() => {
						resolve();
					});
					return () => {
						unsubscribe?.();
					};
				}, "token-usage: configForms dynamic target");
			});
			ctx.inject(["settingsScope"], (scopeCtx) => {
				scopeCtx.effect(() => {
					const scopeService = scopeCtx.get("settingsScope");
					if (scopeService && typeof scopeService.bind === "function") switchTarget(scopeService.bind({ namespace: TOKEN_USAGE_NS }));
					return () => {};
				}, "token-usage: settingsScope dynamic target");
			});
			const form = new CardForm({
				getSnapshot: () => activeTarget.getSnapshot(),
				subscribe: (listener) => {
					targetListeners.add(listener);
					return () => {
						targetListeners.delete(listener);
					};
				},
				set: (field, value) => activeTarget.set(field, value),
				unset: (field) => activeTarget.unset(field)
			});
			const store = form.bind();
			ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
				name: "plugins.bundle.config",
				key: "@laoyuehanni/dsh-token-usage",
				locale: NS,
				inject: () => ({
					hooks: { tokenUsageCard: store },
					...form.actions(),
					pickDirectory: () => ctx.get("uiWorkspace")?.pickDirectory?.() ?? Promise.resolve(null)
				})
			}, TokenUsageCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map