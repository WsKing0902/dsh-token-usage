import type { PricingAssociation, AssociationStorageError } from './wire.ts';
export declare const ASSOCIATIONS_FILE = "pricing-associations.json";
export interface PricingAssociationsFile {
    version: 1;
    revision: number;
    associations: PricingAssociation[];
}
export type AssociationSnapshot = {
    state: 'ready';
    file: PricingAssociationsFile;
    source: string | null;
} | {
    state: 'unavailable';
    error: AssociationStorageError;
    source: string | null;
};
export declare class AssociationError extends Error {
    readonly code: string;
    readonly statusCode: number;
    constructor(code: string, statusCode?: number);
}
/** Compare complete names without trimming or dropping namespace components. */
export declare function isAssociationName(value: unknown): value is string;
export declare function exactFields(value: unknown, fields: readonly string[]): value is Record<string, unknown>;
export declare function coerceAssociations(value: unknown): PricingAssociationsFile | null;
/** Missing is empty; malformed or unreadable durable choices are never erased. */
export declare function readAssociations(dir: string): Promise<AssociationSnapshot>;
export declare function pricingDirectoryKey(dir: string): string;
/** Snapshot reads and feed/association commits share one process-local queue. */
export declare function withPricingDirectoryRead<T>(dir: string, run: () => Promise<T>): Promise<T>;
export declare function withPricingDirectoryWrite<T>(dir: string, run: () => Promise<T>): Promise<T>;
export declare function associationWritesPaused(dir: string): boolean;
export declare function pricingDirectoryEpoch(dir: string): number;
/** Block new commits to both directories, drain already accepted writes,
 * and keep them paused through copying, switching and source cleanup. */
export declare function withPricingDirectoryMigration<T>(oldDir: string, newDir: string, run: () => Promise<T>): Promise<T>;
/** Caller holds the directory queue. Verify both the directory epoch and
 * original bytes immediately before replacing durable user choices. */
export declare function writeAssociations(dir: string, expected: AssociationSnapshot & {
    state: 'ready';
}, file: PricingAssociationsFile, verifyDirectory: () => void): Promise<void>;
//# sourceMappingURL=pricing-associations.d.ts.map