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
import { CardForm, createFallbackTarget } from "./card-form.js";
import { CostPill } from "./CostPill.js";
import { QuotaButton } from "./QuotaButton.js";
import { TokenUsageCard } from "./TokenUsageCard.js";
import { TokenUsageSection } from "./TokenUsageSection.js";
import { UsageView } from "./UsageView.js";
import { en, NS, zh } from "./locales.js";
/**
 * Namespace of the token-usage settings section. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
const TOKEN_USAGE_NS = 'token-usage';
/**
 * Candidate keys under which the Host may serve this plugin's settings
 * form. The 0.1.7 host keys `ConfigForms.get` by the plugin's ENTRY ID (the
 * namespace); the full package name stays as a fallback for a host that keyed
 * it by package instead.
 */
const CONFIG_FORM_KEYS = [TOKEN_USAGE_NS, '@laoyuehanni/dsh-token-usage'];
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
    const namespaces = typeof forms.describe === 'function'
        ? forms.describe()?.getSnapshot()?.view?.namespaces
        : undefined;
    if (namespaces === undefined)
        return undefined;
    const served = CONFIG_FORM_KEYS.find(key => namespaces.some(row => row.ns === key));
    return served === undefined ? undefined : forms.get(served);
};
/** Required services: the slot registry, the locale dictionaries, the
 * workspace navigation service (its native directory picker backs the card's
 * browse button), and the session controller (the stats page's Ctrl+click
 * session jump reads the list and opens the target). Configuration sources
 * (`configForms` in dsh 0.1.7+, `settingsScope` in pre-0.1.7) attach dynamically. */
export const inject = ['slots', 'locale', 'connection', 'remote', 'uiWorkspace', 'sessions', 'workspaces'];
/**
 * Register the dictionary pair, then the settings page and the plugin
 * configuration card once the shell's declarations are on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'token-usage: dictionaries');
    // Stable per-namespace translate reading the active locale at call time;
    // the label thunk re-evaluates it per read, so the nav row follows switches.
    const t = ctx.locale.bind(NS);
    // The stats page's session jump: the pure predicate drives the Ctrl-hover
    // affordance (a session outside the controller's list — archived, or a
    // pre-install log row the list never saw — renders no dashed underline and
    // refuses the click), and the jump closes the settings panel and opens the
    // session via uiWorkspace.openSession.
    const getSessions = () => ctx.get?.('sessions') ?? ctx.sessions;
    const getUiWorkspace = () => ctx.get?.('uiWorkspace') ?? ctx.uiWorkspace;
    const getWorkspaces = () => ctx.get?.('workspaces') ?? ctx.workspaces;
    const isSessionInController = (id) => {
        const list = getSessions()?.list?.getSnapshot();
        return list?.byId?.[id] !== undefined;
    };
    const isWorkspaceAlive = (id) => {
        const ws = getWorkspaces()?.list?.getSnapshot();
        if (!ws || ws.phase === 'pending')
            return true;
        const sid = id;
        return ws.items.some(item => item.sessionIds.includes(sid));
    };
    const sessionListed = (id) => {
        return isSessionInController(id) && isWorkspaceAlive(id);
    };
    const openSession = (id) => {
        if (!isSessionInController(id))
            return { ok: false, reason: 'sessionNotFound' };
        if (!isWorkspaceAlive(id))
            return { ok: false, reason: 'workspaceDeleted' };
        getUiWorkspace()?.openSession(id);
        return { ok: true };
    };
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'token-usage',
        order: 50,
        label: () => t('nav.label'),
        locale: NS,
        inject: () => ({ sessionListed, openSession }),
    }, TokenUsageSection));
    // The Usage view tab: one entry of the conversation view ring (beside the
    // built-in Chat tab and the Trajectory tab from ui-trajectory, rendered
    // by the session header's tab ring, one at a time). Registration is the
    // same trajectory pattern — a label thunk follows the active locale, and
    // the component reads the session through the standard kit.
    ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'usage',
        order: 20,
        label: () => t('view.usage'),
        locale: NS,
    }, UsageView));
    // The composer-dock usage pill: one entry of the
    // `conversation.composer.dock` slot list (`order: 10`, after the
    // official stats pills' `order: 0`), wearing the official pill skin so
    // the row reads as one family. The figure is the WITH-SUBAGENTS fold —
    // the one number no official surface carries; a solo session renders it
    // bare, and a subtree scope adds a quiet "with subagents" badge. The
    // click-open detail panel carries the folded token figure and cache-hit
    // rate (official pills show only the single-session token count), the
    // session / subagents split, and the per-model breakdown. The component
    // self-gates: a session with zero recorded requests renders nothing; a
    // transient fetch miss keeps the previous render.
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'token-usage-cost',
        order: 10,
        locale: NS,
    }, CostPill));
    // The input-bar quota button: one entry of the `conversation.input.right`
    // slot list (the tool row's right end, before the send button — the host
    // renders slot entries left of the model chip). The button polls the
    // host's `/token-usage/quota` route for the ACTIVE session's provider and
    // self-gates: it renders nothing while the provider is undeterminable or
    // has no quota adapter, so the toolbar stays clean on unsupported
    // providers and the button reappears when a supported one takes over.
    // `order: 10` keeps it after any future lower-order utilities in the
    // same slot.
    //
    // Provider resolution follows the model CHIP: the shell's model-selection
    // service (`ctx.modelDirectories`, from ui-model-selection — the same
    // shared per-session directory the chip renders from) reports the host's
    // NEXT selection live, so the button appears the moment the user picks a
    // provider, before any request is sent. The service attaches through an
    // OPTIONAL inject — a shell without it falls back to the host's own
    // resolution (last request's provider, else the default selection).
    const modelDirectory = { service: undefined };
    ctx.inject(['modelDirectories'], (modelCtx) => {
        modelCtx.effect(() => {
            modelDirectory.service = modelCtx.modelDirectories;
            return () => { modelDirectory.service = undefined; };
        }, 'token-usage: model directory seam');
    });
    ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
        name: 'conversation.input.right',
        id: 'token-usage-quota',
        order: 10,
        locale: NS,
        inject: () => ({ modelDirectory }),
    }, QuotaButton));
    // Configuration source resolution:
    // - dsh 0.1.7+: ctx.configForms provides ConfigForm (keyed by the entry id
    //   the describe mirror actually serves; see resolveConfigFormsTarget)
    // - pre-0.1.7: ctx.settingsScope provides SettingsScope (bound by namespace)
    // - fallback: unavailable target preventing runtime errors if neither is mounted
    const lookupCurrentTarget = () => {
        const configForms = ctx.get('configForms');
        if (configForms && typeof configForms.get === 'function') {
            const byMirror = resolveConfigFormsTarget(configForms);
            if (byMirror !== undefined)
                return byMirror;
        }
        const settingsScope = ctx.get('settingsScope');
        if (settingsScope && typeof settingsScope.bind === 'function') {
            return settingsScope.bind({ namespace: TOKEN_USAGE_NS });
        }
        return undefined;
    };
    const initialTarget = lookupCurrentTarget();
    let activeTarget = initialTarget ?? createFallbackTarget();
    const targetListeners = new Set();
    let unsubActive = activeTarget.subscribe(() => {
        for (const listener of targetListeners)
            listener();
    });
    const switchTarget = (next) => {
        if (next === activeTarget)
            return;
        unsubActive?.();
        activeTarget = next;
        unsubActive = activeTarget.subscribe(() => {
            for (const listener of targetListeners)
                listener();
        });
        for (const listener of targetListeners)
            listener();
    };
    ctx.inject(['configForms'], (configCtx) => {
        configCtx.effect(() => {
            const forms = configCtx.get('configForms');
            if (!forms || typeof forms.get !== 'function')
                return () => { };
            // The describe mirror loads asynchronously (its first snapshot holds no
            // view), so besides resolving now, follow the mirror: the moment the
            // namespace appears — or the host re-keys it — re-resolve and bind.
            const mirror = typeof forms.describe === 'function' ? forms.describe() : undefined;
            const resolve = () => {
                const target = resolveConfigFormsTarget(forms);
                if (target !== undefined)
                    switchTarget(target);
            };
            resolve();
            void mirror?.ensure?.();
            const unsubscribe = mirror?.subscribe(() => { resolve(); });
            return () => { unsubscribe?.(); };
        }, 'token-usage: configForms dynamic target');
    });
    ctx.inject(['settingsScope'], (scopeCtx) => {
        scopeCtx.effect(() => {
            const scopeService = scopeCtx.get('settingsScope');
            if (scopeService && typeof scopeService.bind === 'function') {
                switchTarget(scopeService.bind({ namespace: TOKEN_USAGE_NS }));
            }
            return () => { };
        }, 'token-usage: settingsScope dynamic target');
    });
    const dynamicTarget = {
        getSnapshot: () => activeTarget.getSnapshot(),
        subscribe: (listener) => {
            targetListeners.add(listener);
            return () => { targetListeners.delete(listener); };
        },
        set: (field, value) => activeTarget.set(field, value),
        unset: (field) => activeTarget.unset(field),
    };
    // The Plugins page dispatches keyed configuration for bundles through
    // `plugins.bundle.config` (keyed by the bundle's package name).
    const form = new CardForm(dynamicTarget);
    const store = form.bind();
    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: '@laoyuehanni/dsh-token-usage',
        locale: NS,
        inject: () => ({
            hooks: { tokenUsageCard: store },
            ...form.actions(),
            // The shell's own directory picker (the workspace flows' chooser):
            // resolves the chosen absolute path, or null when the user dismisses.
            pickDirectory: () => ctx.get('uiWorkspace')?.pickDirectory?.() ?? Promise.resolve(null),
        }),
    }, TokenUsageCard));
}
//# sourceMappingURL=index.js.map