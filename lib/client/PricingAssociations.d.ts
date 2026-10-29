import type { ReactNode } from 'react';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type { ModelResolution } from '../wire.ts';
import type { CurrencyView } from './format.ts';
export declare function PricingAssociationProvider({ resolutions, feedVersion, view, t, children }: {
    resolutions?: readonly ModelResolution[] | undefined;
    feedVersion?: number | undefined;
    view: CurrencyView;
    t: TranslateNS<'token-usage'>;
    children: ReactNode;
}): ReactNode;
/** Entry remains available even when the usage filter has no rows. */
export declare function PricingAssociationManagerButton({ t, onOpen }: {
    t: TranslateNS<'token-usage'>;
    onOpen?: () => void;
}): ReactNode;
export declare function PricingIssueLink({ resolution, version, t }: {
    resolution: ModelResolution;
    version?: number | undefined;
    t: TranslateNS<'token-usage'>;
}): ReactNode;
export declare function UnpricedModelTag({ model, t }: {
    model: string;
    t: TranslateNS<'token-usage'>;
}): ReactNode;
/** Show original associated IDs on hover without expanding the statistics row. */
export declare function ModelAssociationBadge({ model, t }: {
    model: string;
    t: TranslateNS<'token-usage'>;
}): ReactNode;
export declare function PricingAssociationDialog({ initialSource, view, t, onClose, returnFocus }: {
    initialSource: string | null;
    view: CurrencyView;
    t: TranslateNS<'token-usage'>;
    onClose: () => void;
    returnFocus?: HTMLElement | null;
}): ReactNode;
//# sourceMappingURL=PricingAssociations.d.ts.map