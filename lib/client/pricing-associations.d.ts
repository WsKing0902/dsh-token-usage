import type { ModelResolution, PricingAssociationsPayload } from '../wire.ts';
/** All mounted usage views refresh their existing query after a real commit. */
export declare function pricingAssociationsChanged(): void;
export declare function pricingTableChanged(): void;
export declare function usePricingAssociationRefresh(refresh: () => void): void;
export declare class AssociationRequestError extends Error {
    readonly code: string;
    readonly current?: PricingAssociationsPayload | undefined;
    constructor(code: string, current?: PricingAssociationsPayload | undefined);
}
/** Optional pricing references and the current feed version; no usage or credentials. */
export declare function pricingIssueUrl(resolution: ModelResolution, version?: number): string;
//# sourceMappingURL=pricing-associations.d.ts.map