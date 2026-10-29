/**
 * Imperative cost-cell motion (Web Animations API). Avoids CSS `@keyframes`
 * + custom-property bugs in some embedded hosts; runs on the actual DOM node.
 *
 * @module token-usage/client/cost-inflate-motion
 */
import type { CostInflateVars } from './cost-inflate.ts';
/** The user's motion preference: both runners refuse to animate (returning
 * null) when the OS asks for reduced motion. Exported so the chip hook can
 * skip spawning the DOM for flies that would never animate — a static +Δ
 * flash reads as a glitch, not information. */
export declare function motionAllowed(): boolean;
/** Scale bounce on the cost figure (`costPop`). The mix base is the pill's
 * resting tertiary (NOT label-primary): the pill reads tertiary beside the
 * official pills, and a primary-tinted final frame would leave the figure
 * permanently highlighted after the animation's fill. */
export declare function runCostPop(el: HTMLElement, v: CostInflateVars): Animation | null;
/** +Δ label fall (`deltaFall`). Caller must position the element (absolute,
 * below the pill — the dock sits under the composer, so the label falls
 * away from the message scrollport rather than climbing into it). */
export declare function runDeltaFly(el: HTMLElement, v: CostInflateVars): Animation | null;
//# sourceMappingURL=cost-inflate-motion.d.ts.map