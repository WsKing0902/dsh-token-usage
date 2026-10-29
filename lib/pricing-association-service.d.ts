import { type LoggerLike } from './log.ts';
import type { PricingAssociationsPayload } from './wire.ts';
/** Directory epochs reject forms from an earlier directory, including a
 * round-trip back to the same path after migration. */
export declare class PricingAssociationService {
    private readonly directory;
    private readonly logger;
    private directoryKey;
    private directoryToken;
    constructor(directory: () => string, logger?: LoggerLike);
    directoryChanged(): void;
    private capture;
    private verify;
    private payload;
    read(sourceModel?: string): Promise<PricingAssociationsPayload>;
    /** Validate the entire request; clients cannot submit paths, prices or
     * whole files. Idempotency is checked only after the revision guard. */
    mutate(operation: 'save' | 'delete', value: unknown): Promise<PricingAssociationsPayload>;
}
//# sourceMappingURL=pricing-association-service.d.ts.map