import { compileAliasPattern, matchesAliasPattern } from "../model-resolution.js";
const patternCache = new WeakMap();
function patternsOf(model) {
    let patterns = patternCache.get(model);
    if (patterns === undefined) {
        patterns = model.aliasPatterns.map(compileAliasPattern);
        patternCache.set(model, patterns);
    }
    return patterns;
}
export function sortPricingModels(models) {
    return [...models].sort((a, b) => {
        const familyA = a.family ?? 'other', familyB = b.family ?? 'other';
        if (familyA !== familyB)
            return familyA < familyB ? -1 : 1;
        return a.modelId < b.modelId ? -1 : a.modelId > b.modelId ? 1 : 0;
    });
}
/** Substrings are a search aid only; server resolution determines identity. */
export function matchesPricingSearch(model, query) {
    if (query === '')
        return true;
    const needle = query.toLowerCase();
    return model.modelId.toLowerCase().includes(needle) || (model.family ?? 'other').toLowerCase().includes(needle)
        || patternsOf(model).some(regex => matchesAliasPattern(regex, query));
}
//# sourceMappingURL=pricing-search.js.map