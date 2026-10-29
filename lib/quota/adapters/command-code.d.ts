/**
 * Command Code adapter (Go / GOAT / Pro coding-plan subscription): the
 * 5-hour rolling window, the weekly window, and the monthly plan credits.
 *
 * Endpoints (all `GET`, Bearer with the inference key; the `/alpha`
 * control plane is fixed at the root host while inference paths vary by
 * protocol — Claude `/provider`, Codex `/provider/v1`):
 *   /alpha/whoami?limits=1                  → `org.id`, the billing scope
 *   /alpha/billing/credits[?orgId=…]        → `credits` + `windowLimits`
 *   /alpha/billing/subscriptions[?orgId=…]  → `data.planId`, period bounds
 *   /alpha/usage/summary[?since=…&orgId=…]  → `totalCost`, the period spend
 *
 * `windowLimits` sits BESIDE `credits` (a nested spelling is kept for the
 * response variant that has appeared) and only paints its two lanes while
 * `limited` is true; each lane carries `{ used, cap, resetAt }` in credits
 * with `resetAt` as epoch ms. The monthly window needs no plan table: the
 * period spend plus the three credit balances give the pool, so
 * `used = spent / (spent + monthly + purchased + free)`.
 *
 * Matching: host-only (`*.commandcode.ai`). pi-ai's catalog ships no
 * Command Code route (the community registers it under ad-hoc names like
 * `commandcode`), so a route key carries no catalog identity here — every
 * real route is a user-declared name whose base URL is the only stable
 * signal, and an empty `routes` table marks them all as host-matched.
 *
 * @module token-usage/quota/adapters/command-code
 */
import type { QuotaAdapter } from '../types.ts';
/** Whether a base URL points at the Command Code host family. */
export declare function isCommandCodeUrl(baseUrl: string | undefined): boolean;
/** The Command Code adapter: 5-hour + weekly (+ monthly) windows. */
export declare const commandCodeAdapter: QuotaAdapter;
//# sourceMappingURL=command-code.d.ts.map