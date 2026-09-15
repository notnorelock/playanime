import { cva, type VariantProps } from 'class-variance-authority';
import { splitProps, type JSX } from 'solid-js';
import { cn } from '../utils/cn.js';

/**
 * Badge.
 *
 * Carries state, not decoration. The `airing` variant is the only one that uses
 * amber, and it means the title is broadcasting now — the same meaning amber
 * carries everywhere else in the interface.
 */
const badgeVariants = cva(
  cn(
    'inline-flex items-center gap-1 whitespace-nowrap',
    'font-medium rounded-sm border',
    '[&_svg]:size-3 [&_svg]:shrink-0',
  ),
  {
    variants: {
      variant: {
        neutral: 'bg-ink-700 text-slate-300 border-ink-600',
        /** Broadcasting now. The one decorative-looking use of amber that isn't. */
        airing: 'bg-amber-950 text-amber-300 border-amber-500/40',
        finished: 'bg-ink-700 text-slate-400 border-ink-600',
        /** Approved, available, verified. */
        positive: 'bg-jade-950 text-jade-400 border-jade-400/30',
        /** Blocked, removed, copyright claim. */
        negative: 'bg-rose-950 text-rose-400 border-rose-400/30',
        info: 'bg-sky-950 text-sky-400 border-sky-400/30',
        /** Bordered only — for genre chips, where fills would be noisy. */
        outline: 'bg-transparent text-slate-300 border-ink-500',
      },
      size: {
        sm: 'h-5 px-1.5 text-2xs',
        md: 'h-6 px-2 text-xs',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
);

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  class?: string;
  children?: JSX.Element;
}

export function Badge(props: BadgeProps) {
  const [local] = splitProps(props, ['class', 'variant', 'size', 'children']);

  return (
    <span class={cn(badgeVariants({ variant: local.variant, size: local.size }), local.class)}>
      {local.children}
    </span>
  );
}

export { badgeVariants };
