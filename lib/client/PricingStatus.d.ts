import type { ReactNode } from 'react';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { AssociationStorageError, CostState, PricingUnavailableReason } from '../wire.ts';
export declare function costsAvailable(state?: CostState): boolean;
/** Shared failure reasons; matching and prices remain entirely on the host. */
export declare function PricingStatus({ costState, pricingUnavailableReason, associationStorageError, t }: {
    costState?: CostState | undefined;
    pricingUnavailableReason?: PricingUnavailableReason | undefined;
    associationStorageError?: AssociationStorageError | undefined;
    t: TranslateNS<'token-usage'>;
}): ReactNode;
//# sourceMappingURL=PricingStatus.d.ts.map