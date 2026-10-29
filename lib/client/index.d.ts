/**
 * Browser half of the token-usage plugin. Two registrations share one
 * dictionary pair: the Token Usage stats page on the settings surface (data
 * from the host half's stats route, `/token-usage/stats`), and the plugin
 * configuration card on the Plugins tab (the `token-usage` settings
 * namespace — the data directory and the pricing region — edited through
 * the settings scope, with the relocation progress polled from
 * `/token-usage/migration`). The card's browse button rides the shell's
 * workspace navigation service (`ctx.uiWorkspace.pickDirectory`), the same
 * native directory picker the workspace flows use. Export discipline: the
 * /client entry exposes only what cordis loading needs.
 *
 * @module token-usage/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        /**
         * A bundle's own configuration on the Plugins page, keyed by package name.
         */
        'plugins.bundle.config': {
            kind: 'keyed';
            scope: 'root';
            owner: {
                readonly view: 'summary' | 'page';
            };
        };
    }
}
/** Required services: the slot registry, the locale dictionaries, the
 * workspace navigation service (its native directory picker backs the card's
 * browse button), and the session controller (the stats page's Ctrl+click
 * session jump reads the list and opens the target). Configuration sources
 * (`configForms` in dsh 0.1.7+, `settingsScope` in pre-0.1.7) attach dynamically. */
export declare const inject: string[];
/**
 * Register the dictionary pair, then the settings page and the plugin
 * configuration card once the shell's declarations are on the ledger.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map