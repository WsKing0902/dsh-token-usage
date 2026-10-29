import type { PricingOverviewModel } from '../wire.ts';
export declare function sortPricingModels(models: readonly PricingOverviewModel[]): PricingOverviewModel[];
/** Substrings are a search aid only; server resolution determines identity. */
export declare function matchesPricingSearch(model: PricingOverviewModel, query: string): boolean;
//# sourceMappingURL=pricing-search.d.ts.map