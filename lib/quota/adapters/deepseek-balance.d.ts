/**
 * DeepSeek balance adapter: the pay-as-you-go balance of an API key on the
 * official DeepSeek platform — the dsh provider `deepseek-official`.
 * The signed-in account route (`deepseek-account`) is a different grant
 * and a different endpoint; the account adapter owns it. This adapter
 * refuses that route key even when its base URL is a deepseek.com host
 * (the account default is `https://api.deepseek.com/anthropic`).
 *
 * Endpoint: `GET {root}/user/balance` with a Bearer key. The root is the
 * profile's inference `baseURL` with a trailing OpenAI-compatible `/v1`
 * stripped (so `https://api.deepseek.com/v1` hits the official
 * `/user/balance`, not `/v1/user/balance`), defaulting to
 * `https://api.deepseek.com`. The response lists one entry per currency;
 * the panel shows the CNY figure. A balance window has no reset and no
 * total — the amount IS the signal.
 *
 * @module token-usage/quota/adapters/deepseek-balance
 */
import type { QuotaAdapter } from '../types.ts';
/** The DeepSeek API-key balance adapter. */
export declare const deepseekBalanceAdapter: QuotaAdapter;
//# sourceMappingURL=deepseek-balance.d.ts.map