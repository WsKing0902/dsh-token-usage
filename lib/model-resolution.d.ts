import type { ModelResolution } from './wire.ts';
export interface ModelIdentity {
    modelId: string;
    aliasPatterns?: readonly string[];
}
/** Full-name comparison only: spelling remains intact in records and displays. */
export declare const modelKey: (name: string) => string;
export declare function providerSuffix(name: string): string | undefined;
/** Parse the upstream portable subset rather than accepting arbitrary JS regex. */
export declare function compileAliasPattern(pattern: string): RegExp;
/** `$` also accepts a trailing newline in JS; require a full-span match. */
export declare function matchesAliasPattern(regex: RegExp, name: string): boolean;
export declare function validateModelIdentities(models: readonly ModelIdentity[]): void;
export declare function createModelResolver(models: readonly ModelIdentity[]): (name: string) => ModelResolution;
//# sourceMappingURL=model-resolution.d.ts.map