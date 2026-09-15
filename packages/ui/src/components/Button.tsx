import { Button as KobalteButton } from '@kobalte/core/button';
import { cva, type VariantProps } from 'class-variance-authority';
import { splitProps, type JSX, type ValidComponent } from 'solid-js';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '../utils/cn.js';

/**
 * Button.
 *
 * Built on Kobalte's button primitive, which handles the parts that are easy to
 * get wrong by hand: rendering as `<a>` when given an href while keeping button
 * semantics, disabled state that is announced rather than merely styled, and
 * correct behaviour when the trigger is a non-button element.
 *
 * Variants follow the shadcn pattern — CVA for the variant matrix, `cn` so a
 * caller's classes win — but the treatments are PlayAnime's own. In particular
 * `primary` is amber, and amber means "live". It belongs on the one action that
 * matters on a screen, not on every button; use `secondary` by default.
 */
const buttonVariants = cva(
  // Base: applies to every variant. Focus is visible and offset so the ring
  // never sits on top of the button's own border.
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'font-medium rounded-md select-none',
    // leading-none is required: the theme sets a comfortable body line-height,
    // which on a fixed-height control makes the text box taller than the
    // button and pushes the label outside it.
    'leading-none',
    'transition-colors duration-[120ms] ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900',
    'disabled:pointer-events-none disabled:opacity-45',
    // Icons inside a button should never capture the pointer or shrink.
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ),
  {
    variants: {
      variant: {
        /** The single most important action on a screen. Amber = live. */
        primary: 'bg-amber-400 text-ink-950 hover:bg-amber-300 active:bg-amber-500',
        /** The default for most actions. */
        secondary: 'bg-ink-700 text-paper border border-ink-600 hover:bg-ink-600 hover:border-ink-500',
        /** Low-emphasis action inside dense UI. */
        ghost: 'text-slate-300 hover:bg-ink-700 hover:text-paper',
        /** Bordered, no fill. For a secondary action beside a primary one. */
        outline: 'border border-ink-500 text-paper hover:bg-ink-800 hover:border-ink-400',
        /** Destructive and irreversible: remove, block, delete. */
        danger: 'bg-rose-400 text-ink-950 hover:bg-rose-400/90 active:bg-rose-400/80',
        /** Reads as body text; for inline actions inside prose. */
        link: 'text-amber-400 underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        sm: 'h-8 px-3 text-xs [&_svg]:size-3.5',
        md: 'h-10 px-4 text-sm [&_svg]:size-4',
        lg: 'h-12 px-6 text-base [&_svg]:size-5',
        /** Square, for a lone icon. Paired with IconButton's aria-label. */
        icon: 'size-10 p-0 [&_svg]:size-4',
        'icon-sm': 'size-8 p-0 [&_svg]:size-3.5',
      },
      /** Stretches to the container. Used in forms and narrow drawers. */
      block: {
        true: 'w-full',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md',
    },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;

export interface ButtonProps extends ButtonVariants {
  class?: string;
  children?: JSX.Element;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
}

export function Button<T extends ValidComponent = 'button'>(
  props: PolymorphicProps<T, ButtonProps>,
) {
  // Solid props must not be destructured: destructuring reads them once and
  // breaks reactivity. splitProps is the supported way to separate them.
  const [local, rest] = splitProps(props as ButtonProps, [
    'class',
    'variant',
    'size',
    'block',
    'children',
  ]);

  return (
    <KobalteButton
      class={cn(
        buttonVariants({ variant: local.variant, size: local.size, block: local.block }),
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </KobalteButton>
  );
}

export { buttonVariants };
