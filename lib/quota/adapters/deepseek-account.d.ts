/**
 * DeepSeek account adapter: the signed-in account's recharge and bonus
 * wallets (`deepseek-account`), as opposed to the API-key route
 * (`deepseek-official`) which hits `GET /user/balance`.
 *
 * The account route authenticates with the host's stored grant, not an
 * API key. The plugin does not speak the Platform protocol itself — it
 * calls the host `deepseekAccount.getBalance()`, which already owns token
 * refresh, headers, and 401 expiry. A missing service or a `null` read
 * (signed out, or the grant changed mid-query) is `signed-out`: the button
 * stays up and asks the user to sign in. A `failed` wallet read is a
 * network error so the panel's retry actually re-queries.
 *
 * One currency per purse, CNY preferred, matching the API-key adapter's
 * single-figure choice. A zero bonus purse is omitted (the account
 * settings page does the same); a zero or overdrawn recharge purse stays,
 * because that amount is the figure the user is managing.
 *
 * @module token-usage/quota/adapters/deepseek-account
 */
import type { QuotaAdapter } from '../types.ts';
/** The signed-in DeepSeek account balance adapter. */
export declare const deepseekAccountAdapter: QuotaAdapter;
//# sourceMappingURL=deepseek-account.d.ts.map