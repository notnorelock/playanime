import { For } from 'solid-js';
import { cn } from '@playanime/ui';

/**
 * The cour ribbon — the design's signature element.
 *
 * A broadcast cour runs roughly thirteen weeks. This renders those weeks as
 * segments: elapsed filled, current pulsing amber, future empty.
 *
 * It earns its place because it answers the question a seasonal viewer actually
 * has — "how far into this season are we?" — which no Polish competitor
 * surfaces, and because it reads real dates rather than being decorative. It is
 * the only ambient motion in the interface; the pulse is suppressed under
 * prefers-reduced-motion by the stylesheet.
 */

const WEEKS_PER_COUR = 13;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

export interface CourRibbonProps {
  /** Broadcast start. Weeks are counted from here. */
  startDate: Date;
  /** Defaults to now. Injectable so the component is testable. */
  now?: Date;
  weeks?: number;
  class?: string;
}

/**
 * Which week the season is in: 0 before it starts, `weeks` once finished.
 * Clamped so a stale start date cannot produce a negative or runaway index.
 */
function currentWeek(startDate: Date, now: Date, weeks: number): number {
  const elapsed = now.getTime() - startDate.getTime();
  if (elapsed < 0) return 0;
  return Math.min(Math.floor(elapsed / MS_PER_WEEK) + 1, weeks);
}

export function CourRibbon(props: CourRibbonProps) {
  const weeks = () => props.weeks ?? WEEKS_PER_COUR;
  const week = () => currentWeek(props.startDate, props.now ?? new Date(), weeks());

  return (
    <div
      class={cn('cour-ribbon', props.class)}
      role="img"
      aria-label={`Tydzień ${String(week())} z ${String(weeks())} sezonu`}
    >
      <For each={Array.from({ length: weeks() }, (_, index) => index + 1)}>
        {(weekNumber) => (
          <span
            class={cn(
              'cour-ribbon__week',
              weekNumber < week() && 'cour-ribbon__week--elapsed',
              weekNumber === week() && 'cour-ribbon__week--current',
            )}
          />
        )}
      </For>
    </div>
  );
}
