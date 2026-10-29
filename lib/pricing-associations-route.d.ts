import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import { PricingAssociationService } from './pricing-association-service.ts';
import { type LoggerLike } from './log.ts';
/** One local endpoint: list/inspect, save, revoke. No GET mutations. */
export declare function createPricingAssociationsRoute(service: PricingAssociationService, logger?: LoggerLike): WebRoute;
//# sourceMappingURL=pricing-associations-route.d.ts.map