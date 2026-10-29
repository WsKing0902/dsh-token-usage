import { useEffect, useRef } from 'react';
const CHANGED_EVENT = 'token-usage:pricing-associations-changed';
const TABLE_CHANGED_EVENT = 'token-usage:pricing-table-changed';
/** All mounted usage views refresh their existing query after a real commit. */
export function pricingAssociationsChanged() { window.dispatchEvent(new Event(CHANGED_EVENT)); }
export function pricingTableChanged() { window.dispatchEvent(new Event(TABLE_CHANGED_EVENT)); }
export function usePricingAssociationRefresh(refresh) {
    const latest = useRef(refresh);
    latest.current = refresh;
    useEffect(() => {
        const changed = () => { latest.current(); };
        window.addEventListener(CHANGED_EVENT, changed);
        window.addEventListener(TABLE_CHANGED_EVENT, changed);
        return () => {
            window.removeEventListener(CHANGED_EVENT, changed);
            window.removeEventListener(TABLE_CHANGED_EVENT, changed);
        };
    }, []);
}
export class AssociationRequestError extends Error {
    code;
    current;
    constructor(code, current) {
        super(code);
        this.code = code;
        this.current = current;
    }
}
/** Optional pricing references and the current feed version; no usage or credentials. */
export function pricingIssueUrl(resolution, version) {
    const lines = [
        '1. Pricing reference (optional)',
        '   - Currency:',
        '   - Input price per 1 million tokens:',
        '   - Output price per 1 million tokens:',
        '   - Cache read price per 1 million tokens:',
        '   - Cache write price per 1 million tokens:',
        '   - Context window (tokens):',
        '',
        '2. Official pricing URL (optional)',
        '   - URL:',
        '',
        '3. Current pricing table version',
        `   - ${version ?? 'Unknown'}`,
    ];
    const url = new URL('https://github.com/LaoYueHanNi/model-price-table/issues/new');
    url.searchParams.set('title', `Add model pricing: ${resolution.rawName}`);
    url.searchParams.set('body', lines.join('\n'));
    return url.href;
}
//# sourceMappingURL=pricing-associations.js.map